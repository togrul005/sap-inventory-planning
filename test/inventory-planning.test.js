// Automated tests: business rules (unit) and the OData services against a local S/4HANA stand-in.
// Run with: npm test

import cds from '@sap/cds'
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import * as logic from '../srv/lib/planning.js'
import { batchesForUrl } from '../srv/lib/s4.js'

const MOCK_PORT = 4590
const MOCK = `http://localhost:${MOCK_PORT}`
// set before CAP reads .env, so the tests never call the real sandbox
process.env.S4_BASE_URL = `${MOCK}/s4hanacloud`
process.env.S4_API_KEY = 'test-key'
process.env.S4_WRITE_MODE = 'simulate'
process.env.FOUR_EYES = 'false'

let mock
before(async () => {
  mock = spawn(process.execPath, [path.join(import.meta.dirname, 'mock-s4', 'server.mjs'), String(MOCK_PORT)], { stdio: 'ignore' })
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${MOCK}/__log`); return } catch { await new Promise(resolve => setTimeout(resolve, 100)) }
  }
  throw new Error('mock S/4HANA did not start')
})
after(() => mock?.kill())

const { GET, POST } = cds.test(path.join(import.meta.dirname, '..'))
const planner = { auth: { username: 'planner', password: 'planner' } }
const approver = { auth: { username: 'approver', password: 'approver' } }
const demo = { auth: { username: 'demo', password: 'demo' } }

const mockLog = async () => (await fetch(`${MOCK}/__log`)).json()
const mockReset = () => fetch(`${MOCK}/__reset`, { method: 'POST' })
const mockFail = (service, status) => fetch(`${MOCK}/__fail`, { method: 'POST', body: JSON.stringify({ service, status }) })
const status = async (promise) => { try { return (await promise).status } catch (e) { return e.response?.status ?? e.status } }
const errorText = async (promise) => { try { await promise; return '' } catch (e) { return e.response?.data?.error?.message ?? e.message } }

const material = (id, plant = '1010') => `/odata/v4/planner/Materials(material='${id}',plant='${plant}')`
const propose = (id, data, user = planner) => POST(`${material(id)}/PlannerService.proposeChange`, data, user)
const change = id => `/odata/v4/approval/Changes(${id})`

// ---------------------------------------------------------------------------
describe('business rules', () => {
  it('classifies stock against the planning parameters', () => {
    assert.equal(logic.stockStatus({ stockQty: 10, reorderPoint: 0 }), 'N')
    assert.equal(logic.stockStatus({ stockQty: 20, reorderPoint: 100, safetyStock: 20 }), 'C')
    assert.equal(logic.stockStatus({ stockQty: 100, reorderPoint: 100, safetyStock: 20 }), 'R')
    assert.equal(logic.stockStatus({ stockQty: 101, reorderPoint: 100, safetyStock: 20, maxStock: 400 }), 'O')
    assert.equal(logic.stockStatus({ stockQty: 401, reorderPoint: 100, safetyStock: 20, maxStock: 400 }), 'E')
    assert.equal(logic.stockStatus({ stockQty: 5000, reorderPoint: 100, safetyStock: 20, maxStock: 0 }), 'O', 'no maximum, no excess')
    assert.equal(logic.stockLevelPct({ stockQty: 100, reorderPoint: 100, maxStock: 400 }), 25)
    assert.equal(logic.targetStock({ reorderPoint: 60 }), 120, 'without maximum stock the upper level is twice the reorder point')
  })

  it('measures consumption over the last 12 periods: issues minus reversals, other movements ignored', () => {
    const item = (Material, GoodsMovementType, QuantityInBaseUnit, FiscalYearPeriod) => ({ Material, GoodsMovementType, QuantityInBaseUnit, FiscalYearPeriod })
    const items = [
      item('A', '601', '100.000', '2025012'),
      item('A', '601', '50.000', '2025001'),
      item('A', '201', '30.000', '2024012'), // outside the window 2025001-2025012
      item('A', '602', '20.000', '2025012'), // reversal
      item('A', '101', '999.000', '2025006'), // goods receipt
      item('B', '261', '365.000', '2025006'),
      item('B', '262', '400.000', '2025007') // return larger than the issues of the month: clamped at 0
    ]
    const { byMaterial, from, to } = logic.aggregateConsumption(items)
    assert.equal(from, '2025001')
    assert.equal(to, '2025012')
    assert.equal(byMaterial.get('A').consumptionQty, 130)
    assert.equal(byMaterial.get('A').consumptionDocs, 3)
    assert.equal(byMaterial.get('B').consumptionQty, 365)
    assert.equal(byMaterial.get('B').avgDailyDemand, 1)
    assert.ok(byMaterial.get('B').demandStdDevDaily > 0)

    const later = logic.aggregateConsumption(items, 12, '2026003')
    assert.equal(later.from, '2025004')
    assert.equal(later.byMaterial.get('A').consumptionQty, 80, 'the window can end at a given period')
    assert.equal(logic.aggregateConsumption([]).from, null)
    assert.equal(logic.periodIndex('2025013'), 2025 * 12 + 11)
    assert.equal(logic.periodLabel(logic.periodIndex('2025008')), '2025008')
  })

  it('suggests safety stock, reorder point and maximum stock with the reorder-point formula', () => {
    // SS = 1.645 x 4 x sqrt(9) = 19.74 -> 20; ROP = 10 x 9 + 20 = 110; MAX = 110 + 14 x 10 = 250
    const base = { avgDailyDemand: 10, demandStdDevDaily: 4, leadTimeDays: 9, consumptionDocs: 24 }
    assert.deepEqual(logic.suggestParameters(base), { reorderPoint: 110, safetyStock: 20, maxStock: 250, leadTimeDays: 9, method: 'STATISTICAL' })
    assert.equal(logic.suggestParameters({ ...base, minLotSize: 200, roundingQty: 25 }).maxStock, 325, 'minimum lot size and rounding')
    // fewer than 3 goods issues: safety stock = half of the lead-time demand
    assert.deepEqual(logic.suggestParameters({ ...base, consumptionDocs: 2 }), { reorderPoint: 135, safetyStock: 45, maxStock: 275, leadTimeDays: 9, method: 'SIMPLE' })
    assert.equal(logic.suggestParameters({ ...base, leadTimeDays: null }).leadTimeDays, 7, 'default lead time')
    assert.equal(logic.suggestParameters({ ...base, avgDailyDemand: 0 }), null, 'no demand, no suggestion')
    assert.equal(logic.deviationPct({ reorderPoint: 100, suggestedReorderPoint: 130 }), 30)
    assert.equal(logic.deviationPct({ reorderPoint: 0, suggestedReorderPoint: 10 }), 100)
    assert.equal(logic.deviationPct({ reorderPoint: 100 }), null)
  })

  it('validates a proposal', () => {
    const ok = { reorderPoint: 100, safetyStock: 30, maxStock: 300, leadTimeDays: 7, reason: 'Demand grew' }
    assert.deepEqual(logic.validateProposal(ok), [])
    assert.match(logic.validateProposal({ ...ok, reorderPoint: 0 }).join(), /greater than 0/)
    assert.match(logic.validateProposal({ ...ok, safetyStock: 100 }).join(), /safety stock must be lower/)
    assert.match(logic.validateProposal({ ...ok, maxStock: 90 }).join(), /maximum stock must be higher/)
    assert.deepEqual(logic.validateProposal({ ...ok, maxStock: 0 }), [], 'no maximum stock is allowed')
    assert.match(logic.validateProposal({ ...ok, leadTimeDays: 0.5 }).join(), /whole number/)
    assert.match(logic.validateProposal({ ...ok, reason: ' ' }).join(), /reason/)
    assert.match(logic.validateProposal({ ...ok, safetyStock: -1 }).join(), /0 or more/)
  })

  it('switches to a reorder-point MRP type and classifies the proposal', () => {
    assert.equal(logic.reorderPointMrpType('V1'), 'V1')
    assert.equal(logic.reorderPointMrpType('PD'), 'VB')
    assert.equal(logic.reorderPointMrpType(null), 'VB')
    const s = { reorderPoint: 110, safetyStock: 20, maxStock: 250 }
    assert.equal(logic.proposalMethod({ ...s }, s), 'FORMULA')
    assert.equal(logic.proposalMethod({ ...s, maxStock: 300 }, s), 'ADJUSTED')
    assert.equal(logic.proposalMethod(s, null), 'MANUAL')
    assert.equal(logic.safetyStockValueChange(30, 129, 1.45, 1), 143.55)
    assert.equal(logic.safetyStockValueChange(100, 5, 35, 1000), -3.33)
    assert.equal(logic.safetyStockValueChange(1, 2, null, 1), null)
  })

  it('reads prices, stock and MRP data from the S/4HANA formats', () => {
    const v = logic.pickValuations([
      { Product: 'A', ValuationType: '', InventoryValuationProcedure: 'V', StandardPrice: '0', MovingAveragePrice: '1.45', PriceUnitQty: '1', Currency: 'EUR' },
      { Product: 'B', ValuationType: 'NEW', InventoryValuationProcedure: 'S', StandardPrice: '13', MovingAveragePrice: '0', PriceUnitQty: '1', Currency: 'EUR' },
      { Product: 'B', ValuationType: '', InventoryValuationProcedure: 'S', StandardPrice: '11.5', MovingAveragePrice: '12', PriceUnitQty: '10', Currency: 'EUR' },
      { Product: 'C', ValuationType: '', InventoryValuationProcedure: 'S', StandardPrice: '0', MovingAveragePrice: '0', PriceUnitQty: '1', Currency: 'EUR' }
    ])
    assert.equal(v.get('A').price, 1.45, 'moving average price for procedure V')
    assert.deepEqual(v.get('B'), { price: 11.5, priceUnitQty: 10, currency: 'EUR', split: false }, 'the record without split valuation wins')
    assert.equal(v.has('C'), false, 'no price, no valuation')

    const [s] = logic.aggregateStock([
      { Material: 'A', Plant: '1010', StorageLocation: '101A', InventorySpecialStockType: '', InventoryStockType: '01', MaterialBaseUnit: 'PC', MatlWrhsStkQtyInMatlBaseUnit: '70' },
      { Material: 'A', Plant: '1010', StorageLocation: '101A', InventorySpecialStockType: 'K', InventoryStockType: '01', MaterialBaseUnit: 'PC', MatlWrhsStkQtyInMatlBaseUnit: '500' },
      { Material: 'A', Plant: '1010', StorageLocation: '101B', InventorySpecialStockType: '', InventoryStockType: '02', MaterialBaseUnit: 'PC', MatlWrhsStkQtyInMatlBaseUnit: '5' }
    ])
    assert.deepEqual(s, { material: 'A', plant: '1010', baseUnit: 'PC', stockQty: 70, otherStockQty: 505, storageLocations: 2 })

    const p = logic.parametersFromSupplyPlanning({ MRPType: 'PD', ReorderThresholdQuantity: '0', SafetyStockQuantity: '40', MaximumStockQuantity: '0', PlannedDeliveryDurationInDays: '0' })
    assert.equal(p.reorderPoint, 40, 'a safety stock alone acts as reorder point')
    assert.equal(p.leadTimeDays, null)
  })

  it('keeps approved parameters until S/4HANA holds them, and keeps stored ones if MRP data fails', () => {
    const stock = { material: 'A', baseUnit: 'PC', stockQty: 50, otherStockQty: 0, storageLocations: 1 }
    const sp = { MRPType: 'VB', ReorderThresholdQuantity: '100', SafetyStockQuantity: '30', MaximumStockQuantity: '400', PlannedDeliveryDurationInDays: '7' }
    const approved = { material: 'A', plant: '1010', parameterSource: 'APPROVED', reorderPoint: 120, safetyStock: 40, maxStock: 500, leadTimeDays: 7 }
    const kept = logic.mergeMaterial({ existing: approved, stock, supplyPlanning: sp, plant: '1010', syncedAt: 'now' })
    assert.equal(kept.reorderPoint, undefined, 'approved parameters are not overwritten')
    const held = logic.mergeMaterial({ existing: approved, stock, supplyPlanning: { ...sp, ReorderThresholdQuantity: '120', SafetyStockQuantity: '40', MaximumStockQuantity: '500' }, plant: '1010', syncedAt: 'now' })
    assert.equal(held.parameterSource, 'S4', 'once S/4HANA holds the values, S/4HANA is the source again')
    const fresh = logic.mergeMaterial({ existing: { ...approved, parameterSource: 'S4' }, stock, supplyPlanning: sp, plant: '1010', syncedAt: 'now' })
    assert.equal(fresh.reorderPoint, 100)
    const failed = logic.mergeMaterial({ existing: { ...approved, parameterSource: 'S4' }, stock, supplyPlanningAvailable: false, plant: '1010', syncedAt: 'now' })
    assert.equal(failed.reorderPoint, undefined, 'MRP data not readable: stored parameters stay')
    const withDemand = logic.mergeMaterial({ stock, supplyPlanning: sp, consumption: { consumptionQty: 3650, consumptionDocs: 40, avgDailyDemand: 10, demandStdDevDaily: 4 }, plant: '1010', syncedAt: 'now' })
    // SS = 1.645 x 4 x sqrt(7) = 17.4 -> 18, ROP = 10 x 7 + 18 = 88, MAX = 88 + 14 x 10 = 228
    assert.deepEqual([withDemand.suggestedSafetyStock, withDemand.suggestedReorderPoint, withDemand.suggestedMaxStock], [18, 88, 228])
  })

  it('numbers changes per year and builds the OData V2 update for S/4HANA', () => {
    assert.equal(logic.nextChangeNo(null, 2026), 'PC-2026-0001')
    assert.equal(logic.nextChangeNo('PC-2026-0041', 2026), 'PC-2026-0042')
    assert.equal(logic.nextChangeNo('PC-2025-0099', 2026), 'PC-2026-0001')
    assert.equal(logic.supplyPlanningKey("A'B", '1010'), "A_ProductSupplyPlanning(Product='A''B',Plant='1010')")
    assert.deepEqual(logic.supplyPlanningPayload({ newMrpType: 'VB', newReorderPoint: 298, newSafetyStock: 129, newMaxStock: 636, newLeadTimeDays: 7 }), {
      MRPType: 'VB', ReorderThresholdQuantity: '298', SafetyStockQuantity: '129', MaximumStockQuantity: '636', PlannedDeliveryDurationInDays: '7'
    })
  })

  it('keeps S/4HANA URLs short enough to avoid $batch', () => {
    const materials = Array.from({ length: 100 }, (_, i) => `MATERIAL-${String(i).padStart(9, '0')}`)
    const batches = batchesForUrl(materials, 'Material', 420)
    assert.equal(batches.flat().length, 100)
    for (const b of batches) assert.ok(b.reduce((a, m) => a + 'Material'.length + m.length + 20, 0) <= 1000 - 420)
    assert.equal(batchesForUrl(['A', 'B'], 'Product', 100, 1).length, 2, 'at most maxPerBatch values per batch')
  })
})

// ---------------------------------------------------------------------------
describe('PlannerService and ApprovalService with S/4HANA', () => {
  it('checks every S/4HANA API', async () => {
    const { data } = await GET('/odata/v4/planner/testS4Connection()', planner)
    assert.equal(data.value.length, 5)
    assert.ok(data.value.every(c => c.ok), JSON.stringify(data.value))
  })

  it('syncs a plant from S/4HANA with plain GET requests and the API key', async () => {
    await mockReset()
    const { data } = await POST('/odata/v4/planner/syncFromS4', { plant: '1010' }, planner)
    assert.equal(data.result, 'OK', data.message)
    assert.equal(data.materials, 10)
    assert.equal(data.parametersFromS4, 9)
    assert.equal(data.pricesFromS4, 10)
    assert.match(data.message, /periods 2025001–2025012/)
    const log = await mockLog()
    assert.ok(log.length > 5)
    assert.ok(log.every(l => l.apikey === 'test-key'), 'every call sends the API key')
    assert.ok(log.every(l => l.method === 'GET'), 'no $batch and no writes during a sync')
    assert.ok(log.some(l => l.path.includes("A_MaterialDocumentItem") && l.path.includes("FiscalYearPeriod ge '2025001'")), 'goods issues are read for the 12-period window only')
  })

  it('returns materials with status, coverage, value and suggested parameters', async () => {
    const { data } = await GET("/odata/v4/planner/Materials?$filter=plant eq '1010'&$orderby=statusSort,material", planner)
    const byId = Object.fromEntries(data.value.map(m => [m.material, m]))
    assert.deepEqual(data.value.map(m => m.status).join(''), 'CCCRRRNNEO')
    const tg11 = byId.TG11
    assert.equal(tg11.status, 'R')
    assert.deepEqual([Number(tg11.suggestedReorderPoint), Number(tg11.suggestedSafetyStock), Number(tg11.suggestedMaxStock)], [298, 129, 636])
    assert.equal(tg11.suggestionMethod, 'STATISTICAL')
    assert.equal(tg11.suggestedStatus, 'C')
    assert.equal(Number(tg11.deviationPct), 198)
    assert.equal(Number(tg11.stockValue), 116, '80 x 1.45 EUR (moving average price)')
    assert.equal(Number(byId.TG12.consumptionQty), 2850, 'return of 30 subtracted, cancelled issue and its reversal cancel out')
    assert.equal(byId.TG14.suggestionMethod, 'SIMPLE')
    assert.equal(byId.TG13.parameterSource, 'NONE')
    assert.equal(byId.TG19.suggestedReorderPoint, null, 'no goods issues, no suggestion')
    assert.equal(Number(byId.TG17.stockValue), 91, '2600 x 35 EUR per 1000')
    assert.equal(Number(byId.TG15.stockQty), 0, 'quality-inspection stock is not unrestricted')
    assert.equal(Number(byId.TG16.stockQty), 70, 'consignment stock does not count')
    assert.ok(Number(byId.TG10.coverageDays) > 15)
  })

  it('filters the materials to review over OData', async () => {
    const { data } = await GET("/odata/v4/planner/Materials?$filter=plant eq '1010' and reviewNeeded eq true&$select=material,deviationPct", planner)
    assert.deepEqual(data.value.map(m => m.material).sort(), ['TG11', 'TG12', 'TG13', 'TG14', 'TG15', 'TG17'])
    assert.ok(data.value.every(m => Number(m.deviationPct) >= 25))
  })

  it('reports key figures for the tiles', async () => {
    const { data } = await GET("/odata/v4/planner/kpis(plant='1010')", planner)
    assert.deepEqual([data.critical, data.reorder, data.healthy, data.excess, data.noParameters, data.toReview], [3, 3, 1, 1, 2, 6])
    assert.equal(data.currency, 'EUR')
    assert.equal(Number(data.excessValue), 38.5)
    assert.equal(data.lastSyncResult, 'OK')
  })

  it('recalculates the suggestion for another lead time', async () => {
    const { data } = await GET(`${material('TG11')}/PlannerService.suggestFor(leadTimeDays=10)`, planner)
    assert.equal(data.leadTimeDays, 10)
    assert.ok(data.safetyStock > 129 && data.reorderPoint > 298)
    assert.equal(await status(GET(`${material('TG11')}/PlannerService.suggestFor(leadTimeDays=0)`, planner)), 400)
  })

  it('validates a proposal and blocks a second open one', async () => {
    assert.match(await errorText(propose('TG10', { reorderPoint: 50, safetyStock: 60, maxStock: 0, reason: 'Too much stock' })), /safety stock must be lower/)
    assert.match(await errorText(propose('TG10', { reorderPoint: 150, safetyStock: 50, maxStock: 600, leadTimeDays: 5, reason: 'Nothing new' })), /same as the current/)
    const { data } = await propose('TG11', { reorderPoint: 298, safetyStock: 129, maxStock: 636, leadTimeDays: 7, reason: 'Demand has doubled within a year' })
    assert.equal(data.changeNo, `PC-${new Date().getUTCFullYear()}-0001`)
    assert.equal(data.status_code, 'S')
    assert.equal(data.method, 'FORMULA')
    assert.equal(data.statusBefore_code, 'R')
    assert.equal(data.statusAfter_code, 'C')
    assert.equal(Number(data.safetyStockValueChange), 143.55)
    assert.equal(data.newMrpType, 'VB')
    assert.equal(await status(propose('TG11', { reorderPoint: 200, safetyStock: 50, reason: 'Another one' })), 409)
    const m = (await GET(material('TG11'), planner)).data
    assert.equal(m.openChangeNo, data.changeNo)
    assert.equal(m.openChangeStatus, 'S')
  })

  it('switches a material without reorder point to MRP type VB', async () => {
    const { data } = await propose('TG13', { reorderPoint: 50, safetyStock: 10, maxStock: 120, reason: 'Start reorder-point planning' })
    assert.equal(data.currentMrpType, 'PD')
    assert.equal(data.newMrpType, 'VB')
    assert.equal(data.method, 'ADJUSTED')
    assert.equal(data.statusBefore_code, 'N')
  })

  it('separates the planner and approver roles', async () => {
    assert.equal(await status(GET('/odata/v4/approval/Changes', planner)), 403)
    assert.equal(await status(GET('/odata/v4/planner/Materials', approver)), 403)
    const { data } = await GET('/odata/v4/planner/whoAmI()', demo)
    assert.deepEqual(data.roles, ['Planner', 'Approver'])
    assert.equal(data.writeMode, 'simulate')
    assert.match(data.connection, /mock S\/4HANA/)
  })

  it('approves a change and simulates the update of the MRP data in S/4HANA', async () => {
    const { data: list } = await GET("/odata/v4/approval/Changes?$filter=material eq 'TG11'", approver)
    const id = list.value[0].ID
    assert.equal(await status(POST(`${change(id)}/ApprovalService.updateS4`, {}, approver)), 409, 'not approved yet')
    const { data: approved } = await POST(`${change(id)}/ApprovalService.approveChange`, { note: 'Agreed' }, approver)
    assert.equal(approved.status_code, 'A')
    assert.equal(approved.decidedBy, 'approver')
    const { data: updated } = await POST(`${change(id)}/ApprovalService.updateS4`, {}, approver)
    assert.equal(updated.status_code, 'U')
    assert.equal(updated.s4Mode, 'SIMULATED')
    assert.equal(updated.s4Target, "A_ProductSupplyPlanning(Product='TG11',Plant='1010')")
    assert.deepEqual(JSON.parse(updated.s4Payload), { MRPType: 'VB', ReorderThresholdQuantity: '298', SafetyStockQuantity: '129', MaximumStockQuantity: '636', PlannedDeliveryDurationInDays: '7' })
    assert.ok((await mockLog()).every(l => l.method !== 'PATCH'), 'simulated: nothing is sent to S/4HANA')

    const m = (await GET(material('TG11'), planner)).data
    assert.deepEqual([Number(m.reorderPoint), Number(m.safetyStock), Number(m.maxStock)], [298, 129, 636])
    assert.equal(m.parameterSource, 'APPROVED')
    assert.equal(m.parameterChangeNo, updated.changeNo)
    assert.equal(m.openChangeNo, null)
    const { data: events } = await GET(`/odata/v4/approval/Changes(${id})/events?$orderby=eventAt`, approver)
    assert.deepEqual(events.value.map(e => e.eventType), ['SUBMITTED', 'APPROVED', 'S4_UPDATED'])

    // the read-only sandbox still has the old values: the approved ones stay in the cockpit
    await POST('/odata/v4/planner/syncFromS4', { plant: '1010' }, planner)
    const again = (await GET(material('TG11'), planner)).data
    assert.equal(Number(again.reorderPoint), 298)
    assert.equal(again.parameterSource, 'APPROVED')
  })

  it('requires a reason to reject, and lets the planner withdraw a proposal', async () => {
    const { data: list } = await GET("/odata/v4/approval/Changes?$filter=material eq 'TG13'", approver)
    const id = list.value[0].ID
    assert.equal(await status(POST(`${change(id)}/ApprovalService.rejectChange`, { note: ' ' }, approver)), 400, 'a reason is mandatory')
    const { data: rejected } = await POST(`${change(id)}/ApprovalService.rejectChange`, { note: 'Use the suggestion' }, approver)
    assert.equal(rejected.status_code, 'R')
    assert.equal(await status(POST(`/odata/v4/planner/Changes(${id})/PlannerService.withdraw`, {}, planner)), 409, 'already closed')

    const { data: second } = await propose('TG13', { reorderPoint: 44, safetyStock: 9, maxStock: 114, reason: 'As suggested' })
    assert.equal(second.method, 'FORMULA')
    const { data: withdrawn } = await POST(`/odata/v4/planner/Changes(${second.ID})/PlannerService.withdraw`, { reason: 'Wait for the next sync' }, planner)
    assert.equal(withdrawn.status_code, 'W')
  })

  it('applies the four-eyes principle when switched on', async () => {
    process.env.FOUR_EYES = 'true'
    try {
      const { data } = await propose('TG16', { reorderPoint: 112, safetyStock: 15, maxStock: 209, reason: 'As suggested' }, demo)
      assert.equal(await status(POST(`${change(data.ID)}/ApprovalService.approveChange`, {}, demo)), 403)
      const { data: ok } = await POST(`${change(data.ID)}/ApprovalService.approveChange`, {}, approver)
      assert.equal(ok.status_code, 'A')
    } finally {
      process.env.FOUR_EYES = 'false'
    }
  })

  it('sends a PATCH with CSRF token and If-Match to S/4HANA in live mode', async () => {
    await mockReset()
    process.env.S4_WRITE_MODE = 'live'
    try {
      const { data } = await propose('TG10', { reorderPoint: 144, safetyStock: 9, maxStock: 522, leadTimeDays: 5, reason: 'Align with the formula' })
      await POST(`${change(data.ID)}/ApprovalService.approveChange`, {}, approver)
      const { data: updated } = await POST(`${change(data.ID)}/ApprovalService.updateS4`, {}, approver)
      assert.equal(updated.s4Mode, 'S4')
      const patch = (await mockLog()).find(l => l.method === 'PATCH')
      assert.ok(patch, 'PATCH sent')
      assert.match(patch.path, /A_ProductSupplyPlanning\(Product='TG10',Plant='1010'\)$/)
      assert.equal(patch.csrf, 'mock-csrf-token')
      assert.equal(patch.ifMatch, '*')
      assert.deepEqual(patch.body, { MRPType: 'VB', ReorderThresholdQuantity: '144', SafetyStockQuantity: '9', MaximumStockQuantity: '522', PlannedDeliveryDurationInDays: '5' })
      // S/4HANA now holds the values, so the next sync takes them from there
      await POST('/odata/v4/planner/syncFromS4', { plant: '1010' }, planner)
      const m = (await GET(material('TG10'), planner)).data
      assert.equal(m.parameterSource, 'S4')
      assert.equal(Number(m.reorderPoint), 144)
    } finally {
      process.env.S4_WRITE_MODE = 'simulate'
    }
  })

  it('keeps the change approved if S/4HANA rejects the update', async () => {
    process.env.S4_WRITE_MODE = 'live'
    try {
      const { data } = await propose('TG18', { reorderPoint: 149, safetyStock: 10, maxStock: 475, reason: 'As suggested' })
      await POST(`${change(data.ID)}/ApprovalService.approveChange`, {}, approver)
      await mockFail('API_PRODUCT_SRV', 500)
      assert.match(await errorText(POST(`${change(data.ID)}/ApprovalService.updateS4`, {}, approver)), /Updating the MRP data in S\/4HANA failed/)
      await mockReset()
      const { data: still } = await GET(`${change(data.ID)}`, approver)
      assert.equal(still.status_code, 'A', 'can be retried')
    } finally {
      process.env.S4_WRITE_MODE = 'simulate'
      await mockReset()
    }
  })

  it('syncs many materials with long numbers without $batch', async () => {
    await mockReset()
    const { data } = await POST('/odata/v4/planner/syncFromS4', { plant: '1020' }, planner)
    assert.equal(data.result, 'OK', data.message)
    assert.equal(data.materials, 60)
    assert.equal(data.consumptionDocs, 720)
    const log = await mockLog()
    assert.ok(log.every(l => l.method === 'GET' && !l.path.includes('$batch')))
    assert.ok(log.every(l => l.length < 1100), `longest URL ${Math.max(...log.map(l => l.length))}`)
  })

  it('keeps going when a secondary S/4HANA API fails', async () => {
    await mockFail('API_MATERIAL_DOCUMENT_SRV', 500)
    const { data } = await POST('/odata/v4/planner/syncFromS4', { plant: '1010' }, planner)
    assert.equal(data.result, 'PARTIAL')
    assert.match(data.message, /Goods issues:/)
    const m = (await GET(material('TG12'), planner)).data
    assert.equal(Number(m.consumptionQty), 2850, 'the consumption read before is kept')
    await mockReset()
  })

  it('explains a rejected API key and logs the failed sync', async () => {
    await mockFail('API_MATERIAL_STOCK_SRV', 401)
    const { data: run } = await POST('/odata/v4/planner/syncFromS4', { plant: '1010' }, planner)
    assert.equal(run.result, 'FAILED')
    assert.match(run.message, /rejected the API key \(HTTP 401\)/)
    const { data } = await GET("/odata/v4/planner/SyncRuns?$filter=result eq 'FAILED'", planner)
    assert.equal(data.value.length, 1, 'the failed run is logged')
    const m = (await GET(material('TG10'), planner)).data
    assert.ok(Number(m.stockQty) > 0, 'the stored stock is kept')
    await mockReset()
    assert.equal(await status(POST('/odata/v4/planner/syncFromS4', { plant: '10' }, planner)), 400)
  })
})
