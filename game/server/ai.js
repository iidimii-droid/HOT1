'use strict';
// A straightforward computer opponent. It plays through the same command
// interface as a human, so it can't cheat on costs or cooldowns.

const { UNITS, MAP } = require('./data');
const { BASE_RADIUS } = require('./sim');

const BUILD_ORDER = ['tactical', 'heavy', 'tactical', 'assault', 'lance', 'tactical', 'tank', 'heavy', 'assault', 'tactical', 'tank', 'lance'];

class AI {
  constructor(game, player) {
    this.g = game;
    this.p = player;
    this.buildIdx = 0;
    this.timer = 0;
    this.goals = new Map(); // squad id -> point id
  }

  cmd(c) { return this.g.command(this.p, c); }

  update() {
    if (++this.timer % 20 !== 0) return; // think once a second
    this.production();
    const enemies = [...this.g.squads.values()].filter(s => s.owner !== this.p);
    for (const s of this.g.squads.values()) if (s.owner === this.p) this.control(s, enemies);
  }

  production() {
    const g = this.g, pl = g.players[this.p];
    if (pl.queue.length >= 2) return;
    const enemyTanks = [...g.squads.values()].filter(s => s.owner !== this.p && s.def.armor).length;
    const myLances = [...g.squads.values()].filter(s => s.owner === this.p && s.type === 'lance').length;
    let unit = BUILD_ORDER[this.buildIdx % BUILD_ORDER.length];
    if (enemyTanks > myLances) unit = 'lance';
    const err = this.cmd({ type: 'build', unit });
    if (!err && unit === BUILD_ORDER[this.buildIdx % BUILD_ORDER.length]) this.buildIdx++;
  }

  control(s, enemies) {
    const g = this.g;
    if (s.retreating || s.jump) return;
    const c = g.centroid(s);
    const hq = MAP.hq[this.p];
    const health = s.models.reduce((a, m) => a + m.hp, 0) / (s.def.models * s.def.hp);
    const atBase = Math.hypot(c.x - hq.x, c.y - hq.y) < BASE_RADIUS;

    if (!atBase && (health < 0.3 || (g.isPinned(s) && health < 0.6))) {
      this.cmd({ type: 'retreat', ids: [s.id] });
      this.goals.delete(s.id);
      return;
    }
    if (atBase) {
      if (!s.def.armor && s.models.length + s.reinforceQ < s.def.models) {
        this.cmd({ type: 'reinforce', ids: [s.id] });
        return;
      }
      if (s.reinforceQ || health < 0.75) return; // wait to heal up
    }

    const near = (maxD, pred) => {
      let best = null, bd = maxD;
      for (const e of enemies) {
        if (!pred(e)) continue;
        const ec = g.centroid(e);
        const d = Math.hypot(ec.x - c.x, ec.y - c.y);
        if (d < bd) { bd = d; best = e; }
      }
      return best;
    };

    // Abilities.
    if (s.def.ability && s.abilityCd <= 0 && !s.pending) {
      if (s.def.ability === 'grenade') {
        const t = near(200, e => !e.def.armor);
        if (t) { const tc = g.centroid(t); this.cmd({ type: 'ability', id: s.id, x: tc.x, y: tc.y }); }
      } else if (s.def.ability === 'jump') {
        const t = near(420, e => !e.def.armor);
        if (t) {
          const tc = g.centroid(t);
          this.cmd({ type: 'ability', id: s.id, x: tc.x, y: tc.y });
          this.cmd({ type: 'attack', ids: [s.id], target: t.id });
          return;
        }
      }
    }

    // Specialists hunt what they're good at.
    if (s.type === 'assault') {
      const t = near(260, e => !e.def.armor);
      if (t) { if (s.order.type !== 'attack') this.cmd({ type: 'attack', ids: [s.id], target: t.id }); return; }
    }
    if (s.type === 'lance') {
      const t = near(460, e => e.def.armor);
      if (t) { if (s.order.type !== 'attack') this.cmd({ type: 'attack', ids: [s.id], target: t.id }); return; }
    }
    if (s.order.type === 'attack') return;

    // Objectives: go for the best point we don't own yet.
    const goal = this.goals.has(s.id) ? g.points[this.goals.get(s.id)] : null;
    if (goal && goal.owner !== this.p && s.order.type === 'move') return;
    if (goal && goal.owner !== this.p && Math.hypot(goal.x - c.x, goal.y - c.y) < 60) return; // capturing
    const claimed = new Set([...this.goals.entries()].filter(([id]) => id !== s.id && g.squads.has(id)).map(([, pid]) => pid));
    let best = null, bestScore = Infinity;
    for (const pt of g.points) {
      if (pt.owner === this.p && !pt.contested) continue;
      let score = Math.hypot(pt.x - c.x, pt.y - c.y);
      if (pt.type === 'vp') score *= 0.6;
      if (pt.owner && pt.owner !== this.p) score *= 0.85;
      if (claimed.has(pt.id)) score *= 1.8;
      if (s.def.armor) score *= 1; // tanks escort but can't capture; still head to the front
      if (score < bestScore) { bestScore = score; best = pt; }
    }
    if (!best) {
      // Everything is ours: hold the victory point closest to the enemy base.
      const ehq = MAP.hq[3 - this.p];
      best = g.points.filter(p => p.type === 'vp').sort((a, b) => Math.hypot(a.x - ehq.x, a.y - ehq.y) - Math.hypot(b.x - ehq.x, b.y - ehq.y))[0];
    }
    if (goal === best && s.order.type !== 'idle') return;
    this.goals.set(s.id, best.id);
    const j = () => (g.rand() - 0.5) * 60;
    this.cmd({ type: 'move', ids: [s.id], x: best.x + j(), y: best.y + j(), amove: true });
  }
}

module.exports = { AI };
