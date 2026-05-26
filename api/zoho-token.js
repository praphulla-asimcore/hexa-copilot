// Vercel serverless function — proxies Zoho OAuth token exchange to avoid CORS
// Zoho's /oauth/v2/token endpoint rejects browser requests; this runs server-side.

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

  const { code, client_id, client_secret, code_verifier, redirect_uri, region } = req.body;

  if (!code || !client_id || !redirect_uri) {
    return res.status(400).json({ error: "Missing required fields: code, client_id, redirect_uri" });
  }

  const authBase = ZOHO_AUTH_BASES[region] || ZOHO_AUTH_BASES.com;

  const body = new URLSearchParams({
    grant_type:   "authorization_code",
    client_id,
    redirect_uri,
    code,
  });
  if (client_secret) body.set("client_secret", client_secret);
  if (code_verifier) body.set("code_verifier",  code_verifier);

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
