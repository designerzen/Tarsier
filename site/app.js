// Tarsier project page: logo eyes, the in-browser simulator and the Web MIDI tester.
(function () {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const SVG_NS = "http://www.w3.org/2000/svg";
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ---------------------------------------------------------------- Logo
  // The pupils look towards the pointer.
  const logo = document.querySelector(".logo");
  if (logo) {
    const pupils = logo.querySelectorAll(".pupil");
    window.addEventListener("pointermove", (e) => {
      if (reduceMotion.matches) return;
      const r = logo.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height * 0.57);
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 260) * 11;
      pupils.forEach((p) => { p.style.transform = `translate(${(dx / d) * k}px, ${(dy / d) * k}px)`; });
    }, { passive: true });
  }

  // ----------------------------------------------------------- Simulator
  // Mirrors firmware/Tarsier/Tarsier.ino so the page shows what the device does.
  const sim = document.getElementById("sim");
  if (sim) initSimulator();

  function initSimulator() {
    const MODES = [
      { name: "Beam", colour: [0x00, 0xff, 0x40] },
      { name: "Trigger", colour: [0xff, 0x60, 0x00] },
      { name: "Theremin", colour: [0xa0, 0x00, 0xff] },
      { name: "CC", colour: [0x00, 0x60, 0xff] },
    ];
    const SCALES = [
      { name: "Major pentatonic", steps: [0, 2, 4, 7, 9] },
      { name: "Minor pentatonic", steps: [0, 3, 5, 7, 10] },
      { name: "Major", steps: [0, 2, 4, 5, 7, 9, 11] },
      { name: "Natural minor", steps: [0, 2, 3, 5, 7, 8, 10] },
      { name: "Blues", steps: [0, 3, 5, 6, 7, 10] },
      { name: "Whole tone", steps: [0, 2, 4, 6, 8, 10] },
      { name: "Chromatic", steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
    ];
    const OCTAVES = [2, 3, 4, 5];
    const ZONE_COUNTS = [5, 8, 12, 16];
    const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
    const HOLD_MS = 600;
    const HYSTERESIS = 0.2;
    const LED_MAX = 90 / 255;

    // Beam geometry in the side-view SVG.
    const Y_EDGE = 95, Y_NEAR = 385, Y_TOP = 30, CX = 200;
    const halfWidth = (y) => 34 + ((Y_NEAR - y) / (Y_NEAR - Y_EDGE)) * 116;

    const $ = (id) => document.getElementById(id);
    const beamSvg = $("sim-beam");
    const zonesG = $("sim-zones"), labelsG = $("sim-labels"), handG = $("sim-hand");
    const slider = $("sim-height");
    const bigEl = $("sim-big"), subEl = $("sim-sub"), meterEl = $("sim-meter"), meterLabel = $("sim-meter-label");
    const settingsEl = $("sim-settings"), logEl = $("sim-log");
    const soundBtn = $("sim-sound");
    const leds = [
      [$("sim-led0"), $("sim-led0-glow"), $("sim-side-led0"), $("sim-side-led0-glow")],
      [$("sim-led1"), $("sim-led1-glow"), $("sim-side-led1"), $("sim-side-led1-glow")],
    ];

    const state = {
      mode: 0, scale: 0, octave: 2, zones: 1,
      present: false, intensity: 0, zone: null, note: null,
      speed: 0, lastIntensity: 0, velocity: 0, bend: 0, cc: 0,
      noteFlashAt: -1e9, toast: null, recalibrateAt: 0,
    };

    // ---- music helpers
    const rootNote = () => 12 * (OCTAVES[state.octave] + 1);
    const zoneCount = () => ZONE_COUNTS[state.zones];
    function zoneNote(z) {
      const s = SCALES[state.scale].steps;
      return Math.min(127, rootNote() + 12 * Math.floor(z / s.length) + s[z % s.length]);
    }
    const noteName = (n) => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1);
    function velocity() {
      const t = clamp((state.speed - 0.3) / (4.0 - 0.3), 0, 1);
      return 40 + Math.floor(t * 87);
    }
    function wheel(pos) {
      pos &= 255;
      if (pos < 85) return [255 - pos * 3, pos * 3, 0];
      if (pos < 170) { pos -= 85; return [0, 255 - pos * 3, pos * 3]; }
      pos -= 170; return [pos * 3, 0, 255 - pos * 3];
    }
    const css = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

    // ---- MIDI log
    const lines = [];
    function log(text) {
      lines.push(text);
      while (lines.length > 4) lines.shift();
      logEl.textContent = lines.join("\n");
    }

    // ---- sound (optional, off until asked for)
    const synth = {
      ctx: null, voice: null, enabled: false,
      ensure() {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return false;
          this.ctx = new AC();
          this.master = this.ctx.createGain();
          this.master.gain.value = 0.22;
          this.master.connect(this.ctx.destination);
        }
        if (this.ctx.state === "suspended") this.ctx.resume();
        return true;
      },
      start(note, vel, type, cutoff) {
        if (!this.enabled) return;
        this.stop();
        const ctx = this.ctx, t = ctx.currentTime;
        const osc = ctx.createOscillator(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = 440 * Math.pow(2, (note - 69) / 12);
        filter.type = "lowpass";
        filter.frequency.value = cutoff || 4000;
        const level = 0.15 + 0.85 * Math.pow(vel / 127, 2);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(level, t + 0.012);
        gain.gain.setTargetAtTime(level * 0.7, t + 0.012, 0.25);
        osc.connect(filter).connect(gain).connect(this.master);
        osc.start();
        this.voice = { osc, filter, gain, base: note };
      },
      bend(semitones) {
        if (!this.voice) return;
        const f = 440 * Math.pow(2, (this.voice.base + semitones - 69) / 12);
        this.voice.osc.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.02);
      },
      cutoff(hz) { if (this.voice) this.voice.filter.frequency.setTargetAtTime(hz, this.ctx.currentTime, 0.03); },
      stop() {
        if (!this.voice) return;
        const { osc, gain } = this.voice, t = this.ctx.currentTime;
        gain.gain.cancelScheduledValues(t);
        gain.gain.setTargetAtTime(0, t, 0.08);
        osc.stop(t + 0.6);
        this.voice = null;
      },
    };
    soundBtn.addEventListener("click", () => {
      if (!synth.enabled && !synth.ensure()) { soundBtn.textContent = "Sound: not supported"; return; }
      synth.enabled = !synth.enabled;
      if (!synth.enabled) synth.stop();
      soundBtn.setAttribute("aria-pressed", String(synth.enabled));
      soundBtn.textContent = synth.enabled ? "Sound: on" : "Sound: off";
    });

    // ---- MIDI actions, as in the firmware
    function noteOn(n, v) {
      state.note = n;
      state.velocity = v;
      state.noteFlashAt = performance.now();
      log(`Note On   ${noteName(n).padEnd(4)} vel ${v}`);
      const type = state.mode === 2 ? "sine" : state.mode === 1 ? "square" : "triangle";
      synth.start(n, v, type, state.mode === 1 ? 2200 : 4000);
    }
    function noteOff() {
      if (state.note === null) return;
      log(`Note Off  ${noteName(state.note)}`);
      state.note = null;
      synth.stop();
    }
    function releaseAll() {
      noteOff();
      if (state.bend !== 0) { state.bend = 0; log("Pitch bend  0"); }
      if (state.cc > 0) { state.cc = 0; log("CC 1 = 0"); }
      synth.stop();
      state.zone = null;
    }

    // ---- settings changes
    function showToast(colour, blinks) { state.toast = { colour, blinks, start: performance.now() }; }
    function setMode(m) {
      releaseAll();
      state.mode = m;
      showToast(MODES[m].colour, m + 1);
      buildBeam();
    }
    function onTap(pad) {
      if (pad === 0) { setMode((state.mode + 1) % MODES.length); return; }
      releaseAll();
      state.scale = (state.scale + 1) % SCALES.length;
      showToast(wheel(Math.floor(state.scale * 255 / SCALES.length)), state.scale + 1);
      buildBeam();
    }
    function onHold(pad) {
      releaseAll();
      if (pad === 0) {
        state.octave = (state.octave + 1) % OCTAVES.length;
        showToast([255, 255, 255], state.octave + 1);
      } else {
        state.zones = (state.zones + 1) % ZONE_COUNTS.length;
        showToast([255, 192, 0], state.zones + 1);
      }
      buildBeam();
    }
    function onBothHeld() {
      releaseAll();
      log("CC 123 = 0  (all notes off)");
      showToast([255, 0, 0], 3);
      // The firmware recalibrates a second after both pads are released.
      state.recalibrateAt = performance.now() + 900 + 1000;
    }

    // ---- drawing the beam for the current mode
    function el(tag, attrs, parent) {
      const node = document.createElementNS(SVG_NS, tag);
      for (const k in attrs) node.setAttribute(k, attrs[k]);
      if (parent) parent.appendChild(node);
      return node;
    }
    const slice = (yTop, yBot) => {
      const a = halfWidth(yTop), b = halfWidth(yBot);
      return `${CX - a},${yTop} ${CX + a},${yTop} ${CX + b},${yBot} ${CX - b},${yBot}`;
    };
    let zoneShapes = [], labelShapes = [];
    function buildBeam() {
      zonesG.textContent = "";
      labelsG.textContent = "";
      zoneShapes = [];
      labelShapes = [];
      lastLit = -2;
      const H = Y_NEAR - Y_EDGE;
      if (state.mode === 0) {
        const n = zoneCount();
        for (let i = 0; i < n; i++) {
          const yTop = Y_EDGE + (i / n) * H, yBot = Y_EDGE + ((i + 1) / n) * H;
          const colour = css(wheel(Math.floor(i * 255 / n)));
          zoneShapes.push(el("polygon", { points: slice(yTop + 1, yBot - 1), fill: colour, "fill-opacity": 0.1, stroke: colour, "stroke-opacity": 0.35 }, zonesG));
          const yMid = (yTop + yBot) / 2;
          const label = el("g", {}, labelsG);
          const pill = el("rect", { x: 352, y: yMid - 11, width: 74, height: 22, rx: 11, fill: colour, "fill-opacity": 0 }, label);
          const text = el("text", { x: 389, y: yMid + 5, "text-anchor": "middle", class: "d-text", "font-size": n > 12 ? 11 : 14 }, label);
          text.textContent = noteName(zoneNote(i));
          labelShapes.push({ pill, text });
        }
        // Each step of a 16-zone beam is too thin to label legibly, so thin the labels out.
        if (n > 12) labelShapes.forEach((l, i) => { if (i % 2) l.text.setAttribute("opacity", 0.55); });
      } else {
        const grad = el("linearGradient", { id: "beam-grad", x1: 0, y1: 0, x2: 0, y2: 1 }, zonesG);
        const c = css(MODES[state.mode].colour);
        el("stop", { offset: 0, "stop-color": c, "stop-opacity": 0.04 }, grad);
        el("stop", { offset: 1, "stop-color": c, "stop-opacity": 0.28 }, grad);
        zoneShapes.push(el("polygon", { points: slice(Y_EDGE, Y_NEAR), fill: "url(#beam-grad)", stroke: c, "stroke-opacity": 0.4 }, zonesG));
        const labels = {
          1: [[Y_EDGE + 16, "Enter: note on"], [Y_EDGE + 38, "Leave: note off"], [Y_NEAR - 12, `Note ${noteName(rootNote())}`]],
          2: [[Y_EDGE + 14, "No bend"], [(Y_EDGE + Y_NEAR) / 2, "+6 semitones"], [Y_NEAR - 10, "+12 semitones"]],
          3: [[Y_EDGE + 14, "CC 1 = 0"], [(Y_EDGE + Y_NEAR) / 2, "CC 1 = 64"], [Y_NEAR - 10, "CC 1 = 127"]],
        }[state.mode];
        labels.forEach(([y, t]) => { el("text", { x: 354, y: y + 5, class: "d-text", "font-size": 14 }, labelsG).textContent = t; });
      }
      $("sim-far-label").textContent = state.mode === 0 ? "low" : "far";
      $("sim-near-label").textContent = state.mode === 0 ? "high" : "near";
      renderSettings();
    }
    function renderSettings() {
      const items = [MODES[state.mode].name + " mode", SCALES[state.scale].name, "Octave " + OCTAVES[state.octave], zoneCount() + " zones"];
      settingsEl.textContent = "";
      items.forEach((t) => { const s = document.createElement("span"); s.textContent = t; settingsEl.appendChild(s); });
      sim.querySelectorAll(".mode-btn").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.mode) === state.mode)));
    }

    // ---- lights
    function setLed(i, colour, level) {
      const [top, topGlow, side, sideGlow] = leds[i];
      const on = colour && level > 0.01;
      [top, side].forEach((n) => {
        if (on) { n.removeAttribute("class"); n.setAttribute("fill", css(colour)); n.setAttribute("fill-opacity", 0.35 + 0.65 * Math.min(1, level / LED_MAX)); }
        else { n.setAttribute("class", "d-led-off"); n.removeAttribute("fill"); n.removeAttribute("fill-opacity"); }
      });
      [topGlow, sideGlow].forEach((n) => {
        n.setAttribute("fill", on ? css(colour) : "transparent");
        n.setAttribute("opacity", on ? Math.min(1, level / LED_MAX) : 0);
      });
    }
    function breathe(now, period) {
      const phase = now % period, half = period / 2;
      return phase < half ? phase / half : (period - phase) / half;
    }
    function renderLeds(now) {
      const t = state.toast;
      if (t && now - t.start < t.blinks * 300) {
        const on = (now - t.start) % 300 < 180;
        setLed(0, t.colour, on ? LED_MAX : 0);
        setLed(1, t.colour, on ? LED_MAX : 0);
        return;
      }
      state.toast = null;
      const mc = MODES[state.mode].colour;
      setLed(0, mc, state.present ? LED_MAX / 2 : (4 / 255) + breathe(now, 4000) * (LED_MAX / 3));
      if (!state.present) { setLed(1, null, 0); return; }
      const hue = state.mode === 0 && state.zone !== null ? Math.floor(state.zone * 255 / zoneCount()) : Math.floor(state.intensity * 170);
      let c = wheel(hue);
      const since = now - state.noteFlashAt;
      if (state.note !== null && since < 150) {
        const k = 1 - since / 150;
        c = c.map((v) => Math.round(v + (255 - v) * k));
      }
      setLed(1, c, (12 + state.intensity * (90 - 12)) / 255);
    }

    // ---- hand position: pointer, slider or a gentle demo
    let handY = 230, targetY = 230, lastManualAt = -1e9;
    const sliderToY = (v) => Y_TOP + (v / 100) * (Y_NEAR - Y_TOP);
    const yToSlider = (y) => Math.round(((y - Y_TOP) / (Y_NEAR - Y_TOP)) * 100);
    targetY = handY = sliderToY(Number(slider.value));

    function pointerToY(e) {
      const r = beamSvg.getBoundingClientRect();
      return clamp(((e.clientY - r.top) / r.height) * 440, Y_TOP, Y_NEAR);
    }
    beamSvg.addEventListener("pointerdown", (e) => { beamSvg.setPointerCapture(e.pointerId); targetY = pointerToY(e); lastManualAt = performance.now(); });
    beamSvg.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse" && !beamSvg.hasPointerCapture(e.pointerId)) return;
      targetY = pointerToY(e);
      lastManualAt = performance.now();
    });
    slider.addEventListener("input", () => { targetY = sliderToY(Number(slider.value)); lastManualAt = performance.now(); });

    // ---- touch pads on the board picture
    [0, 1].forEach((i) => {
      const pad = $("sim-pad" + i);
      const ring = pad.querySelector(".hold-ring");
      let downAt = 0, held = false, timer = 0, raf = 0;
      const press = () => {
        if (downAt) return;
        downAt = performance.now();
        held = false;
        pad.classList.add("pressed");
        timer = setTimeout(() => { held = true; onHold(i); }, HOLD_MS);
        const fill = () => {
          const p = clamp((performance.now() - downAt) / HOLD_MS, 0, 1);
          ring.setAttribute("stroke-dashoffset", String(100 - p * 100));
          if (downAt && p < 1) raf = requestAnimationFrame(fill);
        };
        fill();
      };
      const release = () => {
        if (!downAt) return;
        clearTimeout(timer);
        cancelAnimationFrame(raf);
        if (!held && performance.now() - downAt > 30) onTap(i);
        downAt = 0;
        pad.classList.remove("pressed");
        ring.setAttribute("stroke-dashoffset", "100");
      };
      pad.addEventListener("pointerdown", (e) => { e.preventDefault(); pad.setPointerCapture(e.pointerId); press(); });
      pad.addEventListener("pointerup", release);
      pad.addEventListener("pointercancel", release);
      pad.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && !e.repeat) { e.preventDefault(); press(); } });
      pad.addEventListener("keyup", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); release(); } });
      pad.addEventListener("blur", release);
    });
    $("sim-both").addEventListener("click", onBothHeld);
    sim.querySelectorAll(".mode-btn").forEach((b) => b.addEventListener("click", () => setMode(Number(b.dataset.mode))));

    // ---- main loop
    let last = performance.now(), visible = true;
    new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; }).observe(sim);

    function frame(now) {
      requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!visible) return;

      // Demo mode: drift in and out of the beam until someone takes over.
      if (now - lastManualAt > 5000 && !reduceMotion.matches) {
        const t = now / 1000;
        targetY = clamp(220 + 175 * Math.sin(t * 0.7) + 25 * Math.sin(t * 1.9), Y_TOP, Y_NEAR);
      }
      handY += (targetY - handY) * Math.min(1, dt * 14);
      handG.setAttribute("transform", `translate(${CX} ${handY.toFixed(1)})`);
      if (document.activeElement !== slider) slider.value = String(yToSlider(handY));

      // Sensor reading → position, as in updateBeam().
      const wasPresent = state.present;
      state.present = handY >= Y_EDGE;
      state.intensity = clamp((handY - Y_EDGE) / (Y_NEAR - Y_EDGE), 0, 1);
      if (dt > 0) state.speed += 0.3 * (Math.abs(state.intensity - state.lastIntensity) / dt - state.speed);
      state.lastIntensity = state.intensity;

      if (!state.present) {
        if (wasPresent) releaseAll();
      } else if (state.mode === 0) {
        const n = zoneCount(), f = state.intensity * n;
        let z = state.zone;
        if (z === null || z >= n || f <= z - HYSTERESIS || f >= z + 1 + HYSTERESIS) z = clamp(Math.floor(f), 0, n - 1);
        if (z !== state.zone) { state.zone = z; noteOff(); noteOn(zoneNote(z), velocity()); }
      } else if (state.mode === 1) {
        if (!wasPresent) noteOn(rootNote(), velocity());
      } else if (state.mode === 2) {
        const bend = Math.round(state.intensity * 8191);
        if (bend !== state.bend) {
          state.bend = bend;
          if (!wasPresent || now - (state.lastBendLog || 0) > 120) { log(`Pitch bend  +${bend}`); state.lastBendLog = now; }
        }
        if (!wasPresent) noteOn(rootNote(), velocity());
        synth.bend(state.intensity * 12);
      } else {
        const cc = Math.round(state.intensity * 127);
        if (!wasPresent) synth.start(rootNote(), 100, "sawtooth", 200);
        if (cc !== state.cc) {
          state.cc = cc;
          if (now - (state.lastCcLog || 0) > 120) { log(`CC 1 = ${cc}`); state.lastCcLog = now; }
          synth.cutoff(200 + Math.pow(cc / 127, 2) * 6000);
        }
      }

      if (state.recalibrateAt && now >= state.recalibrateAt) {
        state.recalibrateAt = 0;
        showToast([0, 255, 0], 1);
      }

      renderReadout();
      renderZones();
      renderLeds(now);
    }

    function renderReadout() {
      let big = "–", sub = "Move into the beam", meter = 0, label = "Velocity";
      if (state.present) {
        if (state.mode === 0 || state.mode === 1) {
          big = state.note !== null ? noteName(state.note) : "–";
          sub = state.mode === 0 ? `Zone ${state.zone + 1} of ${zoneCount()}` : "Held while you stay in the beam";
          meter = state.velocity / 127;
        } else if (state.mode === 2) {
          big = "+" + (state.intensity * 12).toFixed(1);
          sub = `semitones above ${noteName(rootNote())}`;
          meter = state.intensity; label = "Bend";
        } else {
          big = String(state.cc);
          sub = "CC 1 (mod wheel)";
          meter = state.cc / 127; label = "Value";
        }
      }
      if (bigEl.textContent !== big) bigEl.textContent = big;
      if (subEl.textContent !== sub) subEl.textContent = sub;
      if (meterLabel.textContent !== label) meterLabel.textContent = label;
      meterEl.style.width = (meter * 100).toFixed(1) + "%";
    }

    let lastLit = -1;
    function renderZones() {
      const lit = state.mode === 0 && state.present && state.zone !== null ? state.zone : -1;
      if (state.mode !== 0) { if (zoneShapes[0]) zoneShapes[0].setAttribute("fill-opacity", state.present ? 1 : 0.6); return; }
      if (lit === lastLit) return;
      zoneShapes.forEach((z, i) => z.setAttribute("fill-opacity", i === lit ? 0.45 : 0.1));
      labelShapes.forEach((l, i) => {
        l.pill.setAttribute("fill-opacity", i === lit ? 0.9 : 0);
        l.text.setAttribute("font-weight", i === lit ? 800 : 400);
      });
      lastLit = lit;
    }

    buildBeam();
    showToast(MODES[0].colour, 1);
    log("Ready. Move into the beam.");
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------- Tester
  // Web MIDI monitor so people can check their real Tarsier works.
  const startButton = document.getElementById("monitor-start");
  if (!startButton) return;
  const statusEl = document.getElementById("monitor-status");
  const logEl = document.getElementById("monitor-log");
  const meterEl = document.getElementById("monitor-meter");
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  let lines = [];

  function log(text) {
    lines.push(text);
    if (lines.length > 60) lines = lines.slice(-60);
    logEl.textContent = lines.join("\n");
    logEl.scrollTop = logEl.scrollHeight;
  }
  const noteName = (n) => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1);

  function describe(data) {
    const [status, a, b] = data;
    const type = status & 0xf0, channel = (status & 0x0f) + 1;
    if (type === 0x90 && b > 0) { meterEl.style.width = (b / 127 * 100) + "%"; return `note on   ${noteName(a).padEnd(4)} velocity ${b}   (ch ${channel})`; }
    if (type === 0x80 || type === 0x90) return `note off  ${noteName(a)}   (ch ${channel})`;
    if (type === 0xb0) { meterEl.style.width = (b / 127 * 100) + "%"; return `CC ${a} = ${b}   (ch ${channel})`; }
    if (type === 0xe0) { const v = (b << 7) | a; meterEl.style.width = ((v - 8192) / 8191 * 100) + "%"; return `pitch bend ${v - 8192}   (ch ${channel})`; }
    return null;
  }

  function refresh(access) {
    const inputs = [...access.inputs.values()];
    const tarsier = inputs.filter((i) => /tarsier/i.test(i.name));
    const listening = tarsier.length ? tarsier : inputs;
    inputs.forEach((i) => { i.onmidimessage = null; });
    listening.forEach((i) => { i.onmidimessage = (e) => { const text = describe(e.data); if (text) log(text); }; });
    if (tarsier.length) {
      statusEl.textContent = "Tarsier found. Move your hand over the sensor.";
      statusEl.className = "ok";
    } else if (inputs.length) {
      statusEl.textContent = "Tarsier not found. Listening to: " + inputs.map((i) => i.name).join(", ");
      statusEl.className = "";
    } else {
      statusEl.textContent = "No MIDI devices found. Is Tarsier plugged in?";
      statusEl.className = "";
    }
  }

  startButton.addEventListener("click", async () => {
    if (!navigator.requestMIDIAccess) {
      statusEl.textContent = "This browser can't use MIDI devices. Try Chrome, Edge or Firefox.";
      return;
    }
    try {
      const access = await navigator.requestMIDIAccess();
      logEl.textContent = "";
      lines = [];
      refresh(access);
      access.onstatechange = () => refresh(access);
      startButton.textContent = "Connected";
      startButton.disabled = true;
    } catch (err) {
      statusEl.textContent = "MIDI access was blocked: " + err.message;
    }
  });
})();
