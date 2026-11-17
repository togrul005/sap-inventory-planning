// Minimal stand-in for the SAP Business Accelerator Hub sandbox (OData V2, JSON).
// Supports $filter (eq, ne, gt, ge, lt, le, and, or, not, parentheses), $select, $orderby, $top, $skip,
// checks the APIKey header and accepts PATCH A_ProductSupplyPlanning(...) with CSRF token and If-Match
// (the real sandbox is read-only; the PATCH is only here to test the "live" write mode).
//
//   node test/mock-s4/server.mjs [port]          (default port 4500, API key "test-key")
//
// Control endpoints for tests: GET /__log, POST /__reset, POST /__fail {"service":"API_PRODUCT_SRV","status":500}

import http from 'node:http'
import * as data from './data.mjs'

const PORT = Number(process.argv[2] || process.env.MOCK_S4_PORT || 4500)
const API_KEY = process.env.MOCK_S4_API_KEY || 'test-key'
const BASE = '/s4hanacloud/sap/opu/odata/sap/'
const CSRF_TOKEN = 'mock-csrf-token'

const freshSets = () => structuredClone({
  API_MATERIAL_STOCK_SRV: { A_MatlStkInAcctMod: data.A_MatlStkInAcctMod },
  API_PRODUCT_SRV: {
    A_ProductDescription: data.A_ProductDescription,
    A_ProductSupplyPlanning: data.A_ProductSupplyPlanning,
    A_ProductValuation: data.A_ProductValuation
  },
  API_MATERIAL_DOCUMENT_SRV: { A_MaterialDocumentItem: data.A_MaterialDocumentItem }
})

let ENTITY_SETS = freshSets()
let log = []
let failures = {}

/** "A_ProductSupplyPlanning(Product='TG11',Plant='1010')" -> { set, keys } */
function parseSegment (segment = '') {
  const m = /^([A-Za-z_]\w*)(?:\((.*)\))?$/.exec(segment)
  if (!m) return { set: segment, keys: null }
  if (m[2] === undefined) return { set: m[1], keys: null }
  const keys = {}
  for (const part of m[2].match(/\w+='(?:[^']|'')*'/g) || []) {
    const [, k, v] = /^(\w+)='(.*)'$/.exec(part)
    keys[k] = v.replace(/''/g, "'")
  }
  return { set: m[1], keys }
}

// ---------------------------------------------------------------------------
// $filter parser
// ---------------------------------------------------------------------------

function tokenize (s) {
  const tokens = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === ' ') { i++; continue }
    if (c === '(' || c === ')') { tokens.push({ t: c }); i++; continue }
    if (c === "'") {
      let j = i + 1
      let v = ''
      while (j < s.length) {
        if (s[j] === "'" && s[j + 1] === "'") { v += "'"; j += 2; continue }
        if (s[j] === "'") break
        v += s[j++]
      }
      tokens.push({ t: 'lit', v })
      i = j + 1
      continue
    }
    let j = i
    while (j < s.length && !' ()'.includes(s[j])) j++
    const word = s.slice(i, j)
    if (['eq', 'ne', 'gt', 'ge', 'lt', 'le'].includes(word)) tokens.push({ t: 'op', v: word })
    else if (['and', 'or', 'not'].includes(word)) tokens.push({ t: word })
    else if (word === 'true' || word === 'false') tokens.push({ t: 'lit', v: word === 'true' })
    else if (word === 'null') tokens.push({ t: 'lit', v: null })
    else if (/^-?\d+(\.\d+)?[mMdD]?$/.test(word)) tokens.push({ t: 'lit', v: Number(word.replace(/[mMdD]$/, '')) })
    else tokens.push({ t: 'id', v: word })
    i = j
  }
  return tokens
}

function parseFilter (s) {
  const tokens = tokenize(s)
  let p = 0
  const peek = () => tokens[p]
  const take = (t) => {
    const tok = tokens[p]
    if (!tok || (t && tok.t !== t)) throw new Error(`Invalid $filter near token ${p}: ${JSON.stringify(tok)}`)
    p++
    return tok
  }
  const orExpr = () => {
    let left = andExpr()
    while (peek()?.t === 'or') { take(); const right = andExpr(); const l = left; left = r => l(r) || right(r) }
    return left
  }
  const andExpr = () => {
    let left = notExpr()
    while (peek()?.t === 'and') { take(); const right = notExpr(); const l = left; left = r => l(r) && right(r) }
    return left
  }
  const notExpr = () => {
    if (peek()?.t === 'not') { take(); const e = notExpr(); return r => !e(r) }
    return primary()
  }
  const primary = () => {
    if (peek()?.t === '(') { take('('); const e = orExpr(); take(')'); return e }
    const field = take('id').v
    const op = take('op').v
    const lit = take('lit').v
    return r => compare(r[field], op, lit)
  }
  const e = orExpr()
  if (p !== tokens.length) throw new Error('Invalid $filter: unexpected tokens at the end')
  return e
}

function compare (value, op, lit) {
  let a = value
  let b = lit
  if (typeof b === 'number') a = Number(a)
  switch (op) {
    case 'eq': return a === b
    case 'ne': return a !== b
    case 'gt': return a > b
    case 'ge': return a >= b
    case 'lt': return a < b
    case 'le': return a <= b
  }
  return false
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(body === undefined ? '' : JSON.stringify(body))
}
const odataError = (res, status, message) => send(res, status, { error: { code: String(status), message: { lang: 'en', value: message } } })

const readBody = req => new Promise(resolve => {
  let s = ''
  req.on('data', c => { s += c })
  req.on('end', () => resolve(s))
})

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  if (url.pathname === '/__log') return send(res, 200, log)
  if (url.pathname === '/__reset') { log = []; failures = {}; ENTITY_SETS = freshSets(); return send(res, 200, { ok: true }) }
  if (url.pathname === '/__fail') {
    const body = JSON.parse((await readBody(req)) || '{}')
    if (body.service) failures[body.service] = body.status || 500
    return send(res, 200, failures)
  }

  log.push({
    method: req.method,
    path: decodeURIComponent(url.pathname + url.search),
    length: (url.pathname + url.search).length,
    apikey: req.headers.apikey || null,
    csrf: req.headers['x-csrf-token'] || null,
    ifMatch: req.headers['if-match'] || null
  })
  console.log(`[mock-s4] ${req.method} ${decodeURIComponent(url.pathname + url.search)}`)

  if (req.headers.apikey !== API_KEY) {
    return send(res, 401, { fault: { faultstring: 'Invalid ApiKey', detail: { errorcode: 'oauth.v2.InvalidApiKey' } } })
  }
  if (!url.pathname.startsWith(BASE)) return odataError(res, 404, 'Unknown path')
  const [service, segment] = url.pathname.slice(BASE.length).split('/')
  const { set: setName, keys } = parseSegment(segment)
  const sets = ENTITY_SETS[service]
  if (!sets) return odataError(res, 404, `Service ${service} not found`)
  if (failures[service]) return odataError(res, failures[service], `Simulated failure of ${service}`)

  // CSRF token fetch (HEAD or GET with x-csrf-token: Fetch)
  if (String(req.headers['x-csrf-token'] || '').toLowerCase() === 'fetch') {
    res.writeHead(200, { 'x-csrf-token': CSRF_TOKEN, 'set-cookie': 'SAP_SESSIONID=mock; Path=/' })
    return res.end()
  }

  if ((req.method === 'PATCH' || req.method === 'MERGE') && setName === 'A_ProductSupplyPlanning' && keys) {
    if (req.headers['x-csrf-token'] !== CSRF_TOKEN) return odataError(res, 403, 'CSRF token validation failed')
    if (!req.headers['if-match']) return odataError(res, 428, 'Precondition required: send an If-Match header')
    const row = sets.A_ProductSupplyPlanning.find(r => r.Product === keys.Product && r.Plant === keys.Plant)
    if (!row) return odataError(res, 404, `Resource not found for the segment 'A_ProductSupplyPlanning'`)
    const payload = JSON.parse((await readBody(req)) || '{}')
    const allowed = ['MRPType', 'ReorderThresholdQuantity', 'SafetyStockQuantity', 'MaximumStockQuantity', 'PlannedDeliveryDurationInDays',
      'MinimumLotSizeQuantity', 'LotSizeRoundingQuantity']
    const unknown = Object.keys(payload).filter(k => !allowed.includes(k))
    if (unknown.length) return odataError(res, 400, `Property ${unknown[0]} cannot be changed`)
    log[log.length - 1].body = payload
    Object.assign(row, payload)
    res.writeHead(204)
    return res.end()
  }

  if (setName === '$batch') return odataError(res, 405, 'The mock does not support $batch (keep GET URLs short)')
  if (req.method !== 'GET' && req.method !== 'HEAD') return odataError(res, 405, 'The sandbox is read-only')
  const rows = sets[setName]
  if (!rows) return odataError(res, 404, `Entity set ${setName} not found in ${service}`)
  if (req.method === 'HEAD') return send(res, 200)

  let result = rows
  try {
    const filter = url.searchParams.get('$filter')
    if (filter) {
      const predicate = parseFilter(filter)
      result = result.filter(predicate)
    }
  } catch (e) {
    return odataError(res, 400, e.message)
  }
  const orderby = url.searchParams.get('$orderby')
  if (orderby) {
    const keys = orderby.split(',').map(k => { const [field, dir] = k.trim().split(/\s+/); return { field, desc: dir === 'desc' } })
    result = [...result].sort((a, b) => {
      for (const { field, desc } of keys) {
        if (a[field] === b[field]) continue
        return (a[field] > b[field] ? 1 : -1) * (desc ? -1 : 1)
      }
      return 0
    })
  }
  const skip = Number(url.searchParams.get('$skip') || 0)
  const top = url.searchParams.has('$top') ? Number(url.searchParams.get('$top')) : 1000
  result = result.slice(skip, skip + top)
  const select = url.searchParams.get('$select')
  if (select) {
    const fields = select.split(',')
    result = result.map(r => Object.fromEntries(fields.map(f => [f, r[f]])))
  }
  result = result.map(r => ({ __metadata: { type: `${service}.${setName}Type` }, ...r }))
  return send(res, 200, { d: { results: result } })
})

server.listen(PORT, () => console.log(`[mock-s4] S/4HANA sandbox stand-in on http://localhost:${PORT}${BASE.slice(0, -1)}`))
