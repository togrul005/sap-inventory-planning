import cds from '@sap/cds'
import {
  CHANGE_STATUS, OPEN_CHANGE_STATUSES, SERVICE_LEVEL_PCT,
  num, round, stockStatus, targetStock, stockLevelPct, suggestParameters, validateProposal,
  reorderPointMrpType, proposalMethod, safetyStockValueChange, nextChangeNo
} from './lib/planning.js'
import { syncPlant } from './lib/sync.js'
import { fetchPlants, checkConnections, describeError, connectionInfo } from './lib/s4.js'
import { writeMode, fourEyes } from './lib/config.js'

const PLANT_PATTERN = /^[A-Z0-9]{4}$/
const key = (material, plant) => material + '|' + plant

/** Suggestion for the material's demand with the given lead time */
const suggestionFor = (m, leadTimeDays) => suggestParameters({
  avgDailyDemand: m.avgDailyDemand,
  demandStdDevDaily: m.demandStdDevDaily,
  leadTimeDays: leadTimeDays ?? m.leadTimeDays,
  consumptionDocs: m.consumptionDocs,
  minLotSize: m.minLotSize,
  roundingQty: m.roundingQty
})

export class PlannerService extends cds.ApplicationService {
  init () {
    const { Materials, Changes } = this.entities
    const db = cds.entities('brightline.planning')

    /** Adds the open change, the stock level and the status with the suggested parameters */
    const enrich = async (rows) => {
      const list = (Array.isArray(rows) ? rows : [rows]).filter(r => r && r.material && r.plant)
      if (!list.length) return
      const plants = [...new Set(list.map(r => r.plant))]
      const materials = [...new Set(list.map(r => r.material))]
      // read the stored values, because the client may not have selected them
      const stored = await SELECT.from(db.Materials)
        .columns('material', 'plant', 'stockQty', 'reorderPoint', 'safetyStock', 'maxStock',
          'suggestedReorderPoint', 'suggestedSafetyStock', 'suggestedMaxStock', 'consumptionDocs', 'demandStdDevDaily')
        .where({ plant: { in: plants }, material: { in: materials } })
      const byKey = new Map(stored.map(m => [key(m.material, m.plant), m]))
      const open = await SELECT.from(db.ParameterChanges)
        .columns('ID', 'changeNo', 'material', 'plant', 'status_code')
        .where({ plant: { in: plants }, material: { in: materials }, status_code: { in: OPEN_CHANGE_STATUSES } })
      const openByKey = new Map(open.map(o => [key(o.material, o.plant), o]))
      for (const r of list) {
        const m = byKey.get(key(r.material, r.plant))
        if (!m) continue
        const o = openByKey.get(key(r.material, r.plant))
        r.openChangeID = o?.ID ?? null
        r.openChangeNo = o?.changeNo ?? null
        r.openChangeStatus = o?.status_code ?? null
        r.targetStock = targetStock(m)
        r.stockLevelPct = stockLevelPct(m)
        const hasSuggestion = m.suggestedReorderPoint !== null && m.suggestedReorderPoint !== undefined
        r.suggestedStatus = hasSuggestion
          ? stockStatus({ stockQty: m.stockQty, reorderPoint: m.suggestedReorderPoint, safetyStock: m.suggestedSafetyStock, maxStock: m.suggestedMaxStock })
          : null
        r.suggestionMethod = hasSuggestion ? (num(m.consumptionDocs) >= 3 && num(m.demandStdDevDaily) > 0 ? 'STATISTICAL' : 'SIMPLE') : null
      }
    }

    this.after('READ', Materials, enrich)

    const loadMaterial = async (req) => {
      const { material, plant } = req.params[0]
      const m = await SELECT.one.from(db.Materials).where({ material, plant })
      if (!m) req.reject(404, `Material ${material} was not found in plant ${plant}.`)
      return m
    }

    // --- suggestion and proposal ---------------------------------------------

    this.on('suggestFor', Materials, async req => {
      const m = await loadMaterial(req)
      const lead = req.data.leadTimeDays
      if (lead !== null && lead !== undefined && (!Number.isInteger(Number(lead)) || lead < 1 || lead > 365)) {
        return req.reject(400, 'The lead time must be a whole number of days between 1 and 365.', 'leadTimeDays')
      }
      const s = suggestionFor(m, lead)
      if (!s) return null
      return { ...s, statusAfter: stockStatus({ ...m, ...s }) }
    })

    this.on('proposeChange', Materials, async req => {
      const m = await loadMaterial(req)
      const { material, plant } = m
      const input = {
        reorderPoint: req.data.reorderPoint,
        safetyStock: req.data.safetyStock ?? 0,
        maxStock: req.data.maxStock ?? 0,
        leadTimeDays: req.data.leadTimeDays ?? m.leadTimeDays,
        reason: req.data.reason
      }
      const errors = validateProposal(input)
      if (errors.length) return req.reject(400, errors.join(' '))

      const pending = await SELECT.one.from(db.ParameterChanges)
        .columns('changeNo', 'status_code')
        .where({ material, plant, status_code: { in: OPEN_CHANGE_STATUSES } })
      if (pending) {
        return req.reject(409, `Change ${pending.changeNo} for ${material} is still open. Wait until it is decided and written to S/4HANA, or withdraw it first.`)
      }

      const proposal = {
        mrpType: reorderPointMrpType(m.mrpType),
        reorderPoint: round(num(input.reorderPoint)),
        safetyStock: round(num(input.safetyStock)),
        maxStock: round(num(input.maxStock)),
        leadTimeDays: Number(input.leadTimeDays)
      }
      const unchanged = proposal.mrpType === m.mrpType &&
        proposal.reorderPoint === round(num(m.reorderPoint)) &&
        proposal.safetyStock === round(num(m.safetyStock)) &&
        proposal.maxStock === round(num(m.maxStock)) &&
        proposal.leadTimeDays === Number(m.leadTimeDays)
      if (unchanged) return req.reject(400, 'The proposal is the same as the current parameters.')

      const suggestion = suggestionFor(m, proposal.leadTimeDays)
      const last = await SELECT.one.from(db.ParameterChanges).columns('changeNo')
        .where({ changeNo: { like: `PC-${new Date().getUTCFullYear()}-%` } }).orderBy('changeNo desc')
      const changeNo = nextChangeNo(last?.changeNo)
      const ID = cds.utils.uuid()
      const reason = String(input.reason).trim()
      const coverage = num(m.avgDailyDemand) > 0 ? round(num(m.stockQty) / num(m.avgDailyDemand), 1) : null

      await INSERT.into(db.ParameterChanges).entries({
        ID,
        changeNo,
        material,
        plant,
        description: m.description,
        baseUnit: m.baseUnit,
        currentMrpType: m.mrpType,
        currentReorderPoint: m.reorderPoint,
        currentSafetyStock: m.safetyStock,
        currentMaxStock: m.maxStock,
        currentLeadTimeDays: m.leadTimeDays,
        newMrpType: proposal.mrpType,
        newReorderPoint: proposal.reorderPoint,
        newSafetyStock: proposal.safetyStock,
        newMaxStock: proposal.maxStock,
        newLeadTimeDays: proposal.leadTimeDays,
        method: proposalMethod(proposal, suggestion),
        avgDailyDemand: m.avgDailyDemand,
        demandStdDevDaily: m.demandStdDevDaily,
        serviceLevelPct: SERVICE_LEVEL_PCT,
        consumptionDocs: m.consumptionDocs,
        suggestedReorderPoint: suggestion?.reorderPoint ?? null,
        suggestedSafetyStock: suggestion?.safetyStock ?? null,
        suggestedMaxStock: suggestion?.maxStock ?? null,
        reason,
        stockAtRequest: m.stockQty,
        coverageDaysAtRequest: coverage,
        statusBefore_code: stockStatus(m),
        statusAfter_code: stockStatus({ ...m, ...proposal }),
        price: m.price,
        priceUnitQty: m.priceUnitQty,
        currency: m.currency,
        safetyStockValueChange: safetyStockValueChange(m.safetyStock, proposal.safetyStock, m.price, m.priceUnitQty),
        status_code: CHANGE_STATUS.SUBMITTED,
        events: [{ eventType: 'SUBMITTED', note: reason }]
      })
      req.notify(`Change ${changeNo} for ${material} submitted for approval.`)
      return SELECT.one.from(Changes).where({ ID })
    })

    this.on('withdraw', Changes, async req => {
      const { ID } = req.params[0]
      const c = await SELECT.one.from(db.ParameterChanges).where({ ID })
      if (!c) return req.reject(404, 'Change not found.')
      if (!OPEN_CHANGE_STATUSES.includes(c.status_code)) {
        return req.reject(409, `Change ${c.changeNo} is already closed and cannot be withdrawn.`)
      }
      if (c.createdBy !== req.user.id && !req.user.is('Approver')) return req.reject(403, 'You can only withdraw your own proposals.')
      const note = req.data.reason?.trim() || null
      await UPDATE(db.ParameterChanges, { ID }).set({ status_code: CHANGE_STATUS.WITHDRAWN })
      await INSERT.into(db.ChangeEvents).entries({ change_ID: ID, eventType: 'WITHDRAWN', note })
      req.notify(`Change ${c.changeNo} withdrawn.`)
      return SELECT.one.from(Changes).where({ ID })
    })

    // --- S/4HANA synchronisation and key figures -----------------------------

    const plantOf = req => String(req.data.plant || '1010').trim().toUpperCase()

    this.on('syncFromS4', async req => {
      const plant = plantOf(req)
      if (!PLANT_PATTERN.test(plant)) return req.reject(400, 'A plant has 4 characters, for example 1010.', 'plant')
      return syncPlant(plant, req.user.id)
    })

    this.on('kpis', async req => {
      const plant = plantOf(req)
      if (!PLANT_PATTERN.test(plant)) return req.reject(400, 'A plant has 4 characters, for example 1010.', 'plant')
      const byStatus = await SELECT.from(db.Materials).columns('status', 'count(1) as n').where({ plant }).groupBy('status')
      const count = code => Number(byStatus.find(s => s.status === code)?.n || 0)
      const review = await SELECT.one.from(db.Materials).columns('count(1) as n').where({ plant, reviewNeeded: true })
      const open = await SELECT.one.from(db.ParameterChanges).columns('count(1) as n').where({ plant, status_code: { in: OPEN_CHANGE_STATUSES } })
      const value = await SELECT.one.from(db.Materials).columns('sum(stockValue) as value').where({ plant })
      const excessRows = await SELECT.from(db.Materials).columns('stockQty', 'maxStock', 'price', 'priceUnitQty').where({ plant, status: 'E' })
      const excessValue = excessRows.reduce((sum, m) => sum + (num(m.stockQty) - num(m.maxStock)) * num(m.price) / (num(m.priceUnitQty) || 1), 0)
      const info = await SELECT.one.from(db.Materials).columns('currency').where({ plant, currency: { '!=': null } })
      const window = await SELECT.one.from(db.Materials).columns('consumptionFrom', 'consumptionTo')
        .where({ plant, consumptionTo: { '!=': null } })
      const last = await SELECT.one.from(db.SyncRuns).where({ plant }).orderBy('startedAt desc')
      return {
        plant,
        materials: byStatus.reduce((sum, s) => sum + Number(s.n), 0),
        critical: count('C'),
        reorder: count('R'),
        healthy: count('O'),
        excess: count('E'),
        noParameters: count('N'),
        toReview: Number(review?.n || 0),
        openChanges: Number(open?.n || 0),
        stockValue: round(num(value?.value), 2),
        excessValue: round(excessValue, 2),
        currency: info?.currency || 'EUR',
        consumptionFrom: window?.consumptionFrom || null,
        consumptionTo: window?.consumptionTo || null,
        lastSyncAt: last?.startedAt || null,
        lastSyncResult: last?.result || null,
        lastSyncMessage: last?.message || null
      }
    })

    this.on('plants', async req => {
      const local = await SELECT.from(db.Materials).columns('plant', 'count(1) as n').groupBy('plant')
      const result = new Map(local.map(p => [p.plant, { plant: p.plant, stockRows: Number(p.n), source: 'cockpit' }]))
      try {
        for (const p of await fetchPlants()) {
          if (!result.has(p.plant)) result.set(p.plant, { plant: p.plant, stockRows: p.stockRows, source: 'S/4HANA' })
        }
      } catch (e) {
        req.warn(`Could not read plants from S/4HANA: ${describeError(e).message}`)
      }
      if (!result.has('1010')) result.set('1010', { plant: '1010', stockRows: 0, source: 'default' })
      return [...result.values()].sort((a, b) => a.plant.localeCompare(b.plant))
    })

    this.on('testS4Connection', () => checkConnections())

    this.on('whoAmI', req => ({
      id: req.user.id,
      roles: ['Planner', 'Approver'].filter(role => req.user.is(role)),
      writeMode: writeMode(),
      fourEyes: fourEyes(),
      connection: connectionInfo()
    }))

    return super.init()
  }
}
