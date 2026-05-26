// ── orgs.js — Dynamic Org Configuration ──────────────────────────────
// ORGS is populated at runtime from Zoho Books API.
// Country metadata maps Zoho country names/codes to flags, standards, and taxes.

let ORGS = [];

// ── COUNTRY METADATA ──────────────────────────────────────────────────
const COUNTRY_FLAGS = {
  SG: "🇸🇬", MY: "🇲🇾", ID: "🇮🇩", PH: "🇵🇭", NP: "🇳🇵",
  MM: "🇲🇲", TW: "🇹🇼", BD: "🇧🇩", IN: "🇮🇳", AU: "🇦🇺",
  US: "🇺🇸", GB: "🇬🇧", CA: "🇨🇦", NZ: "🇳🇿", HK: "🇭🇰",
  TH: "🇹🇭", VN: "🇻🇳", KH: "🇰🇭", LK: "🇱🇰", AE: "🇦🇪",
  JP: "🇯🇵", CN: "🇨🇳", KR: "🇰🇷", DE: "🇩🇪", FR: "🇫🇷",
  NL: "🇳🇱", SE: "🇸🇪", CH: "🇨🇭", ZA: "🇿🇦", KE: "🇰🇪",
};

const COUNTRY_STANDARDS = {
  Singapore:         "IFRS / SFRS",
  Malaysia:          "MFRS (IFRS-aligned)",
  Indonesia:         "PSAK (IFRS-aligned)",
  Philippines:       "PFRS (IFRS-aligned)",
  Nepal:             "NAS (Nepal Accounting Standards)",
  Myanmar:           "MFRS",
  Taiwan:            "TIFRS (IFRS-aligned)",
  Bangladesh:        "BFRS (IFRS-aligned)",
  India:             "Ind AS (IFRS-aligned)",
  Australia:         "AASB (IFRS-aligned)",
  "New Zealand":     "NZ IFRS",
  "United States":   "US GAAP",
  "United Kingdom":  "UK GAAP / IFRS",
  Canada:            "ASPE / IFRS",
  Germany:           "HGB / IFRS",
  France:            "PCG / IFRS",
  "Hong Kong":       "HKFRS (IFRS-aligned)",
  Japan:             "JGAAP / IFRS",
  "South Africa":    "IFRS",
  Kenya:             "IFRS",
  "United Arab Emirates": "IFRS",
};

const COUNTRY_TAXES = {
  Singapore:        ["GST 9%",    "WHT",    "CPF"],
  Malaysia:         ["SST 8%",    "WHT",    "EPF",       "SOCSO"],
  Indonesia:        ["PPN 11%",   "PPh 21", "PPh 23",    "BPJS"],
  Philippines:      ["VAT 12%",   "EWT",    "SSS",       "PhilHealth"],
  Nepal:            ["VAT 13%",   "TDS",    "SSF",       "CIT"],
  Myanmar:          ["CT",        "WHT"],
  Taiwan:           ["VAT 5%",    "WHT",    "Labor Ins", "NHI"],
  Bangladesh:       ["VAT 15%",   "TDS",    "AIT"],
  India:            ["GST 18%",   "TDS",    "PF",        "ESI"],
  Australia:        ["GST 10%",   "PAYG",   "Super"],
  "New Zealand":    ["GST 15%",   "PAYE"],
  "United States":  ["Sales Tax", "FICA",   "FUTA"],
  "United Kingdom": ["VAT 20%",   "PAYE",   "NIC"],
  Canada:           ["GST/HST",   "CPP",    "EI"],
  "Hong Kong":      ["Salaries Tax", "Profits Tax"],
  Japan:            ["Consumption Tax 10%", "WHT"],
  Germany:          ["VAT 19%",   "Payroll Tax"],
  France:           ["TVA 20%",   "URSSAF"],
  "United Arab Emirates": ["VAT 5%"],
  "South Africa":   ["VAT 15%",   "PAYE",   "SDL"],
  Kenya:            ["VAT 16%",   "PAYE",   "NHIF"],
};

const FY_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Stop words to strip when building short codes
const STOP_WORDS = new Set([
  "pte","ltd","sdn","bhd","inc","corp","co","pt","cv","llc","plc",
  "berhad","limited","private","public","the","and","of","for",
  "group","holdings","international","global","asia","pacific",
]);

// ── BUILD ORG FROM ZOHO API RESPONSE ─────────────────────────────────
function buildOrgFromZoho(apiOrg) {
  const countryCode = apiOrg.country_code || "";
  const country     = apiOrg.country      || "Unknown";

  // Derive 2–6 char short code from name
  const words = apiOrg.name.split(/\s+/).filter(w => !STOP_WORDS.has(w.toLowerCase()));
  const short  = words
    .map(w => (w === w.toUpperCase() && w.length > 1) ? w : w[0])
    .join("")
    .toUpperCase()
    .substring(0, 6);

  // FY label from fiscal_year_start_month (1=Jan)
  const fyStart = apiOrg.fiscal_year_start_month || 1;
  const fyEnd   = ((fyStart - 2 + 12) % 12);      // index of month before start
  const fyLabel = `${FY_MONTHS[fyStart - 1]}–${FY_MONTHS[fyEnd]}`;

  const taxes = COUNTRY_TAXES[country] || ["Tax"];

  return {
    id:             apiOrg.organization_id,
    zohoOrgId:      apiOrg.organization_id,
    flag:           COUNTRY_FLAGS[countryCode] || "🏢",
    name:           apiOrg.name,
    short:          short || apiOrg.name.substring(0, 4).toUpperCase(),
    country,
    type:           apiOrg.industry_type || "Business",
    currency:       apiOrg.currency_code   || "USD",
    currencySymbol: apiOrg.currency_symbol || "$",
    standard:       COUNTRY_STANDARDS[country] || "IFRS",
    tax:            taxes,
    fy:             fyLabel,
    tags:           taxes.slice(0, 4),
    snapshot: {
      ar: "—", ap: "—", cash: "—", revenue: "—",
      arNote: "Loading…", apNote: "Loading…", cashNote: "Loading…", revenueNote: "",
    },
    activity: [],
  };
}

function getOrg(id) {
  return ORGS.find(o => o.id === id) || ORGS[0];
}
