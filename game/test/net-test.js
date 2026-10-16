'use strict';
// End-to-end over WebSockets: two clients create/join a match, receive
// snapshots, and their commands change the game state.
const assert = require('assert');
process.env.PORT = '0';
const { server } = require('../server/index');
const WebSocket = require('ws');

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.inbox = [];
  ws.on('message', d => ws.inbox.push(JSON.parse(d)));
  return new Promise(r => ws.on('open', () => r(ws)));
}
function waitFor(ws, pred, ms = 4000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const m = ws.inbox.find(pred);
      if (m) { clearInterval(iv); resolve(m); }
      else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error('timeout waiting for message')); }
    }, 20);
  });
}

(async () => {
  await new Promise(r => server.listening ? r() : server.once('listening', r));
  const port = server.address().port;
  const a = await client(port), b = await client(port);
  a.send(JSON.stringify({ t: 'create', name: 'Alpha' }));
  const lobby = await waitFor(a, m => m.t === 'lobby');
  assert.match(lobby.code, /^[A-Z0-9]{4}$/);
  b.send(JSON.stringify({ t: 'join', code: lobby.code.toLowerCase(), name: 'Bravo' }));
  const sa = await waitFor(a, m => m.t === 'start'), sb = await waitFor(b, m => m.t === 'start');
  assert.strictEqual(sa.you, 1); assert.strictEqual(sb.you, 2);
  assert.deepStrictEqual(sa.names.slice(1), ['Alpha', 'Bravo']);

  const snap = await waitFor(a, m => m.t === 's');
  const mine = snap.sq.find(s => s.o === 1), theirs = snap.sq.find(s => s.o === 2);
  // Player 2 must not be able to command player 1's squad.
  b.send(JSON.stringify({ t: 'cmd', c: { type: 'retreat', ids: [mine.id] } }));
  a.send(JSON.stringify({ t: 'cmd', c: { type: 'move', ids: [mine.id], x: 800, y: 1300 } }));
  a.send(JSON.stringify({ t: 'cmd', c: { type: 'build', unit: 'heavy' } }));
  a.send(JSON.stringify({ t: 'cmd', c: { type: 'build', unit: 'tank' } }));
  const err = await waitFor(a, m => m.t === 'err');
  assert.match(err.msg, /Not enough/);
  a.inbox.length = 0;
  const later = await waitFor(a, m => m.t === 's' && m.tick > snap.tick + 100, 8000);
  const sq = later.sq.find(s => s.id === mine.id);
  assert.notStrictEqual(sq.st, 'retreat', 'enemy was able to order our squad');
  const cx = sq.ms.reduce((t, m) => t + m[1], 0) / sq.ms.length;
  assert(cx > mine.ms[0][1] + 100, 'squad did not move toward its order');
  assert.strictEqual(later.pl[1].q.length, 1, 'build order not queued');
  assert(later.pl[1].req < 400 - 280 + 60, 'build cost not paid');

  // Leaving ends the match for the other player.
  b.close();
  await waitFor(a, m => m.t === 'left');
  a.close();
  server.close();
  console.log('net-test ok');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
