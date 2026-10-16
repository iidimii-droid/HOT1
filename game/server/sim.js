'use strict';
// Authoritative game simulation. Pure logic: no networking here.

const { TICK_RATE, WEAPONS, UNITS, ECON, MAP } = require('./data');
const { dist, segRect, circleRectPush, Grid } = require('./geo');

const DT = 1 / TICK_RATE;
const INF_RADIUS = 10;
const CAPTURE_RADIUS = 75;
const BASE_RADIUS = 300;
const VET_XP = [250, 700, 1400];
const SUPPRESSED = 40, PINNED = 80;
const ABILITIES = {
  grenade: { range: 230, cd: 25, pow: 15 },
  jump: { range: 460, cd: 35, pow: 25 },
};
const SHOT_KIND = { rifle: 0, pistol: 1, repeater: 2, lance: 3, cannon: 4, coax: 5, bastion: 6, blade: 7 };

const infGrid = new Grid(MAP, INF_RADIUS + 2);
const tankGrid = new Grid(MAP, 22);
const solids = [...MAP.buildings, ...MAP.walls];

class Game {
  constructor(opts = {}) {
    this.rand = mulberry32(opts.seed ?? (Date.now() & 0xffffffff));
    this.tick = 0;
    this.time = 0;
    this.nextId = 1;
    this.squads = new Map();
    this.projectiles = [];
    this.points = MAP.points.map(p => ({ id: p.id, type: p.type, x: p.x, y: p.y, owner: 0, v: 0 }));
    this.players = [null, this.newPlayer(), this.newPlayer()];
    this.bastionCd = [0, 0, 0];
    this.over = false;
    this.winner = 0;
    this.resetEvents();
    for (const p of [1, 2]) {
      const sq = this.spawnSquad(p, 'tactical');
      this.orderMove(sq, MAP.hq[p].x + this.forward(p) * 300, MAP.hq[p].y, false);
    }
  }

  newPlayer() {
    return { req: ECON.startReq, pow: ECON.startPow, tickets: ECON.tickets, queue: [], kills: 0, losses: 0, rally: null };
  }
  forward(p) { return p === 1 ? 1 : -1; }
  resetEvents() { this.shots = []; this.booms = []; this.msgs = []; }

  // ---- Commands from players ------------------------------------------
  command(player, c) {
    if (this.over || !c || typeof c !== 'object') return null;
    const own = ids => (Array.isArray(ids) ? ids : [])
      .map(id => this.squads.get(id)).filter(s => s && s.owner === player);
    const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
    switch (c.type) {
      case 'move': {
        const x = num(c.x), y = num(c.y);
        if (x === null || y === null) return null;
        const list = own(c.ids);
        list.forEach((s, i) => {
          // Spread several squads side by side around the click.
          const off = (i - (list.length - 1) / 2) * 70;
          this.orderMove(s, x, y + off, !!c.amove);
          s.pending = null;
        });
        return null;
      }
      case 'attack': {
        const t = this.squads.get(c.target);
        if (!t || t.owner === player) return null;
        for (const s of own(c.ids)) {
          if (s.retreating) continue;
          s.order = { type: 'attack', target: t.id, repath: 0 };
          s.pending = null;
        }
        return null;
      }
      case 'stop':
        for (const s of own(c.ids)) { if (!s.retreating) this.halt(s); s.pending = null; }
        return null;
      case 'retreat':
        for (const s of own(c.ids)) this.orderRetreat(s);
        return null;
      case 'reinforce': {
        let err = null;
        for (const s of own(c.ids)) err = this.reinforce(s) || err;
        return err;
      }
      case 'build': return this.build(player, c.unit);
      case 'rally': {
        // New units from the HQ walk to this point. null clears it.
        if (c.x === null) { this.players[player].rally = null; return null; }
        const x = num(c.x), y = num(c.y);
        if (x === null || y === null) return null;
        this.players[player].rally = { x: clamp(x, 20, MAP.w - 20), y: clamp(y, 20, MAP.h - 20) };
        return null;
      }
      case 'cancel': {
        const pl = this.players[player];
        const i = num(c.index);
        if (i === null || !pl.queue[i]) return null;
        const def = UNITS[pl.queue[i].unit];
        pl.req += def.cost.req; pl.pow += def.cost.pow;
        pl.queue.splice(i, 1);
        return null;
      }
      case 'ability': {
        const s = own([c.id])[0];
        const x = num(c.x), y = num(c.y);
        if (!s || x === null || y === null || s.retreating) return null;
        const ab = s.def.ability;
        if (!ab) return null;
        if (s.abilityCd > 0) return 'Ability is recharging';
        if (this.players[player].pow < ABILITIES[ab].pow) return 'Not enough power';
        s.pending = { ab, x: clamp(x, 20, MAP.w - 20), y: clamp(y, 20, MAP.h - 20) };
        return null;
      }
    }
    return null;
  }

  build(player, unit) {
    const def = UNITS[unit];
    const pl = this.players[player];
    if (!def) return null;
    if (pl.queue.length >= 5) return 'Production queue is full';
    if (this.popUsed(player) + def.pop > ECON.popCap) return 'Population cap reached';
    if (pl.req < def.cost.req) return 'Not enough requisition';
    if (pl.pow < def.cost.pow) return 'Not enough power';
    pl.req -= def.cost.req; pl.pow -= def.cost.pow;
    pl.queue.push({ unit, t: def.build });
    return null;
  }

  popUsed(player) {
    let pop = 0;
    for (const s of this.squads.values()) if (s.owner === player) pop += s.def.pop;
    for (const q of this.players[player].queue) pop += UNITS[q.unit].pop;
    return pop;
  }

  reinforce(s) {
    const pl = this.players[s.owner];
    if (s.def.armor) return 'Vehicles cannot be reinforced';
    if (s.models.length + s.reinforceQ >= s.def.models) return 'Squad is at full strength';
    const c = this.centroid(s), hq = MAP.hq[s.owner];
    if (dist(c.x, c.y, hq.x, hq.y) > BASE_RADIUS) return 'Reinforce near your HQ';
    if (pl.req < s.def.reinforce) return 'Not enough requisition';
    pl.req -= s.def.reinforce;
    if (!s.reinforceQ) s.reinforceT = 2.5;
    s.reinforceQ++;
    return null;
  }

  // ---- Squad helpers ----------------------------------------------------
  spawnSquad(owner, type) {
    const def = UNITS[type];
    const hq = MAP.hq[owner];
    const s = {
      id: this.nextId++, owner, type, def, models: [],
      order: { type: 'idle' }, amove: false, target: null, autoT: 0,
      supp: 0, suppHit: 0, xp: 0, vet: 0, abilityCd: 0,
      reinforceQ: 0, reinforceT: 0, retreating: false, pending: null, jump: null,
    };
    for (let i = 0; i < def.models; i++) {
      const a = (i / def.models) * Math.PI * 2;
      s.models.push(this.newModel(s, i, hq.x + this.forward(owner) * 110 + Math.cos(a) * 18, hq.y + Math.sin(a) * 18));
    }
    this.squads.set(s.id, s);
    return s;
  }

  newModel(s, slot, x, y) {
    return {
      id: this.nextId++, slot, x, y, hp: s.def.hp, face: s.owner === 1 ? 0 : Math.PI,
      cd: this.rand() * 0.5, cd2: 0, path: [], still: 0, moved: false, cover: 0, jz: 0,
    };
  }

  centroid(s) {
    let x = 0, y = 0;
    for (const m of s.models) { x += m.x; y += m.y; }
    return { x: x / s.models.length, y: y / s.models.length };
  }

  radius(s) { return s.def.radius || INF_RADIUS; }

  orderMove(s, x, y, amove) {
    if (s.retreating) return;
    x = clamp(x, 20, MAP.w - 20); y = clamp(y, 20, MAP.h - 20);
    s.order = { type: 'move', x, y };
    s.amove = amove;
    this.pathModels(s, x, y, true);
  }

  pathModels(s, x, y, useCover = false) {
    const grid = s.def.armor ? tankGrid : infGrid;
    const n = s.models.length;
    const c = this.centroid(s);
    const ang = Math.atan2(y - c.y, x - c.x);
    // Infantry ordered next to cover spread out along it, one soldier per spot.
    const spots = useCover && !s.def.armor ? this.coverSpots(x, y) : [];
    const assigned = new Map();
    if (spots.length >= Math.min(n, 2)) {
      const free = [...s.models];
      for (const spot of spots.slice(0, n)) {
        let bi = 0, bd = Infinity;
        free.forEach((m, i) => { const d = dist(m.x, m.y, spot.x, spot.y); if (d < bd) { bd = d; bi = i; } });
        assigned.set(free[bi], spot);
        free.splice(bi, 1);
      }
    }
    // Everyone else forms a line perpendicular to the direction of travel.
    s.models.forEach((m, i) => {
      const spot = assigned.get(m);
      if (spot) { m.path = grid.findPath(m.x, m.y, spot.x, spot.y); return; }
      const k = i - (n - 1) / 2;
      let tx = x + Math.cos(ang + Math.PI / 2) * k * 25 - Math.cos(ang) * Math.abs(k) * 7;
      let ty = y + Math.sin(ang + Math.PI / 2) * k * 25 - Math.sin(ang) * Math.abs(k) * 7;
      if (grid.isBlockedAt(tx, ty)) { tx = x; ty = y; }
      m.path = grid.findPath(m.x, m.y, tx, ty);
    });
  }

  // Standing spots in cover near (x, y), closest first. Spots sit on the side
  // of walls, sandbags and ruins facing the click, or inside craters.
  coverSpots(x, y) {
    const R = 95, off = INF_RADIUS + 5, gap = 23, spots = [];
    for (const o of solids) {
      const cx = clamp(x, o.x, o.x + o.w), cy = clamp(y, o.y, o.y + o.h);
      if (dist(x, y, cx, cy) > R) continue;
      const ex = x < o.x ? o.x - x : x > o.x + o.w ? x - o.x - o.w : 0;
      const ey = y < o.y ? o.y - y : y > o.y + o.h ? y - o.y - o.h : 0;
      if (!ex && !ey) continue;
      if (ey >= ex) {
        const sy = y < o.y ? o.y - off : o.y + o.h + off;
        for (let sx = o.x + 10; sx <= o.x + o.w - 10; sx += gap) spots.push({ x: sx, y: sy });
        if (o.w < 30) spots.push({ x: o.x + o.w / 2, y: sy });
      } else {
        const sx = x < o.x ? o.x - off : o.x + o.w + off;
        for (let sy = o.y + 10; sy <= o.y + o.h - 10; sy += gap) spots.push({ x: sx, y: sy });
        if (o.h < 30) spots.push({ x: sx, y: o.y + o.h / 2 });
      }
    }
    for (const cr of MAP.craters) {
      if (dist(x, y, cr.x, cr.y) > R + cr.r) continue;
      const k = Math.max(3, Math.floor((Math.PI * 2 * cr.r * 0.5) / gap));
      for (let i = 0; i < k; i++) {
        const a = (i / k) * Math.PI * 2;
        spots.push({ x: cr.x + Math.cos(a) * cr.r * 0.5, y: cr.y + Math.sin(a) * cr.r * 0.5 });
      }
    }
    return spots
      .filter(p => infGrid.pointFree(p.x, p.y, INF_RADIUS) && dist(x, y, p.x, p.y) < R + 30)
      .sort((a, b) => dist(x, y, a.x, a.y) - dist(x, y, b.x, b.y));
  }

  halt(s) {
    s.order = { type: 'idle' };
    s.amove = false;
    for (const m of s.models) m.path = [];
  }

  orderRetreat(s) {
    const hq = MAP.hq[s.owner];
    s.retreating = true;
    s.pending = null;
    s.order = { type: 'retreat' };
    this.pathModels(s, hq.x + this.forward(s.owner) * 60, hq.y);
  }

  isPinned(s) { return s.supp >= PINNED; }
  isSuppressed(s) { return s.supp >= SUPPRESSED; }

  // ---- Main tick ----------------------------------------------------------
  step() {
    if (this.over) return;
    this.resetEvents();
    this.tick++;
    this.time += DT;
    this.economy();
    for (const s of this.squads.values()) this.updateSquad(s);
    this.separate();
    for (const s of this.squads.values()) for (const m of s.models) m.cover = this.coverAt(m, null);
    for (const s of this.squads.values()) this.combat(s);
    this.bastions();
    this.updateProjectiles();
    this.cleanup();
    this.capture();
    this.victory();
  }

  economy() {
    for (const p of [1, 2]) {
      const pl = this.players[p];
      let req = ECON.baseReq, pow = ECON.basePow;
      for (const pt of this.points) {
        if (pt.owner !== p) continue;
        if (pt.type === 'req') req += ECON.reqPoint;
        else if (pt.type === 'pow') pow += ECON.powPoint;
        else { req += ECON.reqPoint * 0.5; pow += ECON.powPoint * 0.5; }
      }
      pl.req += req * DT; pl.pow += pow * DT;
      pl.income = { req, pow };
      const q = pl.queue[0];
      if (q) {
        q.t -= DT;
        if (q.t <= 0) {
          pl.queue.shift();
          const s = this.spawnSquad(p, q.unit);
          const hq = MAP.hq[p], rally = pl.rally;
          if (rally) this.orderMove(s, rally.x + (this.rand() - 0.5) * 60, rally.y + (this.rand() - 0.5) * 60, false);
          else this.orderMove(s, hq.x + this.forward(p) * 260, hq.y + (this.rand() - 0.5) * 200, false);
          this.msgs.push({ p, text: `${s.def.name} ready`, kind: 'ready' });
        }
      }
    }
  }

  updateSquad(s) {
    // Suppression recovers once the squad stops taking fire.
    s.suppHit -= DT;
    if (s.suppHit <= 0) s.supp = Math.max(0, s.supp - 14 * DT);
    if (s.abilityCd > 0) s.abilityCd -= DT;

    const hq = MAP.hq[s.owner];
    const c = this.centroid(s);
    const atBase = dist(c.x, c.y, hq.x, hq.y) < BASE_RADIUS;
    if (atBase) {
      for (const m of s.models) m.hp = Math.min(s.def.hp, m.hp + (s.def.armor ? 15 : 8) * DT);
      if (s.retreating) s.supp = 0;
    }
    if (s.reinforceQ > 0) {
      s.reinforceT -= DT;
      if (s.reinforceT <= 0) {
        s.reinforceQ--; s.reinforceT = 2.5;
        const used = new Set(s.models.map(m => m.slot));
        let slot = 0; while (used.has(slot)) slot++;
        const m = this.newModel(s, slot, c.x + (this.rand() - 0.5) * 20, c.y + (this.rand() - 0.5) * 20);
        s.models.push(m);
        s.models.sort((a, b) => a.slot - b.slot);
      }
    }

    if (s.jump) { this.updateJump(s); return; }
    if (s.pending) this.updatePending(s, c);

    // Order logic.
    const o = s.order;
    if (o.type === 'attack') {
      const t = this.squads.get(o.target);
      if (!t || !t.models.length) { this.halt(s); }
      else {
        const tc = this.centroid(t);
        const range = s.def.melee ? 18 : this.squadRange(s, t) * 0.85;
        const d = dist(c.x, c.y, tc.x, tc.y);
        const visible = this.lineOfSight(c.x, c.y, tc.x, tc.y);
        o.repath -= DT;
        if (d > range || !visible) {
          if (o.repath <= 0) {
            o.repath = 0.8;
            const k = s.def.melee ? 1 : Math.max(0, (d - range * 0.8) / d);
            this.pathModels(s, c.x + (tc.x - c.x) * k, c.y + (tc.y - c.y) * k);
          }
        } else {
          for (const m of s.models) m.path = [];
        }
      }
    }

    // Attack-move: stop to fight while an enemy is in range.
    const halted = o.type === 'move' && s.amove && s.target;
    const pinned = this.isPinned(s) && !s.retreating;
    let speed = s.def.speed;
    if (s.retreating) speed *= 1.7;
    else if (this.isSuppressed(s)) speed *= 0.5;

    let moving = 0;
    for (const m of s.models) {
      m.moved = false;
      if (pinned || halted || !m.path.length) { m.still += DT; continue; }
      // Heavy weapons need to tear down before moving.
      const w = this.weaponOf(s, m);
      if (w.setup && m.still >= w.setup && m.teardown === undefined) m.teardown = 1.0;
      if (m.teardown !== undefined) {
        m.teardown -= DT;
        if (m.teardown > 0) { moving++; continue; }
        delete m.teardown;
      }
      const wp = m.path[0];
      const d = dist(m.x, m.y, wp.x, wp.y);
      const stepLen = speed * DT;
      // Give up on a waypoint we can't get closer to (blocked by other models).
      if (d < (m.best ?? Infinity) - 2) { m.best = d; m.stuck = 0; } else m.stuck = (m.stuck || 0) + DT;
      if (d <= stepLen || (m.stuck > 1.2 && d < 60) || m.stuck > 4) {
        if (d <= stepLen) { m.x = wp.x; m.y = wp.y; }
        m.path.shift(); m.best = Infinity; m.stuck = 0;
      } else {
        m.x += (wp.x - m.x) / d * stepLen;
        m.y += (wp.y - m.y) / d * stepLen;
      }
      m.face = turnToward(m.face, Math.atan2(wp.y - m.y, wp.x - m.x), (s.def.armor ? 2.5 : 10) * DT);
      m.moved = true; m.still = 0; moving++;
    }
    if (!moving && !pinned && !halted) {
      if (o.type === 'move') { s.order = { type: 'idle' }; s.amove = false; }
      if (o.type === 'retreat') { s.retreating = false; s.order = { type: 'idle' }; }
    }
  }

  updatePending(s, c) {
    const p = s.pending;
    const ab = ABILITIES[p.ab];
    const d = dist(c.x, c.y, p.x, p.y);
    if (d > ab.range) {
      if (s.order.type !== 'move' || s.order.pendingWalk !== true) {
        this.orderMove(s, p.x, p.y, false);
        s.order.pendingWalk = true;
      }
      return;
    }
    const pl = this.players[s.owner];
    if (pl.pow < ab.pow || s.abilityCd > 0) { s.pending = null; return; }
    pl.pow -= ab.pow;
    s.abilityCd = ab.cd;
    s.pending = null;
    if (s.order.pendingWalk) this.halt(s);
    if (p.ab === 'grenade') {
      const m = s.models[0];
      this.projectiles.push({ kind: 'grenade', owner: s.owner, src: s.id, x0: m.x, y0: m.y, x: p.x, y: p.y, t: 0, dur: 0.9, dmg: 45, r: 65, supp: 35 });
    } else if (p.ab === 'jump') {
      const n = s.models.length;
      s.jump = { t: 0, dur: 1.0 };
      s.models.forEach((m, i) => {
        const a = (i / n) * Math.PI * 2;
        let tx = clamp(p.x + Math.cos(a) * 22, 20, MAP.w - 20), ty = clamp(p.y + Math.sin(a) * 22, 20, MAP.h - 20);
        if (infGrid.isBlockedAt(tx, ty)) { const o = infGrid.center(infGrid.nearestOpen(infGrid.cellOf(tx, ty))); tx = o.x; ty = o.y; }
        m.jx0 = m.x; m.jy0 = m.y; m.jx1 = tx; m.jy1 = ty; m.path = [];
      });
      s.order = { type: 'idle' };
    }
  }

  updateJump(s) {
    const j = s.jump;
    j.t += DT;
    const k = Math.min(1, j.t / j.dur);
    for (const m of s.models) {
      m.x = m.jx0 + (m.jx1 - m.jx0) * k;
      m.y = m.jy0 + (m.jy1 - m.jy0) * k;
      m.jz = Math.sin(k * Math.PI);
      m.face = Math.atan2(m.jy1 - m.jy0, m.jx1 - m.jx0);
      m.moved = true; m.still = 0;
    }
    if (k >= 1) {
      s.jump = null;
      for (const m of s.models) m.jz = 0;
      const c = this.centroid(s);
      this.explode(c.x, c.y, 75, 25, 40, s.owner, s, 'jump');
    }
  }

  separate() {
    const all = [];
    for (const s of this.squads.values()) for (const m of s.models) all.push({ m, s, r: this.radius(s) });
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      if (a.s.jump) continue;
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        if (b.s.jump) continue;
        const dx = b.m.x - a.m.x, dy = b.m.y - a.m.y;
        const min = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), push = (min - d) / 2;
        // Vehicles shove infantry aside instead of being pushed.
        const wa = a.s.def.armor && !b.s.def.armor ? 0 : b.s.def.armor && !a.s.def.armor ? 2 : 1;
        a.m.x -= dx / d * push * wa; a.m.y -= dy / d * push * wa;
        b.m.x += dx / d * push * (2 - wa); b.m.y += dy / d * push * (2 - wa);
      }
    }
    for (const { m, r, s } of all) {
      if (s.jump) continue;
      for (const o of solids) {
        const p = circleRectPush(m.x, m.y, r, o);
        if (p) { m.x = p.x; m.y = p.y; }
      }
      m.x = clamp(m.x, r, MAP.w - r); m.y = clamp(m.y, r, MAP.h - r);
    }
  }

  // ---- Combat -------------------------------------------------------------
  weaponOf(s, m) {
    const list = s.def.weapons;
    return WEAPONS[list[Math.min(m.slot, list.length - 1)]];
  }
  weaponName(s, m) {
    const list = s.def.weapons;
    return list[Math.min(m.slot, list.length - 1)];
  }

  squadRange(s, t) {
    let r = 0;
    for (const m of s.models) {
      const w = this.weaponOf(s, m);
      if (t && t.def.armor && w.pen < 0.5 && s.def.weapons.some(n => WEAPONS[n].pen >= 0.5)) continue;
      r = Math.max(r, w.range);
    }
    return r || 200;
  }

  lineOfSight(x1, y1, x2, y2) {
    for (const b of MAP.buildings) if (segRect(x1, y1, x2, y2, b)) return false;
    return true;
  }

  // 2 = heavy, 1 = light, 0 = none. With a shooter position, cover is directional.
  coverAt(m, from) {
    let best = 0;
    for (const o of solids) {
      const cx = Math.max(o.x, Math.min(m.x, o.x + o.w));
      const cy = Math.max(o.y, Math.min(m.y, o.y + o.h));
      if (dist(m.x, m.y, cx, cy) > 24) continue;
      if (!from) return 2;
      // Cover counts if it sits between the model and the shooter.
      const ax = cx - m.x, ay = cy - m.y, bx = from.x - m.x, by = from.y - m.y;
      if (ax * bx + ay * by > 0) return 2;
    }
    for (const c of MAP.craters) if (dist(m.x, m.y, c.x, c.y) < c.r) best = 1;
    return best;
  }

  findTarget(s) {
    const c = this.centroid(s);
    const range = this.squadRange(s, null) + 20;
    const antiTank = this.hasAntiTank(s);
    let best = null, bestD = Infinity;
    for (const t of this.squads.values()) {
      if (t.owner === s.owner || !t.models.length) continue;
      // Prefer targets this squad can actually hurt.
      const weight = t.def.armor === antiTank ? 1 : 2.5;
      for (const m of t.models) {
        const d = dist(c.x, c.y, m.x, m.y);
        if (d * weight < bestD && d <= Math.min(range, s.def.sight) && this.lineOfSight(c.x, c.y, m.x, m.y)) { best = t; bestD = d * weight; }
      }
    }
    return best;
  }

  hasAntiTank(s) { return s.def.weapons.some(n => WEAPONS[n].pen >= 0.5); }

  combat(s) {
    if (s.retreating || s.jump || !s.models.length) { s.target = null; return; }
    // Explicit attack target first, otherwise re-acquire twice a second.
    const ord = s.order.type === 'attack' ? this.squads.get(s.order.target) : null;
    s.autoT -= DT;
    if (ord) s.target = ord;
    else if (s.autoT <= 0 || (s.target && !this.squads.has(s.target.id))) {
      s.autoT = 0.5;
      s.target = this.findTarget(s);
    }
    const t = s.target;
    if (!t || !t.models.length) { s.target = null; return; }

    let accMul = 1 + 0.12 * s.vet;
    if (this.isPinned(s)) accMul *= 0.35;
    else if (this.isSuppressed(s)) accMul *= 0.7;

    for (const m of s.models) {
      if (m.cd > 0) m.cd -= DT;
      if (m.cd2 > 0) m.cd2 -= DT;
      let wname = this.weaponName(s, m);
      let w = WEAPONS[wname];
      let victim = this.nearestModel(t, m);
      if (!victim) continue;
      let d = dist(m.x, m.y, victim.x, victim.y);
      if (s.def.melee && d <= WEAPONS[s.def.melee].range + this.radius(t)) { wname = s.def.melee; w = WEAPONS[wname]; }
      // Coaxial gun on vehicles fires independently at infantry.
      if (s.def.coax && !t.def.armor && m.cd2 <= 0) {
        const cw = WEAPONS[s.def.coax];
        if (d <= cw.range && this.lineOfSight(m.x, m.y, victim.x, victim.y)) {
          m.cd2 = cw.cd;
          this.fire(s, m, cw, 'coax', t, victim, accMul);
        }
      }
      if (m.cd > 0) continue;
      if (w.setup && m.still < w.setup) continue;
      let tt = t;
      // Riflemen in anti-tank teams don't waste shots on armor.
      const skipArmor = w.pen < 0.5 && this.hasAntiTank(s);
      if (d > w.range || !this.lineOfSight(m.x, m.y, victim.x, victim.y) || (t.def.armor && skipArmor)) {
        // The squad's target is out of this soldier's reach: shoot the nearest enemy he can hit.
        const alt = this.modelTarget(s, m, w, skipArmor);
        if (!alt) continue;
        tt = alt.t; victim = alt.v;
      }
      m.cd = w.cd * (0.9 + this.rand() * 0.2);
      if (!m.moved || s.def.armor) m.face = turnToward(m.face, Math.atan2(victim.y - m.y, victim.x - m.x), Math.PI);
      this.fire(s, m, w, wname, tt, victim, accMul * (m.moved && !w.melee ? 0.7 : 1));
    }
  }

  modelTarget(s, m, w, skipArmor) {
    let best = null, bd = w.range;
    for (const t of this.squads.values()) {
      if (t.owner === s.owner || (skipArmor && t.def.armor)) continue;
      for (const v of t.models) {
        const d = dist(m.x, m.y, v.x, v.y);
        if (d <= bd && this.lineOfSight(m.x, m.y, v.x, v.y)) { bd = d; best = { t, v }; }
      }
    }
    return best;
  }

  nearestModel(t, m) {
    let best = null, bd = Infinity;
    for (const v of t.models) {
      const d = dist(m.x, m.y, v.x, v.y);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  fire(s, m, w, wname, t, victim, accMul) {
    const armored = !!t.def.armor;
    let acc = (armored ? w.acc : (w.infAcc ?? w.acc)) * accMul;
    const cover = armored || w.melee ? 0 : this.coverAt(victim, m);
    if (!w.aoe) acc *= cover === 2 ? 0.5 : cover === 1 ? 0.75 : 1;
    const hit = this.rand() < Math.min(0.97, acc);
    let tx = victim.x, ty = victim.y;
    if (!hit) {
      const a = this.rand() * Math.PI * 2, r = (w.aoe ? 30 : 10) + this.rand() * (w.aoe ? 50 : 20);
      tx += Math.cos(a) * r; ty += Math.sin(a) * r;
    }
    this.shots.push([r1(m.x), r1(m.y), r1(tx), r1(ty), SHOT_KIND[wname] ?? 0, hit ? 1 : 0, s.owner]);
    if (w.aoe) {
      if (hit && armored) this.damage(t, victim, w.dmg * w.pen, s, 0);
      this.explode(tx, ty, w.aoe, w.dmg * 0.8, w.supp, s.owner, s, 'shell');
      return;
    }
    if (!hit) {
      // Near misses still keep heads down.
      if (w.supp) this.suppress(t, w.supp * 0.5, cover);
      return;
    }
    let dmg = armored ? w.dmg * w.pen : (w.infDmg ?? w.dmg);
    if (cover === 2) dmg *= 0.8;
    this.damage(t, victim, dmg, s, w.supp, cover);
  }

  suppress(t, amount, cover) {
    if (t.def.armor || !amount || t.retreating) return;
    t.supp = Math.min(100, t.supp + amount * (cover === 2 ? 0.5 : cover === 1 ? 0.75 : 1));
    t.suppHit = 1.5;
  }

  damage(t, victim, dmg, src, supp, cover = 0) {
    if (t.retreating && !t.def.armor) dmg *= 0.5;
    dmg *= 1 - 0.08 * t.vet;
    victim.hp -= dmg;
    this.suppress(t, supp, cover);
    if (src) {
      src.xp += dmg;
      while (src.vet < 3 && src.xp >= VET_XP[src.vet]) {
        src.vet++;
        this.msgs.push({ p: src.owner, text: `${src.def.name} reached veterancy ${src.vet}`, kind: 'vet' });
      }
    }
  }

  explode(x, y, r, dmg, supp, owner, src, kind) {
    this.booms.push([r1(x), r1(y), r, kind === 'shell' ? 0 : kind === 'grenade' ? 1 : 2]);
    for (const t of this.squads.values()) {
      if (t.owner === owner) continue;
      let hitAny = false;
      for (const m of t.models) {
        const d = dist(x, y, m.x, m.y);
        if (d > r) continue;
        hitAny = true;
        if (t.def.armor) continue; // direct hits on armor are handled by the caller
        const cover = this.coverAt(m, { x, y });
        this.damage(t, m, dmg * (1 - 0.6 * d / r) * (cover === 2 ? 0.6 : 1), src, 0);
      }
      if (hitAny) this.suppress(t, supp, 0);
    }
  }

  bastions() {
    for (const p of [1, 2]) {
      this.bastionCd[p] -= DT;
      if (this.bastionCd[p] > 0) continue;
      const hq = MAP.hq[p], w = WEAPONS.bastion;
      let best = null, bm = null, bd = w.range;
      for (const t of this.squads.values()) {
        if (t.owner === p) continue;
        for (const m of t.models) {
          const d = dist(hq.x, hq.y, m.x, m.y);
          if (d < bd) { bd = d; best = t; bm = m; }
        }
      }
      if (!best) continue;
      this.bastionCd[p] = w.cd;
      const hit = this.rand() < w.acc;
      this.shots.push([hq.x, hq.y, r1(bm.x), r1(bm.y), SHOT_KIND.bastion, hit ? 1 : 0, p]);
      if (hit) this.damage(best, bm, best.def.armor ? w.dmg * w.pen * 3 : w.dmg, null, w.supp);
    }
  }

  updateProjectiles() {
    this.projectiles = this.projectiles.filter(pr => {
      pr.t += DT;
      if (pr.t < pr.dur) return true;
      const src = this.squads.get(pr.src) || null;
      this.explode(pr.x, pr.y, pr.r, pr.dmg, pr.supp, pr.owner, src, pr.kind);
      return false;
    });
  }

  cleanup() {
    for (const s of [...this.squads.values()]) {
      const before = s.models.length;
      s.models = s.models.filter(m => m.hp > 0);
      if (s.models.length < before) {
        this.players[s.owner].losses += before - s.models.length;
        this.players[3 - s.owner].kills += before - s.models.length;
      }
      if (!s.models.length) {
        this.squads.delete(s.id);
        this.msgs.push({ p: s.owner, text: `${s.def.name} wiped out!`, kind: 'lost' });
      }
    }
  }

  capture() {
    for (const pt of this.points) {
      const n = [0, 0, 0];
      for (const s of this.squads.values()) {
        if (s.def.armor || s.retreating || s.jump) continue;
        if (s.models.some(m => dist(m.x, m.y, pt.x, pt.y) < CAPTURE_RADIUS)) n[s.owner]++;
      }
      const rate = 0.11;
      if (n[1] && n[2]) { pt.contested = true; continue; }
      pt.contested = false;
      if (n[1] || n[2]) {
        const dir = n[1] ? 1 : -1;
        pt.v = clamp(pt.v + dir * rate * (1 + 0.3 * (Math.max(n[1], n[2]) - 1)) * DT, -1, 1);
      } else if (pt.owner) {
        pt.v = clamp(pt.v + (pt.owner === 1 ? 1 : -1) * rate * DT, -1, 1);
      } else {
        pt.v = Math.abs(pt.v) < rate * DT ? 0 : pt.v - Math.sign(pt.v) * rate * 0.5 * DT;
      }
      const prev = pt.owner;
      if (pt.v >= 1) pt.owner = 1;
      else if (pt.v <= -1) pt.owner = 2;
      else if (pt.owner === 1 && pt.v <= 0) pt.owner = 0;
      else if (pt.owner === 2 && pt.v >= 0) pt.owner = 0;
      if (pt.owner !== prev) {
        const label = pt.type === 'vp' ? 'Victory point' : pt.type === 'req' ? 'Requisition point' : 'Power point';
        if (pt.owner) this.msgs.push({ p: pt.owner, text: `${label} captured`, kind: 'cap' });
        if (prev) this.msgs.push({ p: prev, text: `${label} lost`, kind: 'lostpt' });
      }
    }
  }

  victory() {
    if (this.tick % TICK_RATE !== 0) return;
    const vp = [0, 0, 0];
    for (const pt of this.points) if (pt.type === 'vp' && pt.owner) vp[pt.owner]++;
    const diff = vp[1] - vp[2];
    if (diff > 0) this.players[2].tickets -= diff;
    if (diff < 0) this.players[1].tickets += diff;
    for (const p of [1, 2]) {
      if (this.players[p].tickets <= 0) {
        this.players[p].tickets = 0;
        this.over = true; this.winner = 3 - p;
      }
    }
  }

  // ---- Serialisation -------------------------------------------------------
  snapshot() {
    const pl = p => {
      const x = this.players[p];
      return {
        req: Math.floor(x.req), pow: Math.floor(x.pow), tk: Math.ceil(x.tickets), pop: this.popUsed(p),
        inc: x.income ? [r1(x.income.req * 60), r1(x.income.pow * 60)] : [0, 0],
        q: x.queue.map(q => [q.unit, Math.max(0, Math.ceil(q.t))]), k: x.kills, l: x.losses,
        ry: x.rally ? [r1(x.rally.x), r1(x.rally.y)] : null,
      };
    };
    const sq = [];
    for (const s of this.squads.values()) {
      sq.push({
        id: s.id, o: s.owner, t: s.type, sp: Math.round(s.supp), v: s.vet, xp: Math.round(s.xp),
        cd: Math.max(0, Math.ceil(s.abilityCd)), rq: s.reinforceQ,
        st: s.retreating ? 'retreat' : s.jump ? 'jump' : s.order.type,
        tg: s.target ? s.target.id : 0,
        ms: s.models.map(m => [m.id, r1(m.x), r1(m.y), Math.ceil(m.hp), Math.round(m.face * 100) / 100, m.cover, Math.round(m.jz * 100) / 100, m.slot]),
      });
    }
    return {
      t: 's', tick: this.tick, time: Math.floor(this.time),
      pl: [null, pl(1), pl(2)], sq,
      pts: this.points.map(p => [p.owner, Math.round(p.v * 100) / 100, p.contested ? 1 : 0]),
      sh: this.shots, bo: this.booms,
      pr: this.projectiles.map(p => { const k = p.t / p.dur; return [r1(p.x0 + (p.x - p.x0) * k), r1(p.y0 + (p.y - p.y0) * k), Math.round(Math.sin(k * Math.PI) * 100) / 100]; }),
      msg: this.msgs, over: this.over, win: this.winner,
    };
  }
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function r1(v) { return Math.round(v); }
function turnToward(a, target, maxStep) {
  let d = target - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + clamp(d, -maxStep, maxStep);
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { Game, ABILITIES, SUPPRESSED, PINNED, BASE_RADIUS, CAPTURE_RADIUS };
