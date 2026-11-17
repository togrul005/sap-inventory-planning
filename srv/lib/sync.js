// Synchronises one plant from SAP S/4HANA into the cockpit's own tables.
// Stock is required: if it cannot be read, the run is FAILED. Descriptions, MRP data, prices and
// goods issues are optional: if one of these APIs fails, the run is PARTIAL and the stored values are kept.

import cds from '@sap/cds'
import { fetchStockRows, fetchDescriptions, fetchSupplyPlanning, fetchValuations, fetchConsumptionItems, describeError } from './s4.js'
import { WINDOW_PERIODS, aggregateStock, aggregateConsumption, pickValuations, mergeMaterial } from './planning.js'

const LOG = cds.log('sync')
export const MAX_MATERIALS = 200

const NO_CONSUMPTION = { consumptionQty: 0, consumptionDocs: 0, avgDailyDemand: 0, demandStdDevDaily: 0 }

export async function syncPlant (plant, user) {
  const { Materials, SyncRuns } = cds.entities('brightline.planning')
  const startedAt = new Date()
  const run = {
    ID: cds.utils.uuid(),
    plant,
    startedAt: startedAt.toISOString(),
    startedBy: user,
    stockRows: 0,
    materials: 0,
    parametersFromS4: 0,
    pricesFromS4: 0,
    consumptionDocs: 0
  }
  const warnings = []
  const failed = []

  let stockRows
  try {
    stockRows = await fetchStockRows(plant)
  } catch (e) {
    // returned as a result (not thrown), so that the failed run stays in the log
    const { status, message } = describeError(e)
    Object.assign(run, {
      result: 'FAILED', finishedAt: new Date().toISOString(), durationMs: Date.now() - startedAt,
      message: `Reading stock from S/4HANA failed: ${message}`.slice(0, 1000)
    })
    await INSERT.into(SyncRuns).entries(run)
    LOG.warn(`plant ${plant}: ${run.message} (HTTP ${status ?? '-'})`)
    return resultOf(run)
  }

  let stock = aggregateStock(stockRows).sort((a, b) => a.material.localeCompare(b.material))
  let truncated = false
  if (stock.length > MAX_MATERIALS) {
    warnings.push(`${stock.length - MAX_MATERIALS} more materials were not loaded (limit ${MAX_MATERIALS}).`)
    stock = stock.slice(0, MAX_MATERIALS)
    truncated = true
  }
  const ids = stock.map(s => s.material)

  let descriptions = new Map()
  let planning = null
  let valuations = null
  let consumption = null
  if (ids.length) {
    const [d, p, v, c] = await Promise.allSettled([
      fetchDescriptions(ids),
      fetchSupplyPlanning(plant, ids),
      fetchValuations(plant, ids),
      fetchConsumptionItems(plant, ids)
    ])
    if (d.status === 'fulfilled') descriptions = d.value
    else failed.push(`Descriptions: ${describeError(d.reason).message}`)
    if (p.status === 'fulfilled') planning = p.value
    else failed.push(`MRP data: ${describeError(p.reason).message}`)
    if (v.status === 'fulfilled') valuations = pickValuations(v.value)
    else failed.push(`Prices: ${describeError(v.reason).message}`)
    if (c.status === 'fulfilled') {
      consumption = aggregateConsumption(c.value.items, WINDOW_PERIODS, c.value.endPeriod)
      if (c.value.truncated) warnings.push('Some goods issues were not read (too many documents); the demand may be too low.')
    } else failed.push(`Goods issues: ${describeError(c.reason).message}`)
  }

  const existingRows = ids.length ? await SELECT.from(Materials).where({ plant, material: { in: ids } }) : []
  const existing = new Map(existingRows.map(m => [m.material, m]))
  const syncedAt = new Date().toISOString()

  const entries = stock.map(s => {
    const before = existing.get(s.material)
    const consumed = consumption
      ? (consumption.byMaterial.get(s.material) || NO_CONSUMPTION)
      : before && {
        consumptionQty: before.consumptionQty,
        consumptionDocs: before.consumptionDocs,
        avgDailyDemand: before.avgDailyDemand,
        demandStdDevDaily: before.demandStdDevDaily
      }
    const entry = mergeMaterial({
      existing: before,
      stock: s,
      description: descriptions.get(s.material),
      supplyPlanning: planning ? planning.get(s.material) : undefined,
      supplyPlanningAvailable: !!planning,
      valuation: valuations ? valuations.get(s.material) : undefined,
      consumption: consumed,
      plant,
      syncedAt
    })
    if (consumption) Object.assign(entry, { consumptionFrom: consumption.from, consumptionTo: consumption.to })
    return entry
  })

  for (const e of entries) {
    if (existing.has(e.material)) {
      const { material, plant: _plant, ...changes } = e
      await UPDATE(Materials, { material, plant }).set(changes)
    } else {
      await INSERT.into(Materials).entries(e)
    }
  }

  // materials of this plant that no longer have any stock record in S/4HANA
  if (!truncated) {
    const vanished = await SELECT.from(Materials).columns('material').where({ plant, material: { 'not in': ids.length ? ids : [''] } })
    for (const v of vanished) {
      await UPDATE(Materials, { material: v.material, plant }).set({ stockQty: 0, otherStockQty: 0, storageLocations: 0, lastSyncedAt: syncedAt })
    }
    if (vanished.length) warnings.push(`${vanished.length} materials have no stock record in S/4HANA any more and were set to 0.`)
  }

  run.stockRows = stockRows.length
  run.materials = entries.length
  run.parametersFromS4 = planning ? entries.filter(e => planning.get(e.material)).length : 0
  run.pricesFromS4 = valuations ? entries.filter(e => valuations.get(e.material)).length : 0
  run.consumptionDocs = consumption ? [...consumption.byMaterial.values()].reduce((a, c) => a + c.consumptionDocs, 0) : 0
  run.result = failed.length ? 'PARTIAL' : 'OK'
  run.finishedAt = new Date().toISOString()
  run.durationMs = Date.now() - startedAt

  const withDemand = consumption ? entries.filter(e => Number(e.avgDailyDemand) > 0).length : null
  const window = consumption?.from ? ` (periods ${consumption.from}–${consumption.to})` : ''
  run.message = (entries.length
    ? `${entries.length} materials: ${run.parametersFromS4} with MRP data, ${run.pricesFromS4} with a price` +
      (withDemand !== null ? `, ${withDemand} with goods issues${window}.` : '.')
    : `No stock found in S/4HANA for plant ${plant}. Try another plant.`) +
    [...failed, ...warnings].map(w => ' ' + w).join('')
  run.message = run.message.slice(0, 1000)
  await INSERT.into(SyncRuns).entries(run)
  LOG.info(`plant ${plant}: ${run.message} (${run.durationMs} ms)`)

  return resultOf(run)
}

const resultOf = run => ({
  plant: run.plant,
  result: run.result,
  stockRows: run.stockRows,
  materials: run.materials,
  parametersFromS4: run.parametersFromS4,
  pricesFromS4: run.pricesFromS4,
  consumptionDocs: run.consumptionDocs,
  durationMs: run.durationMs,
  message: run.message
})
