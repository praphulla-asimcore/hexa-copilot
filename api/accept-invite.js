const crypto = require("crypto");

function parseToken(token) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature || !process.env.INVITE_SECRET) return null;
  const expected = crypto.createHmac("sha256", process.env.INVITE_SECRET).update(body).digest("base64url");
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return payload.expiresAt > Date.now() ? payload : null;
  } catch (_) {
    return null;
  }
}

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:Arial,sans-serif;background:#131417;color:#e7e8ea;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}.box{width:min(440px,100%);background:#18191d;border:1px solid #33343b;border-radius:13px;padding:32px;box-sizing:border-box}h1{font-size:22px;margin:0 0 8px}p{color:#9fa1a9;line-height:1.6}label{display:block;color:#9fa1a9;font-size:13px;margin:22px 0 7px}input{width:100%;box-sizing:border-box;background:#202127;border:1px solid #33343b;border-radius:7px;padding:11px;color:#e7e8ea;font-size:15px}button{margin-top:18px;width:100%;padding:11px;border:0;border-radius:7px;background:#8b7cf6;color:#fff;font-weight:600;font-size:14px;cursor:pointer}.error{color:#e5645c}</style></head><body><main class="box">${body}</main></body></html>`;
}

module.exports = async function handler(req, res) {
  const token = req.method === "POST" ? req.body?.token : req.query?.token;
  const invite = parseToken(token);
  if (!invite) return res.status(400).send(page("Invalid invitation", "<h1>Invitation unavailable</h1><p class=\"error\">This invitation is invalid or has expired. Ask an administrator to send a new invitation.</p>"));

  if (req.method === "GET") {
    return res.status(200).send(page("Accept invitation", `<h1>Welcome to Guru Ji</h1><p>Activate the account invited for <strong>${escapeHtml(invite.email)}</strong>.</p><form method="post"><input type="hidden" name="token" value="${escapeHtml(token)}"><label for="password">Temporary password</label><input id="password" name="password" type="password" autocomplete="current-password" required><button type="submit">Activate account</button></form>`));
  }
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const password = String(req.body?.password || "");
  const actualHash = crypto.scryptSync(password, invite.salt, 32).toString("base64url");
  if (actualHash !== invite.passwordHash)
    return res.status(401).send(page("Incorrect password", `<h1>Try again</h1><p class="error">The temporary password does not match. Please use the password from your invitation email.</p><form method="post"><input type="hidden" name="token" value="${escapeHtml(token)}"><label for="password">Temporary password</label><input id="password" name="password" type="password" autocomplete="current-password" required><button type="submit">Activate account</button></form>`));

  const user = JSON.stringify({ email: invite.email, password, name: invite.name, role: invite.role, initials: initials(invite.name) });
  const encodedUser = Buffer.from(user).toString("base64");
  return res.status(200).send(page("Account activated", `<h1>Account activated</h1><p>Your account is ready. Redirecting you to Guru Ji…</p><script>localStorage.setItem("hx_pending_user", atob(${JSON.stringify(encodedUser)})); location.replace("/");</script>`));
};

function initials(name) {
  return name.split(/\s+/).filter(Boolean).map(part => part[0]).join("").substring(0, 2).toUpperCase() || "U";
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}
