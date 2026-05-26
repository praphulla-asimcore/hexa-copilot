// ── app.js — Hexa CoPilot Main Application Controller ─────────────────

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

  // ── INIT ──────────────────────────────────────────────────────────────
  init() {
    this.populateOrgDropdown();
    if (ORGS.length > 0) this.switchOrg(ORGS[0].id);
    this.buildQuickChips();
    this.buildChatHistory();
    this.buildModGrid();
    this.startParticles();

    const inp = document.getElementById("msgInput");
    const btn = document.getElementById("sendBtn");
    inp.addEventListener("input", () => { btn.disabled = !inp.value.trim() || APP.loading; });
  },

  // ── ORG DROPDOWN ──────────────────────────────────────────────────────
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

    // Clear badge counts
    const badgeInv = document.getElementById("badge-invoices");
    const badgeAp  = document.getElementById("badge-ap");
    badgeInv.textContent = "";
    badgeInv.style.display = "none";
    badgeAp.textContent = "";
    badgeAp.style.display = "none";

    // Show placeholder stats and fetch real snapshot
    document.getElementById("statCards").innerHTML    = RENDERER.buildStatCards(org);
    document.getElementById("activityFeed").innerHTML =
      `<div class="act-item"><div class="act-dot" style="background:#60A5FA"></div>
       <div><div class="act-text">Fetching live data…</div></div></div>`;

    this._refreshSnapshot(org);
  },

  // ── REAL-TIME SNAPSHOT REFRESH ────────────────────────────────────────
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
        arNote:      `${snap.arCount} invoice${snap.arCount !== 1 ? "s" : ""}` +
                     (snap.arOverdue ? ` · ${snap.arOverdue} overdue` : " · all current"),
        apNote:      `${snap.apCount} bill${snap.apCount !== 1 ? "s" : ""}` +
                     (snap.apOverdue ? ` · ${snap.apOverdue} overdue` : " · all current"),
        cashNote:    "↑ Live balance",
        revenueNote: "Use AI chat",
      };

      // Only update DOM if this org is still active
      if (this.currentOrg.id === org.id) {
        document.getElementById("statCards").innerHTML = RENDERER.buildStatCards(org);

        const lastAct = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        document.getElementById("activityFeed").innerHTML = [
          snap.arOverdue ? `<div class="act-item"><div class="act-dot" style="background:#F87171"></div><div><div class="act-text">${snap.arOverdue} invoice${snap.arOverdue > 1 ? "s" : ""} overdue</div><div class="act-time">AR · ${org.currency}</div></div></div>` : "",
          snap.apOverdue ? `<div class="act-item"><div class="act-dot" style="background:#FBBF24"></div><div><div class="act-text">${snap.apOverdue} vendor bill${snap.apOverdue > 1 ? "s" : ""} overdue</div><div class="act-time">AP · ${org.currency}</div></div></div>` : "",
          `<div class="act-item"><div class="act-dot" style="background:#4ADE80"></div><div><div class="act-text">Snapshot refreshed</div><div class="act-time">Live · ${lastAct}</div></div></div>`,
        ].filter(Boolean).join("") || `<div class="act-item"><div class="act-dot" style="background:#4ADE80"></div><div><div class="act-text">All clear</div><div class="act-time">No overdue items</div></div></div>`;

        if (snap.arCount > 0) {
          badgeset("badge-invoices", snap.arCount);
        }
        if (snap.apOverdue > 0) {
          badgeset("badge-ap", snap.apOverdue, true);
        }
      }
    } catch (err) {
      console.error("Snapshot error:", err);
      if (this.currentOrg.id === org.id) {
        document.getElementById("activityFeed").innerHTML =
          `<div class="act-item"><div class="act-dot" style="background:#F87171"></div>
           <div><div class="act-text" style="color:#F87171">⚠ ${err.message}</div></div></div>`;
      }
    }
  },

  // ── NAVIGATION ────────────────────────────────────────────────────────
  switchView(view, el) {
    this.currentView = view;
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    if (el) el.classList.add("active");
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active-view"));
    const target = document.getElementById(`view-${view}`);
    if (target) target.classList.add("active-view");
    if (view !== "chat") this.loadModuleView(view);
  },

  // ── MODULE VIEWS — LIVE DATA ──────────────────────────────────────────
  async loadModuleView(view) {
    const org  = this.currentOrg;
    const body = document.getElementById(`${view}-body`);
    const sub  = document.getElementById(`${view}-sub`);
    if (!body) return;

    body.innerHTML = `<div class="view-loading">⏳ Fetching live data from Zoho Books…</div>`;
    if (sub) sub.textContent = `${org.name} · ${org.currency} · Live · Zoho Books`;

    // Views that don't have a simple list endpoint — direct to AI
    if (["reports", "intercompany", "tax"].includes(view)) {
      const prompts = {
        reports:      "Generate a full financial report with P&L, Balance Sheet and Cash Flow commentary",
        intercompany: "Show all intercompany balances, FX translation and elimination entries required",
        tax:          "What are outstanding tax liabilities, upcoming filing deadlines and tax provisions?",
      };
      body.innerHTML = `
        <div style="text-align:center;padding:40px 20px">
          <div style="font-size:32px;margin-bottom:14px">🤖</div>
          <div style="font-family:'Syne',sans-serif;font-size:16px;font-weight:700;color:var(--text);margin-bottom:8px">Ask AI for Live Analysis</div>
          <div style="font-size:13px;color:var(--muted);margin-bottom:20px;line-height:1.7">
            This module queries Zoho Books and your financial data in real time via AI.<br>Click below to get a full live analysis.
          </div>
          <button class="view-btn" onclick="APP.askQuick('${prompts[view]}')">
            Get Live ${view.charAt(0).toUpperCase() + view.slice(1)} Analysis →
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
          ⚠ ${err.message}<br>
          <small style="color:var(--muted);display:block;margin-top:6px">Check your Zoho token and org permissions.</small>
        </div>`;
    }
  },

  // ── CHAT ──────────────────────────────────────────────────────────────
  newChat() {
    this.messages = [];
    document.getElementById("messages").innerHTML = "";
    document.getElementById("welcome").style.display = "";
    this.switchView("chat", document.querySelector(".nav-item[data-view='chat']"));
  },

  buildQuickChips() {
    const el = document.getElementById("quickChips");
    el.innerHTML = QUICK_PROMPTS.map(q =>
      `<div class="chip" onclick="APP.askQuick('${q.prompt.replace(/'/g, "\\'")}')">${q.label}</div>`
    ).join("");
  },

  buildChatHistory() {
    const el = document.getElementById("chatHistory");
    el.innerHTML = this.historyItems.map((h, i) =>
      `<div class="hist-item ${i === 0 ? "recent" : ""}" onclick="APP.askQuick('${h.prompt.replace(/'/g, "\\'")}')">${h.label}</div>`
    ).join("");
  },

  buildModGrid() {
    document.getElementById("modGrid").innerHTML = RENDERER.buildModGrid();
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

  ts() { return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); },

  // ── SEND MESSAGE ──────────────────────────────────────────────────────
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

    msgs.innerHTML += `
      <div class="msg user-msg">
        <div class="msg-av user-av">AS</div>
        <div class="msg-wrap">
          <div class="bubble user-bubble">${this._escHtml(q)}</div>
          <div class="msg-meta" style="text-align:right">You · ${this.ts()}</div>
        </div>
      </div>`;

    const typingId = "typing-" + Date.now();
    msgs.innerHTML += `
      <div class="msg" id="${typingId}">
        <div class="msg-av ai-av">HC</div>
        <div class="msg-wrap">
          <div class="bubble ai-bubble">
            <div class="typing-dots"><div class="td"></div><div class="td"></div><div class="td"></div></div>
          </div>
        </div>
      </div>`;
    this._scrollBottom();

    try {
      const result = await GEMINI.query(q, this.currentOrg);
      document.getElementById(typingId)?.remove();

      msgs.innerHTML += `
        <div class="msg">
          <div class="msg-av ai-av">HC</div>
          <div class="msg-wrap">
            ${RENDERER.renderAIResponse(result)}
            <div class="msg-meta">Hexa CoPilot · ${this.currentOrg.name} · ${this.ts()}</div>
          </div>
        </div>`;

      this.messages.push({ role: "user", content: q });
      this.messages.push({ role: "ai",   content: result.html });

    } catch (err) {
      document.getElementById(typingId)?.remove();
      msgs.innerHTML += `
        <div class="msg">
          <div class="msg-av ai-av">HC</div>
          <div class="msg-wrap">
            <div class="bubble ai-bubble">
              <strong>Error</strong><br>${this._escHtml(err.message)}<br>
              <small style="color:var(--muted)">Check your API keys or Zoho token.</small>
            </div>
            <div class="msg-meta">Hexa CoPilot · ${this.ts()}</div>
          </div>
        </div>`;
    }

    this.loading = false;
    document.getElementById("sendBtn").disabled = !document.getElementById("msgInput").value.trim();
    this._scrollBottom();
  },

  _scrollBottom() {
    const a = document.getElementById("chatArea");
    if (a) a.scrollTop = a.scrollHeight;
  },

  _escHtml(s) {
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  },

  // ── PARTICLE BACKGROUND ───────────────────────────────────────────────
  startParticles() {
    const canvas = document.getElementById("bg-particles");
    if (!canvas) return;
    const ctx   = canvas.getContext("2d");
    const parts  = [];
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);
    for (let i = 0; i < 40; i++) {
      parts.push({
        x: Math.random() * window.innerWidth,  y: Math.random() * window.innerHeight,
        r: Math.random() * 1.5 + 0.5,
        dx: (Math.random() - 0.5) * 0.3,      dy: (Math.random() - 0.5) * 0.3,
        o: Math.random() * 0.4 + 0.1,
        c: Math.random() > 0.5 ? "#FF2D8B" : "#2B5FF5",
      });
    }
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      parts.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.c;
        ctx.globalAlpha = p.o;
        ctx.fill();
        p.x += p.dx; p.y += p.dy;
        if (p.x < 0 || p.x > canvas.width)  p.dx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.dy *= -1;
      });
      requestAnimationFrame(draw);
    };
    draw();
  }
};

// ── BADGE HELPER ────────────────────────────────────────────────────────
function badgeset(id, count, red = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = count;
  el.style.display = "inline";
  if (red) el.className = "nav-badge red";
}

// ── MODAL — CONNECT ─────────────────────────────────────────────────────
async function connectAPIs() {
  const openaiKey  = document.getElementById("openaiKey").value.trim();
  const zohoToken  = document.getElementById("zohoToken").value.trim();
  const zohoRegion = document.getElementById("zohoRegion").value;

  if (!openaiKey.startsWith("sk-")) {
    alert("Please enter a valid OpenAI API key (starts with sk-...).");
    return;
  }
  if (!zohoToken) {
    alert("Please enter your Zoho Books access token.");
    return;
  }

  const btn = document.getElementById("connectBtn");
  btn.textContent = "Connecting…";
  btn.disabled    = true;

  try {
    GEMINI.init(openaiKey, zohoToken, zohoRegion);

    const zohoOrgs = await GEMINI.fetchOrganizations();
    if (!zohoOrgs.length) throw new Error("No Zoho Books organisations found for this token. Check scope: ZohoBooks.fullaccess.all");

    // Populate ORGS from live Zoho data
    ORGS.length = 0;
    zohoOrgs.forEach(o => ORGS.push(buildOrgFromZoho(o)));

    document.getElementById("apiModal").style.display = "none";
    document.getElementById("app").classList.remove("hidden");
    document.querySelector(".live-dot").classList.add("online");
    document.getElementById("liveText").textContent =
      `Live · ${ORGS.length} org${ORGS.length !== 1 ? "s" : ""} · OpenAI + Zoho Books`;

    APP.init();
  } catch (err) {
    alert("Connection failed:\n" + err.message);
    btn.textContent = "Connect & Launch →";
    btn.disabled    = false;
  }
}

// ── MODAL — OAUTH FLOW ──────────────────────────────────────────────────
async function startOAuthFlow() {
  const clientId     = document.getElementById("zohoClientId").value.trim();
  const clientSecret = document.getElementById("zohoClientSecret").value.trim();
  const zohoRegion   = document.getElementById("zohoRegion").value;

  if (!clientId) { alert("Please enter your Zoho Client ID."); return; }

  GEMINI.zohoRegion = zohoRegion;
  await GEMINI.startOAuth(clientId, clientSecret);
}

// ── MODAL — TAB SWITCH ──────────────────────────────────────────────────
function switchModalTab(tab, el) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  el.classList.add("active");
  document.getElementById("tab-token").style.display = tab === "token" ? "" : "none";
  document.getElementById("tab-oauth").style.display = tab === "oauth" ? "" : "none";
}

// ── SETTINGS ────────────────────────────────────────────────────────────
function showSettings() {
  const key = prompt("Update OpenAI API Key (leave blank to keep current):");
  if (key && key.startsWith("sk-")) {
    GEMINI.openaiKey = key;
    alert("OpenAI API key updated.");
  }
}

// ── OAUTH CALLBACK HANDLER ───────────────────────────────────────────────
(async function handleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code   = params.get("code");
  if (!code) return;

  window.history.replaceState({}, "", window.location.pathname);

  const savedOpenAI = sessionStorage.getItem("zoho_pending_openai") || "";
  sessionStorage.removeItem("zoho_pending_openai");

  const statusEl = document.getElementById("oauthStatus");

  try {
    const token = await GEMINI.exchangeCodeForToken(code);
    const region = sessionStorage.getItem("zoho_region") || "com";

    document.getElementById("zohoToken").value   = token;
    document.getElementById("zohoRegion").value  = region;
    if (savedOpenAI) document.getElementById("openaiKey").value = savedOpenAI;

    // Switch to token tab so user can see the pre-filled token
    switchModalTab("token", document.querySelector(".tab-btn"));

    if (statusEl) {
      statusEl.textContent = "✓ Zoho authorized. Token filled in. Click Connect & Launch →";
      statusEl.style.color = "#4ADE80";
    }
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = "OAuth failed: " + err.message;
      statusEl.style.color = "#F87171";
    }
    switchModalTab("oauth", document.querySelectorAll(".tab-btn")[1]);
  }
})();
