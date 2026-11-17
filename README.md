# Inventory Planning Cockpit (Project 4 – SAP Fiori on SAP BTP)

Brightline Distribution GmbH, a fictional wholesale distributor, uses this side-by-side extension on SAP BTP to keep
the planning parameters of its materials right: reorder point, safety stock and maximum stock.

- **Inventory Planning Cockpit** (`app/cockpit`, freestyle SAPUI5) for the **inventory planner**: stock situation per
  plant from SAP S/4HANA (KPI tiles, coverage in days, stock value), parameters suggested from the goods issues of the
  last 12 periods, and proposals for new parameters with a reason.
- **Approve Parameter Changes** (`app/approvals`, SAP Fiori elements List Report / Object Page) for the
  **planning lead**: approve or reject proposals and write approved parameters to the MRP data in SAP S/4HANA.
- **Backend**: SAP Cloud Application Programming Model (CAP, Node.js) with SAP HANA Cloud, XSUAA roles, and three
  SAP S/4HANA Cloud APIs of the SAP Business Accelerator Hub sandbox through the BTP destination `S4HANA_SANDBOX`.

| Folder | Content |
|---|---|
| `db/` | Data model (materials, parameter changes, history, sync log) and code lists |
| `srv/` | `PlannerService`, `ApprovalService`, business rules (`srv/lib/planning.js`), S/4HANA access (`srv/lib/s4.js`, `srv/lib/sync.js`) |
| `srv/external/` | The parts of the S/4HANA Cloud APIs the app uses (stock, product master, material documents) |
| `app/cockpit/` | Freestyle SAPUI5 app (planner) |
| `app/approvals/` | SAP Fiori elements app (planning lead) and its annotations |
| `test/` | 26 automated tests and a local stand-in for the S/4HANA sandbox |
| `mta.yaml`, `xs-security.json`, `.deploy/app-router/` | Deployment to SAP BTP, Cloud Foundry |
| `docs/` | Requirements and design (`project4-requirements-and-design.md`), step-by-step guide (`RUN-IN-BAS.md`), diagrams, wireframes |

## Quick start in SAP Business Application Studio

```sh
cp .env.example .env          # then put your api.sap.com key after S4_API_KEY=
npm install
npm test                      # 26 tests, using the local S/4HANA stand-in
cds watch                     # open /cockpit/webapp/index.html, log on as demo / demo
```

Local users: `demo` (planner and approver), `planner`, `approver`; the password equals the user name.

Switches (environment variables or `package.json` → `brightline`):
`S4_WRITE_MODE=live` writes approved parameters to S/4HANA (default `simulate`, because the sandbox is read-only);
`FOUR_EYES=true` stops users from approving their own proposals.

## Deploy to SAP BTP

```sh
npm run build:mta             # mbt build -t gen --mtar mta.tar
cf login --sso
npm run deploy                # cf deploy gen/mta.tar
```

Then assign the role collections `InventoryPlanning_Planner` and `InventoryPlanning_Approver` to your user.
See `docs/RUN-IN-BAS.md` for every step, including the first-time setup of a new BTP trial account.
