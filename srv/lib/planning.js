// Business rules of the Inventory Planning Cockpit.
// Pure functions without database access, so they can be unit tested directly.

export const STOCK_STATUS = { CRITICAL: 'C', REORDER: 'R', HEALTHY: 'O', EXCESS: 'E', NO_PARAMETERS: 'N' }
export const CHANGE_STATUS = { SUBMITTED: 'S', APPROVED: 'A', UPDATED: 'U', REJECTED: 'R', WITHDRAWN: 'W' }

/** Changes that block a new proposal for the same material */
export const OPEN_CHANGE_STATUSES = ['S', 'A']

export const DEFAULT_LEAD_TIME_DAYS = 7
export const SERVICE_LEVEL_PCT = 95
export const Z_SCORE = 1.645 // standard normal value for a 95 % service level
export const REVIEW_DAYS = 14 // the maximum stock covers two more weeks of demand above the reorder point
export const WINDOW_PERIODS = 12 // consumption is measured over the last 12 fiscal periods (months)
export const DAYS_PER_PERIOD = 365 / 12

/** Goods issues that count as consumption, and their reversals */
export const ISSUE_MOVEMENT_TYPES = ['201', '221', '231', '241', '261', '281', '291', '601', '641', '643']
export const REVERSAL_MOVEMENT_TYPES = ['202', '222', '232', '242', '262', '282', '292', '602', '642', '644']

/** A material is flagged for review if its reorder point is this far (in %) from the suggested one */
export const REVIEW_THRESHOLD_PCT = 25

/** MRP types that plan with a reorder point (manual or automatic) */
export const REORDER_POINT_MRP_TYPES = ['VB', 'VM', 'V1', 'V2']

export const num = v => (v === null || v === undefined || v === '' ? 0 : Number(v))
/** Commercial rounding (half away from zero) */
export const round = (v, digits = 3) => {
  const f = 10 ** digits
  const n = Number(v)
  return Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * f) / f + 0
}

/**
 * Same rule as the calculated element Materials.status in db/schema.cds:
 * N = no reorder point, C = at or below safety stock, R = at or below reorder point,
 * E = above maximum stock, O = healthy
 */
export function stockStatus (m) {
  const reorderPoint = num(m.reorderPoint)
  const stock = num(m.stockQty)
  if (!(reorderPoint > 0)) return STOCK_STATUS.NO_PARAMETERS
  if (stock <= num(m.safetyStock)) return STOCK_STATUS.CRITICAL
  if (stock <= reorderPoint) return STOCK_STATUS.REORDER
  if (num(m.maxStock) > 0 && stock > num(m.maxStock)) return STOCK_STATUS.EXCESS
  return STOCK_STATUS.HEALTHY
}

/** Upper stock level: the maximum stock, or twice the reorder point if no maximum is maintained */
export function targetStock (m) {
  const max = num(m.maxStock)
  if (max > 0) return round(max)
  const reorderPoint = num(m.reorderPoint)
  return reorderPoint > 0 ? round(reorderPoint * 2) : 0
}

/** Stock as a percentage of the upper stock level, between 0 and 100 */
export function stockLevelPct (m) {
  const target = targetStock(m)
  if (!(target > 0)) return 0
  return Math.max(0, Math.min(100, Math.round(num(m.stockQty) / target * 100)))
}

/** Same rule as the calculated element Materials.deviationPct in db/schema.cds */
export function deviationPct (m) {
  if (m.suggestedReorderPoint === null || m.suggestedReorderPoint === undefined) return null
  const current = num(m.reorderPoint)
  if (!(current > 0)) return 100
  return round(Math.abs(num(m.suggestedReorderPoint) - current) * 100 / current, 1)
}

/** True if the planning parameters differ from the values a change was based on */
export function parametersChangedSince (material, change) {
  return num(material.reorderPoint) !== num(change.currentReorderPoint) ||
    num(material.safetyStock) !== num(change.currentSafetyStock) ||
    num(material.maxStock) !== num(change.currentMaxStock)
}

/** Converts a fiscal year period like "2025008" into a running month number */
export function periodIndex (fiscalYearPeriod) {
  const s = String(fiscalYearPeriod || '')
  if (!/^\d{7}$/.test(s)) return null
  const year = Number(s.slice(0, 4))
  const period = Math.min(12, Math.max(1, Number(s.slice(4))))
  return year * 12 + (period - 1)
}

export function periodLabel (index) {
  if (index === null || index === undefined) return null
  const year = Math.floor(index / 12)
  const period = (index % 12) + 1
  return `${year}${String(period).padStart(3, '0')}`
}

/**
 * Consumption per material from material document items (A_MaterialDocumentItem).
 * Goods issues count positive, their reversals negative (a cancelled issue and its reversal
 * cancel each other out; a return to stock reduces the consumption). Other movement types are ignored.
 * The window is the last 12 periods up to endPeriod, or up to the newest period found in the data,
 * because the sandbox holds historical documents. Average and standard deviation are per day.
 */
export function aggregateConsumption (items, windowPeriods = WINDOW_PERIODS, endPeriod = null) {
  const relevant = items.filter(i => i && i.Material && periodIndex(i.FiscalYearPeriod) !== null)
  const result = new Map()
  const end = periodIndex(endPeriod) ?? (relevant.length ? Math.max(...relevant.map(i => periodIndex(i.FiscalYearPeriod))) : null)
  if (end === null) return { byMaterial: result, from: null, to: null }
  const first = end - windowPeriods + 1
  for (const i of relevant) {
    const p = periodIndex(i.FiscalYearPeriod)
    if (p < first || p > end) continue
    const sign = ISSUE_MOVEMENT_TYPES.includes(i.GoodsMovementType) ? 1 : REVERSAL_MOVEMENT_TYPES.includes(i.GoodsMovementType) ? -1 : 0
    if (!sign) continue
    let c = result.get(i.Material)
    if (!c) {
      c = { monthly: new Array(windowPeriods).fill(0), docs: 0 }
      result.set(i.Material, c)
    }
    c.monthly[p - first] += sign * num(i.QuantityInBaseUnit)
    c.docs++
  }
  for (const [material, c] of result) {
    const monthly = c.monthly.map(q => Math.max(0, round(q)))
    const total = monthly.reduce((a, b) => a + b, 0)
    const meanMonth = total / windowPeriods
    const variance = monthly.reduce((a, q) => a + (q - meanMonth) ** 2, 0) / windowPeriods
    result.set(material, {
      consumptionQty: round(total),
      consumptionDocs: c.docs,
      avgDailyDemand: round(total / (windowPeriods * DAYS_PER_PERIOD), 4),
      demandStdDevDaily: round(Math.sqrt(variance) / Math.sqrt(DAYS_PER_PERIOD), 4),
      monthly
    })
  }
  return { byMaterial: result, from: periodLabel(first), to: periodLabel(end) }
}

const roundUp = (qty, rounding = 0) => {
  const r = num(rounding)
  return r > 0 ? round(Math.ceil(qty / r - 1e-9) * r) : Math.ceil(qty - 1e-9)
}

/**
 * Suggested parameters with the standard reorder-point method:
 *   safety stock  SS  = z × σ(daily demand) × √(lead time)      (95 % service level, z = 1.645)
 *   reorder point ROP = average daily demand × lead time + SS
 *   maximum stock MAX = ROP + two weeks of demand (at least the minimum lot size)
 * With fewer than 3 goods issues the variation is not reliable, so SS = half of the lead-time demand.
 * Returns null when there is no consumption.
 */
export function suggestParameters ({ avgDailyDemand, demandStdDevDaily, leadTimeDays, consumptionDocs, minLotSize, roundingQty }) {
  const d = num(avgDailyDemand)
  if (!(d > 0)) return null
  const lead = num(leadTimeDays) > 0 ? num(leadTimeDays) : DEFAULT_LEAD_TIME_DAYS
  const sigma = num(demandStdDevDaily)
  const statistical = num(consumptionDocs) >= 3 && sigma > 0
  const safetyStock = roundUp(statistical ? Z_SCORE * sigma * Math.sqrt(lead) : 0.5 * d * lead)
  const reorderPoint = Math.max(roundUp(d * lead + safetyStock), safetyStock + 1)
  const maxStock = Math.max(roundUp(reorderPoint + Math.max(d * REVIEW_DAYS, num(minLotSize)), roundingQty), reorderPoint + 1)
  return {
    reorderPoint,
    safetyStock,
    maxStock,
    leadTimeDays: lead,
    method: statistical ? 'STATISTICAL' : 'SIMPLE'
  }
}

/** Checks the values a planner proposes and returns a list of error texts */
export function validateProposal ({ reorderPoint, safetyStock, maxStock, leadTimeDays, reason }) {
  const errors = []
  for (const [name, value] of Object.entries({ reorderPoint, safetyStock, maxStock, leadTimeDays })) {
    if (value === null || value === undefined || value === '') continue
    if (!Number.isFinite(Number(value)) || Number(value) < 0) errors.push(`${name} must be a number of 0 or more.`)
  }
  if (errors.length) return errors
  if (!(num(reorderPoint) > 0)) errors.push('Enter a reorder point greater than 0.')
  if (num(reorderPoint) > 0 && num(safetyStock) >= num(reorderPoint)) errors.push('The safety stock must be lower than the reorder point.')
  if (num(maxStock) > 0 && num(maxStock) <= num(reorderPoint)) errors.push('The maximum stock must be higher than the reorder point (or 0 for none).')
  if (leadTimeDays !== null && leadTimeDays !== undefined && leadTimeDays !== '' &&
      (!Number.isInteger(Number(leadTimeDays)) || Number(leadTimeDays) < 1 || Number(leadTimeDays) > 365)) {
    errors.push('The lead time must be a whole number of days between 1 and 365.')
  }
  if (!reason || String(reason).trim().length < 5) errors.push('Explain the change in a few words (reason).')
  return errors
}

/** A reorder point only has an effect with a reorder-point MRP type; otherwise switch to VB (manual reorder point) */
export function reorderPointMrpType (currentMrpType) {
  return REORDER_POINT_MRP_TYPES.includes(currentMrpType) ? currentMrpType : 'VB'
}

/** FORMULA if the proposal equals the suggestion, ADJUSTED if the planner changed it, MANUAL if there was none */
export function proposalMethod (proposal, suggestion) {
  if (!suggestion) return 'MANUAL'
  const same = num(proposal.reorderPoint) === num(suggestion.reorderPoint) &&
    num(proposal.safetyStock) === num(suggestion.safetyStock) &&
    num(proposal.maxStock) === num(suggestion.maxStock)
  return same ? 'FORMULA' : 'ADJUSTED'
}

/** Value of the safety stock change: (new − current safety stock) × price per unit; null without a price */
export function safetyStockValueChange (currentSafetyStock, newSafetyStock, price, priceUnitQty) {
  if (price === null || price === undefined || price === '') return null
  return round((num(newSafetyStock) - num(currentSafetyStock)) * num(price) / (num(priceUnitQty) || 1), 2)
}

/** Picks the price per material from A_ProductValuation (standard or moving average price) */
export function pickValuations (rows) {
  const best = new Map()
  for (const r of rows) {
    if (!r || !r.Product) continue
    const standard = num(r.StandardPrice)
    const moving = num(r.MovingAveragePrice)
    const price = r.InventoryValuationProcedure === 'V' ? (moving || standard) : (standard || moving)
    if (!(price > 0)) continue
    const current = best.get(r.Product)
    // prefer the record without split valuation (empty ValuationType)
    if (!current || (current.split && !r.ValuationType)) {
      best.set(r.Product, {
        price: round(price),
        priceUnitQty: num(r.PriceUnitQty) || 1,
        currency: r.Currency || null,
        split: !!r.ValuationType
      })
    }
  }
  return best
}

/**
 * Sums the rows of A_MatlStkInAcctMod per material.
 * Own stock (no special stock indicator) of stock type 01 counts as unrestricted-use stock,
 * everything else (quality inspection, blocked, consignment, ...) as other stock.
 */
export function aggregateStock (rows) {
  const byMaterial = new Map()
  for (const r of rows) {
    if (!r || !r.Material) continue
    let m = byMaterial.get(r.Material)
    if (!m) {
      m = { material: r.Material, plant: r.Plant, baseUnit: r.MaterialBaseUnit || null, stockQty: 0, otherStockQty: 0, locations: new Set() }
      byMaterial.set(r.Material, m)
    }
    const qty = num(r.MatlWrhsStkQtyInMatlBaseUnit)
    const ownStock = !r.InventorySpecialStockType || String(r.InventorySpecialStockType).trim() === ''
    if (ownStock && r.InventoryStockType === '01') m.stockQty += qty
    else m.otherStockQty += qty
    if (r.StorageLocation) m.locations.add(r.StorageLocation)
    if (!m.baseUnit && r.MaterialBaseUnit) m.baseUnit = r.MaterialBaseUnit
  }
  return [...byMaterial.values()].map(m => ({
    material: m.material,
    plant: m.plant,
    baseUnit: m.baseUnit,
    stockQty: round(m.stockQty),
    otherStockQty: round(m.otherStockQty),
    storageLocations: m.locations.size
  }))
}

/**
 * Turns S/4HANA supply planning (MRP) data into planning parameters.
 * If only a safety stock is maintained, it is also used as the reorder point.
 */
export function parametersFromSupplyPlanning (sp) {
  if (!sp) return null
  const safetyStock = num(sp.SafetyStockQuantity)
  let reorderPoint = num(sp.ReorderThresholdQuantity)
  if (!(reorderPoint > 0) && safetyStock > 0) reorderPoint = safetyStock
  return {
    reorderPoint: round(reorderPoint),
    safetyStock: round(safetyStock),
    maxStock: round(num(sp.MaximumStockQuantity)),
    minLotSize: round(num(sp.MinimumLotSizeQuantity)),
    roundingQty: round(num(sp.LotSizeRoundingQuantity)),
    leadTimeDays: num(sp.PlannedDeliveryDurationInDays) > 0 ? Math.round(num(sp.PlannedDeliveryDurationInDays)) : null,
    mrpType: sp.MRPType || null,
    hasReorderPoint: reorderPoint > 0
  }
}

/** True if S/4HANA already holds the parameters that were approved in the cockpit */
export function s4HoldsParameters (existing, params) {
  if (!existing || !params) return false
  return num(existing.reorderPoint) === num(params.reorderPoint) &&
    num(existing.safetyStock) === num(params.safetyStock) &&
    num(existing.maxStock) === num(params.maxStock)
}

/**
 * Merges a fresh S/4HANA snapshot into the stored material and recalculates the suggestion.
 * Parameters approved in the cockpit are kept until S/4HANA itself holds them (live mode),
 * so in the read-only sandbox the simulated update stays visible.
 * If the MRP data could not be read (supplyPlanningAvailable = false), the stored parameters are kept.
 */
export function mergeMaterial ({ existing, stock, description, supplyPlanning, supplyPlanningAvailable = true, valuation, consumption, plant, syncedAt }) {
  const params = parametersFromSupplyPlanning(supplyPlanning)
  const entry = {
    material: stock.material,
    plant,
    description: description || existing?.description || null,
    baseUnit: stock.baseUnit || existing?.baseUnit || null,
    stockQty: stock.stockQty,
    otherStockQty: stock.otherStockQty,
    storageLocations: stock.storageLocations,
    lastSyncedAt: syncedAt
  }

  const approved = existing?.parameterSource === 'APPROVED'
  const keepStored = (approved && !s4HoldsParameters(existing, params)) || (!supplyPlanningAvailable && existing)
  if (!keepStored) {
    Object.assign(entry, {
      mrpType: params?.mrpType ?? existing?.mrpType ?? null,
      reorderPoint: params?.reorderPoint ?? 0,
      safetyStock: params?.safetyStock ?? 0,
      maxStock: params?.maxStock ?? 0,
      minLotSize: params?.minLotSize ?? 0,
      roundingQty: params?.roundingQty ?? 0,
      leadTimeDays: params?.leadTimeDays ?? existing?.leadTimeDays ?? DEFAULT_LEAD_TIME_DAYS,
      parameterSource: params?.hasReorderPoint ? 'S4' : 'NONE'
    })
  }

  if (valuation) {
    Object.assign(entry, { price: valuation.price, priceUnitQty: valuation.priceUnitQty, currency: valuation.currency })
  }

  const c = consumption || { consumptionQty: 0, consumptionDocs: 0, avgDailyDemand: 0, demandStdDevDaily: 0 }
  Object.assign(entry, {
    consumptionQty: c.consumptionQty,
    consumptionDocs: c.consumptionDocs,
    avgDailyDemand: c.avgDailyDemand,
    demandStdDevDaily: c.demandStdDevDaily
  })

  const effective = { ...existing, ...entry }
  const suggestion = suggestParameters({
    avgDailyDemand: effective.avgDailyDemand,
    demandStdDevDaily: effective.demandStdDevDaily,
    leadTimeDays: effective.leadTimeDays,
    consumptionDocs: effective.consumptionDocs,
    minLotSize: effective.minLotSize,
    roundingQty: effective.roundingQty
  })
  Object.assign(entry, {
    suggestedReorderPoint: suggestion?.reorderPoint ?? null,
    suggestedSafetyStock: suggestion?.safetyStock ?? null,
    suggestedMaxStock: suggestion?.maxStock ?? null
  })
  return entry
}

/** PC-2026-0001, PC-2026-0002, ... */
export function nextChangeNo (lastChangeNo, year = new Date().getUTCFullYear()) {
  const prefix = `PC-${year}-`
  const last = lastChangeNo && lastChangeNo.startsWith(prefix) ? Number(lastChangeNo.slice(prefix.length)) : 0
  return prefix + String((Number.isFinite(last) ? last : 0) + 1).padStart(4, '0')
}

/** Key of the S/4HANA entity that holds the MRP data of a material in a plant */
export function supplyPlanningKey (material, plant) {
  const q = s => String(s).replace(/'/g, "''")
  return `A_ProductSupplyPlanning(Product='${q(material)}',Plant='${q(plant)}')`
}

/** Body of PATCH A_ProductSupplyPlanning (API_PRODUCT_SRV, OData V2): decimals are strings */
export function supplyPlanningPayload (change) {
  const payload = {
    MRPType: change.newMrpType,
    ReorderThresholdQuantity: String(round(num(change.newReorderPoint))),
    SafetyStockQuantity: String(round(num(change.newSafetyStock))),
    MaximumStockQuantity: String(round(num(change.newMaxStock)))
  }
  if (num(change.newLeadTimeDays) > 0) payload.PlannedDeliveryDurationInDays = String(Math.round(num(change.newLeadTimeDays)))
  return payload
}
