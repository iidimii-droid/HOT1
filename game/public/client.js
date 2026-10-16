'use strict';
// Ironfall browser client: menus, rendering, input and HUD.

const $ = id => document.getElementById(id);
const COLORS = {
  1: { body: '#3f6fc9', trim: '#d9b45a', dark: '#1c3466', light: '#8fb4ff' },
  2: { body: '#b8322c', trim: '#e8dcb8', dark: '#5a1512', light: '#ff8f86' },
};
const SHOT_STYLE = [
  { c: '#ffe08a', w: 1.2, life: 0.08 },  // rifle
  { c: '#ffd070', w: 1, life: 0.06 },    // pistol
  { c: '#fff2a0', w: 1.4, life: 0.06 },  // repeater
  { c: '#7fe8ff', w: 3.5, life: 0.25 },  // lance
  { c: '#ffb050', w: 2.5, life: 0.12 },  // cannon
  { c: '#ffe08a', w: 1, life: 0.05 },    // coax
  { c: '#ff9a50', w: 2, life: 0.08 },    // bastion
  { c: '#ffffff', w: 0, life: 0.1 },     // blade
];
const BUILD_KEYS = { z: 'tactical', x: 'heavy', c: 'assault', v: 'lance', b: 'tank' };
const BUILD_LIST = ['tactical', 'heavy', 'assault', 'lance', 'tank'];
const KEY_OF = Object.fromEntries(Object.entries(BUILD_KEYS).map(([k, v]) => [v, k.toUpperCase()]));

let ws = null;
let G = null; // match state

// ---------------------------------------------------------------- Menus ---
const nameInput = $('name');
try { nameInput.value = localStorage.getItem('ironfall-name') || ''; } catch {}

function connect(onOpen) {
  if (ws && ws.readyState <= 1) { onOpen(); return; }
  // Single-file build: the match runs in this page instead of on a server.
  if (window.IronfallLocal) { ws = window.IronfallLocal(onMessage); onOpen(); return; }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = onOpen;
  ws.onmessage = e => onMessage(JSON.parse(e.data));
  ws.onclose = () => {
    if (G && !G.over) endGame('Connection lost', 'The connection to the server was closed.');
    ws = null;
  };
  ws.onerror = () => { $('menu-err').textContent = 'Could not reach the server.'; };
}
function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
function playerName() {
  const n = nameInput.value.trim();
  try { localStorage.setItem('ironfall-name', n); } catch {}
  return n;
}

$('btn-ai').onclick = () => connect(() => send({ t: 'ai', name: playerName() }));
$('btn-create').onclick = () => connect(() => send({ t: 'create', name: playerName() }));
$('btn-join').onclick = () => {
  const code = $('code').value.trim().toUpperCase();
  if (code.length !== 4) { $('menu-err').textContent = 'Enter the 4-letter code.'; return; }
  connect(() => send({ t: 'join', code, name: playerName() }));
};
$('btn-copy').onclick = () => { $('lobby-link').select(); navigator.clipboard?.writeText($('lobby-link').value); };
$('btn-again').onclick = () => location.href = location.pathname;
if (window.IronfallLocal) {
  $('btn-create').hidden = true;
  document.querySelector('.join-row').hidden = true;
  $('offline-note').hidden = false;
}
const joinParam = new URLSearchParams(location.search).get('join');
if (joinParam) $('code').value = joinParam.toUpperCase();

function show(id) {
  for (const s of ['menu', 'lobby', 'game']) $(s).classList.toggle('hidden', s !== id);
}

function onMessage(m) {
  switch (m.t) {
    case 'lobby':
      show('lobby');
      $('lobby-code').textContent = m.code;
      $('lobby-link').value = `${location.origin}${location.pathname}?join=${m.code}`;
      break;
    case 'err':
      if (G) toast(m.msg, 'bad'); else $('menu-err').textContent = m.msg;
      if (G) sfx('error');
      break;
    case 'start': startMatch(m); break;
    case 's': if (G) onSnapshot(m); break;
    case 'left': if (G) endGame('Victory', 'Your opponent left the battlefield.'); break;
  }
}

// ---------------------------------------------------------- Match setup ---
const canvas = $('view');
const ctx = canvas.getContext('2d');
const mini = $('minimap');
const mctx = mini.getContext('2d');

function startMatch(m) {
  show('game');
  G = {
    you: m.you, map: m.map, units: m.units, abilities: m.abilities, names: m.names, econ: m.econ,
    snaps: [], latest: null, cam: { x: 0, y: 0, z: 1 }, sel: new Set(), groups: {},
    mode: null, effects: [], tracers: [], lastModels: new Map(), over: false, prevCards: '',
    lastTap: { key: null, t: 0 },
  };
  const hq = G.map.hq[G.you];
  resize();
  G.cam.x = hq.x - canvas.width / 2 / G.cam.z + (G.you === 1 ? 300 : -300);
  G.cam.y = hq.y - canvas.height / 2 / G.cam.z;
  G.terrain = buildTerrain(G.map);
  $('tk-name1').textContent = m.names[1];
  $('tk-name2').textContent = m.names[2];
  buildProdButtons();
  requestAnimationFrame(frame);
}

function onSnapshot(s) {
  s.recv = performance.now();
  G.snaps.push(s);
  if (G.snaps.length > 6) G.snaps.shift();
  G.latest = s;
  // Effects for this tick.
  for (const sh of s.sh) addShot(sh);
  for (const b of s.bo) addBoom(b);
  for (const msg of s.msg) if (msg.p === G.you) toast(msg.text, msg.kind === 'lost' || msg.kind === 'lostpt' ? 'bad' : 'good');
  // Corpses for models that disappeared.
  const seen = new Map();
  for (const sq of s.sq) for (const m of sq.ms) seen.set(m[0], { x: m[1], y: m[2], o: sq.o, armor: G.units[sq.t].armor });
  for (const [id, m] of G.lastModels) if (!seen.has(id)) addCorpse(m);
  G.lastModels = seen;
  for (const id of [...G.sel]) if (!s.sq.some(q => q.id === id)) G.sel.delete(id);
  if (s.over && !G.over) {
    const won = s.win === G.you;
    endGame(won ? 'Victory' : 'Defeat', won ? 'The enemy has run out of tickets.' : 'Your forces have been broken.');
  }
}

function endGame(title, sub) {
  if (!G) return;
  G.over = true;
  $('end-title').textContent = title;
  $('end-sub').textContent = sub;
  $('endscreen').classList.remove('hidden');
  sfx(title === 'Victory' ? 'cap' : 'lost');
}

// ------------------------------------------------------------- Terrain ---
function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

function buildTerrain(map) {
  const c = document.createElement('canvas');
  c.width = map.w; c.height = map.h;
  const t = c.getContext('2d');
  const r = rng(1234);
  t.fillStyle = '#34352a'; t.fillRect(0, 0, map.w, map.h);
  // Ground variation.
  for (let i = 0; i < 1400; i++) {
    const x = r() * map.w, y = r() * map.h, rad = 20 + r() * 120;
    const g = t.createRadialGradient(x, y, 0, x, y, rad);
    const tone = r() < 0.5 ? '60,58,42' : r() < 0.5 ? '38,40,30' : '72,66,48';
    g.addColorStop(0, `rgba(${tone},0.35)`); g.addColorStop(1, `rgba(${tone},0)`);
    t.fillStyle = g; t.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // Roads.
  t.strokeStyle = 'rgba(95,88,70,0.55)'; t.lineCap = 'round';
  t.lineWidth = 46;
  t.beginPath(); t.moveTo(0, 1000); t.bezierCurveTo(800, 960, 1400, 1060, 1600, 1000); t.bezierCurveTo(1800, 940, 2400, 1040, 3200, 1000); t.stroke();
  t.lineWidth = 30;
  for (const y of [350, 1650]) { t.beginPath(); t.moveTo(500, y + (y < 1000 ? 120 : -120)); t.quadraticCurveTo(1600, y - (y < 1000 ? 80 : -80), 2700, y + (y < 1000 ? 120 : -120)); t.stroke(); }
  t.beginPath(); t.moveTo(1600, 0); t.lineTo(1600, 2000); t.stroke();
  // Speckle.
  for (let i = 0; i < 9000; i++) {
    t.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.25)' : 'rgba(150,140,110,0.18)';
    t.fillRect(r() * map.w, r() * map.h, 1 + r() * 2, 1 + r() * 2);
  }
  // Craters.
  for (const cr of map.craters) {
    const g = t.createRadialGradient(cr.x, cr.y, cr.r * 0.1, cr.x, cr.y, cr.r * 1.25);
    g.addColorStop(0, '#16150f'); g.addColorStop(0.7, '#2a281e'); g.addColorStop(0.82, '#5d5640'); g.addColorStop(1, 'rgba(60,56,42,0)');
    t.fillStyle = g; t.beginPath(); t.arc(cr.x, cr.y, cr.r * 1.25, 0, Math.PI * 2); t.fill();
  }
  // Ruined buildings.
  for (const b of map.buildings) {
    t.fillStyle = 'rgba(0,0,0,0.45)'; t.fillRect(b.x + 8, b.y + 10, b.w, b.h);
    t.fillStyle = '#2b2b2a'; t.fillRect(b.x, b.y, b.w, b.h);
    for (let i = 0; i < 26; i++) {
      t.fillStyle = r() < 0.5 ? '#3a3936' : '#232322';
      t.fillRect(b.x + 6 + r() * (b.w - 24), b.y + 6 + r() * (b.h - 24), 6 + r() * 16, 6 + r() * 16);
    }
    t.strokeStyle = '#5a5850'; t.lineWidth = 7; t.strokeRect(b.x + 3.5, b.y + 3.5, b.w - 7, b.h - 7);
    // Broken gaps in the outer wall.
    t.fillStyle = '#2b2b2a';
    for (let i = 0; i < 3; i++) {
      const side = Math.floor(r() * 4), k = 0.2 + r() * 0.6;
      if (side === 0) t.fillRect(b.x + b.w * k, b.y, 14, 8);
      if (side === 1) t.fillRect(b.x + b.w * k, b.y + b.h - 8, 14, 8);
      if (side === 2) t.fillRect(b.x, b.y + b.h * k, 8, 14);
      if (side === 3) t.fillRect(b.x + b.w - 8, b.y + b.h * k, 8, 14);
    }
    t.strokeStyle = '#77736a'; t.lineWidth = 1; t.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
  }
  // Sandbags / low walls.
  for (const w of map.walls) {
    t.fillStyle = 'rgba(0,0,0,0.4)'; t.fillRect(w.x + 3, w.y + 4, w.w, w.h);
    const horiz = w.w > w.h, n = Math.max(2, Math.round((horiz ? w.w : w.h) / 14));
    for (let i = 0; i < n; i++) {
      const k = i / n, sz = (horiz ? w.w : w.h) / n;
      const x = horiz ? w.x + k * w.w : w.x, y = horiz ? w.y : w.y + k * w.h;
      t.fillStyle = i % 2 ? '#8a7a55' : '#9a8960';
      roundRect(t, x + 0.5, y + 0.5, horiz ? sz - 1 : w.w - 1, horiz ? w.h - 1 : sz - 1, 4); t.fill();
      t.strokeStyle = '#4f4430'; t.lineWidth = 1; t.stroke();
    }
  }
  return c;
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

function addCorpse(m) {
  const t = G.terrain.getContext('2d');
  const col = COLORS[m.o];
  if (m.armor) {
    t.fillStyle = 'rgba(10,10,10,0.6)'; t.beginPath(); t.arc(m.x, m.y, 40, 0, Math.PI * 2); t.fill();
    t.fillStyle = '#1e1e1c'; t.save(); t.translate(m.x, m.y); t.rotate(Math.random() * 6); t.fillRect(-22, -15, 44, 30); t.restore();
    return;
  }
  t.fillStyle = 'rgba(90,10,10,0.35)'; t.beginPath(); t.arc(m.x + 2, m.y + 2, 9, 0, Math.PI * 2); t.fill();
  t.fillStyle = col.dark; t.beginPath(); t.ellipse(m.x, m.y, 7, 4, Math.random() * 3, 0, Math.PI * 2); t.fill();
}

function scorch(x, y, r) {
  const t = G.terrain.getContext('2d');
  const g = t.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, 'rgba(10,8,5,0.45)'); g.addColorStop(1, 'rgba(10,8,5,0)');
  t.fillStyle = g; t.beginPath(); t.arc(x, y, r, 0, Math.PI * 2); t.fill();
}

// ------------------------------------------------------------- Effects ---
function addShot(sh) {
  const [x1, y1, x2, y2, kind, hit, owner] = sh;
  if (!isVisible(x1, y1) && !isVisible(x2, y2)) return;
  G.tracers.push({ x1, y1, x2, y2, kind, hit, owner, t: 0, life: SHOT_STYLE[kind].life });
  G.effects.push({ type: 'flash', x: x1, y: y1, t: 0, life: 0.06, r: kind === 4 ? 14 : kind === 3 ? 10 : 5 });
  if (hit && kind !== 4) G.effects.push({ type: 'spark', x: x2, y: y2, t: 0, life: 0.15 });
  sfx(['rifle', 'pistol', 'repeater', 'lance', 'cannon', 'repeater', 'rifle', 'blade'][kind], x1, y1);
}

function addBoom(b) {
  const [x, y, r] = b;
  G.effects.push({ type: 'boom', x, y, r, t: 0, life: 0.6 });
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * 140;
    G.effects.push({ type: 'debris', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.5 + Math.random() * 0.4 });
  }
  scorch(x, y, r * 0.9);
  sfx('boom', x, y);
}

const toastBox = $('toasts');
function toast(text, kind) {
  const d = document.createElement('div');
  d.className = `toast ${kind || ''}`;
  d.textContent = text;
  toastBox.appendChild(d);
  while (toastBox.children.length > 5) toastBox.firstChild.remove();
  setTimeout(() => d.remove(), 3500);
  if (kind === 'good') sfx('cap'); else if (kind === 'bad') sfx('lost');
}

// --------------------------------------------------------------- Sound ---
let audio = null, soundOn = true, sfxBudget = 0;
function initAudio() {
  if (audio) return;
  try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { audio = null; }
}
function noiseBuf() {
  if (noiseBuf.b) return noiseBuf.b;
  const b = audio.createBuffer(1, audio.sampleRate * 0.5, audio.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return (noiseBuf.b = b);
}
function sfx(kind, x, y) {
  if (!audio || !soundOn || audio.state !== 'running') return;
  let vol = 1;
  if (x !== undefined) {
    const cx = G.cam.x + canvas.width / 2 / G.cam.z, cy = G.cam.y + canvas.height / 2 / G.cam.z;
    const d = Math.hypot(x - cx, y - cy);
    vol = Math.max(0, 1 - d / 1100);
    if (vol <= 0.02) return;
  }
  if (sfxBudget > 10) return;
  sfxBudget++;
  const now = audio.currentTime, out = audio.createGain();
  out.connect(audio.destination);
  const P = {
    rifle: [0.05, 1800, 0.12], pistol: [0.04, 2400, 0.08], repeater: [0.03, 1400, 0.07], cannon: [0.4, 300, 0.5],
    boom: [0.6, 220, 0.6], blade: [0.05, 5000, 0.05],
  }[kind];
  if (P) {
    const src = audio.createBufferSource(); src.buffer = noiseBuf();
    const f = audio.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = P[1];
    src.connect(f); f.connect(out);
    out.gain.setValueAtTime(P[2] * vol, now); out.gain.exponentialRampToValueAtTime(0.001, now + P[0]);
    src.start(now); src.stop(now + P[0] + 0.02);
    return;
  }
  const o = audio.createOscillator(); o.connect(out);
  const tone = { lance: ['sawtooth', 900, 120, 0.35, 0.09], cap: ['triangle', 520, 780, 0.25, 0.08], lost: ['square', 300, 150, 0.3, 0.05],
    error: ['square', 160, 140, 0.12, 0.05], click: ['triangle', 900, 700, 0.05, 0.05] }[kind];
  if (!tone) return;
  o.type = tone[0];
  o.frequency.setValueAtTime(tone[1], now); o.frequency.exponentialRampToValueAtTime(tone[2], now + tone[3]);
  out.gain.setValueAtTime(tone[4] * vol, now); out.gain.exponentialRampToValueAtTime(0.001, now + tone[3]);
  o.start(now); o.stop(now + tone[3] + 0.02);
}
$('btn-sound').onclick = () => { soundOn = !soundOn; $('btn-sound').style.opacity = soundOn ? 1 : 0.4; };

// --------------------------------------------------- Interpolated state ---
const INTERP_DELAY = 100;
function viewState() {
  const snaps = G.snaps;
  if (!snaps.length) return null;
  const rt = performance.now() - INTERP_DELAY;
  let a = snaps[0], b = snaps[snaps.length - 1];
  for (let i = snaps.length - 1; i > 0; i--) {
    if (snaps[i - 1].recv <= rt) { a = snaps[i - 1]; b = snaps[i]; break; }
  }
  const k = b.recv === a.recv ? 1 : Math.max(0, Math.min(1, (rt - a.recv) / (b.recv - a.recv)));
  const prev = new Map();
  for (const sq of a.sq) for (const m of sq.ms) prev.set(m[0], m);
  const squads = b.sq.map(sq => {
    const ms = sq.ms.map(m => {
      const p = prev.get(m[0]);
      if (!p) return { id: m[0], x: m[1], y: m[2], hp: m[3], face: m[4], cover: m[5], jz: m[6], slot: m[7] };
      return { id: m[0], x: p[1] + (m[1] - p[1]) * k, y: p[2] + (m[2] - p[2]) * k, hp: m[3], face: lerpAngle(p[4], m[4], k), cover: m[5], jz: p[6] + (m[6] - p[6]) * k, slot: m[7] };
    });
    let cx = 0, cy = 0;
    for (const m of ms) { cx += m.x; cy += m.y; }
    return { ...sq, ms, cx: cx / ms.length, cy: cy / ms.length, def: G.units[sq.t] };
  });
  return { squads, snap: b };
}
function lerpAngle(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

// ---------------------------------------------------------- Visibility ---
let sightSources = [];
function computeSight(squads) {
  sightSources = [{ x: G.map.hq[G.you].x, y: G.map.hq[G.you].y, r: 420 }];
  for (const s of squads) if (s.o === G.you) sightSources.push({ x: s.cx, y: s.cy, r: s.def.sight });
}
function isVisible(x, y) {
  if (!G || G.over) return true;
  for (const s of sightSources) if ((x - s.x) ** 2 + (y - s.y) ** 2 < s.r * s.r) return true;
  return false;
}
function squadVisible(s) { return s.o === G.you || s.ms.some(m => isVisible(m.x, m.y)); }

// ------------------------------------------------------------- Rendering ---
let lastFrame = performance.now();
let view = null;
function resize() {
  const dpr = 1; // keep pixel cost predictable on large screens
  canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
}
addEventListener('resize', resize);

function frame(now) {
  if (!G) return;
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  sfxBudget = 0;
  updateCamera(dt);
  view = viewState();
  if (view) {
    computeSight(view.squads);
    draw(view, dt);
    drawMinimap(view);
    updateHud(view);
  }
  requestAnimationFrame(frame);
}

function draw(v, dt) {
  const { cam } = G;
  const W = canvas.width, H = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0a0b08'; ctx.fillRect(0, 0, W, H);
  ctx.setTransform(cam.z, 0, 0, cam.z, -cam.x * cam.z, -cam.y * cam.z);
  ctx.drawImage(G.terrain, 0, 0);

  drawPoints(v.snap);
  drawHQs();

  const visible = v.squads.filter(squadVisible);
  // Selection rings and cover markers under units.
  for (const s of visible) {
    if (!G.sel.has(s.id)) continue;
    for (const m of s.ms) {
      const r = (s.def.radius || 8) + 4;
      ctx.strokeStyle = '#8be37a'; ctx.lineWidth = 1.5 / cam.z;
      ctx.beginPath(); ctx.ellipse(m.x, m.y + 2, r, r * 0.75, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }
  for (const s of visible) for (const m of s.ms) if (!m.jz) drawModel(s, m);
  for (const s of visible) for (const m of s.ms) if (m.jz) drawModel(s, m);
  for (const p of v.snap.pr) drawGrenade(p);
  drawEffects(dt);
  for (const s of visible) drawSquadOverlay(s);
  drawFog(W, H);
  drawCommandPreview(v);

  // Drag box (screen space).
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (drag && drag.box) {
    ctx.strokeStyle = '#8be37a'; ctx.lineWidth = 1; ctx.fillStyle = 'rgba(139,227,122,0.08)';
    const x = Math.min(drag.sx, mouse.sx), y = Math.min(drag.sy, mouse.sy);
    const w = Math.abs(mouse.sx - drag.sx), h = Math.abs(mouse.sy - drag.sy);
    ctx.fillRect(x, y, w, h); ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  }
}

function drawPoints(snap) {
  G.map.points.forEach((p, i) => {
    const [owner, val, contested] = snap.pts[i];
    const col = owner ? COLORS[owner].body : '#bbb';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = owner ? col : 'rgba(220,220,200,0.5)';
    ctx.beginPath(); ctx.arc(p.x, p.y, 75, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    // Capture progress ring.
    if (Math.abs(val) > 0.001) {
      ctx.strokeStyle = COLORS[val > 0 ? 1 : 2].light; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(p.x, p.y, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.abs(val)); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(p.x, p.y, 24, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = contested ? '#ffcf4a' : owner ? col : '#ccc';
    if (p.type === 'vp') drawStar(p.x, p.y, 16, 7);
    else {
      ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(p.type === 'req' ? 'R' : 'P', p.x, p.y + 1);
    }
  });
}

function drawStar(x, y, R, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r : R;
    ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  ctx.closePath(); ctx.fill();
}

function drawHQs() {
  for (const p of [1, 2]) {
    const h = G.map.hq[p], col = COLORS[p];
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(h.x - 62, h.y - 56, 130, 120);
    ctx.fillStyle = col.dark; ctx.fillRect(h.x - 65, h.y - 60, 130, 120);
    ctx.strokeStyle = col.trim; ctx.lineWidth = 4; ctx.strokeRect(h.x - 63, h.y - 58, 126, 116);
    ctx.fillStyle = col.body; ctx.fillRect(h.x - 40, h.y - 35, 80, 70);
    ctx.fillStyle = col.trim; ctx.beginPath(); ctx.arc(h.x, h.y, 18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col.dark; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('HQ', h.x, h.y + 1);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(h.x, h.y, 300, 0, Math.PI * 2); ctx.stroke();
  }
}

function drawModel(s, m) {
  const col = COLORS[s.o];
  if (s.def.armor) { drawTank(s, m, col); return; }
  const lift = m.jz || 0;
  const sc = 1 + lift * 0.5;
  // Shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.ellipse(m.x + 2 + lift * 14, m.y + 3 + lift * 18, 8, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.translate(m.x, m.y - lift * 10); ctx.rotate(m.face); ctx.scale(sc, sc);
  // Weapon.
  const heavy = (s.t === 'heavy' || s.t === 'lance') && m.slot === 0;
  ctx.strokeStyle = s.t === 'lance' && m.slot === 0 ? '#2a3a40' : '#1a1a1a';
  ctx.lineWidth = heavy ? 4 : 2.6;
  ctx.beginPath(); ctx.moveTo(2, 3); ctx.lineTo(heavy ? 18 : 13, 3); ctx.stroke();
  // Jump pack.
  if (s.t === 'assault') {
    ctx.fillStyle = '#333'; ctx.fillRect(-11, -5, 5, 10);
    if (lift > 0.05) { ctx.fillStyle = 'rgba(255,170,60,0.9)'; ctx.beginPath(); ctx.arc(-13, 0, 3 + Math.random() * 3, 0, Math.PI * 2); ctx.fill(); }
  }
  // Body and pauldrons.
  ctx.fillStyle = col.body; ctx.strokeStyle = '#0a0a0a'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = col.trim;
  ctx.beginPath(); ctx.arc(-1, -7, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(-1, 7, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // Helmet.
  ctx.fillStyle = col.dark; ctx.beginPath(); ctx.arc(2, 0, 3.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = s.o === 1 ? '#9fe8ff' : '#7dff7d'; ctx.fillRect(4, -1.6, 1.6, 3.2);
  ctx.restore();
}

function drawTank(s, m, col) {
  ctx.save();
  ctx.translate(m.x, m.y);
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(-20, -13, 46, 32);
  ctx.rotate(m.face);
  ctx.fillStyle = '#1b1b1b'; ctx.fillRect(-24, -17, 48, 8); ctx.fillRect(-24, 9, 48, 8);
  ctx.fillStyle = '#3a3a3a';
  for (let i = -22; i < 24; i += 6) { ctx.fillRect(i, -17, 2, 8); ctx.fillRect(i, 9, 2, 8); }
  ctx.fillStyle = col.body; ctx.strokeStyle = '#0a0a0a'; ctx.lineWidth = 1.5;
  ctx.fillRect(-21, -11, 42, 22); ctx.strokeRect(-21, -11, 42, 22);
  ctx.fillStyle = col.trim; ctx.fillRect(14, -11, 7, 22);
  ctx.fillStyle = '#151515'; ctx.fillRect(4, -2.5, 30, 5);
  ctx.fillStyle = col.dark; ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();
}

function drawGrenade(p) {
  const [x, y, z] = p;
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ddd'; ctx.beginPath(); ctx.arc(x, y - z * 40, 3.5, 0, Math.PI * 2); ctx.fill();
}

function drawEffects(dt) {
  G.tracers = G.tracers.filter(t => {
    t.t += dt;
    if (t.t > t.life) return false;
    const st = SHOT_STYLE[t.kind];
    if (!st.w) return true;
    const k = t.t / t.life;
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = st.c; ctx.lineWidth = st.w;
    ctx.beginPath();
    if (t.kind === 3) { ctx.moveTo(t.x1, t.y1); ctx.lineTo(t.x2, t.y2); }
    else {
      // Short streak travelling down the line of fire.
      const a = Math.min(1, k * 1.6), b = Math.max(0, a - 0.35);
      ctx.moveTo(t.x1 + (t.x2 - t.x1) * b, t.y1 + (t.y2 - t.y1) * b);
      ctx.lineTo(t.x1 + (t.x2 - t.x1) * a, t.y1 + (t.y2 - t.y1) * a);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    return true;
  });
  G.effects = G.effects.filter(e => {
    e.t += dt;
    if (e.t > e.life) return false;
    const k = e.t / e.life;
    if (e.type === 'flash') {
      ctx.fillStyle = `rgba(255,220,120,${1 - k})`; ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); ctx.fill();
    } else if (e.type === 'spark') {
      ctx.fillStyle = `rgba(255,120,80,${1 - k})`; ctx.beginPath(); ctx.arc(e.x, e.y, 3 + k * 4, 0, Math.PI * 2); ctx.fill();
    } else if (e.type === 'boom') {
      const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.r * (0.5 + k));
      g.addColorStop(0, `rgba(255,240,180,${1 - k})`); g.addColorStop(0.4, `rgba(255,140,40,${0.8 * (1 - k)})`); g.addColorStop(1, 'rgba(60,40,30,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (0.5 + k), 0, Math.PI * 2); ctx.fill();
    } else if (e.type === 'debris') {
      e.x += e.vx * dt; e.y += e.vy * dt; e.vx *= 0.92; e.vy *= 0.92;
      ctx.fillStyle = `rgba(60,50,40,${1 - k})`; ctx.fillRect(e.x - 1.5, e.y - 1.5, 3, 3);
    }
    return true;
  });
}

function drawSquadOverlay(s) {
  const sel = G.sel.has(s.id), hov = hover && hover.id === s.id;
  const hp = s.ms.reduce((a, m) => a + m.hp, 0), max = s.def.models * s.def.hp;
  const top = Math.min(...s.ms.map(m => m.y)) - (s.def.armor ? 30 : 18);
  const z = G.cam.z;
  if (sel || hov || hp < max || s.sp > 0) {
    const w = 36 / Math.max(z, 0.7), x = s.cx - w / 2;
    ctx.fillStyle = '#000'; ctx.fillRect(x - 1, top - 1, w + 2, 6);
    ctx.fillStyle = '#5a1515'; ctx.fillRect(x, top, w, 4);
    ctx.fillStyle = s.o === G.you ? '#6c6' : '#e65'; ctx.fillRect(x, top, w * hp / max, 4);
    if (s.sp > 0) { ctx.fillStyle = s.sp >= 80 ? '#f33' : s.sp >= 40 ? '#fb3' : '#cc9'; ctx.fillRect(x, top + 5, w * s.sp / 100, 2); }
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.font = 'bold 11px sans-serif';
  let label = '';
  if (s.v) label += '★'.repeat(s.v);
  if (s.st === 'retreat') label += ' ⟲';
  if (s.sp >= 80) label += ' PINNED'; else if (s.sp >= 40) label += ' SUPPRESSED';
  if (label) { ctx.fillStyle = s.sp >= 40 ? '#fb3' : '#d9b45a'; ctx.fillText(label.trim(), s.cx, top - 2); }
  // Cover shields for your selected squad.
  if (sel && s.o === G.you && !s.def.armor) {
    for (const m of s.ms) {
      if (!m.cover) continue;
      ctx.fillStyle = m.cover === 2 ? '#5cd65c' : '#e6c84a';
      ctx.beginPath(); ctx.moveTo(m.x + 8, m.y - 14); ctx.lineTo(m.x + 14, m.y - 12); ctx.lineTo(m.x + 13, m.y - 6);
      ctx.lineTo(m.x + 8, m.y - 3); ctx.lineTo(m.x + 3, m.y - 6); ctx.lineTo(m.x + 2, m.y - 12); ctx.closePath(); ctx.fill();
    }
  }
}

const fogCanvas = document.createElement('canvas');
function drawFog(W, H) {
  if (fogCanvas.width !== W || fogCanvas.height !== H) { fogCanvas.width = W; fogCanvas.height = H; }
  const f = fogCanvas.getContext('2d');
  const { cam } = G;
  f.globalCompositeOperation = 'source-over';
  f.clearRect(0, 0, W, H);
  f.fillStyle = 'rgba(5,6,4,0.55)'; f.fillRect(0, 0, W, H);
  f.globalCompositeOperation = 'destination-out';
  for (const s of sightSources) {
    const x = (s.x - cam.x) * cam.z, y = (s.y - cam.y) * cam.z, r = s.r * cam.z;
    if (x < -r || y < -r || x > W + r || y > H + r) continue;
    const g = f.createRadialGradient(x, y, r * 0.8, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    f.fillStyle = g; f.beginPath(); f.arc(x, y, r, 0, Math.PI * 2); f.fill();
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(fogCanvas, 0, 0); ctx.restore();
}

function drawCommandPreview(v) {
  const w = screenToWorld(mouse.sx, mouse.sy);
  const mine = v.squads.filter(s => G.sel.has(s.id) && s.o === G.you);
  ctx.lineWidth = 1.5 / G.cam.z;
  if (G.mode === 'ability') {
    const s = mine.find(q => q.def.ability && q.cd === 0) || mine.find(q => q.def.ability);
    if (s) {
      const ab = G.abilities[s.def.ability];
      ctx.strokeStyle = 'rgba(255,220,120,0.35)'; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.arc(s.cx, s.cy, ab.range, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = '#ffb347'; ctx.fillStyle = 'rgba(255,140,40,0.15)';
      ctx.beginPath(); ctx.arc(w.x, w.y, s.def.ability === 'jump' ? 75 : 65, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  } else if (G.mode === 'amove') {
    ctx.strokeStyle = '#ff6a4a'; ctx.beginPath(); ctx.arc(w.x, w.y, 14, 0, Math.PI * 2); ctx.moveTo(w.x - 20, w.y); ctx.lineTo(w.x + 20, w.y); ctx.moveTo(w.x, w.y - 20); ctx.lineTo(w.x, w.y + 20); ctx.stroke();
  }
  // Move markers.
  if (G.marker) {
    G.marker.t += 1 / 60;
    if (G.marker.t > 0.6) G.marker = null;
    else {
      const k = G.marker.t / 0.6;
      ctx.strokeStyle = G.marker.color; ctx.globalAlpha = 1 - k; ctx.lineWidth = 2 / G.cam.z;
      ctx.beginPath(); ctx.arc(G.marker.x, G.marker.y, 6 + k * 16, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }
  canvas.style.cursor = G.mode ? 'crosshair' : hover && hover.o !== G.you && mine.length ? 'crosshair' : 'default';
}

function drawMinimap(v) {
  const sx = mini.width / G.map.w, sy = mini.height / G.map.h;
  mctx.drawImage(G.terrain, 0, 0, mini.width, mini.height);
  mctx.fillStyle = 'rgba(0,0,0,0.35)'; mctx.fillRect(0, 0, mini.width, mini.height);
  G.map.points.forEach((p, i) => {
    const o = v.snap.pts[i][0];
    mctx.fillStyle = o ? COLORS[o].light : '#ccc';
    mctx.fillRect(p.x * sx - 3, p.y * sy - 3, 6, 6);
  });
  for (const p of [1, 2]) { mctx.fillStyle = COLORS[p].body; mctx.fillRect(G.map.hq[p].x * sx - 5, G.map.hq[p].y * sy - 5, 10, 10); }
  for (const s of v.squads) {
    if (!squadVisible(s)) continue;
    mctx.fillStyle = s.o === G.you ? (G.sel.has(s.id) ? '#bfffb0' : COLORS[s.o].light) : '#ff5a4a';
    mctx.fillRect(s.cx * sx - 2, s.cy * sy - 2, s.def.armor ? 5 : 4, s.def.armor ? 5 : 4);
  }
  mctx.strokeStyle = '#fff'; mctx.lineWidth = 1;
  mctx.strokeRect(G.cam.x * sx, G.cam.y * sy, canvas.width / G.cam.z * sx, canvas.height / G.cam.z * sy);
}

// ------------------------------------------------------------------- HUD ---
function fmtTime(s) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

function updateHud(v) {
  const s = v.snap, me = s.pl[G.you], econ = G.units;
  $('r-req').textContent = me.req; $('r-reqi').textContent = `+${me.inc[0]}/m`;
  $('r-pow').textContent = me.pow; $('r-powi').textContent = `+${me.inc[1]}/m`;
  $('r-pop').textContent = `${me.pop}/${G.econ.popCap}`;
  for (const p of [1, 2]) {
    $(`tk${p}`).style.width = `${(s.pl[p].tk / G.econ.tickets) * 100}%`;
    $(`tk${p}n`).textContent = s.pl[p].tk;
  }
  $('vp-row').innerHTML = G.map.points.map((p, i) => p.type === 'vp' ? `<div class="vp" style="background:${s.pts[i][0] ? COLORS[s.pts[i][0]].body : '#666'}"></div>` : '').join('');
  $('clock').textContent = fmtTime(s.time);

  // Production buttons and queue.
  for (const u of BUILD_LIST) {
    const d = econ[u], b = $(`build-${u}`);
    b.classList.toggle('cant', me.req < d.cost.req || me.pow < d.cost.pow || me.pop + d.pop > G.econ.popCap);
  }
  const qHtml = me.q.map(([u, t], i) => `<div class="q" data-i="${i}" title="Click to cancel">${econ[u].short} ${t}s</div>`).join('') || '<span class="hint">Production queue empty</span>';
  if ($('queue').innerHTML !== qHtml) $('queue').innerHTML = qHtml;

  // Squad cards.
  const mine = v.squads.filter(q => q.o === G.you).sort((a, b) => a.id - b.id);
  const cards = mine.map(q => {
    const hp = q.ms.reduce((a, m) => a + m.hp, 0) / (q.def.models * q.def.hp);
    const st = q.st === 'retreat' ? 'Retreating' : q.sp >= 80 ? 'Pinned' : q.sp >= 40 ? 'Suppressed' : q.st === 'jump' ? 'Jumping' : q.tg ? 'In combat' : q.st === 'move' ? 'Moving' : 'Idle';
    const bad = q.sp >= 40 || q.st === 'retreat' || q.tg;
    const grp = Object.entries(G.groups).filter(([, ids]) => ids.includes(q.id)).map(([k]) => k).join('');
    return `<div class="card ${G.sel.has(q.id) ? 'sel' : ''}" data-id="${q.id}"><div class="row"><span class="name">${grp ? `[${grp}] ` : ''}${q.def.short}</span><span class="stars">${'★'.repeat(q.v)}</span><span class="pips">${q.def.armor ? '' : '●'.repeat(q.ms.length) + '○'.repeat(q.def.models - q.ms.length)}</span></div><div class="row"><span class="st ${bad ? 'bad' : ''}">${st}</span>${q.def.ability ? `<span class="st">${q.cd ? q.cd + 's' : 'G ready'}</span>` : ''}</div><div class="hp"><div style="width:${hp * 100}%"></div></div></div>`;
  }).join('');
  if (cards !== G.prevCards) { $('cards').innerHTML = cards; G.prevCards = cards; }

  // Selection panel.
  const sel = mine.filter(q => G.sel.has(q.id));
  let html;
  if (!sel.length) {
    html = `<div class="info"><h3>No squad selected</h3><div class="desc">Left-click or drag to select squads. Right-click to move or attack. Capture points to earn resources; hold victory points to drain enemy tickets.</div></div>`;
  } else {
    const q = sel[0];
    const head = sel.length > 1 ? `${sel.length} squads selected` : q.def.name;
    const models = q.ms.map(m => `<div class="model"><div style="width:${(m.hp / q.def.hp) * 100}%"></div></div>`).join('');
    const xpNext = [250, 700, 1400][q.v];
    const nearHq = sel.some(x => Math.hypot(x.cx - G.map.hq[G.you].x, x.cy - G.map.hq[G.you].y) < 300 && !x.def.armor && x.ms.length + x.rq < x.def.models);
    const ab = sel.find(x => x.def.ability);
    html = `<div class="info"><h3>${head} ${'<span class="stars">' + '★'.repeat(q.v) + '</span>'}</h3>
      <div class="desc">${sel.length > 1 ? sel.map(x => x.def.short).join(', ') : q.def.desc}</div>
      <div class="models">${models}</div>
      <div class="meter">Suppression<div class="bar"><div class="fill" style="width:${q.sp}%;background:${q.sp >= 80 ? '#f33' : q.sp >= 40 ? '#fb3' : '#cc9'}"></div></div></div>
      <div class="meter">Veterancy ${xpNext ? `${q.xp}/${xpNext}` : 'max'}${q.rq ? ` · reinforcing ${q.rq}` : ''}</div></div>
      <div class="cmds">
        <button data-cmd="amove" class="${G.mode === 'amove' ? 'active' : ''}">Attack-move<br>(A)</button>
        <button data-cmd="stop">Stop<br>(S)</button>
        <button data-cmd="retreat">Retreat<br>(R)</button>
        <button data-cmd="reinforce" ${nearHq ? '' : 'disabled'} title="Squads near HQ only">Reinforce<br>(T) ${q.def.reinforce || ''}</button>
        <button data-cmd="ability" class="${G.mode === 'ability' ? 'active' : ''}" ${ab && !ab.cd ? '' : 'disabled'}>${ab ? (ab.def.ability === 'grenade' ? 'Frag grenade' : 'Jump') + `<br>(G) ${ab.cd ? ab.cd + 's' : G.abilities[ab.def.ability].pow + 'P'}` : 'No ability'}</button>
      </div>`;
  }
  if ($('selpanel').innerHTML !== html) $('selpanel').innerHTML = html;
}

function buildProdButtons() {
  $('prod-btns').innerHTML = BUILD_LIST.map(u => {
    const d = G.units[u];
    return `<button id="build-${u}" data-unit="${u}" title="${d.name}: ${d.desc}"><b>${d.short}</b><span>${d.name.split(' ')[0]}</span><span class="c-req">${d.cost.req}R</span><span class="c-pow">${d.cost.pow ? d.cost.pow + 'P' : '&nbsp;'}</span><span class="key">${KEY_OF[u]}</span></button>`;
  }).join('');
}

$('prod-btns').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  send({ t: 'cmd', c: { type: 'build', unit: b.dataset.unit } }); sfx('click');
});
$('queue').addEventListener('mousedown', e => {
  const q = e.target.closest('.q'); if (!q) return;
  send({ t: 'cmd', c: { type: 'cancel', index: Number(q.dataset.i) } });
});
$('cards').addEventListener('mousedown', e => {
  const c = e.target.closest('.card'); if (!c) return;
  const id = Number(c.dataset.id);
  if (e.shiftKey) { G.sel.has(id) ? G.sel.delete(id) : G.sel.add(id); }
  else {
    if (G.sel.size === 1 && G.sel.has(id)) centerOn([id]);
    G.sel = new Set([id]);
  }
  sfx('click');
});
$('selpanel').addEventListener('mousedown', e => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  runCommand(b.dataset.cmd);
});

function runCommand(cmd) {
  const ids = [...G.sel];
  if (!ids.length) return;
  if (cmd === 'amove') G.mode = G.mode === 'amove' ? null : 'amove';
  else if (cmd === 'ability') G.mode = G.mode === 'ability' ? null : 'ability';
  else send({ t: 'cmd', c: { type: cmd, ids } });
  sfx('click');
}

// ----------------------------------------------------------------- Input ---
const mouse = { sx: 0, sy: 0, inside: false };
let drag = null, hover = null, mid = null;
const keys = new Set();

function screenToWorld(sx, sy) { return { x: G.cam.x + sx / G.cam.z, y: G.cam.y + sy / G.cam.z }; }

function pickSquad(wx, wy) {
  if (!view) return null;
  let best = null, bd = Infinity;
  for (const s of view.squads) {
    if (!squadVisible(s)) continue;
    for (const m of s.ms) {
      const d = Math.hypot(m.x - wx, m.y - wy) - (s.def.radius || 8);
      if (d < 10 / Math.min(1, G.cam.z) && d < bd) { bd = d; best = s; }
    }
  }
  return best;
}

canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousemove', e => {
  mouse.sx = e.clientX; mouse.sy = e.clientY; mouse.inside = true;
  if (!G) return;
  if (mid) { G.cam.x = mid.cx - (e.clientX - mid.sx) / G.cam.z; G.cam.y = mid.cy - (e.clientY - mid.sy) / G.cam.z; clampCam(); }
  if (drag && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) drag.box = true;
  const w = screenToWorld(e.clientX, e.clientY);
  hover = pickSquad(w.x, w.y);
});
canvas.addEventListener('mouseleave', () => { mouse.inside = false; });
canvas.addEventListener('mousedown', e => {
  initAudio(); audio?.resume?.();
  if (!G || G.over) return;
  const w = screenToWorld(e.clientX, e.clientY);
  if (e.button === 1) { mid = { sx: e.clientX, sy: e.clientY, cx: G.cam.x, cy: G.cam.y }; e.preventDefault(); return; }
  if (e.button === 2) {
    if (G.mode) { G.mode = null; return; }
    issueOrder(w, false); return;
  }
  if (e.button === 0) {
    if (G.mode === 'amove') { issueOrder(w, true); if (!e.shiftKey) G.mode = null; return; }
    if (G.mode === 'ability') { castAbility(w); if (!e.shiftKey) G.mode = null; return; }
    drag = { sx: e.clientX, sy: e.clientY, box: false, shift: e.shiftKey };
  }
});
addEventListener('mouseup', e => {
  if (e.button === 1) mid = null;
  if (e.button !== 0 || !drag || !G) return;
  const add = drag.shift;
  if (!add) G.sel.clear();
  if (drag.box) {
    const a = screenToWorld(Math.min(drag.sx, e.clientX), Math.min(drag.sy, e.clientY));
    const b = screenToWorld(Math.max(drag.sx, e.clientX), Math.max(drag.sy, e.clientY));
    for (const s of view.squads) {
      if (s.o !== G.you) continue;
      if (s.ms.some(m => m.x >= a.x && m.x <= b.x && m.y >= a.y && m.y <= b.y)) G.sel.add(s.id);
    }
  } else {
    const w = screenToWorld(e.clientX, e.clientY);
    const s = pickSquad(w.x, w.y);
    if (s && s.o === G.you) {
      if (add && G.sel.has(s.id)) G.sel.delete(s.id); else G.sel.add(s.id);
      // Double-click selects all squads of that type on screen.
      const now = performance.now();
      if (G.lastClick && G.lastClick.id === s.id && now - G.lastClick.t < 350) {
        for (const q of view.squads) if (q.o === G.you && q.t === s.t && onScreen(q.cx, q.cy)) G.sel.add(q.id);
      }
      G.lastClick = { id: s.id, t: now };
    }
  }
  if (G.sel.size) sfx('click');
  drag = null;
});
canvas.addEventListener('wheel', e => {
  if (!G) return;
  e.preventDefault();
  const before = screenToWorld(e.clientX, e.clientY);
  G.cam.z = Math.max(0.45, Math.min(1.8, G.cam.z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
  G.cam.x = before.x - e.clientX / G.cam.z; G.cam.y = before.y - e.clientY / G.cam.z;
  clampCam();
}, { passive: false });

function onScreen(x, y) {
  const a = screenToWorld(0, 0), b = screenToWorld(canvas.width, canvas.height);
  return x >= a.x && x <= b.x && y >= a.y && y <= b.y;
}

function issueOrder(w, amove) {
  const ids = [...G.sel];
  if (!ids.length) return;
  const target = !amove && pickSquad(w.x, w.y);
  if (target && target.o !== G.you) {
    send({ t: 'cmd', c: { type: 'attack', ids, target: target.id } });
    G.marker = { x: w.x, y: w.y, t: 0, color: '#ff5a4a' };
  } else {
    send({ t: 'cmd', c: { type: 'move', ids, x: w.x, y: w.y, amove } });
    G.marker = { x: w.x, y: w.y, t: 0, color: amove ? '#ff9a4a' : '#8be37a' };
  }
  sfx('click');
}

function castAbility(w) {
  const s = view.squads.find(q => G.sel.has(q.id) && q.o === G.you && q.def.ability && q.cd === 0);
  if (!s) { toast('No ability ready', 'bad'); return; }
  send({ t: 'cmd', c: { type: 'ability', id: s.id, x: w.x, y: w.y } });
  G.marker = { x: w.x, y: w.y, t: 0, color: '#ffb347' };
}

function centerOn(ids) {
  const sq = view.squads.filter(s => ids.includes(s.id));
  if (!sq.length) return;
  const x = sq.reduce((a, s) => a + s.cx, 0) / sq.length, y = sq.reduce((a, s) => a + s.cy, 0) / sq.length;
  G.cam.x = x - canvas.width / 2 / G.cam.z; G.cam.y = y - canvas.height / 2 / G.cam.z; clampCam();
}

addEventListener('keydown', e => {
  if (!G || G.over || e.target.tagName === 'INPUT') return;
  initAudio(); audio?.resume?.();
  const k = e.key.toLowerCase();
  keys.add(e.key);
  if (/^[1-9]$/.test(k)) {
    if (e.ctrlKey || e.metaKey) { G.groups[k] = [...G.sel]; e.preventDefault(); toast(`Group ${k} set`); return; }
    const ids = (G.groups[k] || []).filter(id => view.squads.some(s => s.id === id));
    if (!ids.length) return;
    const now = performance.now();
    if (G.lastTap.key === k && now - G.lastTap.t < 400) centerOn(ids);
    G.lastTap = { key: k, t: now };
    G.sel = new Set(ids); return;
  }
  if (BUILD_KEYS[k]) { send({ t: 'cmd', c: { type: 'build', unit: BUILD_KEYS[k] } }); sfx('click'); return; }
  switch (k) {
    case 'a': runCommand('amove'); break;
    case 's': runCommand('stop'); break;
    case 'r': runCommand('retreat'); break;
    case 't': runCommand('reinforce'); break;
    case 'g': runCommand('ability'); break;
    case 'escape': G.mode = null; G.sel.clear(); break;
    case 'm': $('btn-sound').click(); break;
    case ' ': centerOn([...G.sel]); e.preventDefault(); break;
    case 'home': { const h = G.map.hq[G.you]; G.cam.x = h.x - canvas.width / 2 / G.cam.z; G.cam.y = h.y - canvas.height / 2 / G.cam.z; clampCam(); break; }
    case 'tab': e.preventDefault(); { const own = view.squads.filter(s => s.o === G.you); if (own.length) G.sel = new Set(own.map(s => s.id)); } break;
  }
});
addEventListener('keyup', e => keys.delete(e.key));

function updateCamera(dt) {
  const sp = 900 / G.cam.z * dt;
  let dx = 0, dy = 0;
  if (keys.has('ArrowLeft')) dx -= sp; if (keys.has('ArrowRight')) dx += sp;
  if (keys.has('ArrowUp')) dy -= sp; if (keys.has('ArrowDown')) dy += sp;
  if (mouse.inside && !drag && !mid) {
    const m = 6;
    if (mouse.sx <= m) dx -= sp; if (mouse.sx >= canvas.width - m) dx += sp;
    if (mouse.sy <= m) dy -= sp; if (mouse.sy >= canvas.height - m) dy += sp;
  }
  G.cam.x += dx; G.cam.y += dy;
  clampCam();
}

function clampCam() {
  const vw = canvas.width / G.cam.z, vh = canvas.height / G.cam.z;
  G.cam.x = Math.max(-60, Math.min(G.map.w - vw + 60, G.cam.x));
  G.cam.y = Math.max(-260, Math.min(G.map.h - vh + 260, G.cam.y));
}

function miniJump(e) {
  const r = mini.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width * G.map.w, y = (e.clientY - r.top) / r.height * G.map.h;
  if (e.button === 2) { issueOrder({ x, y }, false); return; }
  G.cam.x = x - canvas.width / 2 / G.cam.z; G.cam.y = y - canvas.height / 2 / G.cam.z; clampCam();
}
mini.addEventListener('mousedown', e => { if (G) { miniJump(e); mini.dragging = e.button === 0; } });
mini.addEventListener('mousemove', e => { if (G && mini.dragging) miniJump(e); });
addEventListener('mouseup', () => { mini.dragging = false; });
mini.addEventListener('contextmenu', e => e.preventDefault());
