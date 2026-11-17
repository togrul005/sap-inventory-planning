using ApprovalService as service from '../../srv/approval-service';

// ---------------------------------------------------------------------------
// Texts, value helps and field behaviour
// ---------------------------------------------------------------------------

annotate service.Changes with {
  ID           @UI.Hidden;
  material     @Common.Text: description  @Common.TextArrangement: #TextFirst;
  status       @Common.Text: status.name  @Common.TextArrangement: #TextOnly  @Common.ValueListWithFixedValues  @Common.FilterDefaultValue: 'S';
  statusBefore @Common.Text: statusBefore.name  @Common.TextArrangement: #TextOnly;
  statusAfter  @Common.Text: statusAfter.name  @Common.TextArrangement: #TextOnly;
  method       @Common.Text: methodText  @Common.TextArrangement: #TextOnly;
  methodText   @UI.Hidden;
  createdBy    @title: 'Proposed By';
  createdAt    @title: 'Proposed On';
  reason       @UI.MultiLineText;
  decisionNote @UI.MultiLineText;
  s4Payload    @UI.MultiLineText;
};

// ---------------------------------------------------------------------------
// List report
// ---------------------------------------------------------------------------

annotate service.Changes with @(
  UI.HeaderInfo         : {
    TypeName      : 'Parameter Change',
    TypeNamePlural: 'Parameter Changes',
    Title         : {Value: changeNo},
    Description   : {Value: description},
    TypeImageUrl  : 'sap-icon://approvals'
  },
  UI.SelectionFields    : [
    status_code,
    plant,
    material,
    method,
    createdBy
  ],
  UI.LineItem           : [
    {
      $Type : 'UI.DataFieldForAction',
      Action: 'ApprovalService.approveChange',
      Label : 'Approve'
    },
    {
      $Type : 'UI.DataFieldForAction',
      Action: 'ApprovalService.rejectChange',
      Label : 'Reject'
    },
    {
      $Type : 'UI.DataFieldForAction',
      Action: 'ApprovalService.updateS4',
      Label : 'Update in S/4HANA'
    },
    {
      Value            : changeNo,
      ![@HTML5.CssDefaults]: {width: '9rem'},
      ![@UI.Importance]: #High
    },
    {
      Value            : material,
      ![@HTML5.CssDefaults]: {width: '15rem'},
      ![@UI.Importance]: #High
    },
    {
      Value            : status_code,
      ![@HTML5.CssDefaults]: {width: '11rem'},
      Criticality      : status.criticality,
      ![@UI.Importance]: #High
    },
    {
      Value            : currentReorderPoint,
      ![@HTML5.CssDefaults]: {width: '11rem'},
      ![@UI.Importance]: #Medium
    },
    {
      Value            : newReorderPoint,
      ![@HTML5.CssDefaults]: {width: '9rem'},
      ![@UI.Importance]: #High
    },
    {
      Value            : newSafetyStock,
      ![@HTML5.CssDefaults]: {width: '9rem'},
      ![@UI.Importance]: #High
    },
    {
      Value            : newMaxStock,
      ![@HTML5.CssDefaults]: {width: '11rem'},
      ![@UI.Importance]: #Medium
    },
    {
      Value            : statusAfter_code,
      ![@HTML5.CssDefaults]: {width: '9rem'},
      Criticality      : statusAfter.criticality,
      ![@UI.Importance]: #High
    },
    {
      Value            : safetyStockValueChange,
      ![@HTML5.CssDefaults]: {width: '10rem'},
      ![@UI.Importance]: #High
    },
    {
      Value            : method,
      ![@HTML5.CssDefaults]: {width: '14rem'},
      ![@UI.Importance]: #Medium
    },
    {
      Value            : createdBy,
      ![@HTML5.CssDefaults]: {width: '7rem'},
      ![@UI.Importance]: #Medium
    },
    {
      Value            : createdAt,
      ![@HTML5.CssDefaults]: {width: '11rem'},
      ![@UI.Importance]: #Medium
    }
  ],
  UI.PresentationVariant: {
    SortOrder     : [{
      Property  : createdAt,
      Descending: true
    }],
    Visualizations: ['@UI.LineItem']
  }
);

// ---------------------------------------------------------------------------
// Object page
// ---------------------------------------------------------------------------

annotate service.Changes with @(
  UI.HeaderFacets                 : [
    {
      $Type : 'UI.ReferenceFacet',
      Target: '@UI.DataPoint#status'
    },
    {
      $Type : 'UI.ReferenceFacet',
      Target: '@UI.DataPoint#statusBefore'
    },
    {
      $Type : 'UI.ReferenceFacet',
      Target: '@UI.DataPoint#statusAfter'
    },
    {
      $Type : 'UI.ReferenceFacet',
      Target: '@UI.DataPoint#value'
    },
    {
      $Type : 'UI.ReferenceFacet',
      Target: '@UI.DataPoint#method'
    }
  ],
  UI.DataPoint #status            : {
    Value      : status_code,
    Title      : 'Status',
    Criticality: status.criticality
  },
  UI.DataPoint #statusBefore      : {
    Value      : statusBefore_code,
    Title      : 'Stock Status at Proposal',
    Criticality: statusBefore.criticality
  },
  UI.DataPoint #statusAfter       : {
    Value      : statusAfter_code,
    Title      : 'Stock Status After Change',
    Criticality: statusAfter.criticality
  },
  UI.DataPoint #value             : {
    Value: safetyStockValueChange,
    Title: 'Safety Stock Value Change'
  },
  UI.DataPoint #method            : {
    Value: method,
    Title: 'Proposal Method'
  },
  UI.Identification               : [
    {
      $Type : 'UI.DataFieldForAction',
      Action: 'ApprovalService.approveChange',
      Label : 'Approve'
    },
    {
      $Type : 'UI.DataFieldForAction',
      Action: 'ApprovalService.rejectChange',
      Label : 'Reject'
    },
    {
      $Type : 'UI.DataFieldForAction',
      Action: 'ApprovalService.updateS4',
      Label : 'Update in S/4HANA'
    }
  ],
  UI.Facets                       : [
    {
      $Type : 'UI.CollectionFacet',
      ID    : 'ParametersSection',
      Label : 'Parameters',
      Facets: [{
        $Type : 'UI.CollectionFacet',
        ID    : 'ParametersSubSection',
        Label : 'Current, Suggested and Proposed',
        Facets: [
          {
            $Type : 'UI.ReferenceFacet',
            ID    : 'CurrentFacet',
            Label : 'Current (S/4HANA)',
            Target: '@UI.FieldGroup#Current'
          },
          {
            $Type : 'UI.ReferenceFacet',
            ID    : 'SuggestedFacet',
            Label : 'Suggested by Formula',
            Target: '@UI.FieldGroup#Suggested'
          },
          {
            $Type : 'UI.ReferenceFacet',
            ID    : 'ProposedFacet',
            Label : 'Proposed',
            Target: '@UI.FieldGroup#Proposed'
          }
        ]
      }]
    },
    {
      $Type : 'UI.CollectionFacet',
      ID    : 'BasisSection',
      Label : 'Demand and Effect',
      Facets: [{
        $Type : 'UI.CollectionFacet',
        ID    : 'BasisSubSection',
        Label : 'Basis of the Proposal',
        Facets: [
          {
            $Type : 'UI.ReferenceFacet',
            ID    : 'DemandFacet',
            Label : 'Demand (Last 12 Periods)',
            Target: '@UI.FieldGroup#Demand'
          },
          {
            $Type : 'UI.ReferenceFacet',
            ID    : 'EffectFacet',
            Label : 'Expected Effect',
            Target: '@UI.FieldGroup#Effect'
          }
        ]
      }]
    },
    {
      $Type : 'UI.ReferenceFacet',
      ID    : 'DecisionFacet',
      Label : 'Decision',
      Target: '@UI.FieldGroup#Decision'
    },
    {
      $Type : 'UI.ReferenceFacet',
      ID    : 'S4Facet',
      Label : 'Update in SAP S/4HANA',
      Target: '@UI.FieldGroup#S4'
    },
    {
      $Type : 'UI.ReferenceFacet',
      ID    : 'HistoryFacet',
      Label : 'History',
      Target: 'events/@UI.PresentationVariant'
    }
  ],
  UI.FieldGroup #Current          : {Data: [
    {
      Value: currentMrpType,
      Label: 'MRP Type'
    },
    {
      Value: currentReorderPoint,
      Label: 'Reorder Point'
    },
    {
      Value: currentSafetyStock,
      Label: 'Safety Stock'
    },
    {
      Value: currentMaxStock,
      Label: 'Maximum Stock'
    },
    {
      Value: currentLeadTimeDays,
      Label: 'Lead Time (Days)'
    }
  ]},
  UI.FieldGroup #Suggested        : {Data: [
    {
      Value: suggestedReorderPoint,
      Label: 'Reorder Point'
    },
    {
      Value: suggestedSafetyStock,
      Label: 'Safety Stock'
    },
    {
      Value: suggestedMaxStock,
      Label: 'Maximum Stock'
    },
    {Value: serviceLevelPct}
  ]},
  UI.FieldGroup #Proposed         : {Data: [
    {
      Value: newMrpType,
      Label: 'MRP Type'
    },
    {
      Value: newReorderPoint,
      Label: 'Reorder Point'
    },
    {
      Value: newSafetyStock,
      Label: 'Safety Stock'
    },
    {
      Value: newMaxStock,
      Label: 'Maximum Stock'
    },
    {
      Value: newLeadTimeDays,
      Label: 'Lead Time (Days)'
    },
    {Value: method},
    {Value: reason},
    {Value: createdBy},
    {Value: createdAt}
  ]},
  UI.FieldGroup #Demand           : {Data: [
    {Value: avgDailyDemand},
    {Value: demandStdDevDaily},
    {Value: consumptionDocs},
    {
      Value: materialRef.consumptionQty,
      Label: 'Consumption (12 Periods)'
    },
    {
      Value: materialRef.consumptionFrom,
      Label: 'From Period'
    },
    {
      Value: materialRef.consumptionTo,
      Label: 'To Period'
    }
  ]},
  UI.FieldGroup #Effect           : {Data: [
    {Value: stockAtRequest},
    {Value: coverageDaysAtRequest},
    {
      Value      : statusBefore_code,
      Criticality: statusBefore.criticality
    },
    {
      Value      : statusAfter_code,
      Criticality: statusAfter.criticality
    },
    {Value: price},
    {Value: safetyStockValueChange},
    {
      Value: materialRef.stockQty,
      Label: 'Unrestricted Stock Now'
    }
  ]},
  UI.FieldGroup #Decision         : {Data: [
    {
      Value      : status_code,
      Criticality: status.criticality
    },
    {Value: decisionNote},
    {Value: decidedBy},
    {Value: decidedAt}
  ]},
  UI.FieldGroup #S4               : {Data: [
    {Value: s4Mode},
    {Value: s4Target},
    {Value: s4UpdatedAt},
    {Value: s4Payload}
  ]}
);

annotate service.ChangeStatus with {
  code @Common.Text: name  @Common.TextArrangement: #TextOnly;
};

annotate service.ChangeEvents with @(
  UI.LineItem           : [
    {Value: eventAt},
    {Value: eventType},
    {Value: eventBy},
    {Value: note}
  ],
  UI.PresentationVariant: {
    SortOrder     : [{
      Property  : eventAt,
      Descending: false
    }],
    Visualizations: ['@UI.LineItem']
  }
) {
  ID     @UI.Hidden;
  change @UI.Hidden;
};

// ---------------------------------------------------------------------------
// Actions: only offered in the right status, and refresh what they change
// ---------------------------------------------------------------------------

annotate service.Changes actions {
  @(
    Core.OperationAvailable: {$edmJson: {$Eq: [
      {$Path: 'in/status_code'},
      'S'
    ]}},
    Common.SideEffects     : {
      TargetProperties: [
        'in/status_code',
        'in/decisionNote',
        'in/decidedBy',
        'in/decidedAt'
      ],
      TargetEntities  : ['in/events']
    }
  )
  approveChange(note @title: 'Note (optional)'  @UI.MultiLineText);

  @(
    Core.OperationAvailable: {$edmJson: {$Eq: [
      {$Path: 'in/status_code'},
      'S'
    ]}},
    Common.SideEffects     : {
      TargetProperties: [
        'in/status_code',
        'in/decisionNote',
        'in/decidedBy',
        'in/decidedAt'
      ],
      TargetEntities  : ['in/events']
    }
  )
  rejectChange(note @title: 'Reason for Rejection'  @UI.MultiLineText  @Common.FieldControl: #Mandatory);

  @(
    Core.OperationAvailable: {$edmJson: {$Eq: [
      {$Path: 'in/status_code'},
      'A'
    ]}},
    Common.SideEffects     : {
      TargetProperties: [
        'in/status_code',
        'in/s4Mode',
        'in/s4Target',
        'in/s4UpdatedAt',
        'in/s4Payload'
      ],
      TargetEntities  : [
        'in/events',
        'in/materialRef'
      ]
    }
  )
  updateS4;
};
