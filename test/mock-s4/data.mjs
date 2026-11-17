// Stand-in data for the SAP S/4HANA Cloud sandbox, used only by the automated tests
// and for testing without network access. The real sandbox has different materials and values.

const stock = (Material, Plant, StorageLocation, qty, { type = '01', special = '', unit = 'PC', batch = '' } = {}) => ({
  Material, Plant, StorageLocation, Batch: batch, Supplier: '', Customer: '', WBSElementInternalID: '00000000',
  SDDocument: '', SDDocumentItem: '000000', InventorySpecialStockType: special, InventoryStockType: type,
  MaterialBaseUnit: unit, MatlWrhsStkQtyInMatlBaseUnit: qty.toFixed(3)
})

export const A_MatlStkInAcctMod = [
  // TG10: healthy and well tuned (reorder point close to the suggestion)
  stock('TG10', '1010', '101A', 300), stock('TG10', '1010', '101B', 120),
  // TG11: reorder; demand has grown, so the reorder point of 100 is far too low
  stock('TG11', '1010', '101A', 80),
  // TG12: critical (stock 10 <= safety stock 20), parameters roughly right
  stock('TG12', '1010', '101A', 10),
  // TG13: MRP type PD without reorder point -> no parameters, suggestion switches to VB
  stock('TG13', '1010', '101A', 55),
  // TG14: only a safety stock (40) in S/4 and hardly any goods issues -> simple method
  stock('TG14', '1010', '101A', 25, { unit: 'KG' }),
  // TG15: only quality-inspection stock -> unrestricted stock 0 -> critical
  stock('TG15', '1010', '101A', 60, { type: '02' }),
  // TG16: own stock 70 plus consignment stock 500 (does not count) -> reorder
  stock('TG16', '1010', '101A', 70), stock('TG16', '1010', '101A', 500, { special: 'K' }),
  // TG17: excess (2600 > maximum 1500) with low demand
  stock('TG17', '1010', '101B', 2000), stock('TG17', '1010', '101A', 600),
  // TG18: reorder, lot size rounding 25
  stock('TG18', '1010', '101A', 140, { unit: 'BOX' }),
  // TG19: no MRP data and no goods issues -> no suggestion
  stock('TG19', '1010', '101B', 12),
  // another plant
  stock('TG11', '1710', '171A', 40), stock('TG12', '1710', '171A', 900)
]

export const A_ProductDescription = [
  ['TG10', 'Pallet stretch film 500 mm'],
  ['TG11', 'Corrugated box 600x400x400'],
  ['TG12', 'Packing tape 50 mm brown'],
  ['TG13', 'Bubble wrap roll 1 m'],
  ['TG14', 'Paper void fill'],
  ['TG15', 'Safety gloves size 9'],
  ['TG16', 'Euro pallet EPAL 1'],
  ['TG17', 'Shipping label A6'],
  ['TG18', 'Cable ties 300 mm (box of 100)'],
  ['TG19', 'Hand pallet truck wheel']
].flatMap(([Product, text]) => [
  { Product, Language: 'EN', ProductDescription: text },
  { Product, Language: 'DE', ProductDescription: `${text} (DE)` }
])

const mrp = (Product, Plant, { rp = 0, ss = 0, max = 0, minLot = 0, rounding = 0, days = 0, type = 'VB', unit = 'PC' } = {}) => ({
  Product, Plant, MRPType: type,
  ReorderThresholdQuantity: rp.toFixed(3), SafetyStockQuantity: ss.toFixed(3), MaximumStockQuantity: max.toFixed(3),
  MinimumLotSizeQuantity: minLot.toFixed(3), LotSizeRoundingQuantity: rounding.toFixed(3),
  PlannedDeliveryDurationInDays: String(days), ProcurementType: 'F', BaseUnit: unit
})

export const A_ProductSupplyPlanning = [
  mrp('TG10', '1010', { rp: 150, ss: 50, max: 600, days: 5 }),
  mrp('TG11', '1010', { rp: 100, ss: 30, max: 400, minLot: 50, days: 7 }),
  mrp('TG12', '1010', { rp: 60, ss: 20, max: 240, days: 3 }),
  mrp('TG13', '1010', { type: 'PD' }),
  mrp('TG14', '1010', { ss: 40, type: 'PD', unit: 'KG' }),
  mrp('TG15', '1010', { rp: 80, ss: 25, days: 10 }),
  mrp('TG16', '1010', { rp: 120, ss: 40, max: 300, days: 14 }),
  mrp('TG17', '1010', { rp: 200, ss: 100, max: 1500, days: 4 }),
  mrp('TG18', '1010', { rp: 150, ss: 50, max: 400, rounding: 25, days: 6, unit: 'BOX' }),
  mrp('TG11', '1710', { rp: 50, ss: 10, max: 200, days: 7 })
]

const valuation = (Product, ValuationArea, price, { procedure = 'S', priceUnit = 1, currency = 'EUR', type = '' } = {}) => ({
  Product, ValuationArea, ValuationType: type, InventoryValuationProcedure: procedure,
  StandardPrice: (procedure === 'S' ? price : 0).toFixed(2), MovingAveragePrice: (procedure === 'V' ? price : 0).toFixed(2),
  PriceUnitQty: String(priceUnit), Currency: currency
})

export const A_ProductValuation = [
  valuation('TG10', '1010', 18.9),
  valuation('TG11', '1010', 1.45, { procedure: 'V' }), // moving average price
  valuation('TG12', '1010', 2.1),
  valuation('TG13', '1010', 24),
  valuation('TG14', '1010', 3.2),
  valuation('TG15', '1010', 45, { priceUnit: 10 }), // 45 EUR per 10 pairs
  valuation('TG16', '1010', 13, { type: 'NEW' }), // split valuation, ignored
  valuation('TG16', '1010', 11.5),
  valuation('TG17', '1010', 35, { priceUnit: 1000 }), // 35 EUR per 1000 labels
  valuation('TG18', '1010', 6.75),
  valuation('TG19', '1010', 39.9),
  valuation('TG11', '1710', 1.6, { currency: 'USD' }),
  valuation('TG12', '1710', 2.3, { currency: 'USD' })
]

// ---------------------------------------------------------------------------
// Goods movements: monthly goods issues for periods 2025001 ... 2025012,
// split into weekly documents, plus older documents that are outside the window
// ---------------------------------------------------------------------------

const MONTHLY_ISSUES = {
  1010: {
    TG10: [820, 800, 830, 810, 840, 820, 800, 830, 820, 810, 840, 820],
    TG11: [500, 520, 560, 600, 650, 700, 760, 800, 850, 900, 950, 1000],
    TG12: [180, 300, 220, 260, 200, 320, 240, 210, 280, 230, 250, 190],
    TG13: [140, 160, 150, 130, 170, 150, 140, 160, 150, 150, 140, 160],
    TG15: [80, 100, 90, 85, 95, 90, 100, 80, 90, 95, 85, 90],
    TG16: [200, 220, 210, 190, 230, 210, 200, 220, 210, 190, 230, 210],
    TG17: [150, 140, 160, 150, 150, 140, 160, 150, 150, 140, 160, 150],
    TG18: [700, 680, 720, 690, 710, 700, 720, 680, 700, 710, 690, 700]
  },
  1710: {
    TG11: [100, 120, 90, 110, 100, 130, 90, 100, 110, 120, 100, 90]
  }
}
const UNITS = { TG14: 'KG', TG18: 'BOX' }
const MOVEMENT_TYPE = { TG10: '201', TG11: '601', TG12: '601', TG13: '261', TG15: '201', TG16: '601', TG17: '601', TG18: '601' }

let docNo = 4900000000
const item = (Material, Plant, qty, period, { type = '601', cancelled = false, year = period.slice(0, 4) } = {}) => ({
  MaterialDocumentYear: year,
  MaterialDocument: String(++docNo),
  MaterialDocumentItem: '1',
  Material,
  Plant,
  StorageLocation: Plant === '1010' ? '101A' : '171A',
  GoodsMovementType: type,
  QuantityInBaseUnit: qty.toFixed(3),
  MaterialBaseUnit: UNITS[Material] || 'PC',
  FiscalYearPeriod: period,
  GoodsMovementIsCancelled: cancelled
})

const items = []
for (const [plant, materials] of Object.entries(MONTHLY_ISSUES)) {
  for (const [material, months] of Object.entries(materials)) {
    months.forEach((qty, m) => {
      const period = `2025${String(m + 1).padStart(3, '0')}`
      const weekly = [0.3, 0.25, 0.25, 0.2].map(f => Math.round(qty * f * 1000) / 1000)
      weekly[3] = Math.round((qty - weekly[0] - weekly[1] - weekly[2]) * 1000) / 1000
      for (const q of weekly) items.push(item(material, plant, q, period, { type: MOVEMENT_TYPE[material] || '601' }))
    })
  }
}
// TG14: only two goods issues in the window -> simple safety stock rule
items.push(item('TG14', '1010', 60, '2025004', { type: '201' }), item('TG14', '1010', 45, '2025010', { type: '201' }))
// older than the 12-period window: ignored
items.push(item('TG10', '1010', 5000, '2024011', { type: '201' }), item('TG11', '1010', 4000, '2024012'))
// TG12: a return of 30 to stock in period 2025006 (reduces the consumption), and an issue of 999
// that was cancelled: the original is flagged and the reversal document cancels it out
items.push(item('TG12', '1010', 30, '2025006', { type: '602' }))
items.push(item('TG12', '1010', 999, '2025007', { cancelled: true }), item('TG12', '1010', 999, '2025007', { type: '602' }))
// goods receipts are not consumption (and not requested by the app)
items.push(item('TG11', '1010', 2000, '2025012', { type: '101' }), item('TG19', '1010', 20, '2025003', { type: '101' }))

// ---------------------------------------------------------------------------
// Plant 1020: 60 materials with long numbers, to test that the batches keep the URLs short
// ---------------------------------------------------------------------------

export const LONG_PLANT = '1020'
export const LONG_MATERIALS = Array.from({ length: 60 }, (_, i) => `MAT-1020-LONG-${String(i + 1).padStart(4, '0')}`)
LONG_MATERIALS.forEach((material, i) => {
  A_MatlStkInAcctMod.push(stock(material, LONG_PLANT, '102A', 50 + i))
  A_ProductDescription.push({ Product: material, Language: 'EN', ProductDescription: `Long material ${i + 1}` })
  A_ProductSupplyPlanning.push(mrp(material, LONG_PLANT, { rp: 40, ss: 10, max: 200, days: 5 }))
  A_ProductValuation.push(valuation(material, LONG_PLANT, 2 + i / 10))
  for (let m = 1; m <= 12; m++) items.push(item(material, LONG_PLANT, 30 + i, `2025${String(m).padStart(3, '0')}`, { type: '201' }))
})

export const A_MaterialDocumentItem = items
