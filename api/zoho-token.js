// Vercel serverless function — proxies Zoho OAuth token operations to avoid CORS.
// Handles: authorization_code exchange and refresh_token renewal.

const ZOHO_AUTH_BASES = {
  com: "https://accounts.zoho.com",
  eu:  "https://accounts.zoho.eu",
  in:  "https://accounts.zoho.in",
  au:  "https://accounts.zoho.com.au",
  jp:  "https://accounts.zoho.jp",
  ca:  "https://accounts.zohocloud.ca",
};

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  const { grant_type, code, client_id, client_secret, code_verifier,
          redirect_uri, refresh_token, region } = req.body;

  const authBase = ZOHO_AUTH_BASES[region] || ZOHO_AUTH_BASES.com;
  const body     = new URLSearchParams();

  if (grant_type === "refresh_token") {
    if (!refresh_token || !client_id) {
      return res.status(400).json({ error: "Missing refresh_token or client_id" });
    }
    body.set("grant_type",    "refresh_token");
    body.set("client_id",     client_id);
    body.set("refresh_token", refresh_token);
    if (client_secret) body.set("client_secret", client_secret);
  } else {
    // Default: authorization_code
    if (!code || !client_id || !redirect_uri) {
      return res.status(400).json({ error: "Missing code, client_id, or redirect_uri" });
    }
    body.set("grant_type",   "authorization_code");
    body.set("client_id",    client_id);
    body.set("redirect_uri", redirect_uri);
    body.set("code",         code);
    if (client_secret) body.set("client_secret", client_secret);
    if (code_verifier) body.set("code_verifier",  code_verifier);
  }

  try {
    const zohoRes = await fetch(`${authBase}/oauth/v2/token`, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    body.toString(),
    });
    const data = await zohoRes.json();
    return res.status(zohoRes.status).json(data);
  } catch (err) {
    return res.status(502).json({ error: "Failed to reach Zoho: " + err.message });
  }
};
