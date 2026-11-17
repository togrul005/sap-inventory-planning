sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/ui/core/Fragment",
  "sap/ui/core/Messaging",
  "sap/m/MessageToast",
  "sap/m/MessageBox",
  "brightline/cockpit/model/formatter"
], (Controller, JSONModel, Filter, FilterOperator, Fragment, Messaging, MessageToast, MessageBox, formatter) => {
  "use strict";

  const DEFAULT_PLANT = "1010";
  const REORDER_POINT_MRP_TYPES = ["VB", "VM", "V1", "V2"];
  const STORAGE_KEY = "brightline.cockpit.plant";
  const num = (v) => (v === null || v === undefined || v === "" ? 0 : Number(v));
  const isNumber = (v) => v !== null && v !== undefined && String(v).trim() !== "" && Number.isFinite(Number(v));

  return Controller.extend("brightline.cockpit.controller.Cockpit", {
    formatter,

    onInit() {
      let plant = DEFAULT_PLANT;
      try {
        plant = window.localStorage.getItem(STORAGE_KEY) || DEFAULT_PLANT;
      } catch (e) { /* storage not available */ }

      this.viewModel = new JSONModel({
        plant,
        plants: [{ plant, source: "" }],
        statusFilter: "ALL",
        search: "",
        changesSearch: "",
        tab: "materials",
        syncing: false,
        user: "",
        userText: "",
        isApprover: false,
        writeMode: "simulate",
        connection: "",
        lastSyncText: "",
        lastSyncState: "None",
        demandWindowText: "",
        stockValueText: "",
        materialsTitle: "",
        changesTitle: ""
      });
      // the root view is created before it is attached to the component, so pass the models on explicitly
      this.getView().setModel(this.getOwnerComponent().getModel());
      this.getView().setModel(this.getOwnerComponent().getModel("i18n"), "i18n");
      this.getView().setModel(this.viewModel, "view");
      this.getView().setModel(new JSONModel({}), "kpi");
      this.getView().setModel(new JSONModel({ rows: [] }), "dlg");

      this._start();
    },

    // ------------------------------------------------------------------ helpers

    _text(key, args) {
      return this.getOwnerComponent().getModel("i18n").getResourceBundle().getText(key, args);
    },

    _model() {
      return this.getOwnerComponent().getModel();
    },

    /** Calls an OData operation (function or action) and returns its result */
    async _call(path, params = {}, context) {
      const binding = this._model().bindContext(path, context);
      Object.entries(params).forEach(([name, value]) => binding.setParameter(name, value));
      if (binding.invoke) {
        await binding.invoke();
      } else {
        await binding.execute();
      }
      const result = binding.getBoundContext();
      return result ? result.getObject() : undefined;
    },

    _showError(error) {
      Messaging.removeAllMessages();
      const message = (error && (error.error && error.error.message)) || (error && error.message) || String(error);
      MessageBox.error(message, { title: this._text("errorTitle") });
    },

    async _start() {
      this._applyFilters();
      this._applyChangeFilters();
      this._resume("syncTable");
      this._loadUser();
      this._loadPlants();
      await this._loadKpis();
    },

    _resume(tableId) {
      const binding = this.byId(tableId).getBinding("items");
      if (binding.isSuspended()) {
        binding.resume();
      }
      return binding;
    },

    async _loadUser() {
      try {
        const me = await this._call("/whoAmI(...)");
        this.viewModel.setProperty("/user", me.id);
        this.viewModel.setProperty("/userText", this._text("userInfo", [me.id]));
        this.viewModel.setProperty("/isApprover", (me.roles || []).includes("Approver"));
        this.viewModel.setProperty("/writeMode", me.writeMode);
        this.viewModel.setProperty("/connection", me.connection);
      } catch (e) {
        // not critical for the page
      }
    },

    async _loadPlants() {
      try {
        const plants = await this._call("/plants(...)");
        if (plants && plants.value) {
          this.viewModel.setProperty("/plants", plants.value);
        }
      } catch (e) {
        // the plant field still accepts free input
      } finally {
        Messaging.removeAllMessages();
      }
    },

    async _loadKpis() {
      const plant = this.viewModel.getProperty("/plant");
      try {
        const kpi = await this._call("/kpis(...)", { plant });
        kpi.excessValueText = this._text("excessValueFooter", [formatter.amount(kpi.excessValue), kpi.currency || ""]);
        this.getView().getModel("kpi").setData(kpi);
        this.viewModel.setProperty("/stockValueText", this._text("stockValueText", [formatter.amount(kpi.stockValue), kpi.currency || ""]));
        this.viewModel.setProperty("/demandWindowText", kpi.consumptionFrom
          ? this._text("demandWindow", [kpi.consumptionFrom, kpi.consumptionTo])
          : this._text("noDemandWindow"));
        if (kpi.lastSyncAt) {
          this.viewModel.setProperty("/lastSyncText", this._text("lastSync", [formatter.dateTime(kpi.lastSyncAt)]));
          this.viewModel.setProperty("/lastSyncState", formatter.resultState(kpi.lastSyncResult));
        } else {
          this.viewModel.setProperty("/lastSyncText", this._text("neverSynced"));
          this.viewModel.setProperty("/lastSyncState", "None");
        }
      } catch (e) {
        this._showError(e);
      }
    },

    _applyFilters() {
      const { plant, statusFilter, search } = this.viewModel.getData();
      const filters = [new Filter("plant", FilterOperator.EQ, plant)];
      if (statusFilter === "REVIEW") {
        filters.push(new Filter("reviewNeeded", FilterOperator.EQ, true));
      } else if (statusFilter && statusFilter !== "ALL") {
        filters.push(new Filter("status", FilterOperator.EQ, statusFilter));
      }
      if (search) {
        filters.push(new Filter({
          filters: [
            new Filter({ path: "material", operator: FilterOperator.Contains, value1: search, caseSensitive: false }),
            new Filter({ path: "description", operator: FilterOperator.Contains, value1: search, caseSensitive: false })
          ],
          and: false
        }));
      }
      const binding = this.byId("materialsTable").getBinding("items");
      binding.filter(filters);
      this._resume("materialsTable");
      this.viewModel.setProperty("/materialsTitle", this._text("materialsTitle", [plant]));
    },

    _applyChangeFilters() {
      const { plant, changesSearch } = this.viewModel.getData();
      const filters = [new Filter("plant", FilterOperator.EQ, plant)];
      if (changesSearch) {
        filters.push(new Filter({
          filters: [
            new Filter({ path: "material", operator: FilterOperator.Contains, value1: changesSearch, caseSensitive: false }),
            new Filter({ path: "changeNo", operator: FilterOperator.Contains, value1: changesSearch, caseSensitive: false }),
            new Filter({ path: "description", operator: FilterOperator.Contains, value1: changesSearch, caseSensitive: false })
          ],
          and: false
        }));
      }
      this.byId("changesTable").getBinding("items").filter(filters);
      this._resume("changesTable");
      this.viewModel.setProperty("/changesTitle", this._text("changesTitle", [plant]));
    },

    _refreshAll() {
      this.byId("materialsTable").getBinding("items").refresh();
      this.byId("changesTable").getBinding("items").refresh();
      this.byId("syncTable").getBinding("items").refresh();
      return this._loadKpis();
    },

    formatValue(value, currency) {
      return value === null || value === undefined ? "" : formatter.amount(value) + " " + (currency || "");
    },

    // ------------------------------------------------------------------ header

    async onSync() {
      const plant = this.viewModel.getProperty("/plant");
      this.viewModel.setProperty("/syncing", true);
      MessageToast.show(this._text("syncRunning"));
      try {
        const result = await this._call("/syncFromS4(...)", { plant });
        if (result.result === "FAILED") {
          MessageBox.error(this._text("syncFailed", [result.message]), { title: this._text("errorTitle") });
        } else if (result.result === "PARTIAL") {
          MessageBox.warning(this._text("syncPartial", [result.message]));
        } else if (result.materials === 0) {
          MessageBox.information(result.message);
        } else {
          MessageToast.show(this._text("syncDone", [result.materials, result.durationMs]));
        }
        await this._refreshAll();
      } catch (e) {
        await this._loadKpis();
        this._showError(e);
      } finally {
        this.viewModel.setProperty("/syncing", false);
      }
    },

    onPlantChange(event) {
      const plant = String(event.getSource().getValue() || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{4}$/.test(plant)) {
        return;
      }
      this.viewModel.setProperty("/plant", plant);
      try {
        window.localStorage.setItem(STORAGE_KEY, plant);
      } catch (e) { /* storage not available */ }
      this._applyFilters();
      this._applyChangeFilters();
      this._loadKpis();
    },

    async onCheckConnection() {
      try {
        const result = await this._call("/testS4Connection(...)");
        const lines = (result.value || []).map((c) =>
          (c.ok ? "✔ " : "✘ ") + c.api + " — " + (c.ok ? this._text("connectionOk") + " (" + c.ms + " ms)" : this._text("connectionFailed") + ": " + c.message)
        );
        const { connection, writeMode } = this.viewModel.getData();
        lines.push(this._text("settingsText", [connection || "–", this._text(writeMode === "live" ? "writeModeLive" : "writeModeSimulate")]));
        const allOk = (result.value || []).every((c) => c.ok);
        MessageBox[allOk ? "success" : "warning"](lines.join("\n\n"), { title: this._text("connectionTitle") });
      } catch (e) {
        this._showError(e);
      }
    },

    onInfo() {
      MessageBox.information(this._text("infoText"), { title: this._text("infoTitle"), contentWidth: "34rem" });
    },

    onOpenApprovals() {
      const container = sap.ui.require("sap/ushell/Container");
      if (container && container.getServiceAsync) {
        const target = { semanticObject: "ParameterChange", action: "approve" };
        container.getServiceAsync("Navigation")
          .then((navigation) => navigation.navigate({ target }))
          .catch(() => container.getServiceAsync("CrossApplicationNavigation").then((nav) => nav.toExternal({ target })));
        return;
      }
      // standalone: the approvals app sits next to this app (local: /approvals/webapp, BTP: /brightlineapprovals)
      const path = window.location.pathname.replace("cockpit", "approvals");
      window.open(path, "_blank");
    },

    // ------------------------------------------------------------------ filters

    onTilePress(event) {
      const filter = event.getSource().data("filter");
      this.viewModel.setProperty("/tab", "materials");
      this.viewModel.setProperty("/statusFilter", filter);
      this._applyFilters();
    },

    onOpenChangesTile() {
      this.viewModel.setProperty("/tab", "changes");
    },

    onStatusFilter() {
      this._applyFilters();
    },

    onSearch() {
      this._applyFilters();
    },

    onChangesSearch() {
      this._applyChangeFilters();
    },

    onOpenChangeLink(event) {
      const changeNo = event.getSource().getBindingContext().getProperty("openChangeNo");
      this.viewModel.setProperty("/changesSearch", changeNo);
      this.viewModel.setProperty("/tab", "changes");
      this._applyChangeFilters();
    },

    // ------------------------------------------------------------------ propose dialog

    async onPropose(event) {
      const context = event.getSource().getBindingContext();
      this._proposeContext = context;
      const m = await context.requestObject();
      const unit = m.baseUnit || "";
      const hasSuggestion = m.suggestedReorderPoint !== null && m.suggestedReorderPoint !== undefined;
      const lead = num(m.leadTimeDays) || 7;
      const row = (key, label, current, suggested) => ({
        key, label, current: formatter.quantity(current), suggested: hasSuggestion ? formatter.quantity(suggested) : "–",
        value: String(hasSuggestion ? num(suggested) : num(current)), state: "None", stateText: ""
      });
      const dlg = this.getView().getModel("dlg");
      dlg.setData({
        m,
        unit,
        hasSuggestion,
        rows: [
          row("reorderPoint", this._text("reorderPoint"), m.reorderPoint, m.suggestedReorderPoint),
          row("safetyStock", this._text("safetyStock"), m.safetyStock, m.suggestedSafetyStock),
          row("maxStock", this._text("maxStock"), m.maxStock, m.suggestedMaxStock),
          { key: "leadTimeDays", label: this._text("leadTime"), current: String(lead), suggested: hasSuggestion ? String(lead) : "–", value: String(lead), state: "None", stateText: "" }
        ],
        suggestion: hasSuggestion ? { reorderPoint: num(m.suggestedReorderPoint), safetyStock: num(m.suggestedSafetyStock), maxStock: num(m.suggestedMaxStock), leadTimeDays: lead } : null,
        demandText: num(m.avgDailyDemand) > 0
          ? this._text("demandInfo", [formatter.demand(m.avgDailyDemand), unit, formatter.demand(m.demandStdDevDaily), m.consumptionDocs,
            m.consumptionFrom || "", m.consumptionTo || "", formatter.quantity(m.stockQty), formatter.coverageText.call(this, m.coverageDays)])
          : this._text("demandNone"),
        formulaText: "",
        mrpTypeText: REORDER_POINT_MRP_TYPES.includes(m.mrpType) ? "" : this._text("mrpTypeSwitch", [m.mrpType || "–"]),
        mrpTypeLine: this._text("mrpTypeLine", [m.mrpType || "–", REORDER_POINT_MRP_TYPES.includes(m.mrpType) ? m.mrpType : "VB"]),
        statusNow: m.status,
        statusAfter: m.status,
        valueChangeText: "–",
        reason: "",
        reasonState: "None"
      });
      this._updateFormula();
      this._updatePreview();
      const dialog = await this._dialog("proposeDialog", "brightline.cockpit.fragment.ProposeDialog");
      dialog.open();
    },

    /** Explains the suggestion with the material's own numbers */
    _updateFormula() {
      const dlg = this.getView().getModel("dlg");
      const { m, suggestion, unit } = dlg.getData();
      if (!suggestion) {
        dlg.setProperty("/formulaText", "");
        return;
      }
      const d = formatter.demand(m.avgDailyDemand);
      const statistical = num(m.consumptionDocs) >= 3 && num(m.demandStdDevDaily) > 0;
      dlg.setProperty("/formulaText", statistical
        ? this._text("formulaStatistical", [formatter.demand(m.demandStdDevDaily), suggestion.leadTimeDays, formatter.quantity(suggestion.safetyStock), d,
          formatter.quantity(suggestion.reorderPoint), formatter.quantity(suggestion.maxStock), unit])
        : this._text("formulaSimple", [formatter.quantity(suggestion.safetyStock), d, suggestion.leadTimeDays, formatter.quantity(suggestion.reorderPoint), unit,
          formatter.quantity(suggestion.maxStock)]));
    },

    /** Validates the entries and shows the stock status and value change they would lead to */
    _updatePreview() {
      const dlg = this.getView().getModel("dlg");
      const d = dlg.getData();
      const values = Object.fromEntries(d.rows.map((r) => [r.key, r.value]));
      const errors = {};
      for (const r of d.rows) {
        if (!isNumber(r.value) || Number(r.value) < 0) errors[r.key] = this._text("errNumber");
      }
      if (!errors.reorderPoint && !(num(values.reorderPoint) > 0)) errors.reorderPoint = this._text("errReorderPoint");
      if (!errors.safetyStock && !errors.reorderPoint && num(values.safetyStock) >= num(values.reorderPoint)) errors.safetyStock = this._text("errSafetyStock");
      if (!errors.maxStock && num(values.maxStock) > 0 && num(values.maxStock) <= num(values.reorderPoint)) errors.maxStock = this._text("errMaxStock");
      if (!errors.leadTimeDays && (!Number.isInteger(Number(values.leadTimeDays)) || num(values.leadTimeDays) < 1 || num(values.leadTimeDays) > 365)) {
        errors.leadTimeDays = this._text("errLeadTime");
      }
      d.rows.forEach((r, i) => {
        dlg.setProperty(`/rows/${i}/state`, errors[r.key] ? "Error" : "None");
        dlg.setProperty(`/rows/${i}/stateText`, errors[r.key] || "");
      });
      const m = d.m;
      dlg.setProperty("/statusAfter", formatter.stockStatus(m.stockQty, values.reorderPoint, values.safetyStock, values.maxStock));
      dlg.setProperty("/valueChangeText", m.price === null || m.price === undefined
        ? "–"
        : formatter.signedAmount((num(values.safetyStock) - num(m.safetyStock)) * num(m.price) / (num(m.priceUnitQty) || 1), m.currency));
      return Object.keys(errors).length === 0;
    },

    onValueChange(event) {
      const value = event.getParameter("value");
      const context = event.getSource().getBindingContext("dlg");
      if (value !== undefined) {
        this.getView().getModel("dlg").setProperty(context.getPath() + "/value", value);
      }
      this._updatePreview();
      if (context.getProperty("key") === "leadTimeDays") {
        clearTimeout(this._leadTimer);
        this._leadTimer = setTimeout(() => this._refreshSuggestion(), 400);
      }
    },

    /** The suggestion depends on the lead time, so it is recalculated by the service */
    async _refreshSuggestion() {
      const dlg = this.getView().getModel("dlg");
      const d = dlg.getData();
      const lead = Number(d.rows[3].value);
      if (!d.hasSuggestion || !Number.isInteger(lead) || lead < 1 || lead > 365) return;
      try {
        const s = await this._call("PlannerService.suggestFor(...)", { leadTimeDays: lead }, this._proposeContext);
        if (!s) return;
        dlg.setProperty("/suggestion", { reorderPoint: num(s.reorderPoint), safetyStock: num(s.safetyStock), maxStock: num(s.maxStock), leadTimeDays: lead });
        dlg.setProperty("/rows/0/suggested", formatter.quantity(s.reorderPoint));
        dlg.setProperty("/rows/1/suggested", formatter.quantity(s.safetyStock));
        dlg.setProperty("/rows/2/suggested", formatter.quantity(s.maxStock));
        dlg.setProperty("/rows/3/suggested", String(lead));
        this._updateFormula();
      } catch (e) {
        Messaging.removeAllMessages();
      }
    },

    onUseSuggestion() {
      const dlg = this.getView().getModel("dlg");
      const s = dlg.getProperty("/suggestion");
      if (!s) return;
      dlg.setProperty("/rows/0/value", String(s.reorderPoint));
      dlg.setProperty("/rows/1/value", String(s.safetyStock));
      dlg.setProperty("/rows/2/value", String(s.maxStock));
      dlg.setProperty("/rows/3/value", String(s.leadTimeDays));
      this._updatePreview();
    },

    onReasonChange(event) {
      const dlg = this.getView().getModel("dlg");
      const value = event.getParameter("value");
      if (value !== undefined) dlg.setProperty("/reason", value);
      if (String(dlg.getProperty("/reason") || "").trim().length >= 5) dlg.setProperty("/reasonState", "None");
    },

    async onSubmitProposal() {
      const dlg = this.getView().getModel("dlg");
      const valid = this._updatePreview();
      const d = dlg.getData();
      const reasonOk = String(d.reason || "").trim().length >= 5;
      dlg.setProperty("/reasonState", reasonOk ? "None" : "Error");
      if (!valid || !reasonOk) {
        MessageToast.show(this._text("fixInput"));
        return;
      }
      const values = Object.fromEntries(d.rows.map((r) => [r.key, r.value]));
      const dialog = this.byId("proposeDialog");
      dialog.setBusy(true);
      try {
        const created = await this._call("PlannerService.proposeChange(...)", {
          reorderPoint: String(num(values.reorderPoint)),
          safetyStock: String(num(values.safetyStock)),
          maxStock: String(num(values.maxStock)),
          leadTimeDays: Math.round(num(values.leadTimeDays)),
          reason: String(d.reason).trim()
        }, this._proposeContext);
        dialog.close();
        Messaging.removeAllMessages();
        MessageToast.show(this._text("proposed", [created && created.changeNo]));
        await this._refreshAll();
      } catch (e) {
        this._showError(e);
      } finally {
        dialog.setBusy(false);
      }
    },

    onCloseProposal() {
      this.byId("proposeDialog").close();
    },

    // ------------------------------------------------------------------ changes

    onWithdraw(event) {
      const context = event.getSource().getBindingContext();
      const changeNo = context.getProperty("changeNo");
      MessageBox.confirm(this._text("withdrawConfirm", [changeNo]), {
        onClose: async (action) => {
          if (action !== MessageBox.Action.OK) {
            return;
          }
          try {
            await this._call("PlannerService.withdraw(...)", { reason: null }, context);
            Messaging.removeAllMessages();
            MessageToast.show(this._text("withdrawn", [changeNo]));
            await this._refreshAll();
          } catch (e) {
            this._showError(e);
          }
        }
      });
    },

    // ------------------------------------------------------------------ dialogs

    async _dialog(id, fragmentName) {
      let dialog = this.byId(id);
      if (!dialog) {
        dialog = await Fragment.load({ id: this.getView().getId(), name: fragmentName, controller: this });
        this.getView().addDependent(dialog);
      }
      return dialog;
    }
  });
});
