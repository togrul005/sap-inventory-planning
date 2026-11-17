# Project 4 – Run and deploy the Inventory Planning Cockpit

📷 marks a screenshot for the report. Never screenshot `.env`, the terminal line that creates it, or the
API key value in the destination.

---

## 0. First-time setup (skip if your BTP trial already ran Project 2)

You need your own SAP BTP trial account. The commands below assume the region **US East (VA)**.

1. **BTP trial:** go to https://account.hanatrial.ondemand.com → **Go To Your Trial Account** → open the subaccount **trial**.
   Cloud Foundry is enabled there with the space **dev**.
2. **Business Application Studio:** Instances and Subscriptions → *SAP Business Application Studio* (or *SAP Build
   Code*) → **Go to Application**. If it is not listed, open **Boosters** in the left menu and run
   *Set up account for SAP Business Application Studio*.
3. **Dev space:** in the Dev Space Manager click **Create Dev Space**, name it `InventoryPlanning`, choose
   **Full Stack Cloud Application** → **Create Dev Space**. Open it when it shows *Running*.
4. **SAP HANA Cloud** (about 15 minutes; SAP tutorial *Provision an Instance of SAP HANA Cloud, SAP HANA Database*):
   - Service Marketplace → **SAP HANA Cloud** → **Create**, plan **tools** (a subscription).
   - Security → Users → your user → **Assign Role Collection** → *SAP HANA Cloud Administrator*.
   - Instances and Subscriptions → SAP HANA Cloud → **Go to Application** → **Create Instance** → *SAP HANA Database*.
     Name `brightline_hdb`, choose an administrator password, under connections **Allow all IP addresses**.
   - **Instance Mapping** (in the wizard, or afterwards via ⋯ → *Manage Configuration*): environment *Cloud Foundry*,
     Environment Instance ID = your **Org ID** from the subaccount Overview page. Wait until the instance is *Running*.
5. **API key:** log in at https://api.sap.com → your profile (top right) → **Settings** → **Show API Key** → copy it.
6. **Destination:** subaccount → Connectivity → **Destinations** → **Create Destination**:
   Name `S4HANA_SANDBOX`, Type HTTP, URL `https://sandbox.api.sap.com/s4hanacloud`, Proxy Type Internet,
   Authentication NoAuthentication; **Additional Properties → New Property** `URL.headers.APIKey` = your key → **Save**.

## Before you start (every time you continue)

1. **SAP HANA Cloud** instance `brightline_hdb` is **Running** in SAP HANA Cloud Central, with *Allow all IP addresses*
   and an **Instance Mapping** to your Cloud Foundry Org ID. The trial stops it every night: ⋯ → **Start**. 📷
2. **Destination** `S4HANA_SANDBOX` exists as in step 0.6. 📷 (cover the key)

## A. Open SAP Business Application Studio

SAP BTP cockpit → Instances and Subscriptions → SAP Business Application Studio (or SAP Build Code) →
**Go to Application** → start your **Full Stack** dev space and open it when it shows *Running*.

## B. Upload and unpack the project

1. **File → Open Folder** → `/home/user/projects/` → **OK**.
2. Right-click the empty area of the Explorer → **Upload...** → choose `project4-inventory-planning.tgz`.
3. Open a terminal (☰ → Terminal → New Terminal) and run:

```
cd /home/user/projects
tar -xzf project4-inventory-planning.tgz
rm project4-inventory-planning.tgz
cd inventory-planning
git init
git add -A
git commit -m "Project 4: Inventory Planning Cockpit"
```

The folder **inventory-planning** appears in the Explorer. 📷 (file tree)
If git asks who you are: `git config --global user.name "Your Name"` and `git config --global user.email "you@example.com"`.

## C. API key for running locally

```
cd /home/user/projects/inventory-planning
cp .env.example .env
```

Open `.env` in the editor and paste your api.sap.com key after `S4_API_KEY=` (no spaces, no quotes), save, then check
that git ignores it:

```
git check-ignore .env && echo ".env is ignored by git"
```

If you already have the key in the Project 2 folder, this copies it instead:
`grep '^S4_API_KEY=' ../ai-created-cap/.env > .env`

## D. Install, test and run in BAS

```
npm install
npm test
cds watch
```

- `npm test` ends with `# pass 26` and `# fail 0`. The tests use a local stand-in, not the sandbox. 📷
- `cds watch`: click **Open in a New Tab** in the popup (or Ctrl+Shift+P → **Ports: Preview** → 4004).
  The start page lists the two apps under **Web Apps** and the three S/4HANA APIs under **Required Services**. 📷
- Click **cockpit/webapp** and sign in as **demo** / **demo** (planner and approver).

Try the flow:

1. **Check Connection** → five lines with ✔ (stock, descriptions, MRP data, valuation, goods movements) and
   *Update mode: simulated*. 📷
2. **Sync from S/4HANA** (plant 1010). The terminal shows lines like
   `[s4] - GET A_MatlStkInAcctMod plant=1010 skip=0 -> 312 rows in 840 ms` and
   `GET A_MaterialDocumentItem batch 1 skip=0 -> …`; these are live calls to the sandbox. 📷 📷
   - The message says how many materials have MRP data, a price and goods issues, and which periods were used.
   - *No stock found*: open the **Plant** dropdown, pick a plant marked *S/4HANA* and sync again.
   - *0 with goods issues*: the sandbox has no consumption for these materials, so there are no suggestions.
     Try another plant from the dropdown (e.g. 1710). Without suggestions you can still propose values by hand
     (method *Manual*). Send me a screenshot of the message and I'll check it.
3. Look at the tiles, then click **To Review** (or **Critical**). Open the **Sync Log** tab. 📷
4. Click **Propose** on a material with a big deviation:
   - read the demand line and the formula line (numbers of this material), 📷
   - change the lead time once (e.g. +3 days) and see the suggestion change, set it back,
   - **Use Suggestion**, write a reason, check *Status after change* → **Submit for Approval**. 📷
   - The row now shows the link *PC-2026-0001 · waiting for approval*; the **Changes** tab lists it. 📷
5. Click **Approve Changes** (opens the approvals app; locally also **approvals/webapp** on the start page).
   Click the row (or the **>** at its end) → object page with current, suggested and proposed values. 📷
   **Approve** → **Update in S/4HANA**. Look at the sections *Update in SAP S/4HANA* (payload) and *History*. 📷 📷
6. Back in the cockpit, press **Sync from S/4HANA** again: the material shows the new parameters
   (*approved in PC-2026-0001*) and its new status; *Open Changes* went down. 📷
7. Optional: propose for another material and **Reject** it with a reason, or **Withdraw** one in the Changes tab.

Stop with Ctrl+C. Locally the data lives in memory, so it is gone after a restart (sync again).
Other local users: `planner`/`planner` and `approver`/`approver` (use a private window to switch users).
To try the four-eyes principle locally: `FOUR_EYES=true cds watch`.

## E. Deploy to SAP BTP

1. **Start the database** if it is stopped: SAP HANA Cloud Central → `brightline_hdb` → ⋯ → **Start**, wait for *Running*.
2. **Log on to Cloud Foundry** in the terminal. The API endpoint is on the subaccount **Overview** page under
   *Cloud Foundry Environment*; for a US East trial it is usually this one:

   ```
   cf login -a https://api.cf.us10-001.hana.ondemand.com --sso
   ```

   Open the link it prints, sign in, copy the temporary code into the terminal, then pick your org and the space `dev`.
3. **Build** the MTA archive (1–3 minutes):

   ```
   npm run build:mta
   ```

   It ends with `the MTA archive generated at: gen/mta.tar`. 📷
4. **Deploy** (5–10 minutes):

   ```
   npm run deploy
   ```

   It ends with `Process finished.` 📷 It creates the HDI container with the tables, the XSUAA instance with the
   roles and role collections, the destination and HTML5 repository instances, the CAP service and the app router.
5. Check with `cf apps`: `inventory-planning-srv` and `inventory-planning` are *started*;
   `inventory-planning-db-deployer` is *stopped*, which is normal because it only runs once to create the tables. 📷

## F. Give yourself the roles

BTP cockpit → subaccount **trial** → **Security → Users** → click your user (identity provider
*Default identity provider*) → **Assign Role Collection** → tick **InventoryPlanning_Planner** and
**InventoryPlanning_Approver** → **Assign**. 📷

Teammates can use the deployed app too: add their e-mail under **Security → Users → Create**, then assign the role collections.

## G. Open and demo the deployed app

1. Get the URL: `cf app inventory-planning` → **routes**, or BTP cockpit → Cloud Foundry → Spaces → dev →
   Applications → **inventory-planning** → *Application Routes*.
2. Open `https://<route>` in a **private window** (so the new roles are used) and sign in with your SAP account.
   The cockpit opens at `/brightlinecockpit/index.html`. 📷 (browser address bar visible)
3. **Check Connection** → ✔ again, now through the destination. 📷
4. Repeat the flow from step D (sync, propose, approve, update in S/4HANA, sync). Data is now stored in
   SAP HANA Cloud, so it survives restarts. 📷 📷
5. The approvals app is at `https://<route>/brightlineapprovals/index.html` (the *Approve Changes* button opens it).
6. Server log with the S/4HANA calls: `cf logs inventory-planning-srv --recent | grep "\[s4\]"` 📷

## H. Optional: tiles in SAP Build Work Zone

Only if you have time; the app is complete without it. In a trial account, Work Zone needs an SAP Cloud
Identity Services tenant with trust to the subaccount. Follow the SAP tutorial
[Set Up SAP Build Work Zone, standard edition Using a Trial Account](https://developers.sap.com/tutorials/cp-portal-cloud-foundry-getting-started.html)
(30–45 minutes), then:

1. Assign yourself the role collection **Launchpad_Admin** and open the Work Zone site manager
   (Instances and Subscriptions → SAP Build Work Zone, standard edition → Go to Application).
2. **Channel Manager** → refresh **HTML5 Apps**. **Content Manager** → **Content Explorer** → **HTML5 Apps** →
   select *Inventory Planning Cockpit* and *Approve Parameter Changes* → **Add to My Content**.
3. **My Content**: create a group *Inventory Planning* with both apps, and add both apps to the role **Everyone**.
4. **Site Directory** → **Create Site** *Brightline* → open the site → two tiles. 📷
5. Users who log on through the Cloud Identity tenant are different users in BTP: assign the two
   InventoryPlanning role collections to them as well (Security → Users, identity provider = your tenant).

## I. Screenshot checklist

| Area | Screenshot |
|---|---|
| Setup | HANA Cloud instance running + instance mapping; destination (key covered); role collections assigned |
| Requirements and design | Wireframes and diagrams from `docs/images`; data model (`db/schema.cds`, or right-click → *Open With → CDS Graphical Modeler*); `srv/external` API definitions |
| Development | File tree in BAS; `npm test` result; `cds watch` with `[s4]` lines; cockpit running locally |
| Deployment | `npm run build:mta` result; `npm run deploy` ending with *Process finished*; `cf apps`; BTP cockpit Applications and Instances |
| End-to-end | Deployed cockpit (tiles, statuses, coverage, suggestions), connection check, sync log, propose dialog with formula, changes tab, approvals list, object page before and after approval, S/4HANA payload, history, cockpit after the update |
| Generative AI | Chat prompts, a generated code part next to its result in the app, the before/after of the scenario (see chapter 12 of the design document) |

## J. If something fails

| Problem | Fix |
|---|---|
| Deploy fails at `inventory-planning-db-deployer` (HANA connection) | Start the HANA instance; check the instance mapping uses the Org ID and *Allow all IP addresses*; run `npm run deploy` again |
| *Service plan … not found* or entitlement errors | Entitlements → Edit → Add Service Plans: SAP HANA Schemas & HDI Containers (hdi-shared), HTML5 Application Repository Service (app-host, app-runtime), Destination Service (lite), Authorization and Trust Management Service (application) → Save |
| *Memory quota exceeded* | `cf apps`, then `cf stop <app>` for apps you don't need (for example the Project 2 apps while you demo Project 4) |
| 403 / *Forbidden* in the app | Assign both role collections, then open the URL in a new private window |
| Sync: *S/4HANA rejected the API key* | Fix `URL.headers.APIKey` in the destination, then `cf restart inventory-planning-srv` |
| Sync: *Destination 'S4HANA_SANDBOX' not found* | The destination name must be exactly `S4HANA_SANDBOX` |
| Sync is *PARTIAL* | One of the optional APIs failed; the message names it. The stock is up to date, the other values are the ones from the last successful sync |
| Errors after the database was stopped overnight | Start HANA, then `cf restart inventory-planning-srv` |
| Start from scratch (deletes the data) | `cf undeploy inventory-planning --delete-services --delete-service-keys` |

If something else shows up, send me a screenshot of the error and the last lines of the terminal or of
`cf logs inventory-planning-srv --recent`.

## K. Later and on presentation day

1. Start the HANA instance about 15 minutes before you need the app (the trial stops it every night).
2. Open the app router URL. The deployed app does not need BAS or `cds watch`.
3. Prepare the demo: sync once, keep one change *Submitted* so the approver part can be shown live.
4. Save your work: `git add -A && git commit -m "..."`. Keep a copy on your laptop:

   ```
   cd /home/user/projects
   tar --exclude=node_modules --exclude=gen --exclude=.env -czf project4-backup.tgz inventory-planning
   ```

   In the Explorer, right-click **project4-backup.tgz** → **Download**, then delete it there.
5. The trial ends after 90 days and is deleted earlier if you don't log in at least every 30 days.
