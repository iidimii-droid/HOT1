'use strict';
// HTTP server for the client files plus a WebSocket server that runs matches.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Game } = require('./sim');
const { AI } = require('./ai');
const { TICK_RATE, UNITS, WEAPONS, ECON, MAP, resolveSchemes } = require('./data');
const { ABILITIES } = require('./sim');

const PORT = process.env.PORT !== undefined ? Number(process.env.PORT) : 8080;
const PUBLIC = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/health') { res.writeHead(200); res.end('ok'); return; }
  const file = path.normalize(path.join(PUBLIC, url === '/' ? 'index.html' : url));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });
const rooms = new Map(); // code -> room

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}

function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); }

function createRoom(vsAI) {
  const room = { code: makeCode(), players: [null, null, null], names: ['', '', ''], schemes: [null, null, null], game: null, ai: null, timer: null, vsAI };
  rooms.set(room.code, room);
  return room;
}

function startGame(room) {
  room.game = new Game();
  const schemes = resolveSchemes(room.schemes[1], room.schemes[2]);
  if (room.vsAI) room.ai = new AI(room.game, 2);
  for (const p of [1, 2]) {
    send(room.players[p], {
      t: 'start', you: p, names: room.names, schemes, map: MAP, units: UNITS, weapons: WEAPONS,
      abilities: ABILITIES, econ: ECON, tickRate: TICK_RATE,
    });
  }
  room.timer = setInterval(() => {
    const g = room.game;
    if (room.ai) room.ai.update();
    g.step();
    const snap = JSON.stringify(g.snapshot());
    for (const p of [1, 2]) send(room.players[p], snap);
    if (g.over) closeRoom(room);
  }, 1000 / TICK_RATE);
}

function closeRoom(room) {
  clearInterval(room.timer);
  rooms.delete(room.code);
  for (const p of [1, 2]) if (room.players[p]) room.players[p].room = null;
}

function cleanName(n) { return String(n || '').replace(/[^\w \-]/g, '').trim().slice(0, 16) || 'Commander'; }

wss.on('connection', ws => {
  ws.room = null; ws.slot = 0;
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    const room = ws.room;
    if (msg.t === 'cmd') {
      if (!room || !room.game) return;
      const err = room.game.command(ws.slot, msg.c);
      if (err) send(ws, { t: 'err', msg: err });
      return;
    }
    if (room) return; // already in a room
    if (msg.t === 'create' || msg.t === 'ai') {
      const r = createRoom(msg.t === 'ai');
      r.players[1] = ws; r.names[1] = cleanName(msg.name); r.schemes[1] = msg.scheme;
      ws.room = r; ws.slot = 1;
      if (r.vsAI) { r.names[2] = 'Iron AI'; startGame(r); }
      else send(ws, { t: 'lobby', code: r.code });
    } else if (msg.t === 'join') {
      const r = rooms.get(String(msg.code || '').toUpperCase());
      if (!r || r.vsAI) { send(ws, { t: 'err', msg: 'No game with that code' }); return; }
      if (r.players[2]) { send(ws, { t: 'err', msg: 'That game is full' }); return; }
      r.players[2] = ws; r.names[2] = cleanName(msg.name); r.schemes[2] = msg.scheme;
      ws.room = r; ws.slot = 2;
      startGame(r);
    }
  });
  ws.on('close', () => {
    const r = ws.room;
    if (!r) return;
    const other = r.players[3 - ws.slot];
    if (r.game && !r.game.over) send(other, { t: 'left' });
    closeRoom(r);
  });
});

server.listen(PORT, () => console.log(`Ironfall server on http://localhost:${server.address().port}`));
module.exports = { server };
