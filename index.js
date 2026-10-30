// ============================================================================
// GATECRASHER 2 — a tribute clone of Ben Grant's Gatecrasher 2 (2020)
// ----------------------------------------------------------------------------
// Fly down an endless neon tube. Steer your ship around the circumference and
// slip through the gaps in the gates. Clip a gate and it's over.
// ============================================================================

const canvas = document.querySelector("canvas");
const c = canvas.getContext("2d");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const W = 480; // logical width
const H = 800; // logical height

const CX = W / 2; // vanishing point
const CY = 372;
const R0 = 208; // tube radius at the camera plane

const PLAYER_Z = 0.25; // ship depth inside the tube
const SHIP_HALF_ANGLE = 0.15; // angular half-width used for collisions

const MAX_ANGULAR_SPEED = 3.4; // rad/s
const ANGULAR_EASE = 0.06; // seconds to reach full speed

const DEPTH = 12; // how deep gates spawn
const GATES_PER_LEVEL = 5;
const GATE_SPACING = 3.4; // z units between gates

const BASE_SPEED = 2.0; // z units/s at level 1
const SPEED_PER_LEVEL = 0.32;
const MAX_SPEED = 4.6;

const COLORS = {
  bg: "#0c0d11",
  text: "#ff9f1c",
  textDim: "#c96f12",
  player: "#ffd23e",
  playerCore: "#fff7d1",
  gate: "#ff4b2e",
  gateHot: "#ff6a00",
  button: "#ffb13d",
};

const FONT = '"Rajdhani", "Segoe UI", sans-serif';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  mode: "menu", // menu | playing | dying | settings
  level: 1,
  gatesRemaining: GATES_PER_LEVEL,
  gatesPassed: 0,
  bestLevel: 0,

  playerAngle: 0, // 0 = bottom of the tube, positive = clockwise
  angularVel: 0,

  gates: [], // { z, start, span, color }
  particles: [],
  ambient: [],

  scroll: 0, // tube ring scroll offset
  spawnTimer: 0,
  dyingTime: 0,
  levelFlash: 0,
  menuArcRotation: 0,

  time: 0,
  shake: 0,
  soundOn: true,
};

const keys = {
  left: false,
  right: false,
  pointerLeft: false,
  pointerRight: false,
};

const activePointers = new Map(); // pointerId -> "left" | "right"

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function loadStorage() {
  try {
    state.bestLevel = Number(localStorage.getItem("gc2_best_level")) || 0;
    state.soundOn = localStorage.getItem("gc2_sound") !== "off";
  } catch (error) {
    // play without persistence
  }
}

function saveStorage() {
  try {
    localStorage.setItem("gc2_best_level", String(state.bestLevel));
    localStorage.setItem("gc2_sound", state.soundOn ? "on" : "off");
  } catch (error) {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Audio — tiny WebAudio bleeps, no assets needed
// ---------------------------------------------------------------------------

let audioContext = null;

function ensureAudio() {
  if (!audioContext) {
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (error) {
      audioContext = null;
    }
  }
  if (audioContext && audioContext.state === "suspended") {
    audioContext.resume();
  }
  return audioContext;
}

function playTone({
  type = "square",
  from = 520,
  to = 520,
  duration = 0.1,
  volume = 0.12,
  delay = 0,
}) {
  const ctx = ensureAudio();
  if (!ctx || !state.soundOn) return;
  const now = ctx.currentTime + delay;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(from, now);
  oscillator.frequency.exponentialRampToValueAtTime(
    Math.max(1, to),
    now + duration,
  );
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
}

const sfx = {
  pass() {
    playTone({
      type: "square",
      from: 660,
      to: 880,
      duration: 0.06,
      volume: 0.06,
    });
  },
  die() {
    playTone({
      type: "sawtooth",
      from: 240,
      to: 30,
      duration: 0.75,
      volume: 0.14,
    });
    playTone({
      type: "square",
      from: 120,
      to: 20,
      duration: 0.9,
      volume: 0.09,
      delay: 0.04,
    });
  },
  levelUp() {
    [523, 659, 784, 1046].forEach((freq, i) => {
      playTone({
        type: "square",
        from: freq,
        to: freq,
        duration: 0.08,
        volume: 0.07,
        delay: i * 0.09,
      });
    });
  },
  click() {
    playTone({
      type: "square",
      from: 880,
      to: 880,
      duration: 0.05,
      volume: 0.06,
    });
  },
  start() {
    [440, 660].forEach((freq, i) => {
      playTone({
        type: "square",
        from: freq,
        to: freq,
        duration: 0.07,
        volume: 0.07,
        delay: i * 0.08,
      });
    });
  },
};

// ---------------------------------------------------------------------------
// Canvas scaling
// ---------------------------------------------------------------------------

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
  canvas.style.width = `${Math.floor(W * scale)}px`;
  canvas.style.height = `${Math.floor(H * scale)}px`;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

// Screen position of a point on the tube wall at angle a, depth z
function project(a, z) {
  const r = R0 / (1 + z);
  return {
    x: CX + r * Math.sin(a),
    y: CY + r * Math.cos(a),
    r,
  };
}

// Shortest signed difference between two angles
function angleDelta(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Is angle a inside the arc [start, start + span] (within margin)?
function angleInArc(a, start, span, margin) {
  const d = angleDelta(start, a);
  return d >= -margin && d <= span + margin;
}

function drawText(text, x, y, size, options = {}) {
  const {
    color = COLORS.text,
    align = "center",
    glow = 0,
    alpha = 1,
    weight = 700,
  } = options;
  c.save();
  c.font = `${weight} ${size}px ${FONT}`;
  c.textAlign = align;
  c.textBaseline = "middle";
  c.globalAlpha = alpha;
  if (glow > 0) {
    c.shadowColor = color;
    c.shadowBlur = glow;
  }
  c.fillStyle = color;
  c.fillText(text, x, y);
  c.restore();
}

// ---------------------------------------------------------------------------
// Ambient particles (floating colored squares inside the tube)
// ---------------------------------------------------------------------------

function initAmbient() {
  state.ambient = [];
  for (let i = 0; i < 42; i++) {
    state.ambient.push({
      angle: Math.random() * Math.PI * 2,
      z: randomBetween(0.4, DEPTH),
      drift: randomBetween(-0.25, 0.25),
      size: randomBetween(2, 5),
      color: ["#ff2e88", "#00e5ff", "#b967ff", "#ff5136"][
        Math.floor(Math.random() * 4)
      ],
    });
  }
}

function updateAmbient(dt, speed) {
  for (const p of state.ambient) {
    p.z -= speed * 0.55 * dt;
    p.angle += p.drift * dt;
    if (p.z < 0.3) {
      p.z = DEPTH;
      p.angle = Math.random() * Math.PI * 2;
    }
  }
}

function drawAmbient() {
  for (const p of state.ambient) {
    const projected = project(p.angle, p.z);
    const scale = projected.r / R0;
    c.globalAlpha = 0.55 * scale;
    c.fillStyle = p.color;
    c.fillRect(projected.x, projected.y, p.size * scale, p.size * scale);
  }
  c.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Tube lines (the moving wall texture)
// ---------------------------------------------------------------------------
function drawTubeLines() {
  const railCount = 16;
  const dashSpacing = 1.65;
  const dashLength = 0.85;
  const dashCount = Math.ceil(DEPTH / dashSpacing);

  c.save();

  // Longitudinal lines running from the vanishing point
  // toward the outside of the tunnel.
  c.lineWidth = 1;

  for (let rail = 0; rail < railCount; rail++) {
    const angle = (rail / railCount) * Math.PI * 2;

    const far = project(angle, DEPTH);
    const near = project(angle, 0.05);

    c.strokeStyle = "rgba(90, 150, 190, 0.13)";

    c.beginPath();
    c.moveTo(far.x, far.y);
    c.lineTo(near.x, near.y);
    c.stroke();
  }

  // Moving light streaks traveling toward the player.
  // Each streak moves from the vanishing point outward.
  c.lineCap = "round";

  for (let rail = 0; rail < railCount; rail++) {
    const angle = (rail / railCount) * Math.PI * 2;

    for (let i = 0; i < dashCount; i++) {
      // Offset each rail slightly so the streaks don't
      // line up and look like another set of circular rings.
      const z =
        (((i * dashSpacing + rail * 0.43 - state.scroll) % DEPTH) + DEPTH) %
        DEPTH;

      const nearZ = Math.max(0, z - dashLength);

      if (z - nearZ < 0.12) continue;

      const far = project(angle, z);
      const near = project(angle, nearZ);

      const scale = near.r / R0;

      c.strokeStyle = `rgba(125, 205, 255, ${0.12 + scale * 0.34})`;
      c.lineWidth = 0.8 + scale * 1.1;

      c.beginPath();
      c.moveTo(far.x, far.y);
      c.lineTo(near.x, near.y);
      c.stroke();
    }
  }

  c.restore();
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

function gateSpeed() {
  return Math.min(MAX_SPEED, BASE_SPEED + (state.level - 1) * SPEED_PER_LEVEL);
}

function gapWidth() {
  return Math.max(0.85, 1.6 - (state.level - 1) * 0.09);
}

function spawnGate() {
  const gap = gapWidth();
  const span = Math.PI * 2 - gap;
  const start = Math.random() * Math.PI * 2;
  state.gates.push({
    z: DEPTH,
    start,
    span,
    color: Math.random() < 0.5 ? COLORS.gate : COLORS.gateHot,
  });
}

function updateGates(dt) {
  const speed = gateSpeed();

  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0 && state.gatesRemaining > 0) {
    spawnGate();
    state.gatesRemaining -= 1;
    state.spawnTimer = GATE_SPACING / speed;
  }

  for (const gate of state.gates) {
    const previousZ = gate.z;
    gate.z -= speed * dt;

    // The gate just reached the ship
    if (previousZ > PLAYER_Z && gate.z <= PLAYER_Z) {
      if (
        angleInArc(state.playerAngle, gate.start, gate.span, SHIP_HALF_ANGLE)
      ) {
        die(gate);
        return;
      }
      // Slipped through the gap
      state.gatesPassed += 1;
      sfx.pass();
    }
  }

  state.gates = state.gates.filter((gate) => gate.z > -0.9);

  // Level cleared
  if (state.gatesRemaining === 0 && state.gates.length === 0) {
    state.level += 1;
    state.gatesRemaining = GATES_PER_LEVEL;
    state.gatesPassed = 0;
    state.spawnTimer = 0.9;
    state.levelFlash = 1.6;
    sfx.levelUp();
  }
}

function drawGates() {
  const sorted = [...state.gates].sort((a, b) => b.z - a.z);
  for (const gate of sorted) {
    const r = R0 / (1 + gate.z);
    const scale = r / R0;
    if (r < 6) continue;

    // Convert my angle convention to canvas arc angles
    const canvasStart = Math.PI / 2 - (gate.start + gate.span);
    const canvasEnd = Math.PI / 2 - gate.start;

    c.save();
    c.strokeStyle = gate.color;
    c.lineWidth = Math.max(2.5, 16 * scale);
    c.lineCap = "round";
    c.shadowColor = gate.color;
    c.shadowBlur = 8 + 26 * scale;
    c.globalAlpha = clamp(0.5 + scale * 0.7, 0, 1);
    c.beginPath();
    c.arc(CX, CY, r, canvasStart, canvasEnd);
    c.stroke();
    c.restore();
  }
}

// ---------------------------------------------------------------------------
// Player ship
// ---------------------------------------------------------------------------

function drawPlayer() {
  const p = project(state.playerAngle, PLAYER_Z);
  const scale = p.r / R0;

  // Rotation trail along the tube wall
  if (Math.abs(state.angularVel) > 0.25) {
    const dir = Math.sign(state.angularVel);
    c.save();
    c.strokeStyle = COLORS.player;
    c.lineCap = "round";
    const segments = 7;
    for (let i = 0; i < segments; i++) {
      const a = state.playerAngle - dir * (0.06 + i * 0.065);
      const seg = project(a, PLAYER_Z + 0.02 + i * 0.05);
      c.globalAlpha = 0.32 * (1 - i / segments);
      c.lineWidth = 6 * (seg.r / R0);
      c.beginPath();
      const a2 = a + dir * 0.045;
      const p2 = project(a2, PLAYER_Z + 0.02 + i * 0.05);
      c.moveTo(seg.x, seg.y);
      c.lineTo(p2.x, p2.y);
      c.stroke();
    }
    c.restore();
  }

  // Hull — foreshortened triangle pointing at the vanishing point,
  // drawn as a glowing radial beam from the wall toward the center
  const beamLength = 42 * scale;
  const beamWidth = Math.max(6, 11 * scale);
  const inwardX = CX + (p.r - beamLength) * Math.sin(state.playerAngle);
  const inwardY = CY + (p.r - beamLength) * Math.cos(state.playerAngle);

  c.save();
  c.strokeStyle = COLORS.player;
  c.lineWidth = beamWidth;
  c.lineCap = "round";
  c.shadowColor = COLORS.player;
  c.shadowBlur = 16;
  c.beginPath();
  c.moveTo(p.x, p.y);
  c.lineTo(inwardX, inwardY);
  c.stroke();

  // Bright core on the wall
  c.shadowBlur = 10;
  c.fillStyle = COLORS.playerCore;
  c.beginPath();
  c.arc(p.x, p.y, Math.max(3, 4.5 * scale), 0, Math.PI * 2);
  c.fill();
  c.restore();
}

function playerExplode() {
  const p = project(state.playerAngle, PLAYER_Z);
  const count = 42;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = randomBetween(80, 380);
    state.particles.push({
      x: p.x,
      y: p.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: randomBetween(3, 8),
      rotation: Math.random() * Math.PI,
      rotationSpeed: randomBetween(-6, 6),
      color: [COLORS.player, COLORS.gate, COLORS.gateHot, "#ffffff"][
        Math.floor(Math.random() * 4)
      ],
      life: 0,
      maxLife: randomBetween(0.5, 1.1),
    });
  }
}

function updateParticles(dt) {
  for (const p of state.particles) {
    p.life += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 300 * dt;
    p.rotation += p.rotationSpeed * dt;
  }
  state.particles = state.particles.filter((p) => p.life < p.maxLife);
}

function drawParticles() {
  for (const p of state.particles) {
    c.save();
    c.globalAlpha = 1 - p.life / p.maxLife;
    c.translate(p.x, p.y);
    c.rotate(p.rotation);
    c.fillStyle = p.color;
    c.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
    c.restore();
  }
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
  state.mode = "playing";
  state.level = 1;
  state.gatesRemaining = GATES_PER_LEVEL;
  state.gatesPassed = 0;
  state.gates = [];
  state.particles = [];
  state.playerAngle = 0;
  state.angularVel = 0;
  state.spawnTimer = 0.6;
  state.levelFlash = 1.4;
  state.shake = 0;
  sfx.start();
}

function die(gate) {
  state.mode = "dying";
  state.dyingTime = 0;
  state.shake = 9;
  playerExplode();
  if (state.level > state.bestLevel) {
    state.bestLevel = state.level;
  }
  saveStorage();
  sfx.die();
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

const menuButtons = [
  { id: "settings", x: CX - 78, y: H - 132, r: 36 },
  { id: "play", x: CX + 78, y: H - 132, r: 48 },
];

const settingsButtons = [
  { id: "sound", x: W / 2 - 140, y: 420, w: 280, h: 56 },
  { id: "back", x: W / 2 - 90, y: 520, w: 180, h: 52 },
];

function hitMenuButton(x, y) {
  for (const button of menuButtons) {
    const dx = x - button.x;
    const dy = y - button.y;
    if (dx * dx + dy * dy <= button.r * button.r) return button;
  }
  return null;
}

function hitSettingsButton(x, y) {
  for (const button of settingsButtons) {
    if (
      x >= button.x &&
      x <= button.x + button.w &&
      y >= button.y &&
      y <= button.y + button.h
    ) {
      return button;
    }
  }
  return null;
}

function pressMenuButton(button) {
  sfx.click();
  if (button.id === "play") {
    startGame();
  } else if (button.id === "settings") {
    state.mode = "settings";
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function pointerToLogical(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * W,
    y: ((event.clientY - rect.top) / rect.height) * H,
  };
}

function updatePointerRotation() {
  let left = false;
  let right = false;
  for (const side of activePointers.values()) {
    if (side === "left") left = true;
    if (side === "right") right = true;
  }
  // Don't override keyboard steering while a pointer isn't active
  if (activePointers.size > 0) {
    keys.pointerLeft = left;
    keys.pointerRight = right;
  } else {
    keys.pointerLeft = false;
    keys.pointerRight = false;
  }
}

canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  try {
    canvas.setPointerCapture(event.pointerId);
  } catch (error) {
    // pointer capture is best-effort (fails for synthetic/stale pointers)
  }
  ensureAudio();
  const { x, y } = pointerToLogical(event);

  if (state.mode === "menu") {
    const button = hitMenuButton(x, y);
    if (button) {
      pressMenuButton(button);
      return;
    }
  } else if (state.mode === "settings") {
    const button = hitSettingsButton(x, y);
    if (button) {
      sfx.click();
      if (button.id === "sound") {
        state.soundOn = !state.soundOn;
        saveStorage();
      } else if (button.id === "back") {
        state.mode = "menu";
      }
      return;
    }
  }

  if (state.mode === "playing") {
    activePointers.set(event.pointerId, x < W / 2 ? "left" : "right");
    updatePointerRotation();
  }
});

canvas.addEventListener("pointermove", (event) => {
  if (!activePointers.has(event.pointerId)) return;
  event.preventDefault();
  const { x } = pointerToLogical(event);
  activePointers.set(event.pointerId, x < W / 2 ? "left" : "right");
  updatePointerRotation();
});

function releasePointer(event) {
  if (activePointers.delete(event.pointerId)) {
    updatePointerRotation();
  }
}

canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);
canvas.addEventListener("lostpointercapture", releasePointer);
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

window.addEventListener("keydown", (event) => {
  switch (event.code) {
    case "ArrowLeft":
    case "KeyA":
      keys.left = true;
      break;
    case "ArrowRight":
    case "KeyD":
      keys.right = true;
      break;
    case "Space":
    case "Enter":
      event.preventDefault();
      ensureAudio();
      if (state.mode === "menu") {
        startGame();
      } else if (state.mode === "settings") {
        state.mode = "menu";
      }
      break;
    case "Escape":
      if (state.mode === "settings") state.mode = "menu";
      break;
    default:
      break;
  }
});

window.addEventListener("keyup", (event) => {
  switch (event.code) {
    case "ArrowLeft":
    case "KeyA":
      keys.left = false;
      break;
    case "ArrowRight":
    case "KeyD":
      keys.right = false;
      break;
    default:
      break;
  }
});

function steeringLeft() {
  return keys.left || keys.pointerLeft;
}

function steeringRight() {
  return keys.right || keys.pointerRight;
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

function drawMenu() {
  // Title
  drawText("gatecrasher 2.", CX, 168, 52, { glow: 22, weight: 700 });
  drawText(`best level ${Math.max(1, state.bestLevel)}`, CX, 226, 24, {
    color: COLORS.textDim,
    weight: 600,
  });

  // Rotating concentric arcs motif
  state.menuArcRotation += 0.004;
  const arcs = [
    { r: 58, span: 4.4 },
    { r: 92, span: 3.6 },
    { r: 128, span: 4.9 },
  ];
  c.save();
  c.lineCap = "round";
  arcs.forEach((arc, index) => {
    const rotation = state.menuArcRotation * (index % 2 === 0 ? 1 : -1) + index;
    c.strokeStyle = index === 1 ? COLORS.gateHot : COLORS.gate;
    c.lineWidth = 7 - index;
    c.shadowColor = c.strokeStyle;
    c.shadowBlur = 14;
    c.globalAlpha = 0.9;
    c.beginPath();
    c.arc(CX, 430, arc.r, rotation, rotation + arc.span);
    c.stroke();
  });
  c.restore();

  // Buttons
  for (const button of menuButtons) {
    drawCircleButton(button);
  }

  drawText("steer with the arrows or tap left / right", CX, H - 42, 15, {
    color: "#6b6f7b",
    weight: 600,
  });
}

function drawCircleButton(button) {
  const isPlay = button.id === "play";
  const color = COLORS.button;

  c.save();
  c.strokeStyle = color;
  c.lineWidth = 3;
  c.shadowColor = color;
  c.shadowBlur = 12;
  c.fillStyle = "rgba(255,177,61,0.08)";
  c.beginPath();
  c.arc(button.x, button.y, button.r, 0, Math.PI * 2);
  c.fill();
  c.stroke();

  // Icon
  c.shadowBlur = 0;
  if (isPlay) {
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(button.x - 12, button.y - 18);
    c.lineTo(button.x + 20, button.y);
    c.lineTo(button.x - 12, button.y + 18);
    c.closePath();
    c.fill();
  } else {
    // Gear icon
    c.strokeStyle = color;
    c.lineWidth = 4;
    c.beginPath();
    c.arc(button.x, button.y, 10, 0, Math.PI * 2);
    c.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      c.beginPath();
      c.moveTo(button.x + Math.cos(a) * 13, button.y + Math.sin(a) * 13);
      c.lineTo(button.x + Math.cos(a) * 18, button.y + Math.sin(a) * 18);
      c.stroke();
    }
  }
  c.restore();
}

function drawSettings() {
  drawText("settings", CX, 160, 44, { glow: 18 });

  for (const button of settingsButtons) {
    const isBack = button.id === "back";
    const label = isBack ? "back" : `sound: ${state.soundOn ? "on" : "off"}`;
    c.save();
    c.strokeStyle = COLORS.button;
    c.lineWidth = 2.5;
    c.shadowColor = COLORS.button;
    c.shadowBlur = 8;
    c.fillStyle = "rgba(255,177,61,0.07)";
    roundRectPath(button.x, button.y, button.w, button.h, 14);
    c.fill();
    c.stroke();
    c.restore();
    drawText(label, button.x + button.w / 2, button.y + button.h / 2 + 1, 24, {
      weight: 600,
    });
  }
}

function roundRectPath(x, y, w, h, radius) {
  c.beginPath();
  c.moveTo(x + radius, y);
  c.arcTo(x + w, y, x + w, y + h, radius);
  c.arcTo(x + w, y + h, x, y + h, radius);
  c.arcTo(x, y + h, x, y, radius);
  c.arcTo(x, y, x + w, y, radius);
  c.closePath();
}

function drawHud() {
  drawText(`level ${state.level}`, CX, 58, 30, { glow: 10, weight: 700 });
  drawText(`gates ${state.gatesRemaining}`, CX, 100, 24, {
    color: COLORS.textDim,
    weight: 600,
  });
}

function drawSteeringButtons() {
  const leftPressed = steeringLeft();
  const rightPressed = steeringRight();

  const buttons = [
    { x: 78, y: H - 96, dir: -1, pressed: leftPressed },
    { x: W - 78, y: H - 96, dir: 1, pressed: rightPressed },
  ];

  for (const button of buttons) {
    c.save();
    c.strokeStyle = COLORS.button;
    c.lineWidth = 3;
    c.globalAlpha = button.pressed ? 1 : 0.55;
    c.shadowColor = COLORS.button;
    c.shadowBlur = button.pressed ? 18 : 8;
    c.fillStyle = button.pressed
      ? "rgba(255,177,61,0.22)"
      : "rgba(255,177,61,0.05)";
    c.beginPath();
    c.arc(button.x, button.y, 46, 0, Math.PI * 2);
    c.fill();
    c.stroke();

    // Chevron — left button shows "<", right button shows ">"
    c.shadowBlur = 0;
    c.strokeStyle = COLORS.button;
    c.lineWidth = 6;
    c.lineCap = "round";
    c.beginPath();
    if (button.dir < 0) {
      c.moveTo(button.x + 14, button.y - 16);
      c.lineTo(button.x - 10, button.y);
      c.lineTo(button.x + 14, button.y + 16);
    } else {
      c.moveTo(button.x - 14, button.y - 16);
      c.lineTo(button.x + 10, button.y);
      c.lineTo(button.x - 14, button.y + 16);
    }
    c.stroke();
    c.restore();
  }
}

function drawLevelFlash() {
  if (state.levelFlash <= 0) return;
  const t = state.levelFlash / 1.6;
  const alpha = t > 0.8 ? (1 - t) / 0.2 : Math.min(1, t / 0.5);
  drawText(`level ${state.level}`, CX, CY - 40, 46, { glow: 16, alpha });
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

function update(dt) {
  state.time += dt;
  state.shake = Math.max(0, state.shake - dt * 26);
  state.levelFlash = Math.max(0, state.levelFlash - dt);

  const speed = state.mode === "playing" ? gateSpeed() : 0.8;
  state.scroll += speed * dt;
  updateAmbient(dt, speed);
  updateParticles(dt);

  if (state.mode === "playing") {
    const dir = (steeringRight() ? 1 : 0) - (steeringLeft() ? 1 : 0);
    const targetVel = dir * MAX_ANGULAR_SPEED;
    const ease = 1 - Math.exp(-dt / ANGULAR_EASE);
    state.angularVel += (targetVel - state.angularVel) * ease;
    state.playerAngle += state.angularVel * dt;

    updateGates(dt);
  } else if (state.mode === "menu") {
    // Gentle idle drift of the camera view
    state.playerAngle = Math.sin(state.time * 0.5) * 0.3;
    state.angularVel = 0;
  } else if (state.mode === "dying") {
    state.dyingTime += dt;
    if (state.dyingTime > 1.5) {
      state.mode = "menu";
    }
  }
}

function render() {
  // Background
  c.fillStyle = COLORS.bg;
  c.fillRect(0, 0, W, H);

  c.save();
  if (state.shake > 0.2) {
    c.translate(
      randomBetween(-state.shake, state.shake),
      randomBetween(-state.shake, state.shake),
    );
  }

  // Deep glow at the vanishing point
  const vanishingGlow = c.createRadialGradient(CX, CY, 0, CX, CY, 110);
  vanishingGlow.addColorStop(0, "rgba(255,90,40,0.22)");
  vanishingGlow.addColorStop(1, "rgba(255,90,40,0)");
  c.fillStyle = vanishingGlow;
  c.fillRect(CX - 110, CY - 110, 220, 220);

  drawTubeLines();
  drawAmbient();
  drawGates();

  if (state.mode !== "dying") {
    drawPlayer();
  }
  drawParticles();

  if (state.mode === "playing") {
    drawHud();
    drawSteeringButtons();
    drawLevelFlash();
  } else if (state.mode === "menu") {
    drawMenu();
  } else if (state.mode === "settings") {
    drawSettings();
  } else if (state.mode === "dying") {
    const alpha = clamp(state.dyingTime * 2, 0, 1);
    drawText("crashed", CX, CY - 40, 44, { glow: 14, alpha });
  }

  c.restore();

  // Subtle vignette
  const vignette = c.createRadialGradient(
    W / 2,
    H / 2,
    H * 0.35,
    W / 2,
    H / 2,
    H * 0.72,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.45)");
  c.fillStyle = vignette;
  c.fillRect(0, 0, W, H);
}

let lastTimestamp = performance.now();

function frame(timestamp) {
  requestAnimationFrame(frame);
  let dt = (timestamp - lastTimestamp) / 1000;
  lastTimestamp = timestamp;
  dt = Math.min(dt, 0.05);

  update(dt);
  render();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function boot() {
  loadStorage();
  initAmbient();
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("orientationchange", resizeCanvas);
  document.addEventListener("visibilitychange", () => {
    lastTimestamp = performance.now();
  });
  requestAnimationFrame(frame);
}

if (document.fonts && document.fonts.load) {
  document.fonts.load("700 20px Rajdhani").then(boot).catch(boot);
} else {
  boot();
}

// Small debug/testing hook (harmless in production)
window.__gatecrasher2 = { state, startGame, spawnGate, die };
