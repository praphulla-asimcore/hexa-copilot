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
    if (res.status === 401 || data.code === 57 || data.code === 14) {
      throw new Error("Zoho token expired or invalid. Please reconnect.");
    }
    if (!res.ok || data.code === 0 && data.message) {
      throw new Error(data.message || data.error || `Zoho API error ${res.status}`);
    }
    return data;
  },

  // ── FETCH ALL ORGANIZATIONS ─────────────────────────────────────────
  async fetchOrganizations() {
    const data = await this._zohoGet("organizations");
    return data.organizations || [];
  },

  // ── FETCH ORG SNAPSHOT (AR, AP, Cash) ──────────────────────────────
  async fetchOrgSnapshot(orgId) {
    const today = new Date();

    const [invRes, billRes, bankRes] = await Promise.allSettled([
      this._zohoGet("invoices",    { organization_id: orgId, status: "unpaid",        per_page: 200 }),
      this._zohoGet("bills",       { organization_id: orgId, status: "unpaid",        per_page: 200 }),
      this._zohoGet("bankaccounts",{ organization_id: orgId, filter_by: "Status.Active" }),
    ]);

    let arTotal = 0, arCount = 0, arOverdue = 0;
    if (invRes.status === "fulfilled") {
      (invRes.value.invoices || []).forEach(i => {
        arTotal += (i.balance || 0);
        arCount++;
        if (new Date(i.due_date) < today) arOverdue++;
      });
    }

    let apTotal = 0, apCount = 0, apOverdue = 0;
    if (billRes.status === "fulfilled") {
      (billRes.value.bills || []).forEach(b => {
        apTotal += (b.balance || 0);
        apCount++;
        if (new Date(b.due_date) < today) apOverdue++;
      });
    }

    let cashTotal = 0;
    if (bankRes.status === "fulfilled") {
      (bankRes.value.bankaccounts || []).forEach(a => cashTotal += (a.balance || 0));
    }

    return { arTotal, arCount, arOverdue, apTotal, apCount, apOverdue, cashTotal };
  },

  // ── FETCH MODULE VIEW DATA ──────────────────────────────────────────
  async fetchModuleData(view, orgId) {
    const p = { organization_id: orgId, per_page: 100 };
    switch (view) {
      case "invoices":  return this._zohoGet("invoices",         { ...p, status: "unpaid", sort_column: "due_date", sort_order: "A" });
      case "payments":  return this._zohoGet("customerpayments", { ...p, sort_column: "date", sort_order: "D" });
      case "expenses":  return this._zohoGet("expenses",         { ...p, sort_column: "date", sort_order: "D" });
      case "ap":        return this._zohoGet("bills",            { ...p, status: "unpaid", sort_column: "due_date", sort_order: "A" });
      default:          return null;
    }
  },

  // ── MAIN AI QUERY ───────────────────────────────────────────────────
  async query(userMessage, org) {
    if (!this.openaiKey) throw new Error("No OpenAI API key configured.");

    const systemPrompt = PROMPTS.forQuery(org, userMessage);
    const zohoData     = await this._fetchContextForQuery(userMessage, org);

    const userContent = [
      `Organisation: ${org.name} (${org.short}) | ${org.country} | Currency: ${org.currency} (${org.currencySymbol})`,
      zohoData ? `\nLIVE ZOHO BOOKS DATA (use this as the source of truth for all figures):\n${zohoData}` : "\n(No Zoho data fetched — answer based on context and ask user to check permissions if needed.)",
      `\nUser Query: ${userMessage}`
    ].join("");

    let res;
    try {
      res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${this.openaiKey}`
        },
        body: JSON.stringify({
          model:           "gpt-4o",
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: userContent  }
          ],
          max_tokens:  2000,
          temperature: 0.2
        })
      });
    } catch (e) {
      throw new Error("Cannot reach OpenAI API. Check your network connection.");
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `OpenAI error ${res.status}`);
    }

    const data = await res.json();
    return this._parseResponse(data.choices?.[0]?.message?.content || "");
  },

  // ── FETCH ZOHO CONTEXT FOR QUERY ────────────────────────────────────
  async _fetchContextForQuery(query, org) {
    if (!this.zohoToken || !org.zohoOrgId) return null;

    const q = query.toLowerCase();
    let endpoint, params = { organization_id: org.zohoOrgId, per_page: 100 };

    if      (/invoice|ar\b|receivable|aging/.test(q))       { endpoint = "invoices";         params.status = "unpaid"; }
    else if (/payment|receipt|collect/.test(q))              { endpoint = "customerpayments"; }
    else if (/expense|cost|spend/.test(q))                   { endpoint = "expenses"; }
    else if (/\bap\b|payable|vendor|bill/.test(q))           { endpoint = "bills";            params.status = "unpaid"; }
    else if (/p&l|profit|loss|revenue|report|ebitda/.test(q)){ endpoint = "invoices"; }
    else if (/cash|bank/.test(q))                            { endpoint = "bankaccounts";     params = { organization_id: org.zohoOrgId, filter_by: "Status.Active" }; }
    else if (/tax|gst|vat|tds|ssf|bpjs|cpf|compliance/.test(q))   { endpoint = "invoices"; }
    else if (/intercompany|related.party|elimination/.test(q))     { endpoint = "contacts";   params.contact_type = "customer"; }

    if (!endpoint) return null;

    try {
      const data = await this._zohoGet(endpoint, params);
      return JSON.stringify(data, null, 2).substring(0, 10000);
    } catch (err) {
      console.warn("Zoho context fetch failed:", err.message);
      return null;
    }
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
    authUrl.searchParams.set("access_type",           "online");
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
    sessionStorage.removeItem("zoho_client_id");
    sessionStorage.removeItem("zoho_client_secret");

    return data.access_token;
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
