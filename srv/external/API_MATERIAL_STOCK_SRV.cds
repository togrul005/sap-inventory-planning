/*
 * SAP S/4HANA Cloud API "Material Stock - Read" (API_MATERIAL_STOCK_SRV, OData V2)
 * https://api.sap.com/api/API_MATERIAL_STOCK_SRV
 *
 * Minimal definition: only the entity and fields this app reads.
 * Names and types follow SAP's published metadata for the API.
 */
@cds.external: true
service API_MATERIAL_STOCK_SRV {

  /** Stock per material, plant, storage location, batch, special stock and stock type */
  @cds.persistence.skip
  entity A_MatlStkInAcctMod {
    key Material                     : String(40);
    key Plant                        : String(4);
    key StorageLocation              : String(4);
    key Batch                        : String(10);
    key Supplier                     : String(10);
    key Customer                     : String(10);
    key WBSElementInternalID         : String(24);
    key SDDocument                   : String(10);
    key SDDocumentItem               : String(6);
    key InventorySpecialStockType    : String(1);
    key InventoryStockType           : String(2); // 01 = unrestricted-use stock
        MaterialBaseUnit             : String(3);
        MatlWrhsStkQtyInMatlBaseUnit : Decimal;
  }
}
