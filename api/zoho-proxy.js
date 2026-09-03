// Vercel serverless function — proxies read-only Zoho Books API calls.
// Credentials live in environment variables; the browser never sends a token.
// Zoho API endpoints also block direct browser requests (CORS), so this runs
// server-side.

module.exports.config = { maxDuration: 30 };

const { zohoBooksGet, getRegion, isConfigured } = require("./_zoho-auth.js");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  if (!isConfigured()) {
    return res.status(503).json({
      error: "Server not configured. Missing ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN.",
      code:  "server_not_configured",
    });
  }

  const { path, params } = req.body || {};
  if (!path) {
    return res.status(400).json({ error: "Missing required field: path" });
  }

  try {
    const { status, json } = await zohoBooksGet(path, params || {});
    if (json && json._nonJson !== undefined) {
      return res.status(502).json({ error: "Zoho returned non-JSON: " + json._nonJson });
    }
    return res.status(status).json(json);
  } catch (err) {
    return res.status(502).json({ error: "Zoho request failed: " + err.message });
  }
};

// exported for other modules / tests
module.exports.getRegion = getRegion;
