// Vercel serverless function — fetches finance context + calls the AI server-side.
// Covers every Zoho Books API v3 endpoint. maxDuration set after module.exports.
//
// Credentials come from environment variables (OPENAI_API_KEY + the ZOHO_*
// vars consumed by ./_zoho-auth.js); the browser never sends a key or token.

const { zohoBooksGet, isConfigured: zohoConfigured } = require("./_zoho-auth.js");
const fs = require("fs");
const path = require("path");

function loadCompanyPolicy() {
  try {
    return fs.readFileSync(path.join(__dirname, "..", "knowledge", "company-policy.md"), "utf8");
  } catch (e) {
    console.error("Company policy file unavailable:", e.message);
    return "Company policy knowledge is currently unavailable.";
  }
}

const COMPANY_POLICY = loadCompanyPolicy();
const MIN_DATA_DATE = "2023-01-01";

function todayDate() {
  return new Date().toISOString().split("T")[0];
}

// ── DATE RANGE PARSER ─────────────────────────────────────────────────
function _parseDateRange(query, wideSearch = false) {
  const q   = query.toLowerCase();
  const now = new Date();
  const cy  = now.getFullYear();

  const MONTH_NUM = {
    january:1,jan:1, february:2,feb:2, march:3,mar:3,
    april:4,apr:4, may:5, june:6,jun:6,
    july:7,jul:7, august:8,aug:8, september:9,sep:9,sept:9,
    october:10,oct:10, november:11,nov:11, december:12,dec:12,
  };
  const lastDay = (y,m) => new Date(y,m,0).getDate();
  const pad     = n => String(n).padStart(2,"0");
  const fmt     = (y,m,d) => `${y}-${pad(m)}-${pad(d)}`;

  // "April 2026" / "2026 April"
  for (const [name,num] of Object.entries(MONTH_NUM)) {
    for (const re of [
      new RegExp(`\\b${name}\\b\\s+(?:of\\s+)?(20\\d{2})`,"i"),
      new RegExp(`(20\\d{2})\\s+${name}`,"i"),
    ]) {
      const m = q.match(re);
      if (m) {
        const yr = parseInt(m[1]);
        return { from:fmt(yr,num,1), to:fmt(yr,num,lastDay(yr,num)), label:`${name} ${yr}` };
      }
    }
  }
  // "Q1 2026"
  const qm = q.match(/\bq([1-4])\s+(?:fy)?(20\d{2})\b/i);
  if (qm) {
    const qn=parseInt(qm[1]),y=parseInt(qm[2]),sm=(qn-1)*3+1,em=qn*3;
    return { from:fmt(y,sm,1), to:fmt(y,em,lastDay(y,em)), label:`Q${qn} ${y}` };
  }
  // "FY2026"
  const fym = q.match(/\bfy\s*(20\d{2})\b/i);
  if (fym) { const y=parseInt(fym[1]); return { from:`${y}-01-01`,to:`${y}-12-31`,label:`FY${y}` }; }
  // "2026-04"
  const ism = q.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])\b/);
  if (ism) { const y=parseInt(ism[1]),mo=parseInt(ism[2]); return { from:fmt(y,mo,1),to:fmt(y,mo,lastDay(y,mo)),label:`${y}-${pad(mo)}` }; }
  // "last month"
  if (/last\s+month/.test(q)) { const d=new Date(now.getFullYear(),now.getMonth()-1,1),y=d.getFullYear(),mo=d.getMonth()+1; return { from:fmt(y,mo,1),to:fmt(y,mo,lastDay(y,mo)),label:"last month" }; }
  // "this month"
  if (/this\s+month/.test(q)) { const y=cy,mo=now.getMonth()+1; return { from:fmt(y,mo,1),to:fmt(y,mo,lastDay(y,mo)),label:"this month" }; }
  // "this year"
  if (/this\s+year|current\s+year/.test(q)) return { from:`${cy}-01-01`,to:now.toISOString().split("T")[0],label:`${cy} YTD` };
  // bare year
  const ym = q.match(/\b(20\d{2})\b/);
  if (ym) { const y=parseInt(ym[1]); return { from:`${y}-01-01`,to:`${y}-12-31`,label:String(y) }; }
  // wide search for "last X", "when was", etc.
  if (wideSearch || /\blast\b|\bwhen\b|\bmost.?recent\b|\bever\b|\bhistory\b|\ball.?time\b/.test(q)) {
    const d=new Date(now); d.setFullYear(d.getFullYear()-3);
    return { from:d.toISOString().split("T")[0], to:now.toISOString().split("T")[0], label:"last 3 years" };
  }
  // Default to the full available history.
  return { from:MIN_DATA_DATE, to:now.toISOString().split("T")[0], label:"available history" };
}

function parseDateRange(query, wideSearch = false) {
  const range = _parseDateRange(query, wideSearch);
  const today = todayDate();
  const from = range.from < MIN_DATA_DATE ? MIN_DATA_DATE : (range.from > today ? today : range.from);
  const to = range.to < MIN_DATA_DATE ? MIN_DATA_DATE : (range.to > today ? today : range.to);
  return { ...range, from, to, label: range.label };
}

// ── ZOHO HELPERS ──────────────────────────────────────────────────────
// The leading (token, region) args are retained for call-site compatibility but
// ignored — auth and data centre are resolved server-side from env vars.
async function zohoGet(_token, _region, path, params={}) {
  const { json } = await zohoBooksGet(path, params);
  return json && json._nonJson !== undefined ? {} : (json || {});
}

async function zohoGetPaged(_token, _region, path, params, rootKey) {
  const all = [];
  for (let page=1; page<=5; page++) {
    const data = await zohoGet(null, null, path, { ...params, page, per_page:200 });
    const items = data[rootKey] || [];
    all.push(...items);
    if (!data.page_context?.has_more_page) break;
  }
  return all;
}

// ── FULL ZOHO CONTEXT FETCHER ─────────────────────────────────────────
async function fetchZohoContext(token, region, orgId, query) {
  const q  = query.toLowerCase();
  const rp = { organization_id: orgId };

  const needsWide = /\blast\b|\bwhen\b|\bmost.?recent\b|\bever\b|\bhistory\b|\ball.?time\b|\brecord\b/.test(q);
  const dr = parseDateRange(query, needsWide);

  const dpR = { ...rp, from_date:dr.from, to_date:dr.to, cash_based:false };
  const dpL = { ...rp, date_start:dr.from, date_end:dr.to, sort_column:"date", sort_order:"D" };

  const tasks = [];

  // ── FINANCIAL REPORTS ────────────────────────────────────────────────
  if (/p&l|profit|loss|revenue|income|ebitda|margin|turnover|pbt|pat/.test(q))
    tasks.push(() => zohoGet(token,region,"reports/profitandloss",dpR).then(d=>({profitandloss:d,_period:dr.label})));

  if (/balance.?sheet|asset|liabilit|equity|net.?worth|book.?value/.test(q))
    tasks.push(() => zohoGet(token,region,"reports/balancesheet",{...rp,date:dr.to}).then(d=>({balancesheet:d,_period:dr.label})));

  if (/cash.?flow|free.?cash|operating.?cash|cfo|cfi|cff/.test(q))
    tasks.push(() => zohoGet(token,region,"reports/cashflow",dpR).then(d=>({cashflow:d,_period:dr.label})));

  if (/trial.?balance/.test(q))
    tasks.push(() => zohoGet(token,region,"reports/trialbalance",dpR).then(d=>({trialbalance:d,_period:dr.label})));

  if (/general.?ledger|\bgl\b|ledger.detail|account.movement/.test(q))
    tasks.push(() => zohoGet(token,region,"reports/generalledger",dpR).then(d=>({generalledger:d,_period:dr.label})));

  if (/account.?transaction|account.?activity|movement/.test(q))
    tasks.push(() => zohoGet(token,region,"reports/accounttransactions",dpR).then(d=>({account_transactions:d,_period:dr.label})));

  let taxSummaryQueued = false;
  if (/tax.?summ|tax.?report|gst.?report|sst.?report|vat.?report|tax.?filing/.test(q)) {
    tasks.push(() => zohoGet(token,region,"reports/taxsummary",dpR).then(d=>({taxsummary:d,_period:dr.label})));
    taxSummaryQueued = true;
  }

  if (/ar.?aging|aged.?receivable|receivable.?aging/.test(q))
    tasks.push(() => zohoGet(token,region,"reports/agingsummary",{...rp,type:"receivable",date:dr.to}).then(d=>({ar_aging_report:d,_period:dr.label})));

  if (/ap.?aging|aged.?payable|payable.?aging/.test(q))
    tasks.push(() => zohoGet(token,region,"reports/agingsummary",{...rp,type:"payable",date:dr.to}).then(d=>({ap_aging_report:d,_period:dr.label})));

  if (/customer.?balance|client.?balance|receivable.?summ/.test(q))
    tasks.push(() => zohoGet(token,region,"reports/customerbalances",{...rp,as_of_date:dr.to}).then(d=>({customer_balances:d,_period:dr.label})));

  if (/vendor.?balance|supplier.?balance|payable.?summ/.test(q))
    tasks.push(() => zohoGet(token,region,"reports/vendorbalances",{...rp,as_of_date:dr.to}).then(d=>({vendor_balances:d,_period:dr.label})));

  if (/sales.by.customer|revenue.by.client|client.revenue/.test(q))
    tasks.push(() => zohoGet(token,region,"reports/salesbycustomer",dpR).then(d=>({sales_by_customer:d,_period:dr.label})));

  if (/purchase.by.supplier|spend.by.vendor|vendor.spend/.test(q))
    tasks.push(() => zohoGet(token,region,"reports/purchasebysupplier",dpR).then(d=>({purchase_by_supplier:d,_period:dr.label})));

  if (/payments?.made.report|ap.payments?.report|disbursement.report/.test(q))
    tasks.push(() => zohoGet(token,region,"reports/paymentsmade",dpR).then(d=>({payments_made_report:d,_period:dr.label})));

  if (/payments?.received.report|ar.payments?.report|collection.report/.test(q))
    tasks.push(() => zohoGet(token,region,"reports/paymentsreceived",dpR).then(d=>({payments_received_report:d,_period:dr.label})));

  if (/inventory|stock.?summ|warehouse|opening.?stock|closing.?stock/.test(q))
    tasks.push(() => zohoGet(token,region,"reports/inventorysummary",rp).then(d=>({inventory_summary:d})));

  // ── INVOICES & AR ────────────────────────────────────────────────────
  if (/invoice|\bar\b|receivable|aging|collect|outstanding|overdue/.test(q))
    tasks.push(() => zohoGetPaged(token,region,"invoices",{...dpL,sort_column:"due_date",sort_order:"A"},"invoices").then(r=>({invoices:r,_period:dr.label})));

  // ── CUSTOMER PAYMENTS ────────────────────────────────────────────────
  const isCustomerPay = /customer.+pay|receipt|received.+from|collected|money.+received/.test(q);
  const isGenericPay  = /payment|receipt/.test(q) && !/paid.+to|vendor.+pay|made.+to|remit/.test(q);
  if (isCustomerPay || isGenericPay)
    tasks.push(() => zohoGetPaged(token,region,"customerpayments",dpL,"customerpayments").then(r=>({customerpayments:r,_period:dr.label})));

  // ── CREDIT NOTES (issued to customers) ──────────────────────────────
  if (/credit.?note|creditnote|\bcn\b|refund.issued|customer.?credit|debit.?memo/.test(q))
    tasks.push(() => zohoGetPaged(token,region,"creditnotes",dpL,"creditnotes").then(r=>({creditnotes:r,_period:dr.label})));

  // ── ESTIMATES / QUOTES ───────────────────────────────────────────────
  if (/estimate|quote|quotation|proposal|tender|rfq/.test(q))
    tasks.push(() => zohoGetPaged(token,region,"estimates",dpL,"estimates").then(r=>({estimates:r,_period:dr.label})));

  // ── SALES ORDERS ────────────────────────────────────────────────────
  if (/sales.?order|\bso\b(?!cial)/.test(q))
    tasks.push(() => zohoGetPaged(token,region,"salesorders",dpL,"salesorders").then(r=>({salesorders:r,_period:dr.label})));

  // ── RECURRING INVOICES ───────────────────────────────────────────────
  if (/recurring.?invoice|subscription|repeat.?invoice|standing.?invoice/.test(q))
    tasks.push(() => zohoGetPaged(token,region,"recurringinvoices",{...rp},"recurringinvoices").then(r=>({recurringinvoices:r})));

  // ── RETAINER INVOICES ────────────────────────────────────────────────
  if (/retainer|advance.?invoice|deposit.?invoice/.test(q))
    tasks.push(() => zohoGetPaged(token,region,"retainerinvoices",dpL,"retainerinvoices").then(r=>({retainerinvoices:r,_period:dr.label})));

  // ── DELIVERY CHALLANS ────────────────────────────────────────────────
  if (/delivery|challan|shipment|dispatch|consignment/.test(q))
    tasks.push(() => zohoGetPaged(token,region,"deliverychallans",dpL,"deliverychallans").then(r=>({deliverychallans:r,_period:dr.label})));

  // ── BILLS / AP ───────────────────────────────────────────────────────
  const hasBillQ  = /\bap\b|payable|vendor.?bill|\bbill\b|bill\s*#|bill\s*no/i.test(q);
  const hasVendor = /ltd|pvt|sdn|bhd|pte|inc|corp|limited|private|communications|services|solutions|technologies|systems|group/.test(q);
  if (hasBillQ || hasVendor)
    tasks.push(() => zohoGetPaged(token,region,"bills",dpL,"bills").then(r=>({bills:r,_period:dr.label})));

  // ── VENDOR PAYMENTS (money paid OUT) ────────────────────────────────
  const isVendorPay = /vendor.?pay|paid.?to\b|pay(?:ment)?.{0,8}to\b|made.{0,8}to\b|remit|supplier.?pay/.test(q);
  const isAmbigPay  = /payment|paid/.test(q) && !isCustomerPay;
  if (isVendorPay || isAmbigPay || hasBillQ || hasVendor)
    tasks.push(() => zohoGetPaged(token,region,"vendorpayments",dpL,"vendorpayments").then(r=>({vendorpayments:r,_period:dr.label})));

  // ── VENDOR CREDITS (credit notes from vendors) ──────────────────────
  if (/vendor.?credit|supplier.?credit|\bdn\b|debit.?note|vendor.?refund/.test(q))
    tasks.push(() => zohoGetPaged(token,region,"vendorcredits",dpL,"vendorcredits").then(r=>({vendorcredits:r,_period:dr.label})));

  // ── PURCHASE ORDERS ──────────────────────────────────────────────────
  if (/purchase.?order|\bpo\b(?!\s*box)/.test(q))
    tasks.push(() => zohoGetPaged(token,region,"purchaseorders",dpL,"purchaseorders").then(r=>({purchaseorders:r,_period:dr.label})));

  // ── EXPENSES ────────────────────────────────────────────────────────
  if (/expense|cost|spend|overhead|reimburs/.test(q))
    tasks.push(() => zohoGetPaged(token,region,"expenses",dpL,"expenses").then(r=>({expenses:r,_period:dr.label})));

  // ── RECURRING EXPENSES ───────────────────────────────────────────────
  if (/recurring.?expense|repeat.?expense|standing.?expense/.test(q))
    tasks.push(() => zohoGetPaged(token,region,"recurringexpenses",{...rp},"recurringexpenses").then(r=>({recurringexpenses:r})));

  // ── MANUAL JOURNALS / JV ─────────────────────────────────────────────
  if (/journal|\bjv\b|manual.?journal|journal.?entr|book.?entr|double.?entr/.test(q))
    tasks.push(() => zohoGetPaged(token,region,"manualjournals",dpL,"manualjournals").then(r=>({manualjournals:r,_period:dr.label})));

  // ── BANK ACCOUNTS & RECONCILIATION ──────────────────────────────────
  if (/cash|bank.?balance|bank.?account|reconcil/.test(q))
    tasks.push(() => zohoGet(token,region,"bankaccounts",{...rp,filter_by:"Status.Active"}).then(d=>({bankaccounts:d})));

  // ── CONTACTS (vendors & customers) ──────────────────────────────────
  if (hasVendor || /contact|customer.?list|vendor.?list|who.?is|supplier|client.?list/.test(q))
    tasks.push(() => zohoGetPaged(token,region,"contacts",{...rp,sort_column:"contact_name",sort_order:"A"},"contacts").then(r=>({contacts:r})));

  // ── ITEMS / PRODUCTS / SERVICES ──────────────────────────────────────
  if (/\bitem\b|\bproduct\b|\bservice\b|catalog|sku|rate.?card|price.?list/.test(q))
    tasks.push(() => zohoGetPaged(token,region,"items",{...rp,sort_column:"name",sort_order:"A"},"items").then(r=>({items:r})));

  // ── CHART OF ACCOUNTS ────────────────────────────────────────────────
  if (/chart.of.account|coa\b|account.?code|account.?list|ledger.?account/.test(q))
    tasks.push(() => zohoGetPaged(token,region,"chartofaccounts",rp,"chartofaccounts").then(r=>({chartofaccounts:r})));

  // ── TAX RATES ────────────────────────────────────────────────────────
  if (/tax.?rate|tax.?code|tax.?list|sst.?rate|gst.?rate|vat.?rate|rate.?list/.test(q))
    tasks.push(() => zohoGet(token,region,"settings/taxes",rp).then(d=>({tax_rates:d})));

  // ── CURRENCIES / FX RATES ────────────────────────────────────────────
  if (/currency|exchange.?rate|\bforex\b|\bfx\b/.test(q))
    tasks.push(() => zohoGet(token,region,"settings/currencies",rp).then(d=>({currencies:d})));

  // ── USERS ────────────────────────────────────────────────────────────
  if (/\buser\b|team.?member|who.?has.?access|staff.?list/.test(q))
    tasks.push(() => zohoGet(token,region,"users",rp).then(d=>({users:d})));

  // ── TAX & COMPLIANCE (general) ───────────────────────────────────────
  if (/\btax\b|gst|vat|tds|sst|withhold|compliance|filing|deadline/.test(q) && !taxSummaryQueued)
    tasks.push(() => zohoGet(token,region,"reports/taxsummary",dpR).then(d=>({taxsummary:d,_period:dr.label})));

  // ── FALLBACK ─────────────────────────────────────────────────────────
  if (!tasks.length) {
    tasks.push(
      () => zohoGet(token,region,"invoices",    {...rp,status:"unpaid",per_page:200}).then(d=>({invoices:d})),
      () => zohoGet(token,region,"bills",       {...rp,status:"unpaid",per_page:200}).then(d=>({bills:d})),
      () => zohoGet(token,region,"bankaccounts",{...rp,filter_by:"Status.Active"}).then(d=>({bankaccounts:d})),
    );
  }

  // Run up to 5 tasks in parallel (well within 60s timeout)
  const limited = tasks.slice(0, 5);
  const results = await Promise.allSettled(limited.map(fn => fn()));
  const combined = { _query_period: dr };
  results.forEach(r => { if (r.status === "fulfilled") Object.assign(combined, r.value); });

  const json = JSON.stringify(combined, null, 2);
  return json.length > 80000 ? json.substring(0, 80000) + "\n...[truncated]" : json;
}

// ── HANDLER ───────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  const {
    orgId, systemPrompt, userMessage, orgContext, conversationHistory,
  } = req.body || {};

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey)
    return res.status(503).json({ error: "Server not configured. Missing OPENAI_API_KEY.", code: "server_not_configured" });
  if (!systemPrompt || !userMessage)
    return res.status(400).json({ error: "Missing required fields." });

  let zohoData = null;
  let dr = parseDateRange(userMessage, /\blast\b|\bwhen\b|\bmost.?recent\b|\bever\b|\bhistory\b|\ball.?time\b|\brecord\b/.test(userMessage.toLowerCase()));
  if (zohoConfigured() && orgId) {
    try { zohoData = await fetchZohoContext(null, null, orgId, userMessage); }
    catch (e) { console.error("Zoho fetch error:", e.message); }
  }

  const dataBlock = zohoData
    ? [
        `DATA PERIOD: ${dr.label} (${dr.from} to ${dr.to})`,
        `PAYMENT TYPES: vendorpayments=money paid OUT to vendors; customerpayments=money received IN from customers.`,
        `LIVE ZOHO BOOKS DATA:\n${zohoData}`,
        `RULES: (1) Only use figures explicitly in the data. (2) Fuzzy-match vendor/customer names — strip Ltd/Pvt/Sdn/Bhd/Pte/Inc suffixes. (3) Check vendorpayments for "paid to vendor" questions. (4) Use conversation history for follow-up pronouns. (5) Use each record's currency_code, never the org currency on foreign transactions.`,
      ].join("\n")
    : "(Zoho data unavailable.)";

  const messages = [{
    role:"system",
    content: `${systemPrompt}

COMPANY POLICY KNOWLEDGE BASE:
Use the following approved company policy when answering questions about internal rules, approvals, responsibilities, risk, compliance, IT controls, or other Group procedures. Treat it as authoritative for company policy. Do not invent policy requirements. If the policy does not address a question, say so clearly and distinguish general professional guidance from Group policy.

${COMPANY_POLICY}`,
  }];
  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    conversationHistory.slice(-8).forEach(m => {
      if (m.role === "user") messages.push({ role:"user",      content:m.content });
      if (m.role === "ai")   messages.push({ role:"assistant", content:m.content });
    });
  }
  messages.push({ role:"user", content:[orgContext||"", "\n"+dataBlock, `\nUser Query: ${userMessage}`].join("") });

  try {
    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type":"application/json", "Authorization":`Bearer ${openaiKey}` },
      body: JSON.stringify({ model:"gpt-4o", response_format:{type:"json_object"}, messages, max_tokens:4000, temperature:0.1 }),
    });
    if (!aiRes.ok) {
      const err = await aiRes.json().catch(()=>({}));
      return res.status(aiRes.status).json({ error: err.error?.message || `OpenAI error ${aiRes.status}` });
    }
    const data = await aiRes.json();
    return res.status(200).json({ content: data.choices?.[0]?.message?.content || "" });
  } catch (e) {
    return res.status(502).json({ error: "AI request failed: " + e.message });
  }
};
module.exports.config = { maxDuration: 60 };
