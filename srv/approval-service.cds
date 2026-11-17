using brightline.planning as db from '../db/schema';

/**
 * Service for the planning lead (Approve Parameter Changes, SAP Fiori elements app).
 * Approved changes are written to the MRP data of the material in SAP S/4HANA.
 */
@path    : '/odata/v4/approval'
@requires: 'Approver'
service ApprovalService {

  @readonly
  entity Changes      as projection on db.ParameterChanges
    actions {
      /** Approve a submitted change */
      action approveChange(note : String(500)) returns Changes;

      /** Reject a submitted change; a note is required */
      action rejectChange(note : String(500))  returns Changes;

      /** Write the approved parameters to the material's MRP data in SAP S/4HANA */
      action updateS4()                        returns Changes;
    };

  @readonly entity Materials    as projection on db.Materials excluding { changes };
  @readonly entity ChangeEvents as projection on db.ChangeEvents;
  @readonly entity StockStatus  as projection on db.StockStatus;
  @readonly entity ChangeStatus as projection on db.ChangeStatus;
}
