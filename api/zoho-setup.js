// Vercel serverless function — ONE-TIME Zoho OAuth setup.
//
// Run this once (in a browser) to mint a long-lived refresh token, then paste
// that token into the ZOHO_REFRESH_TOKEN environment variable and redeploy.
// After that, /api/zoho-proxy and /api/ai-query refresh access tokens on their
// own and this route is no longer needed.
//
// Guarded by SETUP_SECRET: every request must include ?secret=<SETUP_SECRET>.
//
// Required env vars: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, SETUP_SECRET
// Optional:          ZOHO_REGION (default "com")
//
// In the Zoho API console, the client must be a "Server-based Application" and
// its Authorized Redirect URI must be exactly:  https://<this-host>/api/zoho-setup

module.exports.config = { maxDuration: 30 };

const { ZOHO_AUTH_BASES } = require("./_zoho-auth.js");

const esc = s => String(s).replace(/[&<>"]/g, c => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]
));

function page(title, bodyHtml) {
  return `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  body{font:14px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;background:#0e1117;color:#e6e6e6;margin:0;padding:48px 20px}
  .box{max-width:640px;margin:0 auto;background:#161b22;border:1px solid #2a2f37;border-radius:12px;padding:28px}
  h1{font-size:18px;margin:0 0 12px}
  code,pre{background:#0e1117;border:1px solid #2a2f37;border-radius:6px}
  code{padding:2px 6px;color:#c084fc}
  pre{padding:14px;overflow:auto;white-space:pre-wrap;word-break:break-all;color:#4ade80}
  a.btn{display:inline-block;margin-top:12px;padding:10px 18px;background:#2b5ff5;color:#fff;text-decoration:none;border-radius:8px}
  .warn{color:#fbbf24}.err{color:#f87171}
</style>
<div class="box"><h1>${esc(title)}</h1>${bodyHtml}</div>`;
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  const region   = process.env.ZOHO_REGION || "com";
  const authBase = ZOHO_AUTH_BASES[region] || ZOHO_AUTH_BASES.com;
  const proto    = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host     = req.headers.host;
  const redirectUri = `${proto}://${host}/api/zoho-setup`;

  const q      = req.query || {};
  const secret = q.secret || "";
  const code   = q.code || "";

  // ── Guards ──────────────────────────────────────────────────────────
  if (!process.env.SETUP_SECRET) {
    return res.status(503).send(page("Setup locked",
      `<p class="err">Set a <code>SETUP_SECRET</code> environment variable first, then open
       <code>/api/zoho-setup?secret=YOUR_SECRET</code>.</p>`));
  }
  if (secret !== process.env.SETUP_SECRET) {
    return res.status(401).send(page("Unauthorized",
      `<p class="err">Missing or wrong <code>?secret=</code>.</p>`));
  }
  if (!process.env.ZOHO_CLIENT_ID || !process.env.ZOHO_CLIENT_SECRET) {
    return res.status(503).send(page("Missing client credentials",
      `<p class="err">Set <code>ZOHO_CLIENT_ID</code> and <code>ZOHO_CLIENT_SECRET</code> (from the
       Zoho API console → your Server-based client), then reload this page.</p>`));
  }

  // ── Step 1: no code yet → show the authorize link ───────────────────
  if (!code) {
    const authUrl = new URL(`${authBase}/oauth/v2/auth`);
    authUrl.searchParams.set("client_id",     process.env.ZOHO_CLIENT_ID);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("redirect_uri",  redirectUri);
    authUrl.searchParams.set("scope",         "ZohoBooks.fullaccess.all");
    authUrl.searchParams.set("access_type",   "offline");
    authUrl.searchParams.set("prompt",        "consent"); // force a refresh_token every time
    authUrl.searchParams.set("state",         secret);

    return res.status(200).send(page("Zoho Books — one-time setup", `
      <p>Data centre: <code>${esc(region)}</code></p>
      <p>Make sure this exact URI is listed as an <b>Authorized Redirect URI</b> on your Zoho client:</p>
      <pre>${esc(redirectUri)}</pre>
      <p>Then authorize (log in as the Zoho user whose Books orgs you want to expose):</p>
      <a class="btn" href="${esc(authUrl.toString())}">Authorize with Zoho →</a>`));
  }

  // ── Step 2: got a code → exchange it for tokens ────────────────────
  const body = new URLSearchParams({
    grant_type:    "authorization_code",
    client_id:     process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    redirect_uri:  redirectUri,
    code,
  });

  let data;
  try {
    const r = await fetch(`${authBase}/oauth/v2/token`, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    body.toString(),
    });
    data = await r.json().catch(() => ({}));
  } catch (e) {
    return res.status(502).send(page("Token exchange failed",
      `<p class="err">${esc(e.message)}</p>`));
  }

  if (!data.refresh_token) {
    return res.status(502).send(page("No refresh token returned", `
      <p class="err">Zoho response: <code>${esc(data.error || JSON.stringify(data))}</code></p>
      <p class="warn">Common causes: the client is not "Server-based", the redirect URI does not match
      exactly, the code was already used, or <code>prompt=consent</code> was stripped. Start over at
      <code>/api/zoho-setup?secret=YOUR_SECRET</code>.</p>`));
  }

  return res.status(200).send(page("Copy this into ZOHO_REFRESH_TOKEN", `
    <p class="warn">Store this now — it is shown only once.</p>
    <pre>${esc(data.refresh_token)}</pre>
    <p>Set it as the <code>ZOHO_REFRESH_TOKEN</code> environment variable (Production) and redeploy.
    Also confirm <code>ZOHO_REGION</code> is <code>${esc(region)}</code>.</p>
    <p>After redeploy, delete <code>SETUP_SECRET</code> (or leave it — this route does nothing without a valid Zoho code).</p>`));
};
