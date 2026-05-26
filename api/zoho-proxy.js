// Vercel serverless function — proxies all Zoho Books API calls to avoid CORS.
// Zoho API endpoints block direct browser requests; this runs server-side.

module.exports.config = { maxDuration: 30 };

const ZOHO_API_BASES = {
  com: "https://www.zohoapis.com",
  eu:  "https://www.zohoapis.eu",
  in:  "https://www.zohoapis.in",
  au:  "https://www.zohoapis.com.au",
  jp:  "https://www.zohoapis.jp",
  ca:  "https://www.zohoapis.ca",
};

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  const { token, region, path, params } = req.body;

  if (!token || !path) {
    return res.status(400).json({ error: "Missing required fields: token, path" });
  }

  const apiBase = ZOHO_API_BASES[region] || ZOHO_API_BASES.com;
  const url     = new URL(`${apiBase}/books/v3/${path}`);

  if (params && typeof params === "object") {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  try {
    const zohoRes = await fetch(url.toString(), {
      headers: { "Authorization": `Zoho-oauthtoken ${token}` },
    });

    const text = await zohoRes.text();
    try {
      return res.status(zohoRes.status).json(JSON.parse(text));
    } catch (_) {
      return res.status(502).json({ error: "Zoho returned non-JSON: " + text.substring(0, 300) });
    }
  } catch (err) {
    return res.status(502).json({ error: "Failed to reach Zoho API: " + err.message });
  }
};
