sap.ui.define(["sap/ui/core/format/NumberFormat", "sap/ui/core/format/DateFormat"], (NumberFormat, DateFormat) => {
  "use strict";

  const quantityFormat = NumberFormat.getFloatInstance({ maxFractionDigits: 3, groupingEnabled: true });
  const demandFormat = NumberFormat.getFloatInstance({ maxFractionDigits: 2, groupingEnabled: true });
  const daysFormat = NumberFormat.getFloatInstance({ maxFractionDigits: 1, groupingEnabled: true });
  const amountFormat = NumberFormat.getFloatInstance({ minFractionDigits: 2, maxFractionDigits: 2, groupingEnabled: true });
  const dateTimeFormat = DateFormat.getDateTimeInstance({ style: "medium" });

  const STATE = { C: "Error", R: "Warning", O: "Success", E: "Information", N: "None" };
  const ICON = { C: "sap-icon://alert", R: "sap-icon://warning", O: "sap-icon://sys-enter-2", E: "sap-icon://arrow-top", N: "sap-icon://question-mark" };
  const CRITICALITY_STATE = { 1: "Error", 2: "Warning", 3: "Success", 5: "Information" };
  const CHANGE_STATE = { S: "Warning", A: "Information", U: "Success", R: "Error", W: "None" };
  const REVIEW_THRESHOLD_PCT = 25;

  const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));
  const nz = (v) => (Number.isFinite(num(v)) ? num(v) : 0);
  const bundle = (that) => that.getOwnerComponent().getModel("i18n").getResourceBundle();

  const formatter = {
    REVIEW_THRESHOLD_PCT,

    /** Same rule as Materials.status in db/schema.cds and stockStatus() in srv/lib/planning.js */
    stockStatus(stockQty, reorderPoint, safetyStock, maxStock) {
      const rp = nz(reorderPoint);
      const stock = nz(stockQty);
      if (!(rp > 0)) return "N";
      if (stock <= nz(safetyStock)) return "C";
      if (stock <= rp) return "R";
      if (nz(maxStock) > 0 && stock > nz(maxStock)) return "E";
      return "O";
    },

    quantity(value) {
      const n = num(value);
      return Number.isFinite(n) ? quantityFormat.format(n) : "";
    },

    demand(value) {
      const n = num(value);
      return Number.isFinite(n) ? demandFormat.format(n) : "";
    },

    amount(value) {
      const n = num(value);
      return Number.isFinite(n) ? amountFormat.format(n) : "";
    },

    signedAmount(value, currency) {
      const n = num(value);
      if (!Number.isFinite(n)) return "–";
      return (n > 0 ? "+" : "") + amountFormat.format(n) + " " + (currency || "");
    },

    dateTime(value) {
      return value ? dateTimeFormat.format(new Date(value)) : "";
    },

    statusState(status) {
      return STATE[status] || "None";
    },

    statusIcon(status) {
      return ICON[status] || "";
    },

    statusText(status) {
      return status ? bundle(this).getText("status" + status) : "";
    },

    criticalityState(criticality) {
      return CRITICALITY_STATE[criticality] || "None";
    },

    changeState(statusCode) {
      return CHANGE_STATE[statusCode] || "None";
    },

    percentText(pct) {
      const n = num(pct);
      return Number.isFinite(n) ? n + " %" : "";
    },

    /** Coverage in days; red if the stock runs out before a delivery could arrive */
    coverageText(days) {
      const n = num(days);
      return Number.isFinite(n) ? bundle(this).getText("days", [daysFormat.format(n)]) : "–";
    },

    coverageState(days, leadTimeDays) {
      const n = num(days);
      if (!Number.isFinite(n)) return "None";
      const lead = nz(leadTimeDays) || 7;
      if (n < lead) return "Error";
      if (n < 2 * lead) return "Warning";
      return "None";
    },

    demandSubText(docs) {
      return nz(docs) > 0 ? bundle(this).getText("goodsIssues", [nz(docs)]) : bundle(this).getText("noDemand");
    },

    /** "100 / 30 / 400" */
    parameterText(reorderPoint, safetyStock, maxStock) {
      if (!(nz(reorderPoint) > 0) && !(nz(safetyStock) > 0)) return "–";
      return [reorderPoint, safetyStock, maxStock].map((v) => (nz(v) > 0 ? quantityFormat.format(nz(v)) : "0")).join(" / ");
    },

    suggestionText(reorderPoint, safetyStock, maxStock) {
      if (reorderPoint === null || reorderPoint === undefined) return "–";
      return [reorderPoint, safetyStock, maxStock].map((v) => quantityFormat.format(nz(v))).join(" / ");
    },

    parameterSourceText(source, changeNo) {
      const b = bundle(this);
      return source === "APPROVED" ? b.getText("fromApproved", [changeNo || ""]) : source === "S4" ? b.getText("fromS4") : b.getText("noParameters");
    },

    /** "TG11 · MRP type VB · lead time 7 days" */
    materialSubText(material, mrpType, leadTimeDays) {
      return bundle(this).getText("mrpTypeLead", [material, mrpType || "–", nz(leadTimeDays) || 7]);
    },

    deviationText(deviationPct, suggestedReorderPoint) {
      if (suggestedReorderPoint === null || suggestedReorderPoint === undefined) return bundle(this).getText("noSuggestion");
      const n = num(deviationPct);
      return Number.isFinite(n) ? bundle(this).getText("deviation", [daysFormat.format(n)]) : "";
    },

    deviationState(deviationPct) {
      const n = num(deviationPct);
      return Number.isFinite(n) && n >= REVIEW_THRESHOLD_PCT ? "Warning" : "Success";
    },

    proposeButtonType(deviationPct, openChangeNo) {
      if (openChangeNo) return "Default";
      const n = num(deviationPct);
      return Number.isFinite(n) && n >= REVIEW_THRESHOLD_PCT ? "Emphasized" : "Default";
    },

    hasValue(value) {
      return value !== null && value !== undefined && value !== "";
    },

    hasNoOpenChange(openChangeNo) {
      return !openChangeNo;
    },

    openChangeText(changeNo, statusCode) {
      if (!changeNo) return "";
      const b = bundle(this);
      return changeNo + " · " + (statusCode === "A" ? b.getText("changeApproved") : b.getText("changeSubmitted"));
    },

    methodText(method) {
      return method ? bundle(this).getText("method" + method) : "";
    },

    s4Text(mode, updatedAt) {
      if (!mode) return "–";
      return bundle(this).getText("mode" + mode) + (updatedAt ? " · " + dateTimeFormat.format(new Date(updatedAt)) : "");
    },

    changeValues(current, next) {
      return quantityFormat.format(nz(current)) + " → " + quantityFormat.format(nz(next));
    },

    isOpenChange(statusCode) {
      return statusCode === "S" || statusCode === "A";
    },

    resultState(result) {
      return result === "OK" ? "Success" : result === "PARTIAL" ? "Warning" : result === "FAILED" ? "Error" : "None";
    },

    resultText(result) {
      return result ? bundle(this).getText("result" + result) : "";
    },

    durationText(ms) {
      const n = num(ms);
      return Number.isFinite(n) ? (n >= 1000 ? daysFormat.format(n / 1000) + " s" : n + " ms") : "";
    }
  };
  return formatter;
});
