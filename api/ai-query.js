// Vercel serverless function — proxies OpenAI + Zoho data fetch server-side.
// Avoids browser socket timeouts on long AI responses and CORS on Zoho API.

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
  const r = await fetch(url.toString(), {
    headers: { "Authorization": `Zoho-oauthtoken ${token}` },
  });
  return r.json();
}

async function zohoGetAll(token, region, path, params = {}, rootKey, maxPages = 8) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await zohoGet(token, region, path, { ...params, page, per_page: 200 });
    const items = data[rootKey] || [];
    all.push(...items);
    if (!data.page_context?.has_more_page) break;
  }
  return all;
}

async function fetchZohoContext(token, region, orgId, query) {
  const q     = query.toLowerCase();
  const today = new Date().toISOString().split("T")[0];
  const from5 = new Date(); from5.setFullYear(from5.getFullYear() - 5);
  const fromDate = from5.toISOString().split("T")[0];
  const rp    = { organization_id: orgId };

  const tasks = [];

  // Financial statements — use Zoho's built-in report endpoints
  if (/p&l|profit|loss|revenue|income|ebitda|margin|turnover/.test(q)) {
    tasks.push(["reports/profitandloss", { ...rp, from_date: fromDate, to_date: today, cash_based: false }, "profitandloss", false]);
  }
  if (/balance.?sheet|asset|liabilit|equity|net.worth/.test(q)) {
    tasks.push(["reports/balancesheet", { ...rp, date: today }, "balancesheet", false]);
  }
  if (/cash.?flow|free.cash|operating.cash|cfo|cfi|cff/.test(q)) {
    tasks.push(["reports/cashflow", { ...rp, from_date: fromDate, to_date: today }, "cashflow", false]);
  }
  if (/trial.?balance/.test(q)) {
    tasks.push(["reports/trialbalance", { ...rp, from_date: fromDate, to_date: today }, "trialbalance", false]);
  }

  // Transaction lists — paginated full history
  if (/invoice|ar\b|receivable|aging|collect|outstanding/.test(q)) {
    tasks.push(["invoices", { ...rp, sort_column: "date", sort_order: "D" }, "invoices", true]);
  }
  if (/\bap\b|payable|vendor bill|bill/.test(q)) {
    tasks.push(["bills", { ...rp, sort_column: "date", sort_order: "D" }, "bills", true]);
  }
  if (/customer.?payment|receipt|money.received/.test(q)) {
    tasks.push(["customerpayments", { ...rp, sort_column: "date", sort_order: "D" }, "customerpayments", true]);
  }
  if (/vendor.?payment|paid.to|payment.made/.test(q)) {
    tasks.push(["vendorpayments", { ...rp, sort_column: "date", sort_order: "D" }, "vendorpayments", true]);
  }
  if (/expense|cost|spend|overhead/.test(q)) {
    tasks.push(["expenses", { ...rp, sort_column: "date", sort_order: "D" }, "expenses", true]);
  }
  if (/cash|bank.balance|bank.account/.test(q)) {
    tasks.push(["bankaccounts", { ...rp, filter_by: "Status.Active" }, "bankaccounts", false]);
  }
  if (/contact|customer list|client list|vendor list/.test(q)) {
    tasks.push(["contacts", { ...rp, sort_column: "contact_name", sort_order: "A" }, "contacts", true]);
  }
  if (/item|product|service|catalog|price/.test(q)) {
    tasks.push(["items", { ...rp, sort_column: "name", sort_order: "A" }, "items", true]);
  }
  if (/sales.?order/.test(q)) {
    tasks.push(["salesorders", { ...rp, sort_column: "date", sort_order: "D" }, "salesorders", true]);
  }
  if (/purchase.?order|po\b/.test(q)) {
    tasks.push(["purchaseorders", { ...rp, sort_column: "date", sort_order: "D" }, "purchaseorders", true]);
  }
  if (/estimate|quote|proposal/.test(q)) {
    tasks.push(["estimates", { ...rp, sort_column: "date", sort_order: "D" }, "estimates", true]);
  }
  if (/tax|gst|vat|tds|sst|withholding|compliance|filing/.test(q)) {
    tasks.push(["invoices", { ...rp, sort_column: "date", sort_order: "D" }, "invoices", true]);
    tasks.push(["reports/taxsummary", { ...rp, from_date: fromDate, to_date: today }, "taxsummary", false]);
  }
  if (/intercompany|related.party|elimination|consolidat/.test(q)) {
    tasks.push(["contacts", { ...rp, contact_type: "customer" }, "contacts", true]);
    tasks.push(["invoices", { ...rp, sort_column: "date", sort_order: "D" }, "invoices", true]);
  }
  if (/journal|manual.entry|adjustment/.test(q)) {
    tasks.push(["journals", { ...rp, sort_column: "date", sort_order: "D" }, "journals", true]);
  }
  if (/chart.of.accounts|coa|account.list/.test(q)) {
    tasks.push(["chartofaccounts", { ...rp }, "chartofaccounts", false]);
  }

  // Broad/general — fetch snapshot summary
  if (!tasks.length) {
    tasks.push(
      ["invoices",     { ...rp, status: "unpaid",  per_page: 200 }, "invoices",     false],
      ["bills",        { ...rp, status: "unpaid",  per_page: 200 }, "bills",        false],
      ["bankaccounts", { ...rp, filter_by: "Status.Active" },       "bankaccounts", false],
      ["expenses",     { ...rp, per_page: 100, sort_column: "date", sort_order: "D" }, "expenses", false],
    );
  }

  const results = await Promise.allSettled(
    tasks.map(([path, params, rootKey, paginate]) =>
      paginate
        ? zohoGetAll(token, region, path, params, rootKey).then(items => ({ [rootKey]: items }))
        : zohoGet(token, region, path, params)
    )
  );

  const combined = {};
  tasks.forEach(([, , rootKey], i) => {
    if (results[i].status === "fulfilled") {
      Object.assign(combined, results[i].value);
    }
  });

  const json = JSON.stringify(combined, null, 2);
  return json.length > 80000 ? json.substring(0, 80000) + "\n... [truncated]" : json;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  const { openaiKey, zohoToken, zohoRegion, orgId, systemPrompt, userMessage, orgContext } = req.body;

  if (!openaiKey || !systemPrompt || !userMessage) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  // Fetch Zoho context server-side (no CORS issue here)
  let zohoData = null;
  if (zohoToken && orgId) {
    try {
      zohoData = await fetchZohoContext(zohoToken, zohoRegion || "com", orgId, userMessage);
    } catch (e) {
      console.error("Zoho context fetch error:", e.message);
    }
  }

  const userContent = [
    orgContext || "",
    zohoData
      ? `\nLIVE ZOHO BOOKS DATA — use as source of truth for all figures:\n${zohoData}`
      : "\n(Zoho data unavailable — answer from context.)",
    `\nUser Query: ${userMessage}`
  ].join("");

  try {
    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${openaiKey}`,
      },
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
