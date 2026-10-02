(function () {
  const SESSION_KEY = "joyHomeOpenClawSession";
  const MODEL_KEY = "joyHomeTextModel";
  const THINKING_KEY = "joyHomeTextThinking";
  const MODEL_BY_SESSION_KEY = "joyHomeTextModelBySession";
  const THINKING_BY_SESSION_KEY = "joyHomeTextThinkingBySession";
  const DRAFT_BY_SESSION_KEY = "joyHomeTextDraftBySession";
  const HOME_DRAFT_BY_SESSION_KEY = "joyHomeHomeDraftBySession";
  const LAST_SEND_FINGERPRINT_KEY = "joyHomeLastSendFingerprint";

  const threadEl = document.getElementById("textChatThread");
  const inputEl = document.getElementById("textChatInput");
  const sendBtn = document.getElementById("textChatSend");
  const micBtn = document.getElementById("homeMicBtn");
  const modelSelect = document.getElementById("textModelSelect");
  const thinkingSelect = document.getElementById("textThinkingSelect");
  const sessionSelect = document.getElementById("ocSessionSelect");
  const sessionList = document.getElementById("ocSessionList");
  const newSessionBtn = document.getElementById("ocNewSession");
  const abortBtn = document.getElementById("ocAbortBtn");
  const usageBadge = document.getElementById("ocUsageBadge");
  const thinkingBadge = document.getElementById("ocThinkingBadge");
  const toolsBadge = document.getElementById("ocToolsBadge");
  const runBadge = document.getElementById("ocRunBadge");
  const liveStrip = document.getElementById("ocLiveStrip");
  const liveThinking = document.getElementById("ocLiveThinking");
  const liveTool = document.getElementById("ocLiveTool");
  const quickPrompts = document.getElementById("ocQuickPrompts");
  const agentLabel = document.getElementById("ocAgentLabel");
  const refreshBtn = document.getElementById("ocRefreshBtn");
  const patchHint = document.getElementById("ocPatchHint");
  const modelBadge = document.getElementById("ocModelBadge");
  const scopeApproveBtn = document.getElementById("ocScopeApproveBtn");
  const homeInputEl = document.getElementById("homeChatInput");
  const homeSendBtn = document.getElementById("homeChatSend");
  const homeStopBtn = document.getElementById("homeChatStop");
  const homeStatusEl = document.getElementById("homeComposeStatus");

  // Gateway-backed sessions are always real agent:main:* keys. Migrate the
  // legacy local joy-home:main key instead of rendering a synthetic session.
  const MAIN_SESSION_KEY = "";
  let sessions = [];
  const savedSessionKey = localStorage.getItem(SESSION_KEY) || "";
  let sessionKey = savedSessionKey.startsWith("agent:main:") ? savedSessionKey : "";
  let modelCatalog = [];
  let aliasToModel = {};
  let sending = false;
  let activeRunId = null;
  let pollTimer = null;
  let pollStartedAt = 0;
  let patchPromise = null;
  let sessionPatchApplied = true;
  let pendingScopeRequestId = "";
  let pendingTurn = null;
  let homeEchoPending = false;
  let voiceReplyPending = false;
  let draftRecognition = null;
  let draftListening = false;
  let homeDraftPreviewTimer = null;
  let lastFailedHomeDraft = "";
  let lastSendFingerprint = localStorage.getItem(LAST_SEND_FINGERPRINT_KEY) || "";

  if (savedSessionKey && !sessionKey) localStorage.removeItem(SESSION_KEY);

  function readPrefMap(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "{}");
    } catch (_) {
      return {};
    }
  }

  function getSessionModelPref(key) {
    if (!key) return "";
    return readPrefMap(MODEL_BY_SESSION_KEY)[key] || "";
  }

  function getSessionThinkingPref(key) {
    if (!key) return "";
    return readPrefMap(THINKING_BY_SESSION_KEY)[key] || "";
  }

  function setSessionModelPref(key, model) {
    if (!key || !model) return;
    const map = readPrefMap(MODEL_BY_SESSION_KEY);
    map[key] = model;
    localStorage.setItem(MODEL_BY_SESSION_KEY, JSON.stringify(map));
    localStorage.setItem(MODEL_KEY, model);
  }

  function setSessionThinkingPref(key, thinking) {
    if (!key) return;
    const map = readPrefMap(THINKING_BY_SESSION_KEY);
    map[key] = thinking || "off";
    localStorage.setItem(THINKING_BY_SESSION_KEY, JSON.stringify(map));
    localStorage.setItem(THINKING_KEY, thinking || "off");
  }

  function draftKey(key, home = false) {
    return home ? HOME_DRAFT_BY_SESSION_KEY : DRAFT_BY_SESSION_KEY;
  }

  function getDraft(key, home = false) {
    if (!key) return "";
    return readPrefMap(draftKey(key, home))[key] || "";
  }

  function setDraft(key, text, home = false) {
    if (!key) return;
    const map = readPrefMap(draftKey(key, home));
    const clean = String(text || "");
    if (clean) map[key] = clean;
    else delete map[key];
    localStorage.setItem(draftKey(key, home), JSON.stringify(map));
  }

  function restoreSessionDrafts() {
    if (inputEl) inputEl.value = getDraft(sessionKey, false);
    if (homeInputEl) homeInputEl.value = getDraft(sessionKey, true);
  }

  function markFingerprint(text) {
    lastSendFingerprint = `${sessionKey}|${String(text || "").trim()}|${Date.now()}`;
    localStorage.setItem(LAST_SEND_FINGERPRINT_KEY, lastSendFingerprint);
  }

  function isDuplicateSubmit(text) {
    const parts = String(lastSendFingerprint || "").split("|");
    const ts = Number(parts.pop() || 0);
    const priorText = parts.pop() || "";
    const priorSession = parts.join("|");
    return priorSession === sessionKey && priorText === String(text || "").trim() && Date.now() - ts < 1600;
  }

  function modelShortLabel(modelKey) {
    if (!modelKey) return "—";
    return aliasToModel[modelKey] || modelKey.split("/").pop() || modelKey;
  }

  function sessionBucket(s) {
    const key = s.key || "";
    const kind = s.kind || "";
    if (key.includes(":joy-home:") || kind === "joy-home") return "Joy Home";
    if (key.includes(":dashboard:") || kind === "dashboard") return "Dashboard";
    if (key.includes("discord") || kind === "discord") return "Discord";
    if (key === "main" || key.endsWith(":main") || kind === "main") return "Main";
    return "Other";
  }

  function sessionDisplayLabel(s) {
    const label = String(s.label || "").trim();
    const key = s.key || "";
    if (label && !/^(Joy Home|Dashboard)\s+[a-f0-9]{6,}/i.test(label)) return label;
    if (key.includes(":joy-home:")) {
      const tail = key.split(":joy-home:", 2)[1] || "";
      return tail ? `Chat · ${tail.slice(0, 8)}` : "New chat";
    }
    if (key.includes(":dashboard:")) {
      const tail = key.split(":dashboard:", 2)[1] || "";
      return tail ? `Dashboard · ${tail.slice(0, 8)}` : "Dashboard";
    }
    if (key.startsWith("agent:main:")) {
      const tail = key.split("agent:main:", 2)[1] || key;
      return tail.length > 28 ? `${tail.slice(0, 26)}…` : tail;
    }
    return label || key || "Session";
  }

  function formatSessionMeta(s) {
    const parts = [];
    const preview = String(s.lastMessage || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 42);
    if (preview) parts.push(preview + (preview.length >= 42 ? "…" : ""));
    if (s.age) parts.push(s.age);
    const model = modelShortLabel(s.modelKey || s.model);
    if (model && model !== "—") parts.push(model);
    if (s.usagePercent != null) parts.push(`${s.usagePercent}%`);
    return parts.join(" · ");
  }

  const SESSION_GROUP_ORDER = ["Joy Home", "Dashboard", "Main", "Discord", "Other"];

  function setModelBadge(text, state) {
    if (!modelBadge) return;
    if (!text) {
      modelBadge.hidden = true;
      modelBadge.textContent = "";
      modelBadge.className = "oc-model-badge";
      return;
    }
    modelBadge.hidden = false;
    modelBadge.textContent = text;
    modelBadge.className = "oc-model-badge" + (state ? ` is-${state}` : "");
  }

  function updateSessionRow(updated) {
    if (!updated?.key) return;
    const idx = sessions.findIndex((s) => s.key === updated.key);
    if (idx >= 0) sessions[idx] = { ...sessions[idx], ...updated };
    renderSessionRail();
  }

  function esc(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalizeModelKey(key) {
    const model = String(key || "").trim();
    if (!model) return "";
    const keys = modelCatalog.map((m) => m.key);
    if (keys.includes(model)) return model;
    if (model.startsWith("codex/")) {
      const candidate = "openai/" + model.slice("codex/".length);
      if (keys.includes(candidate)) return candidate;
    }
    if (model.startsWith("openai-codex/")) {
      const candidate = "openai/" + model.slice("openai-codex/".length);
      if (keys.includes(candidate)) return candidate;
    }
    return model;
  }

  function getModel() {
    return normalizeModelKey(modelSelect?.value || localStorage.getItem(MODEL_KEY) || "");
  }

  function getThinking() {
    return thinkingSelect?.value || localStorage.getItem(THINKING_KEY) || "off";
  }

  function showPatchHint(message) {
    if (!patchHint) return;
    if (message) {
      patchHint.textContent = message;
      patchHint.hidden = false;
    } else {
      patchHint.textContent = "";
      patchHint.hidden = true;
    }
    updateScopeApproveButton();
  }

  function updateScopeApproveButton() {
    if (!scopeApproveBtn) return;
    scopeApproveBtn.hidden = !pendingScopeRequestId;
  }

  async function refreshScopeStatus() {
    try {
      const data = await fetchJson("/api/joy-home/openclaw/device-status");
      const pending = data.pending || [];
      pendingScopeRequestId = pending[0]?.requestId || "";
      if (pendingScopeRequestId && patchHint?.hidden) {
        showPatchHint(
          "One-time setup: approve OpenClaw scope so model switches apply instantly in the dropdown."
        );
      }
      updateScopeApproveButton();
      return data;
    } catch (_) {
      pendingScopeRequestId = "";
      updateScopeApproveButton();
      return null;
    }
  }

  async function approveScope() {
    if (!scopeApproveBtn) return;
    scopeApproveBtn.disabled = true;
    scopeApproveBtn.textContent = "Approving…";
    try {
      const data = await fetchJson("/api/joy-home/openclaw/device-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: pendingScopeRequestId }),
      });
      pendingScopeRequestId = (data.pending || [])[0]?.requestId || "";
      showPatchHint("");
      sessionPatchApplied = true;
      syncModelBadgeFromPicker();
      if (sessionKey) {
        await patchSessionSettings({
          model: getModel(),
          thinking: getThinking(),
        });
      }
    } catch (err) {
      showPatchHint(err.message || "Could not approve OpenClaw scope.");
    } finally {
      scopeApproveBtn.disabled = false;
      scopeApproveBtn.textContent = "Approve scope";
      updateScopeApproveButton();
    }
  }

  function finishSend(statusText = "Ready", statusState = "ready") {
    sending = false;
    activeRunId = null;
    pollStartedAt = 0;
    setRunState(false);
    setHomeRunState(false, statusText, statusState);
    stopLivePoll();
    inputEl?.focus();
  }

  function setHomeStatus(text, state) {
    if (!homeStatusEl) return;
    homeStatusEl.textContent = text || "Ready";
    homeStatusEl.dataset.state = state || "ready";
  }

  function setHomeRunState(running, idleText = "Ready", idleState = "ready") {
    if (homeSendBtn) homeSendBtn.disabled = running;
    if (homeStopBtn) homeStopBtn.hidden = !running;
    setHomeStatus(running ? "Queued — bridge not connected" : idleText, running ? "working" : idleState);
    // Soft piano while a run is in flight (app.js covers the orb states;
    // this covers typed sends and keeps music going for long runs).
    if (window.joyThinkingMusic) {
      if (running && window.joyVoice?.enabled?.() !== false) window.joyThinkingMusic.start();
      else if (!running) window.joyThinkingMusic.stop();
    }
  }

  function mirrorHomeDraft(text, opts = {}) {
    const clean = String(text || "").trim();
    window.clearTimeout(homeDraftPreviewTimer);
    if (!clean) return;
    window.joyHomeTranscript?.set("You", clean, { autoHideMs: opts.hold ? 0 : 9000 });
  }

  function setDraftMicState(listening) {
    draftListening = listening;
    if (!micBtn) return;
    micBtn.classList.toggle("is-listening", listening);
    micBtn.setAttribute("aria-pressed", listening ? "true" : "false");
    micBtn.title = listening ? "Stop dictation" : "Start listening";
    micBtn.setAttribute("aria-label", listening ? "Stop dictation" : "Start listening");
  }

  function appendDraftText(text) {
    if (!inputEl) return;
    const cleaned = String(text || "").replace(/\s+/g, " ").trim();
    if (!cleaned) return;
    const current = inputEl.value.trim();
    inputEl.value = current ? `${current} ${cleaned}` : cleaned;
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    inputEl.focus();
  }

  function startVoiceDraft() {
    if (draftListening && draftRecognition) {
      try { draftRecognition.stop(); } catch (_) {}
      setDraftMicState(false);
      return true;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showPatchHint("Voice dictation is not available in this browser. Type your message or use Home live voice.");
      inputEl?.focus();
      return false;
    }

    let finalText = "";
    const rec = new SpeechRecognition();
    draftRecognition = rec;
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = true;

    rec.onstart = () => {
      setDraftMicState(true);
      showPatchHint("Listening for text dictation…");
    };
    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const text = event.results[i][0]?.transcript || "";
        if (event.results[i].isFinal) finalText += text;
        else interim += text;
      }
      const preview = [inputEl.value.trim(), finalText.trim(), interim.trim()].filter(Boolean).join(" ");
      if (preview) setModelBadge("Dictating", "applying");
    };
    rec.onerror = (event) => {
      showPatchHint(
        event.error === "not-allowed"
          ? "Microphone access is blocked. Allow mic access, then try dictation again."
          : "Dictation failed. Your draft is still safe."
      );
    };
    rec.onend = () => {
      appendDraftText(finalText);
      setDraftMicState(false);
      draftRecognition = null;
      showPatchHint(finalText.trim() ? "" : "I did not catch any dictation. Try again or type it.");
      syncModelBadgeFromPicker();
    };

    try {
      rec.start();
      return true;
    } catch (err) {
      setDraftMicState(false);
      draftRecognition = null;
      showPatchHint(err.message || "Could not start dictation.");
      return false;
    }
  }

  function isSessionRunning(live, session) {
    const status = String(live?.status || session?.status || "").toLowerCase();
    return status === "running" || status === "active" || status === "busy";
  }

  function setRunState(running) {
    if (runBadge) {
      runBadge.textContent = running ? "Queued" : "Ready";
      runBadge.classList.toggle("oc-badge-active", running);
    }
    if (abortBtn) abortBtn.hidden = !running;
    if (sendBtn) sendBtn.disabled = running;
  }

  function updateBadges(live, session) {
    const usage = session?.usagePercent ?? live?.usagePercent;
    if (usageBadge) {
      usageBadge.textContent =
        usage != null ? `Usage ${usage}%` : "Usage —";
      usageBadge.classList.toggle("oc-badge-warn", usage != null && usage >= 70);
    }
    const thinkOn = getThinking() !== "off";
    if (thinkingBadge) {
      thinkingBadge.textContent = thinkOn ? `Think ${getThinking()}` : "Think off";
      thinkingBadge.classList.toggle("oc-badge-active", thinkOn);
    }
    const tool = live?.tool || "";
    if (toolsBadge) {
      toolsBadge.textContent = tool ? `Tool ${tool}` : "Tools idle";
      toolsBadge.classList.toggle("oc-badge-active", Boolean(tool));
    }
    if (liveStrip) {
      const show = sending && Boolean(tool);
      liveStrip.hidden = !show;
      if (liveThinking) liveThinking.textContent = "";
      if (liveTool) liveTool.textContent = show ? `→ ${tool}` : "";
    }
  }

  function renderThread(messages) {
    if (!threadEl) return;
    if (!messages?.length) {
      threadEl.innerHTML =
        '<div class="text-chat-empty"><span class="oc-assistant-name">Joy</span><p>Ready when you are. Anything you send queues for Joy — she reads it with <code>GET /api/joy/pending</code> and answers with <code>POST /api/joy/reply</code>, and her reply lands right here.</p></div>';
      if (quickPrompts) quickPrompts.hidden = true;
      return;
    }
    if (quickPrompts) quickPrompts.hidden = true;
    const visible = (messages || []).filter((m) => m.role !== "thinking");
    threadEl.innerHTML = visible
      .map((m) => {
        if (m.role === "assistant" && m.text === "Queued — bridge not connected") {
          return `<div class="text-bubble text-bubble-working"><span class="text-bubble-who">Joy</span><div class="text-bubble-body"><span class="oc-live-spinner" aria-hidden="true"></span> Queued — bridge not connected</div></div>`;
        }
        const who =
          m.role === "user"
            ? "You"
            : m.role === "tool"
              ? m.toolName || "Tool"
              : "Joy";
        const cls =
          m.role === "user" ? "user" : m.role === "tool" ? "tool" : "assistant";
        return `<div class="text-bubble text-bubble-${cls}"><span class="text-bubble-who">${esc(who)}</span><div class="text-bubble-body">${esc(m.text)}</div></div>`;
      })
      .join("");
    threadEl.scrollTop = threadEl.scrollHeight;
  }

  function mergePendingTurn(messages) {
    if (!pendingTurn || pendingTurn.sessionKey !== sessionKey) return messages || [];
    const list = messages || [];
    const pendingText = pendingTurn.text.trim();
    const userIndex = list.findLastIndex(
      (m) => m.role === "user" && String(m.text || "").trim() === pendingText
    );
    if (userIndex >= 0) {
      const hasAssistantAfter = list
        .slice(userIndex + 1)
        .some((m) => m.role === "assistant" && m.text !== "Queued — bridge not connected");
      if (hasAssistantAfter || !sending) {
        pendingTurn = null;
        return list;
      }
      return [...list, { role: "assistant", text: "Queued — bridge not connected" }];
    }
    const merged = [...list, { role: "user", text: pendingTurn.text }];
    if (sending) merged.push({ role: "assistant", text: "Queued — bridge not connected" });
    return merged;
  }

  function renderSessionRail() {
    if (!sessionList) return;
    const buckets = {};
    for (const s of sessions) {
      const name = sessionBucket(s);
      if (!buckets[name]) buckets[name] = [];
      buckets[name].push(s);
    }
    for (const list of Object.values(buckets)) {
      list.sort((a, b) => {
        const ageDiff = (b.ageMs ?? -1) - (a.ageMs ?? -1);
        if (ageDiff) return ageDiff;
        return (a.key || "").localeCompare(b.key || "");
      });
    }
    let html = "";
    for (const groupName of SESSION_GROUP_ORDER) {
      const items = buckets[groupName];
      if (!items?.length) continue;
      html += `<li class="oc-session-group"><span class="oc-session-group-label">${esc(groupName)}</span><ul class="oc-session-group-list">`;
      for (const s of items) {
        const active = s.key === sessionKey ? " is-active" : "";
        const meta = formatSessionMeta(s);
        html += `<li><button type="button" class="oc-session-item${active}" data-key="${esc(s.key)}"><span class="oc-session-label">${esc(sessionDisplayLabel(s))}</span><span class="oc-session-meta">${esc(meta)}</span></button></li>`;
      }
      html += "</ul></li>";
    }
    sessionList.innerHTML = html;
    sessionList.querySelectorAll(".oc-session-item").forEach((btn) => {
      btn.addEventListener("click", () => selectSession(btn.dataset.key));
    });
  }

  function renderSessionSelect() {
    if (!sessionSelect) return;
    const sorted = [...sessions].sort((a, b) => {
      const ga = SESSION_GROUP_ORDER.indexOf(sessionBucket(a));
      const gb = SESSION_GROUP_ORDER.indexOf(sessionBucket(b));
      if (ga !== gb) return ga - gb;
      return (b.ageMs ?? -1) - (a.ageMs ?? -1);
    });
    sessionSelect.innerHTML = sorted
      .map(
        (s) =>
          `<option value="${esc(s.key)}"${s.key === sessionKey ? " selected" : ""}>${esc(sessionDisplayLabel(s))}</option>`
      )
      .join("");
    if (sessionKey) sessionSelect.value = sessionKey;
  }

  function applySessionMeta(row) {
    if (!row || !sessionKey) return;
    const modelPref = getSessionModelPref(sessionKey) || row.modelKey;
    if (modelPref && modelSelect) {
      const has = [...modelSelect.options].some((o) => o.value === modelPref);
      if (has) {
        modelSelect.value = modelPref;
        localStorage.setItem(MODEL_KEY, modelPref);
      }
    }
    const thinkPref = getSessionThinkingPref(sessionKey) || row.thinkingLevel || "off";
    if (thinkingSelect) {
      const lvl = thinkPref || "off";
      if ([...thinkingSelect.options].some((o) => o.value === lvl)) {
        thinkingSelect.value = lvl;
        localStorage.setItem(THINKING_KEY, lvl);
      }
    }
    syncModelBadgeFromPicker();
  }

  function syncModelBadgeFromPicker() {
    const model = getModel();
    if (!model) {
      setModelBadge("");
      return;
    }
    setModelBadge(
      sessionPatchApplied ? modelShortLabel(model) : `${modelShortLabel(model)} · on send`,
      sessionPatchApplied ? "" : "pending"
    );
  }

  async function patchSessionSettings({ model, thinking } = {}) {
    if (!sessionKey) return { ok: false };
    const payload = { sessionKey };
    if (model !== undefined) payload.model = model;
    if (thinking !== undefined) payload.thinking = thinking;
    if (patchPromise) return patchPromise;
    if (modelSelect) modelSelect.disabled = true;
    if (thinkingSelect) thinkingSelect.disabled = true;
    setModelBadge(modelShortLabel(model ?? getModel()), "applying");
    patchPromise = (async () => {
      try {
        const data = await fetchJson("/api/joy-home/openclaw/session/patch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        sessionPatchApplied = data.patchApplied !== false;
        if (data.session) {
          updateSessionRow(data.session);
          const resolved = data.session.modelKey;
          if (resolved && modelSelect && [...modelSelect.options].some((o) => o.value === resolved)) {
            modelSelect.value = resolved;
            setSessionModelPref(sessionKey, resolved);
          }
        }
        if (data.warning) {
          showPatchHint(data.warning);
          if (!sessionPatchApplied) void refreshScopeStatus();
        } else if (sessionPatchApplied) showPatchHint("");
        syncModelBadgeFromPicker();
        return data;
      } catch (err) {
        sessionPatchApplied = false;
        showPatchHint(err.message || "Could not update session settings.");
        syncModelBadgeFromPicker();
        return { ok: false, error: err.message };
      } finally {
        patchPromise = null;
        if (modelSelect) modelSelect.disabled = sending;
        if (thinkingSelect) thinkingSelect.disabled = sending;
      }
    })();
    return patchPromise;
  }

  async function onModelChange() {
    if (!modelSelect || !sessionKey) return;
    const model = getModel();
    if (modelSelect.value !== model) modelSelect.value = model;
    setSessionModelPref(sessionKey, model);
    await patchSessionSettings({ model });
  }

  async function onThinkingChange() {
    if (!thinkingSelect || !sessionKey) return;
    const thinking = thinkingSelect.value;
    setSessionThinkingPref(sessionKey, thinking);
    updateBadges({}, sessions.find((s) => s.key === sessionKey));
    await patchSessionSettings({ thinking });
  }

  async function selectSession(key) {
    if (!key) return;
    if (inputEl && sessionKey) setDraft(sessionKey, inputEl.value, false);
    if (homeInputEl && sessionKey) setDraft(sessionKey, homeInputEl.value, true);
    sessionKey = key;
    localStorage.setItem(SESSION_KEY, key);
    sessionPatchApplied = true;
    showPatchHint("");
    restoreSessionDrafts();
    renderSessionRail();
    renderSessionSelect();
    const row = sessions.find((s) => s.key === key);
    applySessionMeta(row);
    await loadHistory();
  }

  function renderModelOptions(data) {
    if (!modelSelect) return;
    aliasToModel = {};
    const aliases = data.aliases || {};
    Object.entries(aliases).forEach(([alias, key]) => {
      aliasToModel[key] = alias;
    });
    modelCatalog = (data.models || []).map((m) => {
      if (typeof m === "string") {
        return { key: m, label: aliasToModel[m] || m, provider: m.split("/")[0] };
      }
      const key = m.key;
      const short = m.label || aliasToModel[key] || m.name || key;
      return {
        key,
        label: short,
        longLabel: m.label || m.name || key,
        provider: m.provider || (key || "").split("/")[0],
        available: m.available !== false,
      };
    });
    const keys = modelCatalog.map((m) => m.key);
    const savedRaw = localStorage.getItem(MODEL_KEY);
    const saved = savedRaw ? normalizeModelKey(savedRaw) : "";
    if (saved && saved !== savedRaw) {
      localStorage.setItem(MODEL_KEY, saved);
      if (sessionKey) setSessionModelPref(sessionKey, saved);
    }
    const def =
      saved && keys.includes(saved) ? saved : data.default || keys[0] || "";
    const groups = data.groups || [];
    let html = "";
    if (groups.length) {
      for (const g of groups) {
        html += `<optgroup label="${esc(g.provider)}">`;
        for (const m of g.models || []) {
          const key = m.key;
          const short = m.label || aliasToModel[key] || m.name || key;
          html += `<option value="${esc(key)}"${key === def ? " selected" : ""}>${esc(short)}</option>`;
        }
        html += "</optgroup>";
      }
    } else {
      html = modelCatalog
        .map(
          (m) =>
            `<option value="${esc(m.key)}"${m.key === def ? " selected" : ""}>${esc(m.label)}</option>`
        )
        .join("");
    }
    modelSelect.innerHTML = html || `<option value="${esc(def)}">${esc(def)}</option>`;
    if (def) modelSelect.value = def;
    syncModelBadgeFromPicker();
  }

  function renderThinkingOptions(data) {
    if (!thinkingSelect) return;
    const levels = data.thinkingLevels || [
      "off", "minimal", "low", "medium", "high", "xhigh", "adaptive", "max",
    ];
    const saved = localStorage.getItem(THINKING_KEY);
    const def =
      saved && levels.includes(saved) ? saved : data.defaultThinking || "off";
    thinkingSelect.innerHTML = levels
      .map(
        (lvl) =>
          `<option value="${esc(lvl)}"${lvl === def ? " selected" : ""}>${esc(lvl)}</option>`
      )
      .join("");
    thinkingSelect.value = def;
  }

  async function fetchJson(url, opts) {
    const res = await fetch(url, opts);
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      throw new Error(
        res.status === 404
          ? "Joy Home server needs a restart (API not found). Restart server.py on port 8765."
          : `Unexpected response (${res.status})`
      );
    }
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  }

  async function loadModels() {
    const data = await fetchJson("/api/joy-home/models?ts=" + Date.now());
    renderModelOptions(data);
    renderThinkingOptions(data);
  }

  async function loadSessions(refreshOnly = false) {
    renderSessionRail();
    renderSessionSelect();
    const data = await fetchJson("/api/joy-home/openclaw/sessions?limit=40");
    const fetched = data.sessions || [];
    sessions = fetched;
    if (!refreshOnly) {
      const saved = localStorage.getItem(SESSION_KEY);
      const pick =
        saved && sessions.some((s) => s.key === saved)
          ? saved
          : data.defaultSessionKey || sessions[0]?.key || "";
      if (pick) sessionKey = pick;
    }
    renderSessionRail();
    renderSessionSelect();
    if (sessionKey && !refreshOnly) {
      await selectSession(sessionKey);
    } else if (sessionKey) {
      syncModelBadgeFromPicker();
    }
  }

  async function loadConfig() {
    try {
      const data = await fetchJson("/api/joy-home/openclaw/config");
      if (agentLabel && data.agentLabel) agentLabel.textContent = data.agentLabel;
    } catch (_) {}
  }

  async function loadHistory() {
    if (!sessionKey) {
      renderThread([]);
      return;
    }
    try {
      const data = await fetchJson(
        "/api/joy-home/openclaw/history?sessionKey=" +
          encodeURIComponent(sessionKey) +
          "&limit=80"
      );
      renderThread(mergePendingTurn(data.messages || []));
      updateBadges(data.live || {}, sessions.find((s) => s.key === sessionKey));
      if (homeEchoPending && !pendingTurn) {
        const msgs = data.messages || [];
        const lastUserIdx = msgs.map((m) => m.role).lastIndexOf("user");
        const lastJoy = msgs
          .slice(lastUserIdx + 1)
          .reverse()
          .find((m) => m.role === "assistant" && (m.text || "").trim());
        if (lastJoy) {
          homeEchoPending = false;
          window.joyHomeTranscript?.set("Joy", lastJoy.text, { autoHideMs: 60000 });
          window.joyOrbFx?.notify("info", { sound: false });
          if (voiceReplyPending) {
            // The question came in by voice, so the answer goes out by voice.
            voiceReplyPending = false;
            window.joyVoice?.speak?.(lastJoy.text);
          }
        }
      }
    } catch (err) {
      renderThread([{ role: "assistant", text: "Could not load history: " + err.message }]);
    }
  }

  async function pollLive() {
    if (!sessionKey) return;
    try {
      const data = await fetchJson(
        "/api/joy-home/openclaw/live?sessionKey=" + encodeURIComponent(sessionKey)
      );
      updateBadges(data.live || {}, data.session);
      if (!sending) return;
      const running = isSessionRunning(data.live, data.session);
      const elapsed = pollStartedAt ? Date.now() - pollStartedAt : 0;
      if (sending && elapsed > 1800) setHomeStatus("Queued — bridge not connected", running ? "working" : "queued");
      // Grace covers the moment right after send before the run registers as
      // running; longer than that just delays hearing the reply.
      const gracePeriod = elapsed < 1200;
      const timedOut = elapsed > 300000;
      if ((!running && !gracePeriod) || timedOut) {
        await loadHistory();
        await loadSessions(true);
        if (timedOut && !running) {
          showPatchHint("Run timed out — refresh if the reply is missing.");
        }
        finishSend(timedOut ? "Queued — reply will appear in history" : "Ready", timedOut ? "queued" : "ready");
      }
    } catch (_) {}
  }

  function startLivePoll() {
    stopLivePoll();
    pollStartedAt = Date.now();
    pollTimer = setInterval(pollLive, 600);
    pollLive();
  }

  function stopLivePoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  async function newSession() {
    try {
      pendingTurn = null;
      if (inputEl && sessionKey) setDraft(sessionKey, inputEl.value, false);
      if (homeInputEl && sessionKey) setDraft(sessionKey, homeInputEl.value, true);
      const data = await fetchJson("/api/joy-home/openclaw/session/new", { method: "POST" });
      const key = data.sessionKey;
      if (!key) return;
      const row = {
        key,
        label: data.label || sessionDisplayLabel({ key, label: data.label }),
        age: "now",
        ageMs: 0,
        modelKey: getModel(),
        usagePercent: null,
        kind: "joy-home",
      };
      sessions = [row, ...sessions.filter((s) => s.key !== key)];
      sessionKey = key;
      sessionPatchApplied = false;
      localStorage.setItem(SESSION_KEY, key);
      restoreSessionDrafts();
      showPatchHint("");
      renderSessionRail();
      renderSessionSelect();
      renderThread([]);
      if (quickPrompts) quickPrompts.hidden = true;
      syncModelBadgeFromPicker();
      await patchSessionSettings({ model: getModel(), thinking: getThinking() });
      inputEl?.focus();
      void loadSessions(true);
    } catch (err) {
      showPatchHint("Could not create session: " + err.message);
    }
  }

  async function refreshAll() {
    showPatchHint("");
    await loadSessions();
    if (sessionKey) await loadHistory();
  }

  async function abortRun() {
    if (!sessionKey) return;
    await fetch("/api/joy-home/openclaw/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionKey, runId: activeRunId }),
    });
    finishSend();
    await loadHistory();
  }

  async function sendDraft(text, options = {}) {
    if (!sessionKey) return false;
    text = String(text || "").trim();
    if (!text) return;
    if (sending || isDuplicateSubmit(text)) {
      setHomeStatus("Already queued", "queued");
      return false;
    }
    sending = true;
    markFingerprint(text);
    pendingTurn = { sessionKey, text };
    voiceReplyPending = options.voiceReply === true;
    if (voiceReplyPending) homeEchoPending = true;
    setRunState(true);
    setHomeRunState(true);
    setHomeStatus("Accepted — queueing", "accepted");
    showPatchHint("");
    if (options.clearTextInput !== false && inputEl) inputEl.value = "";
    if (quickPrompts) quickPrompts.hidden = true;

    const prior = [];
    if (!options.skipPreloadHistory) {
      try {
        const hdata = await fetchJson(
          "/api/joy-home/openclaw/history?sessionKey=" +
            encodeURIComponent(sessionKey) +
            "&limit=80"
        );
        prior.push(...(hdata.messages || []));
      } catch (_) {}
    }
    renderThread(mergePendingTurn(prior));
    startLivePoll();

    try {
      if (patchPromise) await patchPromise;
      const data = await fetchJson("/api/joy-home/openclaw/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionKey,
          message: text,
          model: options.model || getModel(),
          thinking: options.thinking !== undefined
            ? (options.thinking === "off" ? "" : options.thinking)
            : (getThinking() === "off" ? "" : getThinking()),
          voice: options.voiceReply === true,
          skipPatch: sessionPatchApplied,
        }),
      });
      activeRunId = data.runId;
      if (data.messageId) pendingTurn.messageId = data.messageId;
      sessionPatchApplied = data.patchApplied !== false;
      if (data.patchWarning && !sessionPatchApplied) showPatchHint(data.patchWarning);
      else if (sessionPatchApplied) showPatchHint("");
      syncModelBadgeFromPicker();
      if (window.joyShell) window.joyShell.appendActionLog("You", text);
      if (window.joyShell && data.status === "started") {
        window.joyShell.appendActionLog("Joy", "Run started…");
      }
      setDraft(sessionKey, "", false);
      if (options.restoreHome) setDraft(sessionKey, "", true);
      setHomeStatus(data.status === "queued" ? "Queued — waiting for Joy" : "Working", data.status === "queued" ? "queued" : "working");
      return true;
    } catch (err) {
      pendingTurn = null;
      voiceReplyPending = false;
      prior.push({ role: "user", text });
      prior.push({ role: "assistant", text: "Error: " + err.message });
      renderThread(prior);
      if (inputEl) inputEl.value = text;
      if (options.restoreHome && homeInputEl) homeInputEl.value = text;
      setDraft(sessionKey, text, false);
      if (options.restoreHome) setDraft(sessionKey, text, true);
      lastFailedHomeDraft = text;
      setHomeStatus("Failed — draft restored. Press send to retry.", "failed");
      showPatchHint("Message was not sent. I restored the draft so you can retry.");
      finishSend("Failed — draft restored. Press send to retry.", "failed");
      return false;
    }
  }

  async function sendText() {
    if (!inputEl || sending || !sessionKey) return;
    const text = inputEl.value.trim();
    if (!text) return;
    setDraft(sessionKey, text, false);
    await sendDraft(text);
  }

  async function sendHomeText() {
    if (!homeInputEl) return;
    const text = homeInputEl.value.trim();
    if (!text) return;
    mirrorHomeDraft(text, { hold: true });
    if (sending) {
      setHomeStatus("Still working", "thinking");
      return;
    }
    if (!sessionKey) {
      setHomeStatus("Connecting", "thinking");
      inputEl && (inputEl.value = text);
      return;
    }
    setDraft(sessionKey, text, true);
    homeInputEl.value = "";
    if (inputEl) inputEl.value = "";
    homeEchoPending = true;
    const ok = await sendDraft(text, { restoreHome: true, clearTextInput: false, skipPreloadHistory: true });
    if (ok === false) {
      homeEchoPending = false;
      window.joyHomeTranscript?.set("Joy", "That didn't send - I restored your draft so you can retry.", { autoHideMs: 60000 });
    }
  }

  if (sendBtn) sendBtn.addEventListener("click", sendText);
  if (homeSendBtn) homeSendBtn.addEventListener("click", sendHomeText);
  if (homeStopBtn) homeStopBtn.addEventListener("click", abortRun);
  if (abortBtn) abortBtn.addEventListener("click", abortRun);
  if (refreshBtn) refreshBtn.addEventListener("click", refreshAll);
  if (scopeApproveBtn) scopeApproveBtn.addEventListener("click", approveScope);
  if (newSessionBtn) newSessionBtn.addEventListener("click", newSession);
  const newSessionSideBtn = document.getElementById("ocNewSessionSide");
  if (newSessionSideBtn) newSessionSideBtn.addEventListener("click", newSession);
  if (sessionSelect) {
    sessionSelect.addEventListener("change", () => selectSession(sessionSelect.value));
  }
  if (modelSelect) {
    modelSelect.addEventListener("change", () => {
      void onModelChange();
    });
  }
  if (thinkingSelect) {
    thinkingSelect.addEventListener("change", () => {
      void onThinkingChange();
    });
  }
  if (inputEl) {
    inputEl.addEventListener("input", () => setDraft(sessionKey, inputEl.value, false));
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendText();
      }
    });
  }
  if (homeInputEl) {
    homeInputEl.addEventListener("input", () => {
      const text = homeInputEl.value.trim();
      setDraft(sessionKey, homeInputEl.value, true);
      window.clearTimeout(homeDraftPreviewTimer);
      if (!text) return;
      homeDraftPreviewTimer = window.setTimeout(() => mirrorHomeDraft(text), 90);
    });
    homeInputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendHomeText();
      }
    });
  }
  if (quickPrompts) {
    quickPrompts.querySelectorAll(".oc-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        if (inputEl) inputEl.value = chip.dataset.prompt || "";
        sendText();
      });
    });
  }

  window.joyTextChat = {
    send: sendText,
    sendDraft,
    sendHome: sendHomeText,
    setHomeDraft(text, status) {
      if (homeInputEl) {
        homeInputEl.value = String(text || "");
        homeInputEl.focus();
      }
      if (status) setHomeStatus(status, "draft");
    },
    setHomeStatus,
    startVoiceDraft,
    _drafts: { getDraft, setDraft, restoreSessionDrafts, isDuplicateSubmit },
    getModel,
    getThinking,
    selectSession,
    reload: async () => {
      await loadModels();
      await refreshAll();
    },
    focus() {
      inputEl?.focus();
    },
  };

  (async function init() {
    setRunState(false);
    renderSessionRail();
    renderSessionSelect();
    restoreSessionDrafts();
    setHomeStatus("Ready", "ready");
    try {
      await Promise.all([loadConfig(), loadModels(), refreshScopeStatus()]);
      await loadSessions();
    } catch (err) {
      if (threadEl) {
        threadEl.innerHTML =
          `<div class="text-chat-empty">${esc(err.message || "Could not connect to Joy Home APIs.")}<br><br>Joy Home could not load its live OpenClaw state. Refresh once; if it persists, check the Joy Home service.</div>`;
      }
    }
  })();
})();
