// ── renderer.js — Response & View Renderer ────────────────────────────

const RENDERER = {

  // ── RENDER AI MESSAGE ──────────────────────────────────────────────
  renderAIResponse(result) {
    let html = `<div class="bubble ai-bubble">`;
    html += result.html || "";

    if (result.accountingNote) {
      html += `<div class="src-tag" style="margin-top:10px;display:block;border-radius:6px;padding:8px 10px;line-height:1.5">
        <strong style="color:#C084FC">📚 Accounting Note:</strong><br>${result.accountingNote}
      </div>`;
    }

    if (result.tableRows && result.tableRows.length > 0) {
      html += RENDERER.buildTable(result.tableTitle || "Data", result.tableRows);
    }

    if (result.alerts && result.alerts.length > 0) {
      result.alerts.forEach(alert => {
        const isRed = /overdue|risk|error|urgent/i.test(alert);
        html += `<div class="alert-box ${isRed ? "alert-red" : ""}">${alert}</div>`;
      });
    }

    html += `<div class="src-tag">🔗 Live · Zoho Books · OpenAI GPT-4o</div>`;
    html += `</div>`;
    return html;
  },

  // ── BUILD DATA TABLE (in chat bubble) ─────────────────────────────
  buildTable(title, rows) {
    if (!rows || !rows.length) return "";
    const headers = Object.keys(rows[0]);

    let html = `<div class="dt-wrap">
      <div class="dt-head">${title}</div>
      <div class="dt-scroll">
        <table class="dt">
          <thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
          <tbody>`;

    rows.forEach(row => {
      html += `<tr>`;
      headers.forEach(h => {
        const val = row[h] ?? "";
        html += `<td class="${RENDERER._cellClass(h, val)}">${val}</td>`;
      });
      html += `</tr>`;
    });

    html += `</tbody></table></div></div>`;
    return html;
  },

  // ── CELL COLOUR CLASS ──────────────────────────────────────────────
  _cellClass(header, value) {
    const h = header.toLowerCase();
    const v = String(value).toLowerCase();

    if (v === "overdue")   return "status-overdue";
    if (v === "paid")      return "status-paid";
    if (v === "pending")   return "status-pending";
    if (v === "draft")     return "status-draft";
    if (v === "sent")      return "status-sent";
    if (v === "current")   return "status-sent";
    if (v === "cleared")   return "status-paid";
    if (v === "scheduled") return "status-pending";
    if (v === "yes")       return "td-pos";
    if (v === "no")        return "td-warn";

    if (h.includes("amount") || h.includes("total") || h.includes("balance") || h.includes("value")) {
      if (String(value).startsWith("+")) return "td-pos";
      if (String(value).startsWith("-")) return "td-neg";
      return "td-amt";
    }
    if (h.includes("vs") || h.includes("variance") || h.includes("change")) {
      if (String(value).startsWith("+")) return "td-pos";
      if (String(value).startsWith("-")) return "td-neg";
    }
    if ((h.includes("days") || h.includes("overdue")) && parseInt(value) > 30) return "td-neg";
    return "";
  },

  // ── LIVE VIEW DATA (module views — real Zoho data) ─────────────────
  buildLiveViewData(view, data, org) {
    if (!data) return `<div class="view-loading">Ask the AI for live analysis →</div>`;

    const sym   = org.currencySymbol;
    const cur   = org.currency;
    const today = new Date();

    switch (view) {

      case "invoices": {
        const invoices = data.invoices || [];
        if (!invoices.length) return `<div class="view-loading">No unpaid invoices found in Zoho Books.</div>`;

        let arTotal = 0, overdueCount = 0, maxBal = 0;
        invoices.forEach(i => {
          const bal = i.balance || 0;
          arTotal += bal;
          if (new Date(i.due_date) < today) overdueCount++;
          if (bal > maxBal) maxBal = bal;
        });
        const avgDso = this._avgDays(invoices, "due_date");

        const summary = [
          { label: "Total AR",        value: this._fmt(arTotal, sym), sub: `${invoices.length} unpaid invoice${invoices.length !== 1 ? "s" : ""}`, cls: "gold"  },
          { label: "Overdue",         value: overdueCount,            sub: "past due date",      cls: overdueCount ? "amber" : "pos" },
          { label: "Avg Days Due",    value: Math.max(avgDso, 0) + "d", sub: avgDso > 0 ? "past due" : "still pending", cls: avgDso > 30 ? "warn" : "" },
          { label: "Largest Invoice", value: this._fmt(maxBal, sym),  sub: "single balance",     cls: "" },
        ];

        const rows = invoices.map(i => {
          const daysOverdue = this._daysOverdue(i.due_date);
          return {
            "#":        i.invoice_number || "—",
            "Customer": i.customer_name  || "—",
            "Amount":   this._fmt(i.balance || 0, sym),
            "Issued":   i.date           || "—",
            "Due":      i.due_date       || "—",
            "Overdue":  daysOverdue > 0 ? daysOverdue + "d" : "—",
            "Status":   daysOverdue > 0 ? "Overdue" : (i.status === "sent" ? "Sent" : "Pending"),
          };
        });

        return this.buildSummaryCards(summary) +
               this.buildViewTable(`Outstanding Invoices — ${org.name}`, cur, rows);
      }

      case "ap": {
        const bills = data.bills || [];
        if (!bills.length) return `<div class="view-loading">No unpaid bills found in Zoho Books.</div>`;

        let apTotal = 0, overdueCount = 0;
        bills.forEach(b => {
          apTotal += (b.balance || 0);
          if (new Date(b.due_date) < today) overdueCount++;
        });

        const summary = [
          { label: "Total AP",   value: this._fmt(apTotal, sym), sub: `${bills.length} unpaid bill${bills.length !== 1 ? "s" : ""}`, cls: "amber" },
          { label: "Overdue",    value: overdueCount,            sub: "past due date", cls: overdueCount ? "red" : "pos" },
        ];

        const rows = bills.map(b => {
          const daysOverdue = this._daysOverdue(b.due_date);
          return {
            "Bill #":    b.bill_number || "—",
            "Vendor":    b.vendor_name || "—",
            "Amount":    this._fmt(b.balance || 0, sym),
            "Bill Date": b.date        || "—",
            "Due":       b.due_date    || "—",
            "Overdue":   daysOverdue > 0 ? daysOverdue + "d" : "—",
            "Status":    daysOverdue > 0 ? "Overdue" : "Pending",
          };
        });

        return this.buildSummaryCards(summary) +
               this.buildViewTable(`Unpaid Vendor Bills — ${org.name}`, cur, rows);
      }

      case "payments": {
        const payments = data.customerpayments || [];
        if (!payments.length) return `<div class="view-loading">No customer payments found in Zoho Books.</div>`;

        let total = 0;
        payments.forEach(p => total += (p.amount || 0));

        const summary = [
          { label: "Total Received", value: this._fmt(total, sym), sub: `${payments.length} payment${payments.length !== 1 ? "s" : ""}`, cls: "green" },
        ];

        const rows = payments.map(p => ({
          "Ref":      p.payment_number || p.payment_id?.substring(0, 10) || "—",
          "Customer": p.customer_name  || "—",
          "Amount":   this._fmt(p.amount || 0, sym),
          "Date":     p.date           || "—",
          "Mode":     p.payment_mode   || "—",
          "Unused":   p.unused_amount > 0 ? this._fmt(p.unused_amount, sym) : "—",
          "Status":   "Cleared",
        }));

        return this.buildSummaryCards(summary) +
               this.buildViewTable(`Customer Payments — ${org.name}`, cur, rows);
      }

      case "expenses": {
        const expenses = data.expenses || [];
        if (!expenses.length) return `<div class="view-loading">No expenses found in Zoho Books.</div>`;

        let total = 0;
        expenses.forEach(e => total += (e.total || 0));

        const summary = [
          { label: "Total Expenses", value: this._fmt(total, sym), sub: `${expenses.length} expense${expenses.length !== 1 ? "s" : ""}`, cls: "" },
        ];

        const rows = expenses.map(e => ({
          "Category": e.account_name              || "—",
          "Vendor":   e.vendor_name               || e.paid_through_account_name || "—",
          "Amount":   this._fmt(e.total || 0, sym),
          "Date":     e.date                      || "—",
          "Paid Via": e.paid_through_account_name || "—",
          "Status":   e.is_billable               ? "Billable" : "Expensed",
        }));

        return this.buildSummaryCards(summary) +
               this.buildViewTable(`Expenses — ${org.name}`, cur, rows);
      }

      default:
        return `<div class="view-loading">Ask the AI for live data from Zoho Books →</div>`;
    }
  },

  // ── VIEW SUMMARY CARDS ─────────────────────────────────────────────
  buildSummaryCards(items) {
    let html = `<div class="summary-grid">`;
    items.forEach(item => {
      html += `<div class="summary-card">
        <div class="summary-lbl">${item.label}</div>
        <div class="summary-val">${item.value}</div>
        <div class="summary-sub ${item.cls || ""}">${item.sub || ""}</div>
      </div>`;
    });
    html += `</div>`;
    return html;
  },

  // ── VIEW TABLE ─────────────────────────────────────────────────────
  buildViewTable(title, badge, rows) {
    if (!rows || !rows.length) return `<div class="view-loading">No data available.</div>`;
    const headers = Object.keys(rows[0]);

    let html = `<div class="vt-wrap">
      <div class="vt-head">
        <span class="vt-head-title">${title}</span>
        ${badge ? `<span class="vt-head-badge">${badge}</span>` : ""}
      </div>
      <div class="dt-scroll">
        <table class="vt">
          <thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
          <tbody>`;

    rows.forEach(row => {
      html += `<tr>`;
      headers.forEach(h => {
        const val = row[h] ?? "";
        const v   = String(val).toLowerCase();
        const cell = ["paid","overdue","pending","draft","sent","current","cleared","scheduled","billable","expensed"].includes(v)
          ? `<span class="status-pill status-${v}">${val}</span>`
          : val;
        html += `<td class="${RENDERER._cellClass(h, val)}">${cell}</td>`;
      });
      html += `</tr>`;
    });

    html += `</tbody></table></div></div>`;
    return html;
  },

  // ── STAT CARDS (right sidebar) ────────────────────────────────────
  buildStatCards(org) {
    const s = org.snapshot;
    return [
      { label: "Accounts Receivable", value: s.ar,      sub: s.arNote,      cls: "gold"  },
      { label: "Accounts Payable",    value: s.ap,      sub: s.apNote,      cls: "amber" },
      { label: "Cash Position",       value: s.cash,    sub: s.cashNote,    cls: "green" },
      { label: "Revenue (AI Query)",  value: s.revenue, sub: s.revenueNote, cls: ""      },
    ].map(c => `
      <div class="stat-card">
        <div class="stat-lbl">${c.label}</div>
        <div class="stat-val">${c.value}</div>
        <div class="stat-sub ${c.cls}">${c.sub}</div>
      </div>`).join("");
  },

  // ── ACTIVITY FEED ─────────────────────────────────────────────────
  buildActivityFeed(org) {
    if (!org.activity || !org.activity.length) {
      return `<div class="act-item"><div class="act-text" style="color:var(--muted)">No recent activity</div></div>`;
    }
    return org.activity.map(a => `
      <div class="act-item">
        <div class="act-dot" style="background:${a.color}"></div>
        <div>
          <div class="act-text">${a.text}</div>
          <div class="act-time">${a.time}</div>
        </div>
      </div>`).join("");
  },

  // ── MODULE GRID (right sidebar) ───────────────────────────────────
  buildModGrid() {
    return [
      { icon: "🧾", label: "Invoices",      prompt: "Show all outstanding invoices with aging and collection risk flags" },
      { icon: "💳", label: "Payments",      prompt: "Summarize all customer payments received in the last 30 days" },
      { icon: "📋", label: "Expenses",      prompt: "Expense breakdown by category this month with variance analysis" },
      { icon: "📊", label: "P&L",           prompt: "P&L summary for the current financial year with margin analysis" },
      { icon: "📑", label: "Balance Sheet", prompt: "Current Balance Sheet with key ratios and commentary" },
      { icon: "⏱️", label: "AR Aging",      prompt: "AR aging analysis with 0-30, 30-60, 60-90, 90+ day buckets" },
      { icon: "🏦", label: "Cash Flow",     prompt: "Current cash flow position, bank balances and free cash flow" },
      { icon: "🔗", label: "Intercompany",  prompt: "Intercompany balances, FX translation and elimination entries" },
    ].map(m => `
      <div class="mod-btn" onclick="APP.askQuick('${m.prompt}')">
        <span class="mod-icon">${m.icon}</span>${m.label}
      </div>`).join("");
  },

  // ── HELPERS ───────────────────────────────────────────────────────
  _fmt(n, sym) {
    const absN = Math.abs(n);
    let val;
    if (absN >= 1_000_000) val = (n / 1_000_000).toFixed(2) + "M";
    else if (absN >= 1_000) val = (n / 1_000).toFixed(1) + "K";
    else val = n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return sym + " " + val;
  },

  _daysOverdue(dateStr) {
    if (!dateStr) return 0;
    const diff = Math.round((new Date() - new Date(dateStr)) / 86_400_000);
    return diff > 0 ? diff : 0;
  },

  _avgDays(items, field) {
    if (!items.length) return 0;
    return Math.round(items.reduce((s, i) => s + this._daysOverdue(i[field]), 0) / items.length);
  },
};
