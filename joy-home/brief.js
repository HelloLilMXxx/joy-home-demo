/* Joy Home daily brief (desk mode). Renders Now / Attention / Today / Quick actions
   from cached state instantly, then refreshes live in the background. */
(function () {
  const root = document.getElementById("joyBrief");
  if (!root) return;
  const DISMISSED_MAIL_KEY = "joyHomeDismissedMail";

  if (!window.joyHomeTranscript) {
    // Fallback if app.js hasn't loaded; mirrors its two-turn conversation panel.
    let homeTranscriptHideTimer = null;
    window.joyHomeTranscript = {
      set(title, text, opts = {}) {
        const panel = document.querySelector(".home-transcript-panel");
        if (!panel) return;
        const clean = String(text || "").trim();
        const isJoy = title === "Joy";
        const row = document.getElementById(isJoy ? "htTurnJoy" : "htTurnYou");
        const body = document.getElementById(isJoy ? "htTextJoy" : "htTextYou");
        if (!row || !body) return;
        body.textContent = clean.length > 900 ? clean.slice(0, 897) + "..." : clean;
        row.hidden = !clean;
        if (!isJoy) {
          const joyRow = document.getElementById("htTurnJoy");
          if (joyRow) joyRow.hidden = true;
        }
        panel.classList.add("active");
        panel.classList.toggle("is-joy", isJoy);
        window.clearTimeout(homeTranscriptHideTimer);
        if (opts.autoHideMs !== 0) {
          homeTranscriptHideTimer = window.setTimeout(() => panel.classList.remove("active"), opts.autoHideMs || 60000);
        }
      },
      hide() {
        window.clearTimeout(homeTranscriptHideTimer);
        document.querySelector(".home-transcript-panel")?.classList.remove("active");
      },
    };
  }

  let state = null;
  let mission = null;
  let actions = [];
  let stale = true;
  let builtAt = null;
  let refreshing = false;

  function esc(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function readDismissedMail() {
    try {
      const parsed = JSON.parse(localStorage.getItem(DISMISSED_MAIL_KEY) || "[]");
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch (_) {
      return new Set();
    }
  }

  function mailKey(msg) {
    return [
      msg.account || "",
      msg.accountEmail || "",
      msg.id || msg.message_id || msg.thread_id || "",
      msg.date || "",
      msg.from || "",
      msg.subject || "",
    ].join("|");
  }

  function dismissMail(key) {
    const dismissed = readDismissedMail();
    dismissed.add(key);
    localStorage.setItem(DISMISSED_MAIL_KEY, JSON.stringify(Array.from(dismissed).slice(-200)));
    inboxIndex = Math.max(0, inboxIndex - 1);
    render();
  }

  function timeAgo(iso) {
    if (!iso) return "";
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return "";
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    return Math.round(hrs / 24) + "d ago";
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 5) return "Late night, friend";
    if (h < 12) return "Good morning, friend";
    if (h < 17) return "Good afternoon, friend";
    return "Good evening, friend";
  }

  function sectionUnavailable(meta, label) {
    if (!meta || meta.available !== false) return null;
    return `<p class="jb-unavail">${esc(label)} unavailable${meta.reason ? ": " + esc(meta.reason) : ""}.</p>`;
  }

  function eventTimes(ev) {
    const s = ev.start_time || "";
    const e = ev.end_time || "";
    return s && e ? s + " to " + e : s;
  }

  function nextEvent() {
    const cal = Array.isArray(state?.calendar) ? state.calendar : [];
    const now = Date.now();
    const upcoming = cal.filter((ev) => {
      const end = new Date(ev.end || ev.start || 0).getTime();
      return Number.isFinite(end) && end > now;
    });
    return upcoming[0] || null;
  }

  function renderNow() {
    const ev = nextEvent();
    const weather = Array.isArray(state?.weather) ? state.weather.find((w) => w.ok) : null;
    let main;
    if (ev) {
      const startMs = new Date(ev.start || 0).getTime();
      const mins = Math.round((startMs - Date.now()) / 60000);
      let lead = "happening now";
      if (Number.isFinite(mins) && mins > 0) {
        if (mins < 60) lead = `in ${mins} min`;
        else {
          const h = Math.floor(mins / 60);
          const m = mins % 60;
          lead = `in ${h} hr${m ? ` ${m} min` : ""}`;
        }
      }
      main = `<div class="jb-now-event">
          <span class="jb-now-lead">${esc(lead)}</span>
          <strong>${esc(ev.title || ev.summary || "Event")}</strong>
          <span class="jb-now-time">${esc(eventTimes(ev))}${ev.location ? " · " + esc(ev.location) : ""}</span>
        </div>`;
    } else {
      main = `<div class="jb-now-event"><strong>Nothing scheduled next</strong><span class="jb-now-time">The rest of the day is open.</span></div>`;
    }
    const wx = weather
      ? `<div class="jb-now-weather">${esc(weather.temp_f)}°F ${esc((weather.summary || "").trim())}<span>${esc(weather.label || "")}</span></div>`
      : "";
    return `<section class="jb-card jb-now"><h2>Now</h2>${main}${wx}</section>`;
  }

  function attentionItems() {
    const items = [];
    const approvals = (mission?.approvals || []).filter((a) => {
      if (!a || !a.id || a.id === "none") return false;
      const text = `${a.title || ""} ${a.detail || ""}`.toLowerCase();
      return !/(^|\b)(test audit|audit event|placeholder|sample)(\b|$)/.test(text);
    });
    for (const a of approvals.slice(0, 4)) {
      items.push({
        kind: "approval",
        id: a.id,
        title: a.title || "Approval needed",
        detail: a.detail || "",
      });
    }
    const rem = state?.reminders;
    const staleReminderCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const due = (rem?.items || []).filter((r) => {
      if (r.completed) return false;
      if (!r.due) return true;
      const dueMs = new Date(r.due).getTime();
      return !Number.isFinite(dueMs) || dueMs >= staleReminderCutoff;
    });
    for (const r of due.slice(0, 3)) {
      const dueDate = r.due ? new Date(r.due) : null;
      const overdue = dueDate && dueDate.getTime() < Date.now();
      items.push({
        kind: "reminder",
        title: r.title || "Reminder",
        detail: dueDate ? (overdue ? "overdue since " : "due ") + dueDate.toLocaleDateString([], { month: "short", day: "numeric" }) : "",
      });
    }
    for (const sec of ["personal_email", "school_email"]) {
      if (state?.[sec]?.error) {
        items.push({ kind: "failure", title: `${sec === "school_email" ? "School" : "Personal"} email check failed`, detail: "Tap to retry from the composer.", command: "check email" });
      }
    }
    return items;
  }

  function renderAttention() {
    const items = attentionItems();
    if (!items.length) {
      return `<section class="jb-card jb-attention"><h2>Attention</h2><p class="jb-empty">Nothing needs you right now.</p></section>`;
    }
    const rows = items
      .map((it) => {
        if (it.kind === "approval") {
          return `<div class="jb-attn jb-attn-approval" data-approval-id="${esc(it.id)}">
            <div class="jb-attn-body"><strong>${esc(it.title)}</strong>${it.detail ? `<span>${esc(it.detail)}</span>` : ""}</div>
            <div class="jb-attn-actions">
              <button type="button" class="jb-btn jb-approve" data-id="${esc(it.id)}">Approve</button>
              <button type="button" class="jb-btn jb-reject" data-id="${esc(it.id)}">Reject</button>
            </div>
            <div class="jb-attn-status" hidden></div>
          </div>`;
        }
        const cmd = it.command ? ` data-command="${esc(it.command)}" role="button" tabindex="0"` : "";
        return `<div class="jb-attn jb-attn-${esc(it.kind)}"${cmd}>
          <div class="jb-attn-body"><strong>${esc(it.title)}</strong>${it.detail ? `<span>${esc(it.detail)}</span>` : ""}</div>
        </div>`;
      })
      .join("");
    return `<section class="jb-card jb-attention"><h2>Attention</h2>${rows}</section>`;
  }

  /* --- Inbox card: skip through recent mail from both accounts --- */
  let inboxIndex = 0;

  function parseSender(from) {
    const m = String(from || "").match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
    if (m && m[1].trim()) return m[1].trim();
    if (m) return m[2].trim();
    return String(from || "").trim() || "Unknown sender";
  }

  function mailTime(dateStr) {
    const t = new Date(String(dateStr || "").replace(" ", "T")).getTime();
    if (!Number.isFinite(t)) return String(dateStr || "");
    const d = new Date(t);
    const today = new Date().toDateString() === d.toDateString();
    return today
      ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : d.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  function inboxItems() {
    const out = [];
    const dismissed = readDismissedMail();
    for (const [key, label] of [["school_email", "School"], ["personal_email", "Personal"]]) {
      const box = state?.[key];
      if (!box || box.error) continue;
      for (const msg of box.latest || []) {
        const item = { ...msg, account: label, accountEmail: box.account || "" };
        item.mailKey = mailKey(item);
        if (!dismissed.has(item.mailKey)) out.push(item);
      }
    }
    out.sort((a, b) => new Date(String(b.date || "").replace(" ", "T")) - new Date(String(a.date || "").replace(" ", "T")));
    return out;
  }

  function renderInbox() {
    const school = state?.school_email;
    const personal = state?.personal_email;
    if (!school && !personal) return "";
    const items = inboxItems();
    const counts = [];
    if (school && !school.error) counts.push(`${school.unread || 0} school`);
    if (personal && !personal.error) counts.push(`${personal.unread || 0} personal`);
    const countLabel = counts.length ? `<span class="jb-inbox-counts">${esc(counts.join(" · "))} unread</span>` : "";

    if (!items.length) {
      const err = school?.error || personal?.error;
      return `<section class="jb-card jb-inbox"><h2>Inbox ${countLabel}</h2><p class="jb-empty">${err ? "Email check failed. Ask me to retry." : "No recent mail."}</p></section>`;
    }

    inboxIndex = Math.max(0, Math.min(inboxIndex, items.length - 1));
    const msg = items[inboxIndex];
    const sender = parseSender(msg.from);
    const gmailUrl = `https://mail.google.com/mail/?authuser=${encodeURIComponent(msg.accountEmail)}#search/${encodeURIComponent('subject:"' + (msg.subject || "") + '"')}`;

    return `<section class="jb-card jb-inbox"><h2>Inbox ${countLabel}</h2>
      <div class="jb-mail">
        <button type="button" class="jb-mail-dismiss" id="jbMailDismiss" data-mail-key="${esc(msg.mailKey)}" aria-label="Dismiss this email">x</button>
        <div class="jb-mail-view" id="jbMailView" tabindex="0" aria-label="Email ${inboxIndex + 1} of ${items.length}">
          <span class="jb-mail-meta"><span class="jb-mail-tag jb-mail-tag-${esc(msg.account.toLowerCase())}">${esc(msg.account)}</span>${esc(mailTime(msg.date))}</span>
          <strong class="jb-mail-from">${esc(sender)}</strong>
          <p class="jb-mail-subject">${esc(msg.subject || "(no subject)")}</p>
          ${msg.snippet ? `<p class="jb-mail-snippet">${esc(msg.snippet)}</p>` : ""}
        </div>
        <div class="jb-mail-bar">
          <button type="button" class="jb-mail-nav" id="jbMailPrev" aria-label="Previous email" ${inboxIndex === 0 ? "disabled" : ""}>‹</button>
          <span class="jb-mail-count">${inboxIndex + 1} / ${items.length}</span>
          <button type="button" class="jb-mail-nav" id="jbMailNext" aria-label="Next email" ${inboxIndex >= items.length - 1 ? "disabled" : ""}>›</button>
          <span class="jb-mail-spacer"></span>
          <button type="button" class="jb-btn jb-mail-act" data-command="summarize the email from ${esc(sender)} about &quot;${esc(msg.subject || "")}&quot; in my ${esc(msg.account.toLowerCase())} inbox">Ask Joy</button>
          <a class="jb-btn jb-mail-act" href="${esc(gmailUrl)}" target="_blank" rel="noopener noreferrer">Open</a>
        </div>
      </div>
    </section>`;
  }

  function wireInbox() {
    const items = inboxItems();
    const step = (dir) => {
      inboxIndex = Math.max(0, Math.min(inboxIndex + dir, items.length - 1));
      render();
      document.getElementById("jbMailView")?.focus();
    };
    document.getElementById("jbMailPrev")?.addEventListener("click", (e) => { e.stopPropagation(); step(-1); });
    document.getElementById("jbMailNext")?.addEventListener("click", (e) => { e.stopPropagation(); step(1); });
    document.getElementById("jbMailDismiss")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = e.currentTarget.getAttribute("data-mail-key");
      if (key) dismissMail(key);
    });
    const view = document.getElementById("jbMailView");
    if (view) {
      view.addEventListener("keydown", (e) => {
        if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
        if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
      });
      // Swipe/tap-through: tapping the message advances to the next one
      view.addEventListener("click", () => { if (inboxIndex < items.length - 1) step(1); else step(-items.length); });
    }
  }

  function renderToday() {
    const cal = Array.isArray(state?.calendar) ? state.calendar : [];
    const calMeta = state?.calendar_meta;
    const unavail = sectionUnavailable(calMeta, "Calendar");
    let calHtml;
    if (unavail) {
      calHtml = unavail;
    } else if (!cal.length) {
      calHtml = `<p class="jb-empty">No events on the calendar today.</p>`;
    } else {
      calHtml = `<ul class="jb-events">${cal
        .slice(0, 6)
        .map((ev) => {
          const past = new Date(ev.end || ev.start || 0).getTime() < Date.now();
          return `<li class="${past ? "jb-past" : ""}"><span class="jb-event-time">${esc(ev.start_time || "")}</span><span class="jb-event-title">${esc(ev.title || ev.summary || "Event")}</span></li>`;
        })
        .join("")}</ul>`;
    }
    const remNote = "";
    return `<section class="jb-card jb-today"><h2>Today</h2>${calHtml}${remNote}</section>`;
  }

  /* Joy's inner state: diary, garden, flourishing — pushed to /api/panels/inner */
  function renderInner() {
    const inner = state?.inner;
    if (!inner) return "";
    const bits = [];
    if (inner.diary && (inner.diary.entry || inner.diary.date)) {
      bits.push(`<div class="jb-inner-diary"><span class="jb-inner-label">Diary${inner.diary.date ? " · " + esc(inner.diary.date) : ""}</span><p>${esc(String(inner.diary.entry || "").slice(0, 280))}</p></div>`);
    }
    const garden = Array.isArray(inner.garden) ? inner.garden : [];
    if (garden.length) {
      const plants = garden.slice(0, 5)
        .map((p) => `<span class="jb-inner-plant">${esc(p.name || "seed")} · ${esc(p.stage || "")}</span>`)
        .join("");
      bits.push(`<div class="jb-inner-garden"><span class="jb-inner-label">Garden</span><div>${plants}</div></div>`);
    }
    if (inner.flourishing && (inner.flourishing.score != null || inner.flourishing.note)) {
      const score = inner.flourishing.score != null ? `${esc(inner.flourishing.score)}/10 ` : "";
      bits.push(`<div class="jb-inner-flourish"><span class="jb-inner-label">Flourishing</span><p>${score}${esc(inner.flourishing.note || "")}</p></div>`);
    }
    if (!bits.length) return "";
    return `<section class="jb-card jb-inner"><h2>Joy</h2>${bits.join("")}</section>`;
  }

  function actionUsable(a) {
    if (!a || !a.label || a.status === "disabled") return false;
    // Publisher uses safe/queued; legacy panels use available/needs_approval.
    return ["available", "needs_approval", "safe", "queued"].includes(a.status);
  }

  function actionNeedsApprovalTag(a) {
    return a.status === "needs_approval" || a.status === "queued";
  }

  function renderQuickActions() {
    let list = [];
    if (Array.isArray(actions) && actions.length) {
      const usable = actions.filter(actionUsable);
      list = usable.slice(0, 8).map((a) => ({
        label: a.label,
        command: (a.natural_language_examples || [])[0] || a.prompt || a.command || a.label,
        status: a.status,
      }));
    }
    if (!list.length) {
      return `<section class="jb-card jb-quick"><h2>Quick actions</h2><p class="jb-empty">Joy hasn't pushed quick actions yet.</p></section>`;
    }
    const btns = list
      .map(
        (a) =>
          `<button type="button" class="jb-qa" data-command="${esc(a.command)}"${a.fillOnly ? ' data-fill-only="1"' : ""}>${esc(a.label)}${actionNeedsApprovalTag(a) ? '<span class="jb-qa-tag">approval</span>' : ""}</button>`
      )
      .join("");
    return `<section class="jb-card jb-quick"><h2>Quick actions</h2><div class="jb-qa-grid">${btns}</div></section>`;
  }

  function renderHeader() {
    const freshness = builtAt
      ? `Updated ${timeAgo(builtAt)}${stale ? " · refreshing…" : ""}`
      : refreshing
        ? "Loading live data…"
        : "";
    const liveDot = builtAt && !stale && Date.now() - new Date(builtAt).getTime() < 45 * 60 * 1000;
    return `<header class="jb-head">
        <div><h1>${esc(greeting())}</h1><p class="jb-date">${esc(new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }))}</p></div>
        ${freshness ? `<div class="jb-fresh">${liveDot ? '<span class="jb-dot"></span>' : ""}${esc(freshness)}</div>` : ""}
      </header>`;
  }

  function render() {
    if (!state) {
      root.innerHTML = `${renderHeader()}<div class="jb-skeleton"><div></div><div></div><div></div></div>`;
      return;
    }
    root.innerHTML =
      renderHeader() + renderNow() + renderAttention() + renderInbox() + renderToday() + renderInner() + renderQuickActions();
    wire();
    wireInbox();
  }

  function sendCommand(command, fillOnly) {
    const input = document.getElementById("homeChatInput");
    const send = document.getElementById("homeChatSend");
    if (!input) return;
    input.value = command;
    input.focus();
    if (!fillOnly && send) send.click();
  }

  async function resolveApproval(id, verb, row) {
    const statusEl = row.querySelector(".jb-attn-status");
    const btns = row.querySelectorAll("button");
    btns.forEach((b) => (b.disabled = true));
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.textContent = verb === "approve" ? "Approving…" : "Rejecting…";
    }
    try {
      const res = await fetch(`/api/joy-home/${verb}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => ({}));
      const okStatus = data.status || (res.ok ? "done" : "failed");
      if (statusEl) {
        statusEl.textContent =
          okStatus === "done" ? "Done" : okStatus === "rejected" ? "Rejected" : `Failed${data.error ? ": " + data.error : ""}`;
        statusEl.dataset.state = okStatus;
      }
      if (okStatus === "failed") btns.forEach((b) => (b.disabled = false));
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = "Failed: " + err.message;
        statusEl.dataset.state = "failed";
      }
      btns.forEach((b) => (b.disabled = false));
    }
  }

  function wire() {
    root.querySelectorAll(".jb-qa, [data-command]").forEach((el) => {
      el.addEventListener("click", () => {
        const cmd = el.dataset.command;
        if (cmd) sendCommand(cmd, el.dataset.fillOnly === "1");
      });
    });
    root.querySelectorAll(".jb-approve, .jb-reject").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const row = btn.closest("[data-approval-id]");
        if (row) resolveApproval(btn.dataset.id, btn.classList.contains("jb-approve") ? "approve" : "reject", row);
      });
    });
  }

  async function fetchJson(url, timeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs || 8000);
    try {
      const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  async function loadCached() {
    try {
      const data = await fetchJson("/api/joy-home/state?cached=1&ts=" + Date.now(), 4000);
      if (data && data.ok !== false && (data.state || data.calendar !== undefined || data.personal_email)) {
        state = data.state || data;
        stale = data.stale !== false;
        builtAt = data.built_at || state.built_at || null;
        render();
      }
    } catch (_) {}
  }

  async function loadFresh() {
    if (refreshing) return;
    refreshing = true;
    render();
    try {
      const data = await fetchJson("/api/joy-home/state?ts=" + Date.now(), 45000);
      state = data.state || data;
      stale = data.stale !== false;
      builtAt = data.built_at || new Date().toISOString();
    } catch (_) {
      /* keep cached copy; freshness label already says how old it is */
    } finally {
      refreshing = false;
      render();
    }
  }

  async function loadMission() {
    try {
      mission = await fetchJson("/api/mission?ts=" + Date.now(), 6000);
      render();
    } catch (_) {}
  }

  async function loadActions() {
    try {
      const data = await fetchJson("/api/joy-home/actions?ts=" + Date.now(), 6000);
      actions = Array.isArray(data) ? data : data.actions || [];
      render();
    } catch (_) {
      actions = [];
    }
  }

  render();
  loadCached().then(loadFresh);
  loadMission();
  loadActions();
  setInterval(() => { if (!document.hidden) loadFresh(); }, 5 * 60 * 1000);
  setInterval(() => { if (!document.hidden) loadMission(); }, 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && builtAt && Date.now() - new Date(builtAt).getTime() > 10 * 60 * 1000) {
      loadFresh();
      loadMission();
    }
  });
})();
