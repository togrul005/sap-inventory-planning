using brightline.planning as db from '../db/schema';

/**
 * Service for the inventory planner (Inventory Planning Cockpit, freestyle SAPUI5 app).
 * Reads stock, MRP data, prices and goods issues from SAP S/4HANA, suggests
 * reorder point, safety stock and maximum stock, and lets the planner propose changes.
 */
@path    : '/odata/v4/planner'
@requires: 'Planner'
service PlannerService {

  @readonly
  @cds.redirection.target
  entity Materials as projection on db.Materials {
    *,
    virtual null as openChangeID     : UUID,
    virtual null as openChangeNo     : String(12)     @title: '{i18n>OpenChange}',
    virtual null as openChangeStatus : String(1)      @title: '{i18n>OpenChangeStatus}',
    virtual null as targetStock      : Decimal(15, 3) @title: '{i18n>TargetStock}',
    virtual null as stockLevelPct    : Integer        @title: '{i18n>StockLevelPct}',
    virtual null as suggestedStatus  : String(1)      @title: '{i18n>SuggestedStatus}',
    virtual null as suggestionMethod : String(12)     @title: '{i18n>SuggestionMethod}'
  }
  excluding {
    changes
  }
  actions {
    /** Suggested parameters for another lead time (the safety stock grows with the square root of the lead time) */
    function suggestFor(leadTimeDays : Integer) returns Suggestion;

    /** Propose new planning parameters for this material; the planning lead decides */
    action proposeChange(reorderPoint : Decimal(15, 3), safetyStock : Decimal(15, 3), maxStock : Decimal(15, 3), leadTimeDays : Integer, reason : String(500)) returns Changes;
  };

  @readonly
  entity Changes as projection on db.ParameterChanges
    actions {
      /** Withdraw a proposal that has not been written to S/4HANA yet */
      action withdraw(reason : String(500)) returns Changes;
    };

  @readonly entity ChangeEvents as projection on db.ChangeEvents;
  @readonly entity SyncRuns     as projection on db.SyncRuns;
  @readonly entity StockStatus  as projection on db.StockStatus;
  @readonly entity ChangeStatus as projection on db.ChangeStatus;

  type Suggestion {
    reorderPoint : Decimal(15, 3);
    safetyStock  : Decimal(15, 3);
    maxStock     : Decimal(15, 3);
    leadTimeDays : Integer;
    method       : String(12);
    statusAfter  : String(1);
  }

  type SyncResult {
    plant            : String(4);
    result           : String(10);
    stockRows        : Integer;
    materials        : Integer;
    parametersFromS4 : Integer;
    pricesFromS4     : Integer;
    consumptionDocs  : Integer;
    durationMs       : Integer;
    message          : String(1000);
  }

  type Kpis {
    plant           : String(4);
    materials       : Integer;
    critical        : Integer;
    reorder         : Integer;
    healthy         : Integer;
    excess          : Integer;
    noParameters    : Integer;
    toReview        : Integer;
    openChanges     : Integer;
    stockValue      : Decimal(15, 2);
    excessValue     : Decimal(15, 2);
    currency        : String(5);
    consumptionFrom : String(7);
    consumptionTo   : String(7);
    lastSyncAt      : Timestamp;
    lastSyncResult  : String(10);
    lastSyncMessage : String(1000);
  }

  type PlantInfo {
    plant     : String(4);
    stockRows : Integer;
    source    : String(20);
  }

  type ConnectionCheck {
    api     : String(60);
    ok      : Boolean;
    status  : Integer;
    rows    : Integer;
    ms      : Integer;
    message : String(500);
  }

  type UserInfo {
    id         : String(255);
    roles      : many String(20);
    writeMode  : String(10);
    fourEyes   : Boolean;
    connection : String(120);
  }

  /** Read stock, MRP data, prices and goods issues for one plant from SAP S/4HANA */
  action   syncFromS4(plant : String(4)) returns SyncResult;

  /** Key figures for the KPI tiles */
  function kpis(plant : String(4))       returns Kpis;

  /** Plants known locally or found in the S/4HANA stock data */
  function plants()                      returns many PlantInfo;

  /** Calls each S/4HANA API once and reports whether it works */
  function testS4Connection()            returns many ConnectionCheck;

  /** The logged-on user, their roles and how the app is configured */
  function whoAmI()                      returns UserInfo;
}
