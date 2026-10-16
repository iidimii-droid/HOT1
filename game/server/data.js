'use strict';
// Static game data: unit definitions and the map. Sent to clients on game start.

const TICK_RATE = 20;
const WORLD = { w: 3200, h: 2000 };

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
  bastion: { range: 320, dmg: 16, cd: 0.5,  acc: 0.6,  pen: 0.15, supp: 3 },
};

// Squad definitions. `weapons` lists the weapon carried by each model slot;
// the last entry repeats for any extra models.
const UNITS = {
  tactical: {
    name: 'Tactical Squad', short: 'TAC', models: 5, hp: 80, speed: 70, sight: 330,
    weapons: ['rifle'], cost: { req: 300, pow: 0 }, build: 18, pop: 6, reinforce: 45,
    ability: 'grenade', desc: 'Versatile line infantry. Frag grenade (G).',
  },
  assault: {
    name: 'Assault Squad', short: 'ASL', models: 4, hp: 95, speed: 105, sight: 300,
    weapons: ['pistol'], melee: 'blade', cost: { req: 320, pow: 20 }, build: 22, pop: 6, reinforce: 55,
    ability: 'jump', desc: 'Jump-pack shock troops. Deadly in melee. Jump (G).',
  },
  heavy: {
    name: 'Heavy Support Team', short: 'HVY', models: 3, hp: 80, speed: 55, sight: 360,
    weapons: ['repeater', 'rifle'], cost: { req: 280, pow: 0 }, build: 20, pop: 5, reinforce: 45,
    desc: 'Repeater suppresses infantry. Must set up to fire.',
  },
  lance: {
    name: 'Lance Team', short: 'LNC', models: 3, hp: 80, speed: 60, sight: 360,
    weapons: ['lance', 'rifle'], cost: { req: 300, pow: 45 }, build: 22, pop: 5, reinforce: 50,
    desc: 'Anti-armor. Weak against infantry.',
  },
  tank: {
    name: 'Warhound Tank', short: 'TNK', models: 1, hp: 900, speed: 85, sight: 340, armor: true,
    weapons: ['cannon'], coax: 'coax', cost: { req: 380, pow: 160 }, build: 35, pop: 12, radius: 22,
    desc: 'Main battle tank. Shrugs off small arms.',
  },
};

const ECON = {
  startReq: 400, startPow: 40,
  baseReq: 4, basePow: 0.6,           // per second
  reqPoint: 1.6, powPoint: 1.0,        // per owned point per second
  popCap: 50, tickets: 500,
};

// ---- Map ----------------------------------------------------------------
// The left half is authored by hand and mirrored for player 2.
function mirrorRect(r) { return { ...r, x: WORLD.w - r.x - r.w }; }
function mirrorCircle(c) { return { ...c, x: WORLD.w - c.x }; }

function buildMap() {
  const left = {
    // Ruined buildings: block movement and line of sight, heavy cover beside them.
    buildings: [
      { x: 380, y: 230, w: 170, h: 110 }, { x: 380, y: 1660, w: 170, h: 110 },
      { x: 960, y: 610, w: 120, h: 170 }, { x: 960, y: 1220, w: 120, h: 170 },
      { x: 1300, y: 90, w: 130, h: 120 }, { x: 1300, y: 1790, w: 130, h: 120 },
    ],
    // Sandbags and low walls: block movement, heavy cover, do not block sight.
    walls: [
      { x: 1490, y: 300, w: 16, h: 100 }, { x: 1490, y: 950, w: 16, h: 100 }, { x: 1490, y: 1600, w: 16, h: 100 },
      { x: 1210, y: 930, w: 16, h: 140 }, { x: 820, y: 330, w: 170, h: 16 }, { x: 820, y: 1654, w: 170, h: 16 },
      { x: 640, y: 940, w: 16, h: 120 }, { x: 1140, y: 470, w: 120, h: 16 }, { x: 1140, y: 1514, w: 120, h: 16 },
    ],
    // Craters: light cover, no blocking.
    craters: [
      { x: 560, y: 760, r: 34 }, { x: 560, y: 1240, r: 34 }, { x: 860, y: 1000, r: 40 },
      { x: 1080, y: 360, r: 30 }, { x: 1080, y: 1640, r: 30 }, { x: 1380, y: 700, r: 36 },
      { x: 1380, y: 1300, r: 36 }, { x: 1250, y: 1120, r: 28 }, { x: 760, y: 620, r: 28 },
      { x: 760, y: 1380, r: 28 }, { x: 1420, y: 480, r: 26 }, { x: 1420, y: 1520, r: 26 },
    ],
    points: [
      { type: 'req', x: 700, y: 470 }, { type: 'pow', x: 700, y: 1530 }, { type: 'req', x: 1120, y: 1000 },
    ],
  };
  const map = {
    w: WORLD.w, h: WORLD.h,
    hq: [null, { x: 170, y: 1000 }, { x: WORLD.w - 170, y: 1000 }],
    buildings: [...left.buildings, ...left.buildings.map(mirrorRect)],
    walls: [...left.walls, ...left.walls.map(mirrorRect)],
    craters: [...left.craters, ...left.craters.map(mirrorCircle)],
    points: [],
  };
  // Mirrored point pairs, then the three victory points in the middle.
  left.points.forEach(p => { map.points.push({ ...p }); map.points.push(mirrorCircle(p)); });
  map.points.push({ type: 'vp', x: 1600, y: 350 }, { type: 'vp', x: 1600, y: 1000 }, { type: 'vp', x: 1600, y: 1650 });
  map.points.forEach((p, i) => { p.id = i; });
  return map;
}

const MAP = buildMap();

module.exports = { TICK_RATE, WORLD, WEAPONS, UNITS, ECON, MAP };
