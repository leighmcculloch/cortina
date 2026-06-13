/**
 * hud.js — Racing HUD overlay for browser Three.js racing sim.
 *
 * Usage:
 *   const hud = window.GAME.createHUD(containerEl);
 *   // Every frame:
 *   hud.update(state);
 *   // Transient messages:
 *   hud.setMessage(text, ttlMs);
 *
 * update(state) shape:
 *   state = {
 *     speedKmh   : number | null,   // vehicle speed in km/h
 *     rpm        : number | null,   // engine RPM
 *     maxRpm     : number | null,   // redline RPM (used for tach arc colour)
 *     gear       : number | null,   // -1 = R, 0 = N, 1-5 = gear number
 *     currentLapMs : number | null, // current lap elapsed time in ms
 *     bestLapMs    : number | null, // personal best lap in ms (null if none yet)
 *     lastLapMs    : number | null, // last completed lap in ms (null if none yet)
 *     deltaMs      : number | null, // delta vs best (negative = ahead, positive = behind)
 *     lap          : number | null, // current lap number
 *     onTrack      : boolean | null,// false triggers "Off track" style warning
 *     message      : string | null, // transient message (same as setMessage with default TTL)
 *   }
 *
 * setMessage(text, ttlMs):
 *   Shows a centred transient message that fades out after ttlMs (default 2000 ms).
 */

window.GAME = window.GAME || {};

window.GAME.createHUD = function (container) {

  // ─── CSS injection ────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    .hud-root {
      position: absolute;
      inset: 0;
      pointer-events: none;
      font-family: 'Courier New', Courier, monospace;
      color: #e8e8e8;
      user-select: none;
    }

    /* ── bottom-right: speed + tach + gear ─── */
    .hud-gauges {
      position: absolute;
      bottom: 24px;
      right: 24px;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
    }
    .hud-canvas-wrap {
      position: relative;
      width: 220px;
      height: 120px;
    }
    .hud-canvas-wrap canvas {
      display: block;
    }
    .hud-speed-readout {
      position: absolute;
      bottom: 8px;
      left: 0;
      right: 0;
      text-align: center;
      font-size: 28px;
      font-weight: bold;
      letter-spacing: 2px;
      color: #ffffff;
      text-shadow: 0 0 8px rgba(0,200,255,0.6);
      line-height: 1;
    }
    .hud-speed-unit {
      font-size: 11px;
      color: #aaa;
      letter-spacing: 1px;
    }
    .hud-tach-readout {
      position: absolute;
      top: 6px;
      left: 0;
      right: 0;
      text-align: center;
      font-size: 11px;
      color: #aaa;
      letter-spacing: 1px;
    }
    .hud-gear {
      font-size: 52px;
      font-weight: bold;
      line-height: 1;
      color: #ffffff;
      text-shadow: 0 0 14px rgba(0,200,255,0.7);
      min-width: 40px;
      text-align: center;
    }

    /* ── top-left: timing ─── */
    .hud-timing {
      position: absolute;
      top: 20px;
      left: 20px;
      background: rgba(0,0,0,0.45);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 6px;
      padding: 10px 14px;
      min-width: 200px;
      backdrop-filter: blur(2px);
    }
    .hud-timing-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 12px;
      line-height: 1.65;
    }
    .hud-timing-label {
      font-size: 10px;
      color: #888;
      letter-spacing: 1px;
      text-transform: uppercase;
      flex-shrink: 0;
    }
    .hud-timing-value {
      font-size: 14px;
      color: #ffffff;
      letter-spacing: 1px;
    }
    .hud-lap-num {
      font-size: 10px;
      color: #888;
      letter-spacing: 1px;
      margin-bottom: 4px;
    }
    .hud-delta-positive { color: #ff4444; }
    .hud-delta-negative { color: #44ff88; }
    .hud-delta-zero     { color: #ffffff; }

    /* ── centre-top: transient message ─── */
    .hud-message {
      position: absolute;
      top: 18%;
      left: 50%;
      transform: translateX(-50%);
      font-size: 22px;
      font-weight: bold;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #fff;
      text-shadow: 0 0 16px rgba(255,220,0,0.9), 0 2px 4px rgba(0,0,0,0.8);
      white-space: nowrap;
      transition: opacity 0.3s ease;
      opacity: 0;
      pointer-events: none;
    }
    .hud-message.hud-message-visible {
      opacity: 1;
    }

    /* ── bottom-left: controls legend ─── */
    .hud-legend {
      position: absolute;
      bottom: 24px;
      left: 24px;
      background: rgba(0,0,0,0.4);
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 10px;
      color: #777;
      line-height: 1.7;
      letter-spacing: 0.5px;
      transition: opacity 0.3s ease;
    }
    .hud-legend.hud-legend-hidden {
      opacity: 0;
    }
    .hud-legend-key {
      display: inline-block;
      background: rgba(255,255,255,0.12);
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 3px;
      padding: 0 4px;
      margin-right: 4px;
      font-size: 9px;
      color: #bbb;
    }
    .hud-legend-toggle {
      position: absolute;
      bottom: 24px;
      left: 24px;
      font-size: 9px;
      color: #555;
      letter-spacing: 0.5px;
      cursor: pointer;
      pointer-events: all;
    }
  `;
  document.head.appendChild(style);

  // ─── Root wrapper ─────────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.className = 'hud-root';
  container.appendChild(root);

  // ─── Gauge canvases (speed arc + tach arc) ────────────────────────────────
  // We use a single 220×120 canvas for both arcs side by side.
  const gaugesPanel = document.createElement('div');
  gaugesPanel.className = 'hud-gauges';
  root.appendChild(gaugesPanel);

  // Gear indicator
  const gearEl = document.createElement('div');
  gearEl.className = 'hud-gear';
  gearEl.textContent = 'N';
  gaugesPanel.appendChild(gearEl);

  // Canvas wrap for speedometer arc
  const speedWrap = document.createElement('div');
  speedWrap.className = 'hud-canvas-wrap';
  gaugesPanel.appendChild(speedWrap);

  const speedCanvas = document.createElement('canvas');
  speedCanvas.width = 220;
  speedCanvas.height = 120;
  speedWrap.appendChild(speedCanvas);
  const speedCtx = speedCanvas.getContext('2d');

  const speedReadout = document.createElement('div');
  speedReadout.className = 'hud-speed-readout';
  speedReadout.innerHTML = '0 <span class="hud-speed-unit">KM/H</span>';
  speedWrap.appendChild(speedReadout);

  // Canvas wrap for tachometer arc
  const tachWrap = document.createElement('div');
  tachWrap.className = 'hud-canvas-wrap';
  gaugesPanel.appendChild(tachWrap);

  const tachCanvas = document.createElement('canvas');
  tachCanvas.width = 220;
  tachCanvas.height = 120;
  tachWrap.appendChild(tachCanvas);
  const tachCtx = tachCanvas.getContext('2d');

  const tachReadout = document.createElement('div');
  tachReadout.className = 'hud-tach-readout';
  tachReadout.textContent = '0 RPM';
  tachWrap.appendChild(tachReadout);

  // ─── Timing panel (top-left) ──────────────────────────────────────────────
  const timingPanel = document.createElement('div');
  timingPanel.className = 'hud-timing';
  root.appendChild(timingPanel);

  const lapNumEl = document.createElement('div');
  lapNumEl.className = 'hud-lap-num';
  lapNumEl.textContent = 'LAP 1';
  timingPanel.appendChild(lapNumEl);

  function makeTimingRow(label) {
    const row = document.createElement('div');
    row.className = 'hud-timing-row';
    const lbl = document.createElement('span');
    lbl.className = 'hud-timing-label';
    lbl.textContent = label;
    const val = document.createElement('span');
    val.className = 'hud-timing-value';
    val.textContent = '--:--.---';
    row.appendChild(lbl);
    row.appendChild(val);
    timingPanel.appendChild(row);
    return val;
  }

  const currentLapEl = makeTimingRow('Current');
  const lastLapEl    = makeTimingRow('Last');
  const bestLapEl    = makeTimingRow('Best');
  const deltaEl      = makeTimingRow('Delta');

  // ─── Transient message (centre) ───────────────────────────────────────────
  const messageEl = document.createElement('div');
  messageEl.className = 'hud-message';
  root.appendChild(messageEl);

  // ─── Controls legend (bottom-left) ────────────────────────────────────────
  const legendEl = document.createElement('div');
  legendEl.className = 'hud-legend';
  legendEl.innerHTML =
    '<div><span class="hud-legend-key">W/↑</span> Throttle</div>' +
    '<div><span class="hud-legend-key">S/↓</span> Brake</div>' +
    '<div><span class="hud-legend-key">A/D</span> Steer</div>' +
    '<div><span class="hud-legend-key">R</span> Reset</div>' +
    '<div><span class="hud-legend-key">H</span> Toggle HUD</div>';
  root.appendChild(legendEl);

  let legendVisible = true;

  // Allow H key to toggle the legend (pointer-events:none on root so we use document)
  function onKeyDown(e) {
    if (e.key === 'h' || e.key === 'H') {
      legendVisible = !legendVisible;
      legendEl.classList.toggle('hud-legend-hidden', !legendVisible);
    }
  }
  document.addEventListener('keydown', onKeyDown);

  // ─── Helpers ──────────────────────────────────────────────────────────────
  const TAU = Math.PI * 2;

  /** Format milliseconds as m:ss.mmm */
  function fmtTime(ms) {
    if (ms == null || ms < 0 || !isFinite(ms)) return '--:--.---';
    const totalMs = Math.floor(ms);
    const minutes = Math.floor(totalMs / 60000);
    const seconds = Math.floor((totalMs % 60000) / 1000);
    const millis  = totalMs % 1000;
    return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
  }

  /** Format delta with sign */
  function fmtDelta(ms) {
    if (ms == null || !isFinite(ms)) return '--';
    const abs = Math.abs(ms);
    const sign = ms <= 0 ? '-' : '+';
    const s = (abs / 1000).toFixed(3);
    return `${sign}${s}`;
  }

  /** Gear number to display string */
  function gearLabel(g) {
    if (g == null) return 'N';
    if (g === -1)  return 'R';
    if (g === 0)   return 'N';
    return String(g);
  }

  /**
   * Draw a semicircular arc gauge on a canvas context.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} cx - centre x
   * @param {number} cy - centre y
   * @param {number} r  - radius
   * @param {number} fraction - 0..1 fill
   * @param {string} trackColor
   * @param {string} fillColor
   * @param {string} label - text in arc centre
   */
  function drawArcGauge(ctx, cx, cy, r, fraction, trackColor, fillColor) {
    const startAngle = Math.PI * 0.75;       // 135°
    const endAngle   = Math.PI * 2.25;       // 405° (= 45°)
    const sweep      = Math.PI * 1.5;        // 270° arc
    const lineW      = 10;

    ctx.clearRect(cx - r - lineW, cy - r - lineW, (r + lineW) * 2, (r + lineW) * 2);

    // Track (background arc)
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.strokeStyle = trackColor;
    ctx.lineWidth = lineW;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Fill arc
    if (fraction > 0) {
      const fillEnd = startAngle + sweep * Math.min(fraction, 1);
      ctx.beginPath();
      ctx.arc(cx, cy, r, startAngle, fillEnd);
      ctx.strokeStyle = fillColor;
      ctx.lineWidth = lineW;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Needle dot at tip
    if (fraction > 0) {
      const needleAngle = startAngle + sweep * Math.min(fraction, 1);
      const nx = cx + Math.cos(needleAngle) * r;
      const ny = cy + Math.sin(needleAngle) * r;
      ctx.beginPath();
      ctx.arc(nx, ny, lineW * 0.7, 0, TAU);
      ctx.fillStyle = fillColor;
      ctx.fill();
    }
  }

  /** Interpolate colour from green→yellow→red based on 0..1 */
  function redlineColor(fraction) {
    // Below 0.7: cyan-white; 0.7-0.9: yellow; above 0.9: red
    if (fraction < 0.7) return '#00ccff';
    if (fraction < 0.9) {
      // yellow-ish
      const t = (fraction - 0.7) / 0.2;
      const r = Math.round(0 + t * 255);
      const g = Math.round(204 + t * (200 - 204));
      const b = Math.round(255 + t * (0 - 255));
      return `rgb(${r},${g},${b})`;
    }
    // red zone
    return '#ff2222';
  }

  // ─── Transient message state ──────────────────────────────────────────────
  let _msgTimer = null;

  function setMessage(text, ttlMs) {
    ttlMs = (ttlMs == null) ? 2000 : ttlMs;
    if (_msgTimer !== null) {
      clearTimeout(_msgTimer);
      _msgTimer = null;
    }
    messageEl.textContent = text || '';
    if (text) {
      messageEl.classList.add('hud-message-visible');
      _msgTimer = setTimeout(function () {
        messageEl.classList.remove('hud-message-visible');
        _msgTimer = null;
      }, ttlMs);
    } else {
      messageEl.classList.remove('hud-message-visible');
    }
  }

  // Track last message so we don't re-trigger the timer every frame
  let _lastStateMessage = null;

  // ─── Main update ─────────────────────────────────────────────────────────
  function update(state) {
    state = state || {};

    // ── Gear ──
    gearEl.textContent = gearLabel(state.gear);

    // ── Speedometer arc ──
    const speed    = (state.speedKmh != null && isFinite(state.speedKmh)) ? state.speedKmh : 0;
    const maxSpeed = 260; // reference max for the gauge arc
    const speedFrac = Math.min(speed / maxSpeed, 1);

    speedCanvas.width = speedCanvas.width; // fast clear
    drawArcGauge(speedCtx, 110, 110, 90, speedFrac, 'rgba(255,255,255,0.08)', '#00ccff');

    // Numeric readout
    speedReadout.innerHTML = `${Math.round(speed)} <span class="hud-speed-unit">KM/H</span>`;

    // ── Tachometer arc ──
    const rpm    = (state.rpm != null && isFinite(state.rpm)) ? state.rpm : 0;
    const maxRpm = (state.maxRpm != null && isFinite(state.maxRpm) && state.maxRpm > 0) ? state.maxRpm : 8000;
    const rpmFrac = Math.min(rpm / maxRpm, 1);
    const tachColor = redlineColor(rpmFrac);

    tachCanvas.width = tachCanvas.width; // fast clear
    drawArcGauge(tachCtx, 110, 110, 90, rpmFrac, 'rgba(255,255,255,0.08)', tachColor);

    tachReadout.textContent = `${Math.round(rpm).toLocaleString()} RPM`;

    // ── Timing panel ──
    lapNumEl.textContent = `LAP ${state.lap != null ? state.lap : 1}`;
    currentLapEl.textContent = fmtTime(state.currentLapMs);
    lastLapEl.textContent    = fmtTime(state.lastLapMs);
    bestLapEl.textContent    = fmtTime(state.bestLapMs);

    // Delta
    if (state.deltaMs != null && isFinite(state.deltaMs)) {
      deltaEl.textContent = fmtDelta(state.deltaMs);
      deltaEl.className = 'hud-timing-value ' + (
        state.deltaMs < 0 ? 'hud-delta-negative' :
        state.deltaMs > 0 ? 'hud-delta-positive' :
        'hud-delta-zero'
      );
    } else {
      deltaEl.textContent = '--';
      deltaEl.className = 'hud-timing-value hud-delta-zero';
    }

    // ── Transient message from state ──
    if (state.message && state.message !== _lastStateMessage) {
      _lastStateMessage = state.message;
      setMessage(state.message, 2000);
    } else if (!state.message) {
      _lastStateMessage = null;
    }

    // Off-track warning
    if (state.onTrack === false && !state.message) {
      if (_lastStateMessage !== '__offtrack__') {
        _lastStateMessage = '__offtrack__';
        setMessage('OFF TRACK', 1500);
      }
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────
  const hud = {
    update: update,
    setMessage: setMessage,
    /** Destroy — remove DOM and listeners */
    destroy: function () {
      document.removeEventListener('keydown', onKeyDown);
      root.remove();
      style.remove();
    },
  };

  return hud;
};
