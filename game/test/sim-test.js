'use strict';
// Headless AI-vs-AI matches: checks the simulation never throws, stays
// within bounds, and that games reach a result.
const assert = require('assert');
const { Game } = require('../server/sim');
const { AI } = require('../server/ai');
const { MAP } = require('../server/data');

const MAX_TICKS = 20 * 60 * 30; // 30 game minutes
let results = [];
for (const seed of [1, 2, 3]) {
  const g = new Game({ seed });
  const ais = [new AI(g, 1), new AI(g, 2)];
  const t0 = Date.now();
  let peak = 0, built = new Set();
  while (!g.over && g.tick < MAX_TICKS) {
    ais.forEach(a => a.update());
    g.step();
    const snap = g.snapshot();
    JSON.stringify(snap);
    peak = Math.max(peak, snap.sq.length);
    for (const s of g.squads.values()) {
      built.add(s.type);
      for (const m of s.models) {
        assert(Number.isFinite(m.x) && Number.isFinite(m.y), 'model position is not finite');
        assert(m.x >= 0 && m.x <= MAP.w && m.y >= 0 && m.y <= MAP.h, 'model left the map');
      }
    }
  }
  const ms = Date.now() - t0;
  const r = { seed, minutes: +(g.time / 60).toFixed(1), winner: g.winner, tickets: [g.players[1].tickets, g.players[2].tickets],
    kills: [g.players[1].kills, g.players[2].kills], peakSquads: peak, types: [...built].sort().join(','), msPerTick: +(ms / g.tick).toFixed(2) };
  results.push(r);
  console.log(JSON.stringify(r));
}
assert(results.every(r => r.kills[0] + r.kills[1] > 0), 'no combat happened');

// A squad ordered next to sandbags should spread out into cover there.
{
  const g = new Game({ seed: 9 });
  const sq = [...g.squads.values()].find(s => s.owner === 1);
  const wall = MAP.walls.find(w => w.x === 1210); // vertical sandbags east of the req point
  g.command(1, { type: 'move', ids: [sq.id], x: wall.x - 30, y: wall.y + wall.h / 2 });
  for (let i = 0; i < 20 * 40 && sq.order.type !== 'idle'; i++) g.step();
  const inCover = sq.models.filter(m => g.coverAt(m, { x: 2000, y: m.y }) === 2).length;
  assert(inCover >= 4, `only ${inCover} of ${sq.models.length} models took cover`);
  console.log(`cover: ${inCover}/${sq.models.length} models behind sandbags`);
}
console.log('sim-test ok');
