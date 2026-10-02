(function () {
  const NAV = [
    { id: "home", label: "Home", icon: "⌂", kind: "home", title: "Daily brief" },
    { id: "text", label: "Chat", icon: "✎", kind: "text", title: "Chat with Joy" },
    { id: "tasks", label: "Tasks", icon: "⌘", kind: "mc", page: "tasks" },
    { id: "calendar", label: "Calendar", icon: "◷", kind: "mc", page: "calendar" },
    { id: "approvals", label: "Approvals", icon: "✓", kind: "mc", page: "general_approvals", badgeKey: "approvals", title: "General approvals" },
    { id: "actions", label: "Activity", icon: "⚡", kind: "actions", title: "Live activity" },
  ];

  const OPENCLAW_CAPABILITIES = [{title:"Local release subset",items:["Local panels and message queue", "Explicit bridge replies; no model called automatically", "Review decisions only; no external execution"]}];

  let activeNav = "home";
  // Room mode was the legacy May UI; a stale localStorage value could resurrect
  // it on reload/rotate. Desk mode is the only supported surface now.
  let displayMode = "desk";
  localStorage.setItem("joyHomeDisplayMode", "desk");

  const railEl = document.getElementById("joyRail");
  const homePane = document.getElementById("joyHomePane");
  const textPane = document.getElementById("joyTextPane");
  const featurePane = document.getElementById("joyFeaturePane");
  const controlPane = document.getElementById("joyControlPane");
  const actionsPane = document.getElementById("joyActionsPane");
  const educationPane = document.getElementById("joyEducationPane");
  const mcFrame = document.getElementById("mcEmbedFrame");
  const modeBtn = document.getElementById("joyModeToggle");
  const actionsFeed = document.getElementById("actionsFeed");
  const capRoot = document.getElementById("capabilitiesRoot");
  const homeMicBtn = document.getElementById("homeMicBtn");
  const taskRefreshBtn = document.getElementById("taskRefreshBtn");
  const shellClock = document.getElementById("shellClock");
  const shellDate = document.getElementById("shellDate");

  function esc(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderCapabilities() {
    if (!capRoot) return;
    capRoot.innerHTML = OPENCLAW_CAPABILITIES.map(
      (g) =>
        `<div class="joy-cap-group"><h3>${esc(g.title)}</h3><ul>${g.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>`
    ).join("");
  }

  function syncBodyNavClass(navId) {
    document.body.classList.remove(...NAV.map((n) => "nav-" + n.id));
    document.body.classList.add("nav-" + navId);
  }

  function setDisplayMode(mode) {
    displayMode = mode === "room" ? "room" : "desk";
    localStorage.setItem("joyHomeDisplayMode", displayMode);
    document.body.classList.remove("mode-desk", "mode-room");
    document.body.classList.add(displayMode === "room" ? "mode-room" : "mode-desk");
    if (modeBtn) {
      modeBtn.textContent = displayMode === "room" ? "Desk" : "Room";
      modeBtn.title = displayMode === "room" ? "Switch to desk mode" : "Switch to room / projector mode";
    }
  }

  function showPane(pane, visible) {
    if (!pane) return;
    pane.classList.toggle("hidden", !visible);
    pane.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  function showHomeOverlay(overlay) {
    document.body.classList.toggle("joy-show-commands", overlay === "commands");
    if (overlay === "commands" && typeof window.setState === "function") {
      window.setState("dashboard");
    } else if (!overlay && typeof window.setState === "function") {
      window.setState("ambient");
    }
  }

  function initTextChat() {
    if (!window.joyTextChat) return;
    if (window.joyTextChat.reload) window.joyTextChat.reload();
    window.setTimeout(() => window.joyTextChat.focus?.(), 120);
  }

  /* MC iframe: hide the stale page while the next one loads, and skip the
     reload entirely when the same page is re-selected. */
  let mcCurrentPage = "";
  if (mcFrame) {
    mcFrame.addEventListener("load", () => featurePane?.classList.remove("mc-loading"));
  }
  function missionControlSrc(page) {
    const pageId = String(page || "").toLowerCase();
    if (pageId === "diary" || pageId === "garden") {
      return `/joy-apps/${pageId}/`;
    }
    if (pageId === "projects") return "/joy-home/projects.html";
    if (pageId === "x_research") return "/joy-home/x-research.html";
    if (pageId === "system") return "/joy-home/system-map.html?v=20260715-node-click-fix";
    return `/joy-home/panel.html?page=${encodeURIComponent(pageId)}`;
  }

  function loadMcPage(page) {
    if (!mcFrame || !page) return;
    if (mcCurrentPage === page) return;
    mcCurrentPage = page;
    featurePane?.classList.add("mc-loading");
    mcFrame.src = missionControlSrc(page);
  }

  function openMissionControl(page) {
    const pageId = page.toLowerCase();
    activeNav = NAV.find((n) => n.page === page)?.id || "mc-" + pageId;
    railEl?.querySelectorAll(".joy-rail-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.nav === activeNav);
    });
    syncBodyNavClass(activeNav);
    showPane(homePane, false);
    showPane(textPane, false);
    showPane(actionsPane, false);
    showPane(educationPane, false);
    showPane(featurePane, true);
    showPane(controlPane, false);
    showHomeOverlay(null);
    loadMcPage(page);
    try {
      history.replaceState(null, "", `#mc-${page.toLowerCase()}`);
    } catch (_) {}
  }

  function setActiveNav(navId) {
    if (navId === "voice" || navId === "joy") navId = "home";
    if (navId === "Text") navId = "text";
    if (navId.startsWith("mc-")) {
      const page = navId.slice(3);
      const title = page.charAt(0).toUpperCase() + page.slice(1);
      openMissionControl(title);
      return;
    }
    const item = NAV.find((n) => n.id === navId) || NAV[0];
    activeNav = item.id;

    railEl?.querySelectorAll(".joy-rail-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.nav === item.id);
    });

    syncBodyNavClass(item.id);

    showPane(homePane, item.kind === "home");
    showPane(textPane, item.kind === "text");
    showPane(featurePane, item.kind === "mc");
    showPane(controlPane, item.kind === "control");
    showPane(actionsPane, item.kind === "actions");
    showPane(educationPane, item.kind === "education");

    showHomeOverlay(item.kind === "home" ? item.overlay || null : null);

    if (item.kind === "mc") {
      loadMcPage(item.page || item.id);
    }

    if (item.kind === "actions") {
      refreshActionsFeed();
    }

    if (item.kind === "control") {
      window.joyControlOverview?.refresh?.();
      window.setTimeout(() => document.getElementById("joyControlRefresh")?.focus?.(), 80);
    }

    if (item.kind === "education") {
      window.joyAtlasEducation?.refresh?.();
      window.setTimeout(() => document.getElementById("atlasEducationRefresh")?.focus?.(), 80);
    }

    if (item.kind === "text") {
      initTextChat();
    }

    if (item.kind === "home") {
      refreshNavBadges();
      if (!item.overlay && typeof window.setState === "function") {
        window.setState("ambient");
      }
    }

    try {
      history.replaceState(null, "", `#${item.id}`);
    } catch (_) {}
  }

  function renderRail(badgeCounts = {}) {
    if (!railEl) return;
    railEl.innerHTML = NAV.map((item) => {
      const badge =
        item.badgeKey && badgeCounts[item.badgeKey]
          ? `<span class="joy-rail-badge">${badgeCounts[item.badgeKey]}</span>`
          : "";
      const current = item.id === activeNav ? ' aria-current="page"' : "";
      return `<button type="button" class="joy-rail-btn${item.id === activeNav ? " active" : ""}" data-nav="${esc(item.id)}" title="${esc(item.title || item.label)}" aria-label="${esc(item.label)}"${current}><span class="joy-rail-icon" aria-hidden="true">${item.icon}</span><span class="joy-rail-label">${esc(item.label)}</span>${badge}</button>`;
    }).join("");

    railEl.querySelectorAll(".joy-rail-btn").forEach((btn) => {
      btn.addEventListener("click", () => setActiveNav(btn.dataset.nav));
    });
  }

  function renderActivityHtml(mission) {
    const activity = (mission.activity || []).slice(-30).reverse();
    const approvals = (mission.approvals || []).filter((a) => {
      if (!a || a.id === "none") return false;
      const text = `${a.title || ""} ${a.detail || ""}`.toLowerCase();
      return !/(^|\b)(test audit|audit event|placeholder|sample)(\b|$)/.test(text);
    });
    let html = "";
    if (approvals.length) {
      html += approvals
        .slice(0, 4)
        .map(
          (a) =>
            `<div class="joy-action-item"><b>Approval · ${esc(a.title)}</b><p>${esc(a.detail)}</p></div>`
        )
        .join("");
    }
    if (activity.length) {
      html += activity
        .map((ev) => {
          const tsMs = typeof ev.ts === "number" ? ev.ts * 1000 : Date.parse(ev.ts || "");
          const when = Number.isFinite(tsMs) ? new Date(tsMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
          return `<div class="joy-action-item"><b>${esc(ev.who || "Joy")}</b><p>${esc(ev.text)}</p>${when ? `<time>${esc(when)}</time>` : ""}</div>`;
        })
        .join("");
    }
    return html || '<div class="joy-action-item"><b>Quiet so far</b><p>Joy logs what she does with <code>POST /api/panels/activity/append</code> — entries land here the moment she acts.</p></div>';
  }

  async function refreshNavBadges() {
    try {
      const res = await fetch("/api/mission?ts=" + Date.now(), { cache: "no-store" });
      if (!res.ok) return;
      const mission = await res.json();
      const notifications = (mission.notifications || []).filter((n) => {
        if (!n) return false;
        const status = String(n.status || "new").toLowerCase();
        return !["reviewed", "done", "dismissed", "archived"].includes(status);
      });
      const approvals = (mission.approvals || []).filter((a) => {
        if (!a || a.id === "none") return false;
        const text = `${a.title || ""} ${a.detail || ""}`.toLowerCase();
        return !/(^|\b)(test audit|audit event|placeholder|sample)(\b|$)/.test(text);
      });
      const [replyPanel, skillPanel, generalPanel] = await Promise.all([
        fetch("/api/panels/email_reply_queue?ts=" + Date.now(), { cache: "no-store" }).then((r) => r.ok ? r.json() : null).catch(() => null),
        fetch("/api/panels/skill_review_queue?ts=" + Date.now(), { cache: "no-store" }).then((r) => r.ok ? r.json() : null).catch(() => null),
        fetch("/api/panels/general_approvals?ts=" + Date.now(), { cache: "no-store" }).then((r) => r.ok ? r.json() : null).catch(() => null),
      ]);
      const replyQueue = Array.isArray(replyPanel?.data) ? replyPanel.data.filter((r) => (r.status || "pending") === "pending") : [];
      const skillQueue = Array.isArray(skillPanel?.data) ? skillPanel.data.filter((r) => (r.status || "pending") === "pending") : [];
      const generalQueue = Array.isArray(generalPanel?.data) ? generalPanel.data.filter((r) => (r.status || "pending") === "pending") : approvals;
      renderRail({ approvals: generalQueue.length, notifications: notifications.length, replyQueue: replyQueue.length, skillQueue: skillQueue.length });
      railEl?.querySelectorAll(".joy-rail-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.nav === activeNav);
      });
    } catch (_) {}
  }

  async function refreshActionsFeed() {
    if (!actionsFeed) return;
    actionsFeed.innerHTML = '<div class="joy-action-item"><p>Loading activity…</p></div>';
    try {
      const res = await fetch("/api/mission?ts=" + Date.now(), { cache: "no-store" });
      if (!res.ok) throw new Error("mission " + res.status);
      const mission = await res.json();
      actionsFeed.innerHTML = renderActivityHtml(mission);
    } catch (err) {
      actionsFeed.innerHTML = `<div class="joy-action-item"><b>Could not load activity</b><p>${esc(err.message)}</p></div>`;
    }
  }

  function syncTopbarClock() {
    const clockEl = document.getElementById("clock");
    const dateEl = document.getElementById("date");
    if (shellClock && clockEl) shellClock.textContent = clockEl.textContent || "--:--";
    if (shellDate && dateEl) shellDate.textContent = dateEl.textContent || "";
  }

  function hideBootStatus() {
    document.getElementById("joyBootStatus")?.remove();
  }

  function showBootError(message) {
    const boot = document.getElementById("joyBootStatus");
    if (!boot) return;
    boot.className = "joy-boot-error";
    boot.textContent = message;
  }

  async function verifyServerReachable() {
    try {
      let res = await fetch("/api/joy-home/health?ts=" + Date.now(), { cache: "no-store" });
      if (res.status === 404) {
        res = await fetch("/api/mission?ts=" + Date.now(), { cache: "no-store" });
      }
      if (!res.ok) throw new Error("Server returned " + res.status);
      const dot = document.getElementById("joyOnlineDot");
      const label = document.getElementById("joyOnlineLabel");
      if (dot) dot.classList.add("is-live");
      if (label) label.textContent = "Online";
      return true;
    } catch (err) {
      const label = document.getElementById("joyOnlineLabel");
      if (label) label.textContent = "Offline";
      return false;
    }
  }

  function initFromHash() {
    let hash = (location.hash || "").replace(/^#/, "");
    if (hash === "voice" || hash === "joy") hash = "home";
    if (hash === "Text") hash = "text";
    if (hash.startsWith("mc-")) {
      setActiveNav(hash);
      return;
    }
    const legacy = { more: "tasks", commands: "home", activity: "actions", Activity: "actions" };
    if (legacy[hash]) hash = legacy[hash];
    if (hash && (NAV.some((n) => n.id === hash) || hash.startsWith("mc-"))) {
      setActiveNav(hash);
    } else if (hash && hash[0] === hash[0].toUpperCase()) {
      const lower = hash.toLowerCase();
      if (NAV.some((n) => n.id === lower)) setActiveNav(lower);
      else setActiveNav("home");
    } else {
      setActiveNav("home");
    }
  }

  if (modeBtn) {
    modeBtn.addEventListener("click", () => {
      setDisplayMode(displayMode === "room" ? "desk" : "room");
    });
  }

  if (homeMicBtn) {
    homeMicBtn.addEventListener("click", () => {
      if (activeNav === "text" && window.joyTextChat?.startVoiceDraft) {
        window.joyTextChat.startVoiceDraft();
        return;
      }
      if (activeNav !== "home") setActiveNav("home");
      if (window.joyVoice?.startPrimaryVoice) window.joyVoice.startPrimaryVoice();
      else if (window.joyVoice?.startLocalVoice) window.joyVoice.startLocalVoice();
      else document.getElementById("listenButton")?.click();
    });
  }

  const homeLocalMicBtn = document.getElementById("homeLocalMicBtn");
  if (homeLocalMicBtn) {
    homeLocalMicBtn.addEventListener("pointerdown", () => {
      window.joyVoice?.primeLocalMicrophone?.().catch(() => {});
    });
    homeLocalMicBtn.addEventListener("click", () => {
      if (activeNav !== "home") setActiveNav("home");
      if (window.joyVoice?.startLocalVoice) window.joyVoice.startLocalVoice();
      else document.getElementById("listenButton")?.click();
    });
  }

  window.joyShell = {
    setActiveTab: setActiveNav,
    setActiveNav,
    openMissionControl,
    refreshActionsFeed,
    refreshNavBadges,
    getActiveTab: () => (activeNav.startsWith("mc-") ? "home" : activeNav),
    appendActionLog(who, text) {
      const html = `<div class="joy-action-item"><b>${esc(who)}</b><p>${esc(text)}</p><time>${esc(new Date().toLocaleTimeString())}</time></div>`;
      actionsFeed?.insertAdjacentHTML("afterbegin", html);
    },
  };

  renderCapabilities();
  renderRail();
  setDisplayMode(displayMode);
  refreshNavBadges();
  initFromHash();
  hideBootStatus();
  verifyServerReachable();
  window.addEventListener("hashchange", initFromHash);
  window.setInterval(() => { if (!document.hidden) syncTopbarClock(); }, 1000);
  window.setInterval(() => {
    if (document.hidden) return;
    if (activeNav === "home") refreshNavBadges();
    if (activeNav === "actions") refreshActionsFeed();
  }, 60000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) syncTopbarClock();
  });
})();
