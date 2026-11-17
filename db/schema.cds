namespace brightline.planning;

using {
  cuid,
  managed,
  sap.common.CodeList
} from '@sap/cds/common';

// ---------------------------------------------------------------------------
// Code lists
// ---------------------------------------------------------------------------

/** Stock situation of a material compared with its planning parameters */
entity StockStatus : CodeList {
  key code        : String(1); // C = critical, R = reorder, O = healthy, E = excess, N = no parameters
      criticality : Integer;
      sortOrder   : Integer;
}

/** Life cycle of a parameter change */
entity ChangeStatus : CodeList {
  key code        : String(1); // S = submitted, A = approved, U = updated in S/4HANA, R = rejected, W = withdrawn
      criticality : Integer;
      isOpen      : Boolean;
}

// ---------------------------------------------------------------------------
// Materials: stock, consumption and valuation from SAP S/4HANA,
// current planning (MRP) parameters and the suggested parameters
// ---------------------------------------------------------------------------

entity Materials : managed {
  key material              : String(40)               @title: '{i18n>Material}';
  key plant                 : String(4)                @title: '{i18n>Plant}';
      description           : String(80)               @title: '{i18n>Description}';
      baseUnit              : String(3)                @title: '{i18n>Unit}';

      // stock (API_MATERIAL_STOCK_SRV)
      stockQty              : Decimal(15, 3) default 0 @title: '{i18n>UnrestrictedStock}'  @Measures.Unit: baseUnit;
      otherStockQty         : Decimal(15, 3) default 0 @title: '{i18n>OtherStock}'         @Measures.Unit: baseUnit;
      storageLocations      : Integer default 0        @title: '{i18n>StorageLocations}';
      lastSyncedAt          : Timestamp                @title: '{i18n>LastSyncedAt}';

      // current planning parameters (API_PRODUCT_SRV supply planning data, or the last approved change)
      mrpType               : String(2)                @title: '{i18n>MrpType}';
      reorderPoint          : Decimal(15, 3) default 0 @title: '{i18n>ReorderPoint}'       @Measures.Unit: baseUnit;
      safetyStock           : Decimal(15, 3) default 0 @title: '{i18n>SafetyStock}'        @Measures.Unit: baseUnit;
      maxStock              : Decimal(15, 3) default 0 @title: '{i18n>MaxStock}'           @Measures.Unit: baseUnit;
      minLotSize            : Decimal(15, 3) default 0 @title: '{i18n>MinLotSize}'         @Measures.Unit: baseUnit;
      roundingQty           : Decimal(15, 3) default 0 @title: '{i18n>RoundingQty}'        @Measures.Unit: baseUnit;
      leadTimeDays          : Integer default 7        @title: '{i18n>LeadTimeDays}';
      parameterSource       : String(10) default 'NONE' @title: '{i18n>ParameterSource}'; // S4 | APPROVED | NONE
      parameterChangedBy    : String(255)              @title: '{i18n>ParameterChangedBy}';
      parameterChangedAt    : Timestamp                @title: '{i18n>ParameterChangedAt}';
      parameterChangeNo     : String(12)               @title: '{i18n>ParameterChangeNo}';

      // valuation (API_PRODUCT_SRV A_ProductValuation)
      price                 : Decimal(12, 3)           @title: '{i18n>Price}'              @Measures.ISOCurrency: currency;
      priceUnitQty          : Decimal(5, 0) default 1  @title: '{i18n>PriceUnit}';
      currency              : String(5)                @title: '{i18n>Currency}'           @Semantics.currencyCode;

      // consumption over the last 12 periods (API_MATERIAL_DOCUMENT_SRV goods issues)
      consumptionQty        : Decimal(15, 3) default 0 @title: '{i18n>ConsumptionQty}'     @Measures.Unit: baseUnit;
      consumptionDocs       : Integer default 0        @title: '{i18n>ConsumptionDocs}';
      consumptionFrom       : String(7)                @title: '{i18n>ConsumptionFrom}';
      consumptionTo         : String(7)                @title: '{i18n>ConsumptionTo}';
      avgDailyDemand        : Decimal(15, 4) default 0 @title: '{i18n>AvgDailyDemand}'     @Measures.Unit: baseUnit;
      demandStdDevDaily     : Decimal(15, 4) default 0 @title: '{i18n>DemandStdDevDaily}'  @Measures.Unit: baseUnit;

      // suggested parameters (reorder-point formula, calculated at sync)
      suggestedReorderPoint : Decimal(15, 3)           @title: '{i18n>SuggestedReorderPoint}' @Measures.Unit: baseUnit;
      suggestedSafetyStock  : Decimal(15, 3)           @title: '{i18n>SuggestedSafetyStock}'  @Measures.Unit: baseUnit;
      suggestedMaxStock     : Decimal(15, 3)           @title: '{i18n>SuggestedMaxStock}'     @Measures.Unit: baseUnit;

      // calculated on read, so the database can filter and sort by them
      status                : String(1) = (
        case
          when reorderPoint is null or reorderPoint <= 0 then 'N'
          when stockQty <= safetyStock                   then 'C'
          when stockQty <= reorderPoint                  then 'R'
          when maxStock > 0 and stockQty > maxStock      then 'E'
          else 'O'
        end
      )                                                @title: '{i18n>StockStatus}';
      criticality           : Integer = (
        case
          when reorderPoint is null or reorderPoint <= 0 then 0
          when stockQty <= safetyStock                   then 1
          when stockQty <= reorderPoint                  then 2
          when maxStock > 0 and stockQty > maxStock      then 5
          else 3
        end
      );
      statusSort            : Integer = (
        case
          when reorderPoint is null or reorderPoint <= 0 then 3
          when stockQty <= safetyStock                   then 1
          when stockQty <= reorderPoint                  then 2
          when maxStock > 0 and stockQty > maxStock      then 4
          else 5
        end
      );
      coverageDays          : Decimal(10, 1) = (
        case
          when avgDailyDemand > 0 then stockQty * 1.0 / avgDailyDemand
          else null
        end
      )                                                @title: '{i18n>CoverageDays}';
      stockValue            : Decimal(15, 2) = (
        case
          when price is null       then null
          when priceUnitQty > 0    then stockQty * price * 1.0 / priceUnitQty
          else stockQty * price * 1.0
        end
      )                                                @title: '{i18n>StockValue}'         @Measures.ISOCurrency: currency;

      // how far the current reorder point is from the suggested one (100 if none is maintained)
      deviationPct          : Decimal(7, 1) = (
        case
          when suggestedReorderPoint is null                then null
          when reorderPoint is null or reorderPoint <= 0     then 100
          when suggestedReorderPoint >= reorderPoint         then (suggestedReorderPoint - reorderPoint) * 100.0 / reorderPoint
          else (reorderPoint - suggestedReorderPoint) * 100.0 / reorderPoint
        end
      )                                                @title: '{i18n>DeviationPct}';

      // true if the reorder point is 25 % or more away from the suggestion, or none is maintained
      // (REVIEW_THRESHOLD_PCT in srv/lib/planning.js; a Boolean, so filters work the same on SQLite and SAP HANA)
      reviewNeeded          : Boolean = (
        case
          when suggestedReorderPoint is null                        then false
          when reorderPoint is null or reorderPoint <= 0             then true
          when suggestedReorderPoint >= reorderPoint * 1.25          then true
          when suggestedReorderPoint <= reorderPoint * 0.75          then true
          else false
        end
      )                                                @title: '{i18n>ReviewNeeded}';

      changes               : Association to many ParameterChanges
                                on  changes.material = material
                                and changes.plant    = plant;
}

// ---------------------------------------------------------------------------
// Parameter changes: proposed by the planner, decided by the planning lead,
// then written to the material's MRP data in SAP S/4HANA
// ---------------------------------------------------------------------------

entity ParameterChanges : cuid, managed {
  changeNo               : String(12)                  @title: '{i18n>ChangeNo}';
  material               : String(40)                  @title: '{i18n>Material}';
  plant                  : String(4)                   @title: '{i18n>Plant}';
  materialRef            : Association to Materials
                             on  materialRef.material = material
                             and materialRef.plant    = plant;
  description            : String(80)                  @title: '{i18n>Description}';
  baseUnit               : String(3)                   @title: '{i18n>Unit}';

  // values before the change
  currentMrpType         : String(2)                   @title: '{i18n>CurrentMrpType}';
  currentReorderPoint    : Decimal(15, 3)              @title: '{i18n>CurrentReorderPoint}'  @Measures.Unit: baseUnit;
  currentSafetyStock     : Decimal(15, 3)              @title: '{i18n>CurrentSafetyStock}'   @Measures.Unit: baseUnit;
  currentMaxStock        : Decimal(15, 3)              @title: '{i18n>CurrentMaxStock}'      @Measures.Unit: baseUnit;
  currentLeadTimeDays    : Integer                     @title: '{i18n>CurrentLeadTimeDays}';

  // proposed values
  newMrpType             : String(2)                   @title: '{i18n>NewMrpType}';
  newReorderPoint        : Decimal(15, 3)              @title: '{i18n>NewReorderPoint}'      @Measures.Unit: baseUnit;
  newSafetyStock         : Decimal(15, 3)              @title: '{i18n>NewSafetyStock}'       @Measures.Unit: baseUnit;
  newMaxStock            : Decimal(15, 3)              @title: '{i18n>NewMaxStock}'          @Measures.Unit: baseUnit;
  newLeadTimeDays        : Integer                     @title: '{i18n>NewLeadTimeDays}';

  // how the proposal was made
  method                 : String(10)                  @title: '{i18n>Method}'; // FORMULA | ADJUSTED | MANUAL
  methodText             : String(40) = (
    case method
      when 'FORMULA'  then 'As suggested by the formula'
      when 'ADJUSTED' then 'Suggestion adjusted by the planner'
      when 'MANUAL'   then 'Manual (no suggestion)'
      else method
    end
  )                                                    @title: '{i18n>Method}';
  avgDailyDemand         : Decimal(15, 4)              @title: '{i18n>AvgDailyDemand}'       @Measures.Unit: baseUnit;
  demandStdDevDaily      : Decimal(15, 4)              @title: '{i18n>DemandStdDevDaily}'    @Measures.Unit: baseUnit;
  serviceLevelPct        : Decimal(5, 2)               @title: '{i18n>ServiceLevelPct}';
  consumptionDocs        : Integer                     @title: '{i18n>ConsumptionDocs}';
  suggestedReorderPoint  : Decimal(15, 3)              @title: '{i18n>SuggestedReorderPoint}' @Measures.Unit: baseUnit;
  suggestedSafetyStock   : Decimal(15, 3)              @title: '{i18n>SuggestedSafetyStock}'  @Measures.Unit: baseUnit;
  suggestedMaxStock      : Decimal(15, 3)              @title: '{i18n>SuggestedMaxStock}'     @Measures.Unit: baseUnit;
  reason                 : String(500)                 @title: '{i18n>Reason}';

  // expected effect
  stockAtRequest         : Decimal(15, 3)              @title: '{i18n>StockAtRequest}'       @Measures.Unit: baseUnit;
  coverageDaysAtRequest  : Decimal(10, 1)              @title: '{i18n>CoverageDays}';
  statusBefore           : Association to StockStatus  @title: '{i18n>StatusBefore}';
  statusAfter            : Association to StockStatus  @title: '{i18n>StatusAfter}';
  price                  : Decimal(12, 3)              @title: '{i18n>Price}'                @Measures.ISOCurrency: currency;
  priceUnitQty           : Decimal(5, 0)               @title: '{i18n>PriceUnit}';
  currency               : String(5)                   @title: '{i18n>Currency}'             @Semantics.currencyCode;
  safetyStockValueChange : Decimal(15, 2)              @title: '{i18n>SafetyStockValueChange}' @Measures.ISOCurrency: currency;

  // decision
  status                 : Association to ChangeStatus @title: '{i18n>ChangeStatus}';
  decisionNote           : String(500)                 @title: '{i18n>DecisionNote}';
  decidedBy              : String(255)                 @title: '{i18n>DecidedBy}';
  decidedAt              : Timestamp                   @title: '{i18n>DecidedAt}';

  // update of the MRP data in SAP S/4HANA (API_PRODUCT_SRV, A_ProductSupplyPlanning)
  s4Mode                 : String(10)                  @title: '{i18n>S4Mode}'; // SIMULATED | S4
  s4Target               : String(120)                 @title: '{i18n>S4Target}';
  s4UpdatedAt            : Timestamp                   @title: '{i18n>S4UpdatedAt}';
  s4Payload              : LargeString                 @title: '{i18n>S4Payload}';

  events                 : Composition of many ChangeEvents
                             on events.change = $self;
}

entity ChangeEvents : cuid {
  change    : Association to ParameterChanges;
  eventAt   : Timestamp   @cds.on.insert: $now  @title: '{i18n>EventAt}';
  eventBy   : String(255) @cds.on.insert: $user @title: '{i18n>EventBy}';
  eventType : String(20)                        @title: '{i18n>EventType}';
  note      : String(500)                       @title: '{i18n>Note}';
}

// ---------------------------------------------------------------------------
// Log of every synchronisation with SAP S/4HANA
// ---------------------------------------------------------------------------

entity SyncRuns : cuid {
  plant            : String(4)    @title: '{i18n>Plant}';
  startedAt        : Timestamp    @title: '{i18n>StartedAt}';
  finishedAt       : Timestamp    @title: '{i18n>FinishedAt}';
  startedBy        : String(255)  @title: '{i18n>StartedBy}';
  result           : String(10)   @title: '{i18n>SyncResult}'; // OK | PARTIAL | FAILED
  stockRows        : Integer      @title: '{i18n>StockRows}';
  materials        : Integer      @title: '{i18n>Materials}';
  parametersFromS4 : Integer      @title: '{i18n>ParametersFromS4}';
  pricesFromS4     : Integer      @title: '{i18n>PricesFromS4}';
  consumptionDocs  : Integer      @title: '{i18n>ConsumptionDocs}';
  durationMs       : Integer      @title: '{i18n>DurationMs}';
  message          : String(1000) @title: '{i18n>Message}';
}
