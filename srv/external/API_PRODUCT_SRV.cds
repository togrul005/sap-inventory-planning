/*
 * SAP S/4HANA Cloud API "Product Master" (API_PRODUCT_SRV, OData V2)
 * https://api.sap.com/api/API_PRODUCT_SRV
 *
 * Minimal definition: descriptions, the plant's supply planning (MRP) data and the valuation price.
 * A_ProductSupplyPlanning is also the entity the app updates (PATCH) when a parameter change is approved.
 */
@cds.external: true
service API_PRODUCT_SRV {

  @cds.persistence.skip
  entity A_ProductDescription {
    key Product            : String(40);
    key Language           : String(2);
        ProductDescription : String(40);
  }

  /** MRP data of a product in a plant (reorder point, safety stock, maximum stock, lot sizes, delivery time) */
  @cds.persistence.skip
  entity A_ProductSupplyPlanning {
    key Product                       : String(40);
    key Plant                         : String(4);
        MRPType                       : String(2);
        ReorderThresholdQuantity      : Decimal(13, 3);
        SafetyStockQuantity           : Decimal(13, 3);
        MaximumStockQuantity          : Decimal(13, 3);
        MinimumLotSizeQuantity        : Decimal(13, 3);
        LotSizeRoundingQuantity       : Decimal(13, 3);
        PlannedDeliveryDurationInDays : Decimal(3, 0);
        ProcurementType               : String(1);
        BaseUnit                      : String(3);
  }

  /** Valuation per valuation area (= plant): standard or moving average price */
  @cds.persistence.skip
  entity A_ProductValuation {
    key Product                     : String(40);
    key ValuationArea               : String(4);
    key ValuationType               : String(10);
        InventoryValuationProcedure : String(1); // S = standard price, V = moving average price
        StandardPrice               : Decimal(12, 3);
        MovingAveragePrice          : Decimal(12, 3);
        PriceUnitQty                : Decimal(5, 0);
        Currency                    : String(5);
  }
}
