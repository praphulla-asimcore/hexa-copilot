// ── gemini.js — AI Engine: OpenAI GPT-4o + Zoho Books REST API ───────────

const ZOHO_REGIONS = {
  com: { api: "https://www.zohoapis.com",    auth: "https://accounts.zoho.com"      },
  eu:  { api: "https://www.zohoapis.eu",     auth: "https://accounts.zoho.eu"       },
  in:  { api: "https://www.zohoapis.in",     auth: "https://accounts.zoho.in"       },
  au:  { api: "https://www.zohoapis.com.au", auth: "https://accounts.zoho.com.au"   },
  jp:  { api: "https://www.zohoapis.jp",     auth: "https://accounts.zoho.jp"       },
  ca:  { api: "https://www.zohoapis.ca",     auth: "https://accounts.zohocloud.ca"  },
};

const GEMINI = {

  openaiKey:  null,
  zohoToken:  null,
  zohoRegion: "com",

  get zohoApiBase()  { return (ZOHO_REGIONS[this.zohoRegion] || ZOHO_REGIONS.com).api;  },
  get zohoAuthBase() { return (ZOHO_REGIONS[this.zohoRegion] || ZOHO_REGIONS.com).auth; },

  init(openaiKey, zohoToken, zohoRegion = "com") {
    this.openaiKey  = openaiKey;
    this.zohoToken  = zohoToken;
    this.zohoRegion = zohoRegion;
  },

  // ── ZOHO REST HELPER (via server-side proxy to avoid CORS) ─────────
  async _zohoGet(path, params = {}) {
    let res;
    try {
      res = await fetch("/api/zoho-proxy", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ token: this.zohoToken, region: this.zohoRegion, path, params }),
      });
    } catch (e) {
      throw new Error("Cannot reach Zoho proxy. Check your network connection.");
    }

    const data = await res.json();
    // Zoho uses code 0 = success, non-zero = error
    if (data.code === 57 || data.code === 14 || res.status === 401) {
      throw new Error("Zoho token expired or invalid. Please reconnect.");
    }
    if (data.code !== undefined && data.code !== 0) {
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
        arTotal += (i.balance || 0); arCount++;
        if (new Date(i.due_date) < today) arOverdue++;
      });
    }

    let apTotal = 0, apCount = 0, apOverdue = 0;
    if (billRes.status === "fulfilled") {
      (billRes.value.bills || []).forEach(b => {
        apTotal += (b.balance || 0); apCount++;
        if (new Date(b.due_date) < today) apOverdue++;
      });
    }

    let cashTotal = 0;
    if (bankRes.status === "fulfilled") {
      (bankRes.value.bankaccounts || []).forEach(a => cashTotal += (a.balance || 0));
    }

    return { arTotal, arCount, arOverdue, apTotal, apCount, apOverdue, cashTotal };
  },

  // ── FETCH MODULE VIEW DATA (full paginated history) ─────────────────
  async fetchModuleData(view, orgId) {
    const p = { organization_id: orgId, sort_column: "date", sort_order: "D" };
    switch (view) {
      case "invoices": {
        const rows = await this._zohoGetAll("invoices", { ...p, status: "unpaid", sort_column: "due_date", sort_order: "A" });
        return { invoices: rows };
      }
      case "payments": {
        const rows = await this._zohoGetAll("customerpayments", p);
        return { customerpayments: rows };
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
  async query(userMessage, org) {
    if (!this.openaiKey) throw new Error("No OpenAI API key configured.");

    const orgContext = `Organisation: ${org.name} (${org.short}) | ${org.country} | Currency: ${org.currency} (${org.currencySymbol})`;

    let res;
    try {
      res = await fetch("/api/ai-query", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openaiKey:    this.openaiKey,
          zohoToken:    this.zohoToken  || null,
          zohoRegion:   this.zohoRegion || "com",
          orgId:        org.zohoOrgId   || null,
          systemPrompt: PROMPTS.forQuery(org, userMessage),
          userMessage,
          orgContext,
        }),
      });
    } catch (e) {
      throw new Error("Cannot reach AI query proxy: " + e.message);
    }

    const data = await res.json();
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

  // ── OAUTH PKCE FLOW ─────────────────────────────────────────────────
  async startOAuth(clientId, clientSecret) {
    const { verifier, challenge } = await this._generatePKCE();
    sessionStorage.setItem("zoho_pkce_verifier",    verifier);
    sessionStorage.setItem("zoho_client_id",        clientId);
    sessionStorage.setItem("zoho_client_secret",    clientSecret || "");
    sessionStorage.setItem("zoho_region",           this.zohoRegion);
    sessionStorage.setItem("zoho_pending_openai",   document.getElementById("openaiKey")?.value || "");

    const redirectUri = window.location.href.split("?")[0].replace(/#.*$/, "");
    const authUrl = new URL(`${this.zohoAuthBase}/oauth/v2/auth`);
    authUrl.searchParams.set("client_id",             clientId);
    authUrl.searchParams.set("response_type",         "code");
    authUrl.searchParams.set("redirect_uri",          redirectUri);
    authUrl.searchParams.set("scope",                 "ZohoBooks.fullaccess.all");
    authUrl.searchParams.set("access_type",           "offline");
    authUrl.searchParams.set("code_challenge",        challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

    window.location.href = authUrl.toString();
  },

  async exchangeCodeForToken(code) {
    const verifier      = sessionStorage.getItem("zoho_pkce_verifier") || "";
    const clientId      = sessionStorage.getItem("zoho_client_id")     || "";
    const clientSecret  = sessionStorage.getItem("zoho_client_secret") || "";
    const region        = sessionStorage.getItem("zoho_region")        || "com";
    this.zohoRegion     = region;

    const redirectUri   = window.location.href.split("?")[0].replace(/#.*$/, "");

    // Token exchange via server-side proxy to avoid CORS (Zoho blocks browser requests)
    let res;
    try {
      res = await fetch("/api/zoho-token", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          client_id:     clientId,
          client_secret: clientSecret || undefined,
          code_verifier: verifier     || undefined,
          redirect_uri:  redirectUri,
          region,
        }),
      });
    } catch (e) {
      throw new Error("Cannot reach token proxy.");
    }

    const data = await res.json();
    if (data.error) throw new Error(`Zoho OAuth error: ${data.error}`);
    if (!data.access_token) throw new Error("No access token returned from Zoho.");

    sessionStorage.removeItem("zoho_pkce_verifier");

    // Return both tokens — refresh_token persists forever (offline access)
    return { accessToken: data.access_token, refreshToken: data.refresh_token || null };
  },

  async refreshAccessToken() {
    const config = JSON.parse(localStorage.getItem("hx_config") || "null");
    if (!config?.zohoRefreshToken || !config?.zohoClientId) return null;
    try {
      const res = await fetch("/api/zoho-token", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type:    "refresh_token",
          client_id:     config.zohoClientId,
          client_secret: config.zohoClientSecret || undefined,
          refresh_token: config.zohoRefreshToken,
          region:        config.zohoRegion || "com",
        }),
      });
      const data = await res.json();
      if (data.access_token) {
        this.zohoToken = data.access_token;
        const updated = { ...config, zohoToken: data.access_token };
        localStorage.setItem("hx_config", JSON.stringify(updated));
        return data.access_token;
      }
    } catch (_) {}
    return null;
  },

  async _generatePKCE() {
    const chars    = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    const arr      = new Uint8Array(64);
    crypto.getRandomValues(arr);
    const verifier  = Array.from(arr, b => chars[b % chars.length]).join("");
    const digest    = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    return { verifier, challenge };
  }
};
