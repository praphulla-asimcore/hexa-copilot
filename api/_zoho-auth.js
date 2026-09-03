// Shared Zoho OAuth helper (not a route — the leading "_" keeps Vercel from
// exposing it). Reads long-lived credentials from environment variables and
// exchanges the refresh token for a short-lived access token, cached in
// module memory across warm invocations.

const ZOHO_AUTH_BASES = {
  com: "https://accounts.zoho.com",
  eu:  "https://accounts.zoho.eu",
  in:  "https://accounts.zoho.in",
  au:  "https://accounts.zoho.com.au",
  jp:  "https://accounts.zoho.jp",
  ca:  "https://accounts.zohocloud.ca",
};

const ZOHO_API_BASES = {
  com: "https://www.zohoapis.com",
  eu:  "https://www.zohoapis.eu",
  in:  "https://www.zohoapis.in",
  au:  "https://www.zohoapis.com.au",
  jp:  "https://www.zohoapis.jp",
  ca:  "https://www.zohoapis.ca",
};

function getRegion() {
  return process.env.ZOHO_REGION || "com";
}

function apiBase() {
  return ZOHO_API_BASES[getRegion()] || ZOHO_API_BASES.com;
}

function isConfigured() {
  return Boolean(
    process.env.ZOHO_CLIENT_ID &&
    process.env.ZOHO_CLIENT_SECRET &&
    process.env.ZOHO_REFRESH_TOKEN
  );
}

let _cache = { token: null, exp: 0 };

// Force the next getZohoToken() call to refresh (used after a 401 from Zoho).
function invalidateZohoToken() {
  _cache = { token: null, exp: 0 };
}

async function getZohoToken() {
  if (_cache.token && Date.now() < _cache.exp - 60_000) return _cache.token;

  if (!isConfigured()) {
    throw new Error(
      "Server is missing Zoho credentials. Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET " +
      "and ZOHO_REFRESH_TOKEN in the deployment environment."
    );
  }

  const authBase = ZOHO_AUTH_BASES[getRegion()] || ZOHO_AUTH_BASES.com;
  const body = new URLSearchParams({
    grant_type:    "refresh_token",
    client_id:     process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
  });

  const res  = await fetch(`${authBase}/oauth/v2/token`, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    body.toString(),
  });
  const data = await res.json().catch(() => ({}));

  if (!data.access_token) {
    throw new Error(
      "Zoho token refresh failed: " + (data.error || `HTTP ${res.status}`)
    );
  }

  _cache = {
    token: data.access_token,
    exp:   Date.now() + (data.expires_in || 3600) * 1000,
  };
  return _cache.token;
}

// GET a Zoho Books endpoint using the server-managed token. Retries once with a
// fresh token if Zoho reports the token expired/invalid.
async function zohoBooksGet(path, params = {}) {
  const run = async () => {
    const token = await getZohoToken();
    const url   = new URL(`${apiBase()}/books/v3/${path}`);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    });
    const r = await fetch(url.toString(), {
      headers: { "Authorization": `Zoho-oauthtoken ${token}` },
    });
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); }
    catch (_) { json = { _nonJson: text.substring(0, 300), _status: r.status }; }
    return { status: r.status, json };
  };

  let { status, json } = await run();
  const expired = status === 401 || json.code === 57 || json.code === 14;
  if (expired) {
    invalidateZohoToken();
    ({ status, json } = await run());
  }
  return { status, json };
}

module.exports = {
  getRegion,
  isConfigured,
  getZohoToken,
  invalidateZohoToken,
  zohoBooksGet,
  ZOHO_AUTH_BASES,
  ZOHO_API_BASES,
};
