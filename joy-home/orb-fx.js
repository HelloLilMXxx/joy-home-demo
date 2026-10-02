/* Joy Home — Orb FX engine
 * Makes the orb feel alive: real-time audio-reactive motion (your voice in,
 * Joy's voice out), notification pulses, and a warmer Web Audio cue set.
 * Self-contained; app.js/brief.js call into window.joyOrbFx. Every entry
 * point is guarded so a failure here can never break voice or playback.
 */
(function () {
  "use strict";

  const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const PERSONALITY_CLASSES = [
    "orb-personality-calm",
    "orb-personality-curious",
    "orb-personality-focused",
    "orb-personality-playful",
    "orb-personality-concerned",
    "orb-personality-alert"
  ];

  let breatheTimer = null;
  let currentPersonality = "";
  let pointerFrame = null;

  function getOrb() {
    return document.getElementById("orb");
  }

  function setPersonality(name) {
    const orb = getOrb();
    if (!orb) return false;
    const next = name || "calm";
    if (currentPersonality === next) return true;
    orb.classList.remove(...PERSONALITY_CLASSES);
    orb.classList.add("orb-personality-" + next);
    currentPersonality = next;
    return true;
  }

  function personalityForStage(stage) {
    if (!stage) return "calm";
    if (stage.classList.contains("state-error")) return "alert";
    if (stage.classList.contains("state-thinking")) return "focused";
    if (stage.classList.contains("state-listening") || stage.classList.contains("state-realtime")) return "curious";
    if (stage.classList.contains("state-responding")) return "playful";
    return "calm";
  }

  function syncPersonality() {
    setPersonality(personalityForStage(document.getElementById("stage")));
  }

  function scheduleBreath() {
    if (reducedMotion) return;
    window.clearTimeout(breatheTimer);
    const orb = getOrb();
    if (!orb) return;
    const stage = document.getElementById("stage");
    const active = stage && !stage.classList.contains("state-ambient");
    const base = active ? 4.8 : 8.2;
    const variation = 0.86 + Math.random() * 0.28;
    const min = active ? 0.955 + Math.random() * 0.025 : 0.965 + Math.random() * 0.018;
    const max = active ? 1.065 + Math.random() * 0.04 : 1.025 + Math.random() * 0.028;
    orb.style.setProperty("--breathe-duration", (base * variation).toFixed(2) + "s");
    orb.style.setProperty("--breathe-scale-min", min.toFixed(3));
    orb.style.setProperty("--breathe-scale-max", max.toFixed(3));
    breatheTimer = window.setTimeout(scheduleBreath, (base * variation * 1000) + 350);
  }

  function bindStageObserver() {
    const stage = document.getElementById("stage");
    if (!stage) return;
    syncPersonality();
    if (!reducedMotion) scheduleBreath();
    try {
      new MutationObserver(() => {
        syncPersonality();
        scheduleBreath();
      }).observe(stage, { attributes: true, attributeFilter: ["class"] });
    } catch (e) {}
  }

  function bindPointerPresence() {
    if (reducedMotion) return;
    const stage = document.getElementById("stage");
    const orb = getOrb();
    if (!stage || !orb) return;
    stage.addEventListener("pointermove", (event) => {
      if (pointerFrame) return;
      pointerFrame = requestAnimationFrame(() => {
        pointerFrame = null;
        const rect = orb.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = Math.max(-1, Math.min(1, (event.clientX - cx) / Math.max(1, rect.width * 1.8)));
        const dy = Math.max(-1, Math.min(1, (event.clientY - cy) / Math.max(1, rect.height * 1.8)));
        orb.style.setProperty("--joy-orb-tilt-y", (dx * 4.5).toFixed(2) + "deg");
        orb.style.setProperty("--joy-orb-tilt-x", (dy * -3.5).toFixed(2) + "deg");
      });
    }, { passive: true });
    stage.addEventListener("pointerleave", () => {
      orb.style.setProperty("--joy-orb-tilt-y", "0deg");
      orb.style.setProperty("--joy-orb-tilt-x", "0deg");
    }, { passive: true });
  }

  /* ---------- Procedural 3D orb model ----------
   * A dependency-free perspective projection of a rotating Fibonacci sphere.
   * Each point is a vertex on the model, depth-sorted every frame. This keeps
   * Joy's presence genuinely spatial without a CDN or a fragile WebGL bundle.
   */
  function mountOrbModel3d() {
    const canvas = document.getElementById("joyOrb3d");
    const orb = getOrb();
    if (!canvas || !orb || typeof canvas.getContext !== "function") return;
    const draw = canvas.getContext("2d", { alpha: true });
    if (!draw) return;

    const vertices = [];
    const count = 720;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const y = 1 - (i / (count - 1)) * 2;
      const radius = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * i;
      vertices.push({ x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius, seed: i % 17 });
    }

    let width = 0;
    let height = 0;
    let angle = 0;
    let frame = null;
    let visible = true;
    let firstPaint = false;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const nextWidth = Math.max(1, Math.round(rect.width * dpr));
      const nextHeight = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
      }
      width = nextWidth;
      height = nextHeight;
    }

    function rotatePoint(point, ax, ay) {
      const cosY = Math.cos(ay);
      const sinY = Math.sin(ay);
      const x1 = point.x * cosY - point.z * sinY;
      const z1 = point.x * sinY + point.z * cosY;
      const cosX = Math.cos(ax);
      const sinX = Math.sin(ax);
      return { x: x1, y: point.y * cosX - z1 * sinX, z: point.y * sinX + z1 * cosX, seed: point.seed };
    }

    function stageMotion() {
      const stage = document.getElementById("stage");
      if (!stage) return { mode: "ambient", speed: 0.0022, energy: 0.22 };
      if (stage.classList.contains("state-listening") || stage.classList.contains("state-realtime")) return { mode: "listening", speed: 0.0068, energy: 0.72 };
      if (stage.classList.contains("state-stopping")) return { mode: "stopping", speed: 0.003, energy: 0.42 };
      if (stage.classList.contains("state-thinking")) return { mode: "thinking", speed: 0.012, energy: 0.9 };
      if (stage.classList.contains("state-responding")) return { mode: "responding", speed: 0.0052, energy: 0.65 };
      if (stage.classList.contains("state-error")) return { mode: "error", speed: 0.001, energy: 0.82 };
      return { mode: "ambient", speed: 0.0022, energy: 0.22 };
    }

    function drawStateFx(state, now, cx, cy, radius) {
      draw.save();
      draw.globalCompositeOperation = "screen";
      draw.lineWidth = Math.max(1.2, width / 820);
      if (state.mode === "ambient") {
        // Breathing ring, phase-locked to the body's breath cycle.
        const b = (Math.sin(now * 0.00095) + 1) / 2;
        draw.globalAlpha = 0.05 + b * 0.08;
        draw.strokeStyle = "rgba(196,181,253,0.9)";
        draw.beginPath();
        draw.arc(cx, cy, radius * (1.16 + b * 0.06), 0, Math.PI * 2);
        draw.stroke();
      } else if (state.mode === "listening") {
        for (let i = 0; i < 3; i++) {
          const phase = ((now * 0.00055) + i / 3) % 1;
          draw.globalAlpha = (1 - phase) * 0.56;
          draw.strokeStyle = i === 1 ? "rgba(93,232,255,0.95)" : "rgba(196,181,253,0.95)";
          draw.beginPath();
          draw.arc(cx, cy, radius * (1.02 + phase * 0.42), 0, Math.PI * 2);
          draw.stroke();
        }
      } else if (state.mode === "thinking") {
        // Inner core pulse: computation happening at the center.
        const corePulse = (Math.sin(now * 0.008) + 1) / 2;
        const core = draw.createRadialGradient(cx, cy, 0, cx, cy, radius * (0.36 + corePulse * 0.12));
        core.addColorStop(0, `rgba(255,255,255,${(0.2 + corePulse * 0.28).toFixed(3)})`);
        core.addColorStop(1, "rgba(180,150,255,0)");
        draw.globalAlpha = 1;
        draw.fillStyle = core;
        draw.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
        for (let i = 0; i < 3; i++) {
          const dir = i % 2 ? -1 : 1;
          const a = now * 0.0022 * dir + i * 2.094;
          const rx = radius * (1.2 + i * 0.08);
          const ry = radius * (0.28 + i * 0.07);
          draw.globalAlpha = 0.3 + i * 0.12;
          draw.strokeStyle = i === 1 ? "rgba(92,229,255,0.85)" : "rgba(218,202,255,0.88)";
          draw.beginPath();
          draw.ellipse(cx, cy, rx, ry, a * 0.18, 0, Math.PI * 2);
          draw.stroke();
          // Orbiter with a fading comet trail.
          const dotR = Math.max(2, width / 320);
          for (let t = 4; t >= 0; t--) {
            const ta = a - dir * t * 0.11;
            draw.globalAlpha = t === 0 ? 0.95 : 0.4 * (1 - t / 5);
            draw.fillStyle = i === 1 ? "rgba(127,241,255,1)" : "rgba(242,237,255,1)";
            draw.beginPath();
            draw.arc(cx + Math.cos(ta) * rx, cy + Math.sin(ta) * ry, dotR * (t === 0 ? 1 : 0.72 - t * 0.09), 0, Math.PI * 2);
            draw.fill();
          }
        }
      } else if (state.mode === "stopping") {
        const settle = Math.min(1, (now % 700) / 700);
        draw.globalAlpha = 0.56 * (1 - settle);
        draw.strokeStyle = "rgba(232,222,255,0.95)";
        draw.lineWidth = Math.max(2, width / 600);
        draw.beginPath();
        draw.arc(cx, cy, radius * (1.35 - settle * 0.3), -Math.PI * 0.15, Math.PI * (1.15 + settle * 0.7));
        draw.stroke();
      } else if (state.mode === "error") {
        draw.globalAlpha = 0.88;
        draw.strokeStyle = "rgba(255,92,151,0.95)";
        draw.setLineDash([Math.max(5, width / 80), Math.max(4, width / 130)]);
        draw.beginPath();
        draw.arc(cx, cy, radius * 1.18, now * 0.001, Math.PI * 1.35 + now * 0.001);
        draw.stroke();
        draw.setLineDash([]);
        draw.lineWidth = Math.max(2, width / 520);
        draw.beginPath();
        draw.moveTo(cx - radius * 0.54, cy - radius * 0.42);
        draw.lineTo(cx + radius * 0.46, cy + radius * 0.5);
        draw.moveTo(cx + radius * 0.48, cy - radius * 0.44);
        draw.lineTo(cx - radius * 0.5, cy + radius * 0.48);
        draw.stroke();
      } else if (state.mode === "responding") {
        const pulse = (Math.sin(now * 0.006) + 1) / 2;
        draw.globalAlpha = 0.2 + pulse * 0.32;
        draw.strokeStyle = "rgba(231,221,255,0.95)";
        draw.beginPath();
        draw.arc(cx, cy, radius * (1.06 + pulse * 0.1), 0, Math.PI * 2);
        draw.stroke();
      }
      draw.restore();
    }

    function voiceLevel() {
      const raw = getComputedStyle(orb).getPropertyValue("--voice-level");
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    }

    function paint(now) {
      if (!visible) return;
      resize();
      draw.clearRect(0, 0, width, height);
      let cx = width / 2;
      let cy = height / 2;
      const state = stageMotion();
      const voice = voiceLevel();
      if (state.mode === "error" && !reducedMotion) {
        cx += Math.sin(now * 0.041) * width * 0.006;
        cy += Math.cos(now * 0.037) * height * 0.004;
      }
      // Two-phase breathing: a slow deep cycle with a light overlay, strongest
      // at rest so Joy reads as alive even when nothing is happening.
      const breathPhase = Math.sin(now * 0.00095);
      const breatheAmp = state.mode === "ambient" ? 1 : 0.45;
      const breathe = reducedMotion
        ? 1
        : 1 + (breathPhase * 0.026 + Math.sin(now * 0.0021 + 1.3) * 0.007) * breatheAmp;
      const settleScale = state.mode === "stopping" ? 0.96 + Math.cos(now * 0.018) * 0.018 : 1;
      // 0.216 * the 150% canvas = the sphere size the orb had before the
      // canvas was enlarged for the aura.
      const modelRadius = Math.min(width, height) * (0.216 + voice * 0.014) * breathe * settleScale;
      angle += reducedMotion ? 0 : state.speed + voice * 0.01;

      // Purple aura: Joy's presence beyond the sphere, breathing with her and
      // swelling with activity and voice.
      const auraStrength = 0.15
        + (reducedMotion ? 0.05 : (breathPhase + 1) * 0.05)
        + state.energy * 0.1
        + voice * 0.2;
      const aura = draw.createRadialGradient(cx, cy, modelRadius * 0.55, cx, cy, modelRadius * 2.2);
      aura.addColorStop(0, `rgba(139,92,246,${Math.min(0.5, auraStrength).toFixed(3)})`);
      aura.addColorStop(0.45, `rgba(109,40,217,${Math.min(0.34, auraStrength * 0.6).toFixed(3)})`);
      aura.addColorStop(1, "rgba(76,29,149,0)");
      draw.fillStyle = aura;
      draw.fillRect(0, 0, width, height);

      const halo = draw.createRadialGradient(cx * 0.88, cy * 0.82, modelRadius * 0.06, cx, cy, modelRadius * 1.24);
      halo.addColorStop(0, "rgba(249,247,255,0.98)");
      halo.addColorStop(0.16, "rgba(216,195,255,0.96)");
      halo.addColorStop(0.48, "rgba(139,92,246,0.78)");
      halo.addColorStop(0.82, "rgba(66,20,132,0.62)");
      halo.addColorStop(1, "rgba(10,6,28,0)");
      draw.fillStyle = halo;
      draw.beginPath();
      draw.arc(cx, cy, modelRadius * 1.1, 0, Math.PI * 2);
      draw.fill();

      drawStateFx(state, now, cx, cy, modelRadius);

      const projected = vertices.map((point) => rotatePoint(point, -0.2 + Math.sin(angle * 0.43) * 0.13, angle));
      projected.sort((a, b) => a.z - b.z);
      draw.globalCompositeOperation = "screen";
      // Directional light from the upper-left front (matches the halo's
      // highlight) plus a rim term so the silhouette catches light — this is
      // what makes the sphere read as lit rather than flat-shaded.
      const lx = -0.46, ly = -0.5, lz = 0.735;
      for (const point of projected) {
        const perspective = 2.7 / (3.5 - point.z);
        const px = cx + point.x * modelRadius * perspective;
        const py = cy + point.y * modelRadius * perspective;
        const front = (point.z + 1) / 2;
        const lambert = Math.max(0, point.x * lx + point.y * ly + point.z * lz);
        const rim = (1 - Math.abs(point.z)) * (1 - Math.abs(point.z));
        // Light shapes the sphere; the front term keeps the shadow side from
        // going flat-dark (dots blend with "screen", so dim means invisible).
        const lit = Math.min(1, 0.42 * front + 0.72 * Math.pow(lambert, 1.4) + rim * 0.28);
        const twinkle = reducedMotion ? 1 : 1 + Math.sin(now * 0.0027 + point.seed * 2.4) * 0.16;
        // Thinking reads as neural activity: pseudo-random vertices fire.
        const flash = (state.mode === "thinking" && !reducedMotion
          && (point.seed * 31 + Math.floor(now / 240)) % 47 === 0) ? 0.5 : 0;
        const sparkle = point.seed === 0 ? 1.75 : point.seed < 3 ? 1.18 : 1;
        const size = Math.max(0.7, (0.75 + front * 1.9 + lit * 1.5 + voice * 1.8 + flash * 1.6) * sparkle * twinkle * (width / 1100));
        const alpha = Math.min(0.95, 0.08 + lit * (0.46 + state.energy * 0.25) + voice * 0.22 + flash * 0.45);
        draw.fillStyle = point.seed === 0
          ? `rgba(246,242,255,${Math.min(0.97, alpha + 0.2)})`
          : `rgba(${Math.round(148 + lit * 102)},${Math.round(96 + lit * 135)},255,${alpha.toFixed(3)})`;
        draw.beginPath();
        draw.arc(px, py, size, 0, Math.PI * 2);
        draw.fill();
      }

      draw.globalAlpha = 0.2 + state.energy * 0.16 + voice * 0.2;
      draw.strokeStyle = "rgba(226,214,255,0.9)";
      draw.lineWidth = Math.max(1, width / 1160);
      for (let band = -2; band <= 2; band++) {
        draw.beginPath();
        for (let step = 0; step <= 80; step++) {
          const t = (step / 80) * Math.PI * 2;
          const y = band * 0.22;
          const r = Math.sqrt(1 - y * y);
          const p = rotatePoint({ x: Math.cos(t) * r, y, z: Math.sin(t) * r }, -0.2, angle);
          const perspective = 2.7 / (3.5 - p.z);
          const px = cx + p.x * modelRadius * perspective;
          const py = cy + p.y * modelRadius * perspective;
          if (step === 0) draw.moveTo(px, py); else draw.lineTo(px, py);
        }
        draw.stroke();
      }
      draw.globalAlpha = 1;
      draw.globalCompositeOperation = "source-over";

      if (!firstPaint) {
        firstPaint = true;
        orb.classList.add("orb-3d-ready");
      }
      if (!reducedMotion) frame = requestAnimationFrame(paint);
    }

    const observer = typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => {
          visible = Boolean(entries[0] && entries[0].isIntersecting) && !document.hidden;
          if (visible && !frame && !reducedMotion) frame = requestAnimationFrame(paint);
          if (!visible && frame) { cancelAnimationFrame(frame); frame = null; }
        }, { threshold: 0.01 })
      : null;
    if (observer) observer.observe(canvas);
    document.addEventListener("visibilitychange", () => {
      visible = !document.hidden;
      if (visible && !frame) frame = requestAnimationFrame(paint);
      if (!visible && frame) { cancelAnimationFrame(frame); frame = null; }
    });
    window.addEventListener("resize", resize, { passive: true });
    resize();
    frame = requestAnimationFrame(paint);
    window.joyOrb3d = { repaint: () => paint(performance.now()) };
  }

  /* ---------- Audio cue engine ---------- */
  let ctx = null;
  let masterOut = null;

  function getCtx() {
    if (ctx) return ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20;
      comp.ratio.value = 6;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 7200;
      const gain = ctx.createGain();
      gain.gain.value = 0.9;
      gain.connect(lp);
      lp.connect(comp);
      comp.connect(ctx.destination);
      masterOut = gain;
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  function tone(opts) {
    const c = getCtx();
    if (!c || !masterOut) return;
    const t0 = c.currentTime + (opts.at || 0);
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = opts.type || "sine";
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.glideTo) osc.frequency.exponentialRampToValueAtTime(opts.glideTo, t0 + (opts.glideTime || opts.dur * 0.7));
    if (opts.detune) osc.detune.value = opts.detune;
    const attack = opts.attack || 0.008;
    const peak = opts.peak || 0.1;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    osc.connect(gain);
    gain.connect(masterOut);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.05);
  }

  function airSweep(opts) {
    const c = getCtx();
    if (!c || !masterOut) return;
    const t0 = c.currentTime + (opts.at || 0);
    const dur = opts.dur || 0.5;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 8;
    bp.frequency.setValueAtTime(opts.from || 900, t0);
    bp.frequency.exponentialRampToValueAtTime(opts.to || 3200, t0 + dur);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(opts.peak || 0.03, t0 + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp);
    bp.connect(gain);
    gain.connect(masterOut);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  function bell(freq, at, peak, dur) {
    tone({ freq, at, peak, dur, type: "sine" });
    tone({ freq: freq * 2.0, at, peak: peak * 0.32, dur: dur * 0.72, type: "sine", detune: 4 });
    tone({ freq: freq * 3.01, at, peak: peak * 0.1, dur: dur * 0.45, type: "sine" });
  }

  const CUES = {
    "listen-start": () => {
      tone({ freq: 440, glideTo: 659, glideTime: 0.14, dur: 0.22, peak: 0.09, attack: 0.012 });
      tone({ freq: 880, at: 0.05, dur: 0.18, peak: 0.028, type: "triangle" });
      airSweep({ from: 800, to: 2800, dur: 0.28, peak: 0.02 });
    },
    "listen-stop": () => {
      tone({ freq: 659, glideTo: 440, glideTime: 0.14, dur: 0.22, peak: 0.07, attack: 0.012 });
      airSweep({ from: 2400, to: 700, dur: 0.26, peak: 0.016 });
    },
    thinking: () => {
      [620, 700, 784].forEach((f, i) => tone({ freq: f, at: i * 0.07, dur: 0.06, peak: 0.045 }));
    },
    success: () => {
      tone({ freq: 523, dur: 0.18, peak: 0.1, type: "triangle" });
      tone({ freq: 659, at: 0.13, dur: 0.2, peak: 0.1, type: "triangle" });
      tone({ freq: 1046, at: 0.13, dur: 0.24, peak: 0.03 });
    },
    error: () => {
      tone({ freq: 220, dur: 0.24, peak: 0.06, type: "sawtooth" });
      tone({ freq: 164, at: 0.05, dur: 0.24, peak: 0.045, type: "sine" });
    },
    wake: () => {
      tone({ freq: 220, dur: 0.55, peak: 0.05, attack: 0.09 });
      tone({ freq: 660, at: 0.08, dur: 0.5, peak: 0.035, attack: 0.12, type: "triangle" });
      airSweep({ from: 600, to: 3600, dur: 0.5, peak: 0.02 });
    },
    notify: () => {
      bell(880, 0, 0.07, 0.7);
      bell(1174, 0.11, 0.045, 0.6);
    },
    approval: () => {
      bell(784, 0, 0.08, 0.55);
      bell(659, 0.22, 0.075, 0.75);
    }
  };

  function cue(name) {
    const fn = CUES[name];
    if (!fn) return false;
    const c = getCtx();
    if (!c) return false;
    if (c.state === "suspended") c.resume().catch(() => {});
    try { fn(); } catch (e) {}
    return true;
  }

  /* ---------- Live level engine (orb follows real audio) ---------- */
  let micAnalyser = null;
  let micSource = null;
  let outAnalyser = null;
  let outSource = null;
  let levelFrame = null;
  let smoothLevel = 0;
  let freqData = null;
  let barEls = null;

  function makeAnalyser(c) {
    const a = c.createAnalyser();
    a.fftSize = 256;
    a.smoothingTimeConstant = 0.72;
    return a;
  }

  function bindMicStream(stream) {
    const c = getCtx();
    if (!c || !stream) return;
    releaseMic();
    try {
      micSource = c.createMediaStreamSource(stream);
      micAnalyser = makeAnalyser(c);
      micSource.connect(micAnalyser); // analyser only — never routed to speakers
      startLevelLoop();
    } catch (e) {
      micAnalyser = null;
      micSource = null;
    }
  }

  function bindOutputAudio(audioEl) {
    const c = getCtx();
    if (!c || !audioEl) return;
    releaseOutput();
    try {
      let stream = null;
      if (audioEl.srcObject instanceof MediaStream) {
        stream = audioEl.srcObject;
      } else if (typeof audioEl.captureStream === "function") {
        stream = audioEl.captureStream();
      } else if (typeof audioEl.mozCaptureStream === "function") {
        stream = audioEl.mozCaptureStream();
      }
      if (!stream || stream.getAudioTracks().length === 0) return;
      outSource = c.createMediaStreamSource(stream);
      outAnalyser = makeAnalyser(c);
      outSource.connect(outAnalyser);
      startLevelLoop();
    } catch (e) {
      outAnalyser = null;
      outSource = null;
    }
  }

  function releaseMic() {
    try { if (micSource) micSource.disconnect(); } catch (e) {}
    micSource = null;
    micAnalyser = null;
    maybeStopLoop();
  }

  function releaseOutput() {
    try { if (outSource) outSource.disconnect(); } catch (e) {}
    outSource = null;
    outAnalyser = null;
    maybeStopLoop();
  }

  function releaseAll() {
    releaseMic();
    releaseOutput();
  }

  function readLevel(analyser) {
    if (!freqData || freqData.length !== analyser.frequencyBinCount) {
      freqData = new Uint8Array(analyser.frequencyBinCount);
    }
    analyser.getByteFrequencyData(freqData);
    // Weight the voice band (roughly bins 2-60 at 48kHz/fft256)
    let sum = 0;
    let count = 0;
    for (let i = 2; i < Math.min(64, freqData.length); i++) {
      sum += freqData[i];
      count++;
    }
    return count ? sum / (count * 255) : 0;
  }

  function startLevelLoop() {
    if (levelFrame) return;
    const orb = document.getElementById("orb");
    const waveform = document.getElementById("waveform");
    if (orb) orb.classList.add("orb-voice-live");
    if (waveform) {
      waveform.classList.add("live");
      barEls = waveform.querySelectorAll(".bar");
    }
    const step = () => {
      const analyser = micAnalyser || outAnalyser;
      if (!analyser) { stopLevelLoop(); return; }
      const raw = readLevel(analyser);
      // Fast attack, slow release — feels like breath, not jitter
      smoothLevel = raw > smoothLevel ? smoothLevel + (raw - smoothLevel) * 0.55 : smoothLevel + (raw - smoothLevel) * 0.12;
      const level = Math.min(1, smoothLevel * 2.4);
      if (orb) orb.style.setProperty("--voice-level", level.toFixed(3));
      if (barEls && barEls.length && freqData && !reducedMotion) {
        const bins = freqData.length;
        const n = barEls.length;
        const mid = (n - 1) / 2;
        for (let i = 0; i < n; i++) {
          // Symmetric around center: center bars carry the low/mid voice energy
          const dist = Math.abs(i - mid) / mid;
          const bin = 2 + Math.floor(dist * Math.min(70, bins - 3));
          const v = (freqData[bin] || 0) / 255;
          const h = 0.16 + v * 0.84;
          barEls[i].style.height = (h * 100).toFixed(1) + "%";
          barEls[i].style.opacity = (0.35 + v * 0.65).toFixed(2);
        }
      }
      levelFrame = requestAnimationFrame(step);
    };
    levelFrame = requestAnimationFrame(step);
  }

  function stopLevelLoop() {
    if (levelFrame) cancelAnimationFrame(levelFrame);
    levelFrame = null;
    smoothLevel = 0;
    const orb = document.getElementById("orb");
    const waveform = document.getElementById("waveform");
    if (orb) {
      orb.classList.remove("orb-voice-live");
      orb.style.removeProperty("--voice-level");
    }
    if (waveform) {
      waveform.classList.remove("live");
      waveform.querySelectorAll(".bar").forEach((b) => {
        b.style.height = "";
        b.style.opacity = "";
      });
    }
    barEls = null;
  }

  function maybeStopLoop() {
    if (!micAnalyser && !outAnalyser) stopLevelLoop();
  }

  /* ---------- Notification pulses ---------- */
  const lastNotify = {};

  function notify(kind, opts) {
    kind = kind || "info";
    opts = opts || {};
    const now = Date.now();
    if (lastNotify[kind] && now - lastNotify[kind] < 4000) return; // debounce bursts
    lastNotify[kind] = now;

    const orb = document.getElementById("orb");
    if (orb && !reducedMotion) {
      const previousPersonality = currentPersonality || "calm";
      if (kind === "approval") setPersonality("alert");
      else if (kind === "wake") setPersonality("curious");
      else setPersonality("focused");
      orb.classList.remove("orb-notify", "orb-notify-approval", "orb-notify-wake", "orb-notify-info");
      // force reflow so re-adding restarts the bounce animation
      void orb.offsetWidth;
      orb.classList.add("orb-notify", "orb-notify-" + kind);
      for (let i = 0; i < 2; i++) {
        const ring = document.createElement("span");
        ring.className = "notify-ring" + (i ? " ring-2" : "");
        orb.appendChild(ring);
        window.setTimeout(() => { if (ring.parentNode) ring.parentNode.removeChild(ring); }, 1800);
      }
      window.setTimeout(() => {
        orb.classList.remove("orb-notify", "orb-notify-" + kind);
        setPersonality(personalityForStage(document.getElementById("stage")) || previousPersonality);
      }, 1700);
    }

    if (opts.sound !== false) {
      cue(kind === "approval" ? "approval" : kind === "wake" ? "wake" : "notify");
    }
  }

  window.joyOrbFx = {
    cue,
    notify,
    setPersonality,
    bindMicStream,
    bindOutputAudio,
    releaseMic,
    releaseOutput,
    releaseAll
  };

  bindStageObserver();
  bindPointerPresence();
  mountOrbModel3d();
})();
