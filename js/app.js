// ── app.js — HexaFin.AI Main Application Controller ───────────────────

// ── AUTH ──────────────────────────────────────────────────────────────
// Hardcoded admin. Extra users stored in localStorage under hx_users.
const ADMIN_USER = {
  email:    "praphulla@hexamatics.com",
  password: "Asim@1212",
  role:     "admin",
  name:     "Praphulla",
  initials: "PA",
};

function getUsers() {
  const extra = JSON.parse(localStorage.getItem("hx_users") || "[]");
  return [ADMIN_USER, ...extra];
}

function getSession() {
  return JSON.parse(localStorage.getItem("hx_session") || "null");
}

function saveSession(user) {
  localStorage.setItem("hx_session", JSON.stringify({
    email: user.email, role: user.role, name: user.name, initials: user.initials
  }));
}

function clearSession() { localStorage.removeItem("hx_session"); }

// ── PAGE BOOT ─────────────────────────────────────────────────────────
// Credentials (OpenAI + Zoho) live server-side in environment variables.
// The client only gates access with a login and then boots the app.
document.addEventListener("DOMContentLoaded", () => {
  const session = getSession();
  if (session) _postLogin(session);
  // Otherwise loginPage stays visible (default)
});

// ── LOGIN ─────────────────────────────────────────────────────────────
function doLogin() {
  const email = document.getElementById("loginEmail").value.trim().toLowerCase();
  const pwd   = document.getElementById("loginPwd").value.trim();
  const errEl = document.getElementById("loginError");
  errEl.textContent = "";

  const user = getUsers().find(u => u.email.toLowerCase() === email && u.password === pwd);
  if (!user) {
    errEl.textContent = "Invalid email or password.";
    return;
  }

  saveSession(user);
  _postLogin(user);
}

function _postLogin(session) {
  document.getElementById("loginPage").classList.add("hidden");

  // Update topbar avatar
  document.getElementById("userInitials").textContent = session.initials || session.name?.substring(0, 2).toUpperCase() || "U";
  document.getElementById("avatarMenuName").textContent = session.name;
  document.getElementById("avatarMenuRole").textContent = session.role === "admin" ? "Admin" : "Member";

  _bootstrap();
}

// Load organisations from the server (which holds the Zoho credentials) and
// launch. No API keys are ever requested from the user.
async function _bootstrap() {
  try {
    const zohoOrgs = await GEMINI.fetchOrganizations();
    if (!zohoOrgs.length) throw new Error("No Zoho Books organisations found for the connected account.");
    ORGS.length = 0;
    zohoOrgs.forEach(o => ORGS.push(buildOrgFromZoho(o)));
    _launchApp();
  } catch (err) {
    _showNoConfig("Could not connect to Zoho Books: " + err.message);
  }
}

function _launchApp() {
  document.getElementById("app").classList.remove("hidden");
  document.querySelector(".live-dot").classList.add("online");
  document.getElementById("liveText").textContent =
    `Live · ${ORGS.length} org${ORGS.length !== 1 ? "s" : ""} · OpenAI + Zoho Books`;
  APP.init();
}

function _showNoConfig(msg) {
  document.getElementById("app").classList.remove("hidden");
  document.getElementById("liveText").textContent = "Not connected";
  // Show a message in the chat area
  document.getElementById("welcome").innerHTML = `
    <div class="empty-state setup-state">
      <div class="empty-state-icon">HF</div>
      <div class="empty-state-title">Setup required</div>
      <div class="empty-state-copy">
        ${msg || "The server is missing its OpenAI / Zoho Books credentials.<br>An administrator needs to set the OPENAI_API_KEY and ZOHO_* environment variables and redeploy."}
      </div>
    </div>`;
  APP.initShell();
}

// ── LOGOUT ────────────────────────────────────────────────────────────
function doLogout() {
  clearSession();
  document.getElementById("avatarMenu").classList.add("hidden");
  document.getElementById("app").classList.add("hidden");
  document.getElementById("loginPage").classList.remove("hidden");
  document.getElementById("loginEmail").value = "";
  document.getElementById("loginPwd").value   = "";
  document.getElementById("loginError").textContent = "";
  // Reset app state
  ORGS.length = 0;
  APP.messages = [];
  document.querySelector(".live-dot").classList.remove("online");
}

// ── AVATAR DROPDOWN ───────────────────────────────────────────────────
function toggleAvatarMenu() {
  const menu = document.getElementById("avatarMenu");
  menu.classList.toggle("hidden");
  document.getElementById("userAvatar")?.setAttribute("aria-expanded", String(!menu.classList.contains("hidden")));
}

function toggleMobileNav() {
  const side = document.getElementById("sideL");
  const overlay = document.getElementById("mobileOverlay");
  const open = !side.classList.contains("mobile-open");
  side.classList.toggle("mobile-open", open);
  overlay.classList.toggle("visible", open);
  const button = document.getElementById("mobileMenuBtn");
  button?.setAttribute("aria-expanded", String(open));
  button?.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
}

function closeMobileNav() {
  document.getElementById("sideL")?.classList.remove("mobile-open");
  document.getElementById("mobileOverlay")?.classList.remove("visible");
  const button = document.getElementById("mobileMenuBtn");
  button?.setAttribute("aria-expanded", "false");
  button?.setAttribute("aria-label", "Open navigation");
}

// Close dropdown when clicking outside
document.addEventListener("click", e => {
  const wrap = document.getElementById("avatarWrap");
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById("avatarMenu")?.classList.add("hidden");
    document.getElementById("userAvatar")?.setAttribute("aria-expanded", "false");
  }
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    closeMobileNav();
    document.getElementById("avatarMenu")?.classList.add("hidden");
    document.getElementById("userAvatar")?.setAttribute("aria-expanded", "false");
  }
});

// ── MAIN APP OBJECT ───────────────────────────────────────────────────
const APP = {

  currentOrg:  null,
  currentView: "chat",
  messages:    [],
  loading:     false,

  historyItems: [
    { label: "AR aging analysis",        prompt: "Provide a full AR aging analysis with collection risk flags and recommended actions" },
    { label: "Outstanding invoices",     prompt: "Show all outstanding invoices with amounts, due dates and aging buckets" },
    { label: "Overdue vendor bills",     prompt: "List all overdue vendor bills and AP aging analysis" },
    { label: "Cash & bank position",     prompt: "What is our current cash position and bank balances?" },
    { label: "P&L summary",             prompt: "Give me the Profit & Loss summary for the current financial year with margin analysis" },
    { label: "Tax compliance deadlines", prompt: "What are outstanding tax liabilities and upcoming compliance deadlines?" },
  ],

  // Full init (with orgs loaded)
  init() {
    this.populateOrgDropdown();
    if (ORGS.length > 0) this.switchOrg(ORGS[0].id);
    this.buildQuickChips();
    this.buildChatHistory();
    this.buildModGrid();
    const inp = document.getElementById("msgInput");
    const btn = document.getElementById("sendBtn");
    inp.addEventListener("input", () => { btn.disabled = !inp.value.trim() || APP.loading; });
  },

  // Shell init for no-config state (no orgs)
  initShell() {
    this.buildModGrid();
  },

  // ── ORG DROPDOWN ────────────────────────────────────────────────────
  populateOrgDropdown() {
    const sel = document.getElementById("orgSelect");
    sel.innerHTML = "";
    ORGS.forEach(o => {
      const opt = document.createElement("option");
      opt.value       = o.id;
      opt.textContent = `${o.flag} ${o.name}`;
      sel.appendChild(opt);
    });
  },

  async switchOrg(id) {
    this.currentOrg = getOrg(id);
    const org = this.currentOrg;

    document.getElementById("orgFlag").textContent   = org.flag;
    document.getElementById("orgName").textContent   = org.name;
    document.getElementById("orgDetail").textContent = `${org.country} · ${org.type} · FY${new Date().getFullYear()}`;
    document.getElementById("orgTags").innerHTML     = org.tags.map(t => `<span class="org-tag">${t}</span>`).join("");
    document.getElementById("currentOrgLabel").textContent = org.name;
    document.getElementById("welcomeOrg").textContent      = org.name;
    document.getElementById("snapshotLabel").textContent   = `${org.flag} ${org.short} Snapshot`;
    document.getElementById("orgSelect").value = id;

    const badgeInv = document.getElementById("badge-invoices");
    const badgeAp  = document.getElementById("badge-ap");
    badgeInv.textContent = ""; badgeInv.classList.add("hidden");
    badgeAp.textContent  = ""; badgeAp.classList.add("hidden");

    document.getElementById("statCards").innerHTML    = RENDERER.buildStatCards(org);
    this._animateStats();
    document.getElementById("activityFeed").innerHTML =
      `<div class="act-item"><div class="act-dot" style="background:var(--blue-l)"></div>
       <div><div class="act-text">Fetching live data…</div></div></div>`;

    this._refreshSnapshot(org);
  },

  async _refreshSnapshot(org) {
    try {
      const snap = await GEMINI.fetchOrgSnapshot(org.zohoOrgId);
      const sym  = org.currencySymbol;
      const fmt  = n => {
        if (n >= 1_000_000) return sym + " " + (n / 1_000_000).toFixed(2) + "M";
        if (n >= 1_000)     return sym + " " + (n / 1_000).toFixed(1) + "K";
        return sym + " " + n.toFixed(2);
      };

      org.snapshot = {
        ar:          fmt(snap.arTotal),
        ap:          fmt(snap.apTotal),
        cash:        fmt(snap.cashTotal),
        revenue:     "—",
        arNote:      `${snap.arCount} invoice${snap.arCount !== 1 ? "s" : ""}` + (snap.arOverdue ? ` · ${snap.arOverdue} overdue` : " · all current"),
        apNote:      `${snap.apCount} bill${snap.apCount !== 1 ? "s" : ""}` + (snap.apOverdue ? ` · ${snap.apOverdue} overdue` : " · all current"),
        cashNote:    "↑ Live balance",
        revenueNote: "Use AI chat",
      };

      if (this.currentOrg.id === org.id) {
        document.getElementById("statCards").innerHTML = RENDERER.buildStatCards(org);
        this._animateStats();

        const t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        document.getElementById("activityFeed").innerHTML = [
          snap.arOverdue ? `<div class="act-item"><div class="act-dot" style="background:var(--red)"></div><div><div class="act-text">${snap.arOverdue} invoice${snap.arOverdue > 1 ? "s" : ""} overdue</div><div class="act-time">AR · ${org.currency}</div></div></div>` : "",
          snap.apOverdue ? `<div class="act-item"><div class="act-dot" style="background:var(--amber)"></div><div><div class="act-text">${snap.apOverdue} vendor bill${snap.apOverdue > 1 ? "s" : ""} overdue</div><div class="act-time">AP · ${org.currency}</div></div></div>` : "",
          `<div class="act-item"><div class="act-dot" style="background:var(--green)"></div><div><div class="act-text">Snapshot refreshed</div><div class="act-time">Live · ${t}</div></div></div>`,
        ].filter(Boolean).join("") ||
          `<div class="act-item"><div class="act-dot" style="background:var(--green)"></div><div><div class="act-text">All clear</div><div class="act-time">No overdue items</div></div></div>`;

        if (snap.arCount > 0) _badgeSet("badge-invoices", snap.arCount, false);
        if (snap.apOverdue > 0) _badgeSet("badge-ap", snap.apOverdue, true);
      }
    } catch (err) {
      console.error("Snapshot error:", err);
      if (this.currentOrg.id === org.id) {
        document.getElementById("activityFeed").innerHTML =
          `<div class="act-item"><div class="act-dot" style="background:var(--red)"></div>
           <div><div class="act-text" style="color:var(--red)">⚠ ${err.message}</div></div></div>`;
      }
    }
  },

  // ── NAVIGATION ──────────────────────────────────────────────────────
  switchView(view, el) {
    closeMobileNav();
    this.currentView = view;
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    if (el) el.classList.add("active");
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active-view"));
    const target = document.getElementById(`view-${view}`);
    if (target) target.classList.add("active-view");
    if (view !== "chat") this.loadModuleView(view);
  },

  async loadModuleView(view) {
    const org  = this.currentOrg;
    const body = document.getElementById(`${view}-body`);
    const sub  = document.getElementById(`${view}-sub`);
    if (!body) return;

    if (!org) {
      body.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">HF</div>
          <div class="empty-state-title">Connect Zoho Books</div>
          <div class="empty-state-copy">Live module data will appear here after the server credentials are configured.</div>
        </div>`;
      return;
    }

    body.innerHTML = `<div class="view-loading">Fetching live data from Zoho Books…</div>`;
    if (sub) sub.textContent = `${org.name} · ${org.currency} · Live`;

    if (["reports","intercompany","tax"].includes(view)) {
      const prompts = {
        reports:      "Generate a full financial report with P&L, Balance Sheet and Cash Flow commentary",
        intercompany: "Show all intercompany balances, FX translation and elimination entries required",
        tax:          "What are outstanding tax liabilities, upcoming filing deadlines and tax provisions?",
      };
      body.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">AI</div>
          <div class="empty-state-title">Ask AI for live analysis</div>
          <div class="empty-state-copy">
            This module queries your live Zoho Books data via AI. Run it for a full analysis.
          </div>
          <button class="view-btn" onclick="APP.askQuick('${prompts[view]}')">
            Get live ${view.charAt(0).toUpperCase() + view.slice(1)} analysis
          </button>
        </div>`;
      return;
    }

    try {
      const data = await GEMINI.fetchModuleData(view, org.zohoOrgId);
      body.innerHTML = RENDERER.buildLiveViewData(view, data, org);
    } catch (err) {
      body.innerHTML = `
        <div class="view-loading" style="color:var(--red)">
          ${err.message}<br>
          <small style="color:var(--muted);display:block;margin-top:6px">Check the server connection or contact an administrator.</small>
        </div>`;
    }
  },

  // ── CHAT ────────────────────────────────────────────────────────────
  newChat() {
    this.messages = [];
    document.getElementById("messages").innerHTML = "";
    document.getElementById("welcome").style.display = "";
    this.switchView("chat", document.querySelector(".nav-item[data-view='chat']"));
  },

  buildQuickChips() {
    document.getElementById("quickChips").innerHTML = QUICK_PROMPTS.map(q =>
      `<button type="button" class="chip" onclick="APP.askQuick('${q.prompt.replace(/'/g,"\\'")}')">${q.label}</button>`
    ).join("");
  },

  buildChatHistory() {
    document.getElementById("chatHistory").innerHTML = this.historyItems.map((h, i) =>
      `<button type="button" class="hist-item ${i===0?"recent":""}" onclick="APP.askQuick('${h.prompt.replace(/'/g,"\\'")}')">
        ${h.label}</button>`
    ).join("");
  },

  buildModGrid() {
    document.getElementById("modGrid").innerHTML = RENDERER.buildModGrid();
  },

  // Count-up on the right-sidebar stat values. Parses "RM 1.2M" / "RM 2,345.00"
  // into prefix + number + suffix and eases from 0 to the target (~480ms).
  _animateStats() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.querySelectorAll("#statCards .stat-val").forEach(el => {
      const raw = el.textContent.trim();
      const m = raw.match(/^(\D*?)([\d,]+(?:\.\d+)?)(\D*)$/);
      if (!m) return;
      const [, pre, numStr, suf] = m;
      const target = parseFloat(numStr.replace(/,/g, ""));
      if (!isFinite(target)) return;
      const decimals = (numStr.split(".")[1] || "").length;
      const dur = 480, t0 = performance.now();
      const step = now => {
        const p = Math.min((now - t0) / dur, 1);
        const v = target * (1 - Math.pow(1 - p, 3));
        el.textContent = pre + v.toLocaleString("en", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suf;
        if (p < 1) requestAnimationFrame(step);
      };
      el.textContent = pre + (0).toLocaleString("en", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suf;
      requestAnimationFrame(step);
    });
  },

  askQuick(prompt) {
    document.getElementById("msgInput").value = prompt;
    document.getElementById("sendBtn").disabled = false;
    this.switchView("chat", document.querySelector(".nav-item[data-view='chat']"));
    this.sendMessage();
  },

  handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
  },

  autoResize(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 130) + "px";
  },

  ts() { return new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }); },

  // ── SEND MESSAGE ────────────────────────────────────────────────────
  async sendMessage() {
    const input = document.getElementById("msgInput");
    const q = input.value.trim();
    if (!q || this.loading) return;

    this.loading = true;
    input.value  = "";
    input.style.height = "auto";
    document.getElementById("sendBtn").disabled = true;
    document.getElementById("welcome").style.display = "none";

    const msgs = document.getElementById("messages");
    const session = getSession();
    const initials = session?.initials || "U";

    msgs.innerHTML += `
      <div class="msg user-msg">
        <div class="msg-av user-av">${initials}</div>
        <div class="msg-wrap">
          <div class="bubble user-bubble">${this._escHtml(q)}</div>
          <div class="msg-meta" style="text-align:right">${session?.name || "You"} · ${this.ts()}</div>
        </div>
      </div>`;

    const typingId = "typing-" + Date.now();
    msgs.innerHTML += `
      <div class="msg" id="${typingId}">
        <div class="msg-av ai-av">HF</div>
        <div class="msg-wrap">
          <div class="bubble ai-bubble">
            <div class="typing-dots"><div class="td"></div><div class="td"></div><div class="td"></div></div>
          </div>
        </div>
      </div>`;
    this._scrollBottom();

    try {
      const result = await GEMINI.query(q, this.currentOrg, this.messages);
      document.getElementById(typingId)?.remove();
      msgs.innerHTML += `
        <div class="msg">
          <div class="msg-av ai-av">HF</div>
          <div class="msg-wrap">
            ${RENDERER.renderAIResponse(result)}
            <div class="msg-meta">HexaFin.AI · ${this.currentOrg.name} · ${this.ts()}</div>
          </div>
        </div>`;
      this.messages.push({ role:"user", content:q });
      // Strip HTML tags for the history so the AI receives plain text context
      this.messages.push({ role:"ai", content: (result.html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() });
    } catch (err) {
      document.getElementById(typingId)?.remove();
      msgs.innerHTML += `
        <div class="msg">
          <div class="msg-av ai-av">HF</div>
          <div class="msg-wrap">
            <div class="bubble ai-bubble">
              <strong>Error</strong><br>${this._escHtml(err.message)}<br>
              <small style="color:var(--muted)">Check the server connection or contact an administrator.</small>
            </div>
            <div class="msg-meta">HexaFin.AI · ${this.ts()}</div>
          </div>
        </div>`;
    }

    this.loading = false;
    document.getElementById("sendBtn").disabled = !document.getElementById("msgInput").value.trim();
    this._scrollBottom();
  },

  _scrollBottom() { const a=document.getElementById("chatArea"); if(a) a.scrollTop=a.scrollHeight; },
  _escHtml(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); },
};

// ── BADGE HELPER ──────────────────────────────────────────────────────
function _badgeSet(id, count, red) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = count;
  el.classList.remove("hidden");
  if (red) el.className = "nav-badge red";
}
