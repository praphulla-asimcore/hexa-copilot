// Vercel serverless function — fetches Zoho context + calls OpenAI server-side.
// maxDuration: 60 overrides the 10s default to prevent socket timeouts.

module.exports.config = { maxDuration: 60 };

const ZOHO_API_BASES = {
  com: "https://www.zohoapis.com",
  eu:  "https://www.zohoapis.eu",
  in:  "https://www.zohoapis.in",
  au:  "https://www.zohoapis.com.au",
  jp:  "https://www.zohoapis.jp",
  ca:  "https://www.zohoapis.ca",
};

async function zohoGet(token, region, path, params = {}) {
  const base = ZOHO_API_BASES[region] || ZOHO_API_BASES.com;
  const url  = new URL(`${base}/books/v3/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r    = await fetch(url.toString(), {
    headers: { "Authorization": `Zoho-oauthtoken ${token}` },
  });
  const text = await r.text();
  try { return JSON.parse(text); } catch (_) { return {}; }
}

async function zohoGetPaged(token, region, path, params, rootKey) {
  // Fetch up to 2 pages (400 records max) — keeps function under timeout
  const all = [];
  for (let page = 1; page <= 2; page++) {
    const data = await zohoGet(token, region, path, { ...params, page, per_page: 200 });
    const items = data[rootKey] || [];
    all.push(...items);
    if (!data.page_context?.has_more_page) break;
  }
  return all;
}

async function fetchZohoContext(token, region, orgId, query) {
  const q       = query.toLowerCase();
  const today   = new Date().toISOString().split("T")[0];
  const from5   = new Date(); from5.setFullYear(from5.getFullYear() - 5);
  const fromDate = from5.toISOString().split("T")[0];
  const rp      = { organization_id: orgId };

  // Pick at most 3 most relevant data sources to stay well within timeout
  const tasks = [];

  if (/p&l|profit|loss|revenue|income|ebitda|margin|turnover/.test(q))
    tasks.push(() => zohoGet(token, region, "reports/profitandloss",
      { ...rp, from_date: fromDate, to_date: today, cash_based: false }).then(d => ({ profitandloss: d })));

  if (/balance.?sheet|asset|liabilit|equity|net.worth/.test(q))
    tasks.push(() => zohoGet(token, region, "reports/balancesheet",
      { ...rp, date: today }).then(d => ({ balancesheet: d })));

  if (/cash.?flow|free.cash|operating.cash/.test(q))
    tasks.push(() => zohoGet(token, region, "reports/cashflow",
      { ...rp, from_date: fromDate, to_date: today }).then(d => ({ cashflow: d })));

  if (/trial.?balance/.test(q))
    tasks.push(() => zohoGet(token, region, "reports/trialbalance",
      { ...rp, from_date: fromDate, to_date: today }).then(d => ({ trialbalance: d })));

  if (/invoice|ar\b|receivable|aging|collect|outstanding/.test(q))
    tasks.push(() => zohoGetPaged(token, region, "invoices",
      { ...rp, sort_column: "date", sort_order: "D" }, "invoices").then(r => ({ invoices: r })));

  if (/\bap\b|payable|vendor.?bill|\bbill\b/.test(q))
    tasks.push(() => zohoGetPaged(token, region, "bills",
      { ...rp, sort_column: "date", sort_order: "D" }, "bills").then(r => ({ bills: r })));

  if (/payment|receipt|money.received/.test(q))
    tasks.push(() => zohoGetPaged(token, region, "customerpayments",
      { ...rp, sort_column: "date", sort_order: "D" }, "customerpayments").then(r => ({ customerpayments: r })));

  if (/expense|cost|spend|overhead/.test(q))
    tasks.push(() => zohoGetPaged(token, region, "expenses",
      { ...rp, sort_column: "date", sort_order: "D" }, "expenses").then(r => ({ expenses: r })));

  if (/cash|bank.balance|bank.account/.test(q))
    tasks.push(() => zohoGet(token, region, "bankaccounts",
      { ...rp, filter_by: "Status.Active" }).then(d => ({ bankaccounts: d })));

  if (/contact|customer.list|vendor.list/.test(q))
    tasks.push(() => zohoGetPaged(token, region, "contacts",
      { ...rp, sort_column: "contact_name", sort_order: "A" }, "contacts").then(r => ({ contacts: r })));

  if (/tax|gst|vat|tds|sst|withholding|compliance|filing/.test(q))
    tasks.push(() => zohoGet(token, region, "reports/taxsummary",
      { ...rp, from_date: fromDate, to_date: today }).then(d => ({ taxsummary: d })));

  if (/sales.?order/.test(q))
    tasks.push(() => zohoGetPaged(token, region, "salesorders",
      { ...rp, sort_column: "date", sort_order: "D" }, "salesorders").then(r => ({ salesorders: r })));

  if (/purchase.?order|\bpo\b/.test(q))
    tasks.push(() => zohoGetPaged(token, region, "purchaseorders",
      { ...rp, sort_column: "date", sort_order: "D" }, "purchaseorders").then(r => ({ purchaseorders: r })));

  // Fallback: unpaid invoices + bills + bank balances
  if (!tasks.length) {
    tasks.push(
      () => zohoGet(token, region, "invoices",     { ...rp, status: "unpaid", per_page: 200 }).then(d => ({ invoices: d })),
      () => zohoGet(token, region, "bills",        { ...rp, status: "unpaid", per_page: 200 }).then(d => ({ bills: d })),
      () => zohoGet(token, region, "bankaccounts", { ...rp, filter_by: "Status.Active" }).then(d => ({ bankaccounts: d })),
    );
  }

  // Run at most 3 tasks in parallel to stay within timeout
  const limited  = tasks.slice(0, 3);
  const results  = await Promise.allSettled(limited.map(fn => fn()));
  const combined = {};
  results.forEach(r => { if (r.status === "fulfilled") Object.assign(combined, r.value); });

  const json = JSON.stringify(combined, null, 2);
  return json.length > 60000 ? json.substring(0, 60000) + "\n...[truncated]" : json;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  const { openaiKey, zohoToken, zohoRegion, orgId, systemPrompt, userMessage, orgContext } = req.body;
  if (!openaiKey || !systemPrompt || !userMessage)
    return res.status(400).json({ error: "Missing required fields." });

  let zohoData = null;
  if (zohoToken && orgId) {
    try { zohoData = await fetchZohoContext(zohoToken, zohoRegion || "com", orgId, userMessage); }
    catch (e) { console.error("Zoho fetch error:", e.message); }
  }

  const userContent = [
    orgContext || "",
    zohoData
      ? `\nLIVE ZOHO BOOKS DATA — use as source of truth:\n${zohoData}`
      : "\n(Zoho data unavailable — answer from context.)",
    `\nUser Query: ${userMessage}`,
  ].join("");

  try {
    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model:           "gpt-4o",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userContent  },
        ],
        max_tokens:  4000,
        temperature: 0.2,
      }),
    });

    if (!aiRes.ok) {
      const err = await aiRes.json().catch(() => ({}));
      return res.status(aiRes.status).json({ error: err.error?.message || `OpenAI error ${aiRes.status}` });
    }

    const data = await aiRes.json();
    return res.status(200).json({ content: data.choices?.[0]?.message?.content || "" });
  } catch (e) {
    return res.status(502).json({ error: "AI request failed: " + e.message });
  }
};
