// ── gemini.js — AI Engine client ────────────────────────────────────────
// All credentials (OpenAI key + Zoho OAuth) live server-side in environment
// variables. This module only talks to our own /api/* proxies — it never holds
// or sends an API key or access token.

const GEMINI = {

  dataStartDate: "2023-01-01",

  // Kept as a no-op so older call sites (APP bootstrap) don't break.
  init() {},

  // ── ZOHO REST HELPER (via server-side proxy) ───────────────────────
  async _zohoGet(path, params = {}) {
    let res;
    try {
      res = await fetch("/api/zoho-proxy", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ path, params }),
      });
    } catch (e) {
      throw new Error("Cannot reach Zoho proxy. Check your network connection.");
    }

    const data = await res.json().catch(() => ({}));

    if (res.status === 503 || data.code === "server_not_configured") {
      throw new Error(data.error || "Server is not configured with Zoho credentials.");
    }
    // Zoho uses code 0 = success, non-zero = error
    if (data.code === 57 || data.code === 14 || res.status === 401) {
      throw new Error("Zoho authorisation failed on the server. Refresh token may be expired — re-run setup.");
    }
    if (data.code !== undefined && data.code !== 0 && typeof data.code === "number") {
      throw new Error(data.message || `Zoho error ${data.code}`);
    }
    if (!res.ok) {
      throw new Error(data.error || `Zoho API error ${res.status}`);
    }
    return data;
  },

  // ── FETCH ALL ORGANIZATIONS ─────────────────────────────────────────
  async fetchOrganizations() {
    const data = await this._zohoGet("organizations");
    return data.organizations || [];
  },

  // ── PAGINATE THROUGH ALL PAGES OF A LIST ENDPOINT ──────────────────
  async _zohoGetAll(path, params = {}, maxPages = 10) {
    const keyMap = {
      invoices: "invoices", bills: "bills", expenses: "expenses",
      customerpayments: "customerpayments", vendorpayments: "vendorpayments",
      contacts: "contacts", items: "items", bankaccounts: "bankaccounts",
      salesorders: "salesorders", purchaseorders: "purchaseorders",
      estimates: "estimates", journals: "journals",
    };
    const rootKey = keyMap[path] || path;
    const all = [];
    for (let page = 1; page <= maxPages; page++) {
      const data = await this._zohoGet(path, { ...params, page, per_page: 200 });
      const items = data[rootKey] || [];
      all.push(...items);
      if (!data.page_context?.has_more_page) break;
    }
    return all;
  },

  // ── FETCH ORG SNAPSHOT (AR, AP, Cash) ──────────────────────────────
  async fetchOrgSnapshot(orgId) {
    const today = new Date();
    const [invRes, billRes, bankRes] = await Promise.allSettled([
      this._zohoGet("invoices",     { organization_id: orgId, status: "unpaid", per_page: 200 }),
      this._zohoGet("bills",        { organization_id: orgId, status: "unpaid", per_page: 200 }),
      this._zohoGet("bankaccounts", { organization_id: orgId, filter_by: "Status.Active" }),
    ]);

    let arTotal = 0, arCount = 0, arOverdue = 0;
    if (invRes.status === "fulfilled") {
      (invRes.value.invoices || []).forEach(i => {
        // bcy_balance = balance in org's base currency; fall back to balance for same-currency txns
        arTotal += (i.bcy_balance ?? i.balance ?? 0); arCount++;
        if (new Date(i.due_date) < today) arOverdue++;
      });
    }

    let apTotal = 0, apCount = 0, apOverdue = 0;
    if (billRes.status === "fulfilled") {
      (billRes.value.bills || []).forEach(b => {
        apTotal += (b.bcy_balance ?? b.balance ?? 0); apCount++;
        if (new Date(b.due_date) < today) apOverdue++;
      });
    }

    let cashTotal = 0;
    if (bankRes.status === "fulfilled") {
      // Bank account balances are always in the org's base currency
      (bankRes.value.bankaccounts || []).forEach(a => cashTotal += (a.balance || 0));
    }

    return { arTotal, arCount, arOverdue, apTotal, apCount, apOverdue, cashTotal };
  },

  // ── FETCH MODULE VIEW DATA (full paginated history) ─────────────────
  async fetchModuleData(view, orgId) {
    const p = {
      organization_id: orgId,
      date_start: this.dataStartDate,
      date_end: new Date().toISOString().split("T")[0],
      sort_column: "date",
      sort_order: "D",
    };
    switch (view) {
      case "invoices": {
        const rows = await this._zohoGetAll("invoices", { ...p, status: "unpaid", sort_column: "due_date", sort_order: "A" });
        return { invoices: rows };
      }
      case "payments": {
        const [custRows, vendRows] = await Promise.all([
          this._zohoGetAll("customerpayments", p),
          this._zohoGetAll("vendorpayments",   p),
        ]);
        return { customerpayments: custRows, vendorpayments: vendRows };
      }
      case "expenses": {
        const rows = await this._zohoGetAll("expenses", p);
        return { expenses: rows };
      }
      case "ap": {
        const rows = await this._zohoGetAll("bills", { ...p, status: "unpaid", sort_column: "due_date", sort_order: "A" });
        return { bills: rows };
      }
      default: return null;
    }
  },

  // ── MAIN AI QUERY (via /api/ai-query — server-side Zoho fetch + OpenAI) ─
  async query(userMessage, org, conversationHistory = []) {
    const orgContext = `Organisation: ${org.name} (${org.short}) | ${org.country} | Currency: ${org.currency} (${org.currencySymbol})`;

    let res;
    try {
      res = await fetch("/api/ai-query", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId:               org.zohoOrgId || null,
          systemPrompt:        PROMPTS.forQuery(org, userMessage),
          userMessage,
          orgContext,
          conversationHistory, // pass prior turns for follow-up context
        }),
      });
    } catch (e) {
      throw new Error("Cannot reach AI query proxy: " + e.message);
    }

    const data = await res.json().catch(() => ({}));
    if (res.status === 503 || data.code === "server_not_configured")
      throw new Error(data.error || "Server is not configured.");
    if (!res.ok || data.error) throw new Error(data.error || `AI error ${res.status}`);
    return this._parseResponse(data.content || "");
  },

  // ── PARSE OPENAI RESPONSE ───────────────────────────────────────────
  _parseResponse(raw) {
    try {
      const parsed = JSON.parse(raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim());
      return {
        html:           parsed.html           || parsed.summary || raw,
        tableTitle:     parsed.tableTitle     || null,
        tableRows:      parsed.tableRows      || null,
        alerts:         parsed.alerts         || [],
        accountingNote: parsed.accountingNote || null,
        source: "live"
      };
    } catch (_) {
      return { html: raw || "<em>Response received.</em>", tableTitle: null, tableRows: null, alerts: [], accountingNote: null, source: "live" };
    }
  },
};
