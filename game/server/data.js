'use strict';
// Static game data: unit definitions and the map. Sent to clients on game start.

const TICK_RATE = 20;
const WORLD = { w: 4400, h: 2800 };

// Weapon fields: range (px), dmg, cd (seconds between shots), acc (0..1),
// pen (damage multiplier against armored targets), supp (suppression per hit),
// aoe (splash radius), setup (seconds stationary before it can fire).
const WEAPONS = {
  rifle:   { range: 260, dmg: 9,  cd: 1.0,  acc: 0.6,  pen: 0.05, supp: 0.6 },
  pistol:  { range: 100, dmg: 7,  cd: 0.8,  acc: 0.7,  pen: 0.03, supp: 0.4 },
  blade:   { range: 24,  dmg: 22, cd: 1.0,  acc: 0.9,  pen: 0.25, supp: 0, melee: true },
  repeater:{ range: 340, dmg: 6,  cd: 0.15, acc: 0.45, pen: 0.08, supp: 4, setup: 2.0 },
  lance:   { range: 380, dmg: 120,cd: 5.0,  acc: 0.75, pen: 1.0,  supp: 2, setup: 1.5, infAcc: 0.3, infDmg: 40 },
  cannon:  { range: 330, dmg: 55, cd: 3.5,  acc: 0.65, pen: 0.8,  supp: 25, aoe: 45 },
  coax:    { range: 260, dmg: 5,  cd: 0.3,  acc: 0.45, pen: 0.02, supp: 1.2 },
  bastion: { range: 380, dmg: 16, cd: 0.5,  acc: 0.6,  pen: 0.15, supp: 3 },
};

// Squad definitions. `weapons` lists the weapon carried by each model slot;
// the last entry repeats for any extra models.
const UNITS = {
  tactical: {
    name: 'Tactical Squad', short: 'TAC', models: 5, hp: 80, speed: 80, sight: 330,
    weapons: ['rifle'], cost: { req: 300, pow: 0 }, build: 18, pop: 6, reinforce: 45,
    ability: 'grenade', desc: 'Versatile line infantry. Frag grenade (G).',
  },
  assault: {
    name: 'Assault Squad', short: 'ASL', models: 4, hp: 95, speed: 115, sight: 300,
    weapons: ['pistol'], melee: 'blade', cost: { req: 320, pow: 20 }, build: 22, pop: 6, reinforce: 55,
    ability: 'jump', desc: 'Jump-pack shock troops. Deadly in melee. Jump (G).',
  },
  heavy: {
    name: 'Heavy Support Team', short: 'HVY', models: 3, hp: 80, speed: 63, sight: 360,
    weapons: ['repeater', 'rifle'], cost: { req: 280, pow: 0 }, build: 20, pop: 5, reinforce: 45,
    desc: 'Repeater suppresses infantry. Must set up to fire.',
  },
  lance: {
    name: 'Lance Team', short: 'LNC', models: 3, hp: 80, speed: 68, sight: 360,
    weapons: ['lance', 'rifle'], cost: { req: 300, pow: 45 }, build: 22, pop: 5, reinforce: 50,
    desc: 'Anti-armor. Weak against infantry.',
  },
  tank: {
    name: 'Warhound Tank', short: 'TNK', models: 1, hp: 900, speed: 95, sight: 340, armor: true,
    weapons: ['cannon'], coax: 'coax', cost: { req: 380, pow: 160 }, build: 35, pop: 12, radius: 22,
    desc: 'Main battle tank. Shrugs off small arms.',
  },
};

const ECON = {
  startReq: 400, startPow: 40,
  baseReq: 4, basePow: 0.6,           // per second
  reqPoint: 1.6, powPoint: 1.0,        // per owned point per second
  popCap: 50, tickets: 500, hqHp: 3000,
};

// ---- Map ----------------------------------------------------------------
// The left half is authored by hand and mirrored for player 2; `center` items
// sit on the middle line and are not mirrored.
function mirrorRect(r) { return { ...r, x: WORLD.w - r.x - r.w }; }
function mirrorCircle(c) { return { ...c, x: WORLD.w - c.x }; }

function buildMap() {
  const left = {
    // Ruined buildings: block movement and line of sight, heavy cover beside them.
    buildings: [
      { x: 500, y: 300, w: 190, h: 125 }, { x: 500, y: 2375, w: 190, h: 125 },
      { x: 1300, y: 830, w: 130, h: 190 }, { x: 1300, y: 1780, w: 130, h: 190 },
      { x: 1780, y: 120, w: 150, h: 130 }, { x: 1780, y: 2550, w: 150, h: 130 },
      { x: 960, y: 1130, w: 120, h: 120 }, { x: 960, y: 1550, w: 120, h: 120 },
    ],
    // Sandbags and low walls: block movement, heavy cover, do not block sight.
    walls: [
      { x: 2060, y: 440, w: 16, h: 120 }, { x: 2060, y: 1340, w: 16, h: 120 }, { x: 2060, y: 2240, w: 16, h: 120 },
      { x: 1350, y: 1330, w: 16, h: 140 }, { x: 520, y: 760, w: 170, h: 16 }, { x: 520, y: 2024, w: 170, h: 16 },
      { x: 860, y: 1360, w: 16, h: 80 }, { x: 1600, y: 620, w: 140, h: 16 }, { x: 1600, y: 2164, w: 140, h: 16 },
      { x: 1740, y: 1230, w: 16, h: 110 }, { x: 1740, y: 1460, w: 16, h: 110 },
      { x: 1340, y: 500, w: 130, h: 16 }, { x: 1340, y: 2284, w: 130, h: 16 },
    ],
    // Craters: light cover, no blocking.
    craters: [
      { x: 820, y: 560, r: 34 }, { x: 820, y: 2240, r: 34 }, { x: 760, y: 1400, r: 42 },
      { x: 1150, y: 640, r: 30 }, { x: 1150, y: 2160, r: 30 }, { x: 1560, y: 1100, r: 38 },
      { x: 1560, y: 1700, r: 38 }, { x: 1180, y: 1400, r: 30 }, { x: 1900, y: 820, r: 32 },
      { x: 1900, y: 1980, r: 32 }, { x: 1950, y: 1400, r: 28 }, { x: 600, y: 1050, r: 28 },
      { x: 600, y: 1750, r: 28 }, { x: 1700, y: 380, r: 26 }, { x: 1700, y: 2420, r: 26 },
    ],
    points: [
      { type: 'req', x: 650, y: 650 }, { type: 'pow', x: 650, y: 2150 }, { type: 'req', x: 1250, y: 1400 },
      { type: 'pow', x: 1500, y: 380 }, { type: 'req', x: 1500, y: 2420 },
    ],
  };
  const center = {
    buildings: [{ x: 2130, y: 880, w: 140, h: 110 }, { x: 2130, y: 1810, w: 140, h: 110 }],
    craters: [{ x: 2200, y: 1100, r: 30 }, { x: 2200, y: 1700, r: 30 }],
  };
  const hq = [null, { x: 220, y: WORLD.h / 2 }, { x: WORLD.w - 220, y: WORLD.h / 2 }];
  const map = {
    w: WORLD.w, h: WORLD.h, hq,
    captureRadius: 100,
    hqHalf: 70, // HQ fortress footprint: blocks movement and can be attacked
    buildings: [...left.buildings, ...left.buildings.map(mirrorRect), ...center.buildings],
    walls: [...left.walls, ...left.walls.map(mirrorRect)],
    blocks: [1, 2].map(p => ({ x: hq[p].x - 70, y: hq[p].y - 70, w: 140, h: 140 })),
    craters: [...left.craters, ...left.craters.map(mirrorCircle), ...center.craters],
    points: [],
  };
  // Mirrored point pairs, then the three victory points in the middle.
  left.points.forEach(p => { map.points.push({ ...p }); map.points.push(mirrorCircle(p)); });
  map.points.push({ type: 'vp', x: WORLD.w / 2, y: 500 }, { type: 'vp', x: WORLD.w / 2, y: WORLD.h / 2 }, { type: 'vp', x: WORLD.w / 2, y: WORLD.h - 500 });
  map.points.forEach((p, i) => { p.id = i; });
  return map;
}

const MAP = buildMap();

// Armor color schemes players can pick on the menu.
const SCHEMES = ['azure', 'crimson', 'emerald', 'storm'];

// Gives player 2 a different scheme when both picked the same one.
function resolveSchemes(a, b) {
  const s1 = SCHEMES.includes(a) ? a : 'azure';
  let s2 = SCHEMES.includes(b) ? b : 'crimson';
  if (s2 === s1) s2 = s1 === 'crimson' ? 'azure' : 'crimson';
  return [null, s1, s2];
}

module.exports = { SCHEMES, resolveSchemes, TICK_RATE, WORLD, WEAPONS, UNITS, ECON, MAP };
