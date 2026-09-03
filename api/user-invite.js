const crypto = require("crypto");

function tokenFor(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", process.env.INVITE_SECRET).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString("base64url");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { name, email, password, role } = req.body || {};
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!name || !normalizedEmail || !password || !role)
    return res.status(400).json({ error: "Name, email, password, and role are required." });
  if (password.length < 8)
    return res.status(400).json({ error: "Temporary password must be at least 8 characters." });
  if (!process.env.RESEND_API_KEY || !process.env.INVITE_SECRET || !process.env.INVITE_FROM_EMAIL)
    return res.status(503).json({ error: "Invitation email is not configured on the server.", code: "invite_not_configured" });

  const salt = crypto.randomBytes(16).toString("base64url");
  const token = tokenFor({
    name: String(name).trim(),
    email: normalizedEmail,
    role,
    salt,
    passwordHash: hashPassword(password, salt),
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });
  const appUrl = (process.env.APP_URL || "https://ai.hexamatics.finance").replace(/\/$/, "");
  const inviteUrl = `${appUrl}/api/accept-invite?token=${encodeURIComponent(token)}`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.INVITE_FROM_EMAIL,
      to: [normalizedEmail],
      subject: "Your Guru Ji invitation",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;line-height:1.6;color:#222">
          <h2>You have been invited to Guru Ji</h2>
          <p>Hello ${escapeHtml(String(name).trim())},</p>
          <p>Use the button below to activate your account. This invitation expires in 7 days.</p>
          <p><a href="${inviteUrl}" style="display:inline-block;padding:11px 18px;background:#7566e8;color:#fff;text-decoration:none;border-radius:6px">Accept invitation</a></p>
          <p>Your temporary password is:</p>
          <p style="font-family:monospace;font-size:16px"><strong>${escapeHtml(password)}</strong></p>
          <p>Keep this password private. You can change it after signing in.</p>
        </div>`,
    }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    return res.status(502).json({ error: data.message || "Could not send invitation email." });
  }
  return res.status(200).json({ sent: true });
};

function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}
