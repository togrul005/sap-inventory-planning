// Access to SAP S/4HANA Cloud through CAP remote services.
//
// Locally (cds watch) the services call the Business Accelerator Hub sandbox URL from package.json
// and send the API key from .env (S4_API_KEY). On SAP BTP they use the destination S4HANA_SANDBOX,
// which holds the URL and the APIKey header (URL.headers.APIKey).

import cds from '@sap/cds'
import { WINDOW_PERIODS, periodIndex, periodLabel } from './planning.js'

const LOG = cds.log('s4')

export const S4 = {
  STOCK: 'API_MATERIAL_STOCK_SRV',
  PRODUCT: 'API_PRODUCT_SRV',
  MATERIAL_DOCUMENT: 'API_MATERIAL_DOCUMENT_SRV'
}

const SANDBOX_URL = 'https://sandbox.api.sap.com/s4hanacloud'
const PAGE_SIZE = 500
const MAX_STOCK_ROWS = 5000
const MAX_DOC_ROWS_PER_BATCH = 5000
const MAX_PER_BATCH = 40
const PARALLEL_CALLS = 4

// CAP sends a GET whose URL is longer than 1028 characters as an OData $batch request (cds.env.remote.max_get_url_length).
// The batches below are sized so that every URL stays shorter, and the sandbox only ever gets plain GET requests.
const MAX_URL_LENGTH = 1000

// goods issues (201 ... 291, 601 ... 643) and their reversals (202 ... 292, 602 ... 644);
// other movement types inside these ranges are ignored by aggregateConsumption()
const GOODS_ISSUE_RANGES = "((GoodsMovementType >= '201' and GoodsMovementType <= '292') or (GoodsMovementType >= '601' and GoodsMovementType <= '644'))"

let prepared = false

/** Adds the API key from .env and an optional base URL override to URL-based credentials */
function prepareCredentials () {
  if (prepared) return
  prepared = true
  const apiKey = process.env.S4_API_KEY
  const baseUrl = process.env.S4_BASE_URL
  for (const name of Object.values(S4)) {
    const credentials = cds.env.requires[name]?.credentials
    if (!credentials) continue
    if (credentials.url) {
      if (baseUrl) credentials.url = credentials.url.replace(SANDBOX_URL, baseUrl.replace(/\/$/, ''))
      if (apiKey) credentials.headers = { ...credentials.headers, APIKey: apiKey }
    }
  }
  const c = cds.env.requires[S4.STOCK]?.credentials || {}
  if (c.destination) LOG.info(`S/4HANA via BTP destination "${c.destination}"`)
  else LOG.info(`S/4HANA via ${c.url ? new URL(c.url).origin : '(no URL configured)'}, API key ${apiKey ? 'set' : 'MISSING (add S4_API_KEY to .env)'}`)
}

/** Where the S/4HANA calls go, for the cockpit's info popover */
export function connectionInfo () {
  prepareCredentials()
  const c = cds.env.requires[S4.STOCK]?.credentials || {}
  if (c.destination) return `BTP destination ${c.destination}`
  if (!c.url) return 'not configured'
  const url = new URL(c.url)
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' ? `mock S/4HANA (${url.host})` : url.host
}

export async function s4 (name) {
  prepareCredentials()
  return cds.connect.to(name)
}

/** HTTP status and a readable message from an error thrown by a CAP remote service */
export function describeError (e) {
  const status = e?.reason?.response?.status ?? e?.response?.status ?? e?.statusCode ?? e?.status ?? null
  const body = e?.reason?.response?.data ?? e?.response?.data
  let detail = ''
  if (body && typeof body === 'object') detail = body.error?.message?.value || body.error?.message || body.fault?.faultstring || ''
  else if (typeof body === 'string') detail = body.slice(0, 200)
  let message = detail || e?.reason?.message || e?.message || String(e)
  if (status === 401 || status === 403) message = `S/4HANA rejected the API key (HTTP ${status}). Check S4_API_KEY in .env, or URL.headers.APIKey in the BTP destination.`
  else if (status === 404) message = `API not found (HTTP 404): ${message}`
  else if (status === 429) message = 'Too many requests to the sandbox (HTTP 429). Wait a minute and try again.'
  return { status: status ? Number(status) : null, message: String(message).slice(0, 480) }
}

/** Runs one remote call, logs it with its duration and row count */
async function timed (label, fn, method = 'GET') {
  const start = Date.now()
  try {
    const result = await fn()
    const rows = Array.isArray(result) ? result.length : result ? 1 : 0
    LOG.info(`${method} ${label} -> ${rows} rows in ${Date.now() - start} ms`)
    return result
  } catch (e) {
    const { status, message } = describeError(e)
    LOG.warn(`${method} ${label} failed after ${Date.now() - start} ms: ${status ?? ''} ${message}`)
    throw e
  }
}

/** Runs fn for each item with at most `limit` calls at the same time */
async function mapLimit (items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * Splits values into batches for a filter "field eq 'v1' or field eq 'v2' ...", so that the URL
 * (fixedLength characters without the values) stays below MAX_URL_LENGTH.
 */
export function batchesForUrl (values, field, fixedLength, maxPerBatch = MAX_PER_BATCH) {
  const budget = MAX_URL_LENGTH - fixedLength
  const batches = []
  let current = []
  let length = 0
  for (const v of values) {
    const term = field.length + encodeURIComponent(v).length + 20 // "Field%20eq%20'value'%20or%20"
    if (current.length && (length + term > budget || current.length >= maxPerBatch)) {
      batches.push(current)
      current = []
      length = 0
    }
    current.push(v)
    length += term
  }
  if (current.length) batches.push(current)
  return batches
}

/** All stock rows of one plant (paged), from API_MATERIAL_STOCK_SRV/A_MatlStkInAcctMod */
export async function fetchStockRows (plant) {
  const srv = await s4(S4.STOCK)
  const { A_MatlStkInAcctMod } = srv.entities
  const rows = []
  for (let skip = 0; skip < MAX_STOCK_ROWS; skip += PAGE_SIZE) {
    const page = await timed(`A_MatlStkInAcctMod plant=${plant} skip=${skip}`, () => srv.run(
      SELECT.from(A_MatlStkInAcctMod)
        .columns('Material', 'Plant', 'StorageLocation', 'InventorySpecialStockType', 'InventoryStockType', 'MaterialBaseUnit', 'MatlWrhsStkQtyInMatlBaseUnit')
        .where({ Plant: plant })
        .limit(PAGE_SIZE, skip)
    ))
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }
  return rows
}

/** English descriptions per product, from API_PRODUCT_SRV/A_ProductDescription */
export async function fetchDescriptions (materials, language = 'EN') {
  const srv = await s4(S4.PRODUCT)
  const { A_ProductDescription } = srv.entities
  const result = new Map()
  await mapLimit(batchesForUrl(materials, 'Product', 160), PARALLEL_CALLS, async (batch, i) => {
    const rows = await timed(`A_ProductDescription batch ${i + 1}`, () => srv.run(
      SELECT.from(A_ProductDescription)
        .columns('Product', 'Language', 'ProductDescription')
        .where({ Language: language, Product: { in: batch } })
    ))
    for (const r of rows) if (r.ProductDescription) result.set(r.Product, r.ProductDescription)
  })
  return result
}

/** MRP data per product in the plant, from API_PRODUCT_SRV/A_ProductSupplyPlanning */
export async function fetchSupplyPlanning (plant, materials) {
  const srv = await s4(S4.PRODUCT)
  const { A_ProductSupplyPlanning } = srv.entities
  const result = new Map()
  await mapLimit(batchesForUrl(materials, 'Product', 320), PARALLEL_CALLS, async (batch, i) => {
    const rows = await timed(`A_ProductSupplyPlanning batch ${i + 1}`, () => srv.run(
      SELECT.from(A_ProductSupplyPlanning)
        .columns('Product', 'Plant', 'MRPType', 'ReorderThresholdQuantity', 'SafetyStockQuantity', 'MaximumStockQuantity',
          'MinimumLotSizeQuantity', 'LotSizeRoundingQuantity', 'PlannedDeliveryDurationInDays', 'ProcurementType', 'BaseUnit')
        .where({ Plant: plant, Product: { in: batch } })
    ))
    for (const r of rows) result.set(r.Product, r)
  })
  return result
}

/** Valuation (price) per product in the plant's valuation area, from API_PRODUCT_SRV/A_ProductValuation */
export async function fetchValuations (plant, materials) {
  const srv = await s4(S4.PRODUCT)
  const { A_ProductValuation } = srv.entities
  const all = []
  await mapLimit(batchesForUrl(materials, 'Product', 260), PARALLEL_CALLS, async (batch, i) => {
    const rows = await timed(`A_ProductValuation batch ${i + 1}`, () => srv.run(
      SELECT.from(A_ProductValuation)
        .columns('Product', 'ValuationArea', 'ValuationType', 'InventoryValuationProcedure', 'StandardPrice', 'MovingAveragePrice', 'PriceUnitQty', 'Currency')
        .where({ ValuationArea: plant, Product: { in: batch } })
    ))
    all.push(...rows)
  })
  return all
}

/** Newest fiscal period with a goods issue in the plant; the consumption window ends there */
export async function fetchLatestIssuePeriod (plant) {
  const srv = await s4(S4.MATERIAL_DOCUMENT)
  const { A_MaterialDocumentItem } = srv.entities
  const row = await timed(`A_MaterialDocumentItem latest period plant=${plant}`, () => srv.run(
    SELECT.one.from(A_MaterialDocumentItem).columns('FiscalYearPeriod')
      .where(`Plant = '${plant}' and ${GOODS_ISSUE_RANGES}`)
      .orderBy('FiscalYearPeriod desc')
  ))
  return periodIndex(row?.FiscalYearPeriod) === null ? null : row.FiscalYearPeriod
}

/**
 * Goods issues and their reversals of the materials in the plant over the last 12 periods,
 * from API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentItem.
 * Returns { items, endPeriod, truncated }.
 */
export async function fetchConsumptionItems (plant, materials) {
  const srv = await s4(S4.MATERIAL_DOCUMENT)
  const { A_MaterialDocumentItem } = srv.entities
  let endPeriod = null
  try {
    endPeriod = await fetchLatestIssuePeriod(plant)
  } catch (e) {
    LOG.warn(`Latest goods issue period not available, reading all periods: ${describeError(e).message}`)
  }
  const fromPeriod = endPeriod ? periodLabel(periodIndex(endPeriod) - WINDOW_PERIODS + 1) : null
  const periodFilter = fromPeriod ? ` and FiscalYearPeriod >= '${fromPeriod}'` : ''
  const all = []
  let truncated = false
  await mapLimit(batchesForUrl(materials, 'Material', 420), PARALLEL_CALLS, async (batch, i) => {
    const materialFilter = batch.map(m => `Material = '${m.replace(/'/g, "''")}'`).join(' or ')
    for (let skip = 0; ; skip += PAGE_SIZE) {
      if (skip >= MAX_DOC_ROWS_PER_BATCH) { truncated = true; break }
      const page = await timed(`A_MaterialDocumentItem batch ${i + 1} skip=${skip}`, () => srv.run(
        SELECT.from(A_MaterialDocumentItem)
          .columns('Material', 'GoodsMovementType', 'QuantityInBaseUnit', 'FiscalYearPeriod')
          .where(`Plant = '${plant}' and (${materialFilter})${periodFilter} and ${GOODS_ISSUE_RANGES}`)
          .limit(PAGE_SIZE, skip)
      ))
      all.push(...page)
      if (page.length < PAGE_SIZE) break
    }
  })
  return { items: all, endPeriod, truncated }
}

/** Plants that have stock records in S/4HANA (from the first rows of the stock API) */
export async function fetchPlants (sampleSize = 2000) {
  const srv = await s4(S4.STOCK)
  const { A_MatlStkInAcctMod } = srv.entities
  const rows = await timed('A_MatlStkInAcctMod plants', () => srv.run(
    SELECT.from(A_MatlStkInAcctMod).columns('Plant', 'Material').limit(sampleSize)
  ))
  const counts = new Map()
  for (const r of rows) counts.set(r.Plant, (counts.get(r.Plant) || 0) + 1)
  return [...counts.entries()].map(([plant, stockRows]) => ({ plant, stockRows }))
}

/** One small call per API to show which connections work */
export async function checkConnections () {
  const checks = [
    { api: `${S4.STOCK} (stock)`, name: S4.STOCK, entity: 'A_MatlStkInAcctMod' },
    { api: `${S4.PRODUCT} (descriptions)`, name: S4.PRODUCT, entity: 'A_ProductDescription' },
    { api: `${S4.PRODUCT} (MRP data)`, name: S4.PRODUCT, entity: 'A_ProductSupplyPlanning' },
    { api: `${S4.PRODUCT} (valuation)`, name: S4.PRODUCT, entity: 'A_ProductValuation' },
    { api: `${S4.MATERIAL_DOCUMENT} (goods movements)`, name: S4.MATERIAL_DOCUMENT, entity: 'A_MaterialDocumentItem' }
  ]
  const results = []
  for (const c of checks) {
    const start = Date.now()
    try {
      const srv = await s4(c.name)
      const rows = await timed(`${c.entity} (connection test)`, () => srv.run(SELECT.from(srv.entities[c.entity]).limit(1)))
      results.push({ api: c.api, ok: true, status: 200, rows: rows.length, ms: Date.now() - start, message: 'OK' })
    } catch (e) {
      const { status, message } = describeError(e)
      results.push({ api: c.api, ok: false, status, rows: 0, ms: Date.now() - start, message })
    }
  }
  return results
}

/** Writes new MRP data to a real S/4HANA system (S4_WRITE_MODE=live only) */
export async function patchSupplyPlanning (key, payload) {
  const srv = await s4(S4.PRODUCT)
  await timed(key, () => srv.send({ method: 'PATCH', path: `/${key}`, data: payload, headers: { 'If-Match': '*' } }), 'PATCH')
}
