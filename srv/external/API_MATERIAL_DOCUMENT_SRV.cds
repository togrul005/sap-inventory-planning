/*
 * SAP S/4HANA Cloud API "Material Documents" (API_MATERIAL_DOCUMENT_SRV, OData V2)
 * https://api.sap.com/api/API_MATERIAL_DOCUMENT_SRV
 *
 * Minimal definition: goods movement items, used to measure consumption (goods issues) per material.
 */
@cds.external: true
service API_MATERIAL_DOCUMENT_SRV {

  @cds.persistence.skip
  entity A_MaterialDocumentItem {
    key MaterialDocumentYear     : String(4);
    key MaterialDocument         : String(10);
    key MaterialDocumentItem     : String(4);
        Material                 : String(40);
        Plant                    : String(4);
        StorageLocation          : String(4);
        GoodsMovementType        : String(3);  // 201, 261, 601, ... = goods issues
        QuantityInBaseUnit       : Decimal(13, 3);
        MaterialBaseUnit         : String(3);
        FiscalYearPeriod         : String(7);  // e.g. 2025008 = period 8 of 2025
        GoodsMovementIsCancelled : Boolean;
  }
}
