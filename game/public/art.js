'use strict';
// Procedural art: armor schemes, unit sprites, HQ fortresses and the battlefield.
// Sprites are drawn once at high resolution into offscreen canvases and reused.

const ART = (() => {
  const SCHEMES = {
    azure:   { name: 'Azure Guard',     armor: '#2d4c9c', hi: '#6a93e6', lo: '#152457', trim: '#d8ad4a', trimLo: '#7d5c1c', helm: '#2d4c9c', lens: '#ff4a3a', accent: '#b8282c', ui: '#4f86e8' },
    crimson: { name: 'Crimson Host',    armor: '#b3241c', hi: '#ef5a45', lo: '#5a0e0a', trim: '#e0b650', trimLo: '#80601e', helm: '#d9a93c', lens: '#4de0ff', accent: '#1b1b1b', ui: '#d8483e' },
    emerald: { name: 'Emerald Wardens', armor: '#1e5934', hi: '#4f9c66', lo: '#0b2715', trim: '#c9a34c', trimLo: '#6e5520', helm: '#1e5934', lens: '#ff2a1e', accent: '#d8cfb2', ui: '#45b26e', cloth: '#d6ccae', clothLo: '#8f866b', hood: true },
    storm:   { name: 'Storm Grey',      armor: '#5f7182', hi: '#a4b6c8', lo: '#28323c', trim: '#cfd4d8', trimLo: '#727a80', helm: '#5f7182', lens: '#ffb02e', accent: '#b8282c', ui: '#9fb6cc', fur: '#6d6458', furLo: '#3a342c' },
  };
  const SPRITE_SCALE = 3;
  const cache = new Map();

  // Painted art (public/img/assets.js, generated with Higgsfield). Anything
  // missing falls back to the procedural drawings below.
  const IMG = {};
  const ready = Promise.all(Object.entries(window.IRONFALL_IMAGES || {}).map(([name, src]) => new Promise(done => {
    const im = new Image();
    im.onload = () => { IMG[name] = im; done(); };
    im.onerror = done;
    im.src = src;
  })));
  // World-space size of each painted sprite's square frame.
  const IMG_BOX = { rifle: 50, heavy: 52, lance: 52, hammer: 52, tank: 78, hq: 210 };
  function painted(name, kind) {
    const im = IMG[name];
    return im ? { canvas: im, box: IMG_BOX[kind] } : null;
  }

  function radial(c, x, y, r, hi, mid, lo) {
    const g = c.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, hi); g.addColorStop(0.55, mid); g.addColorStop(1, lo);
    return g;
  }
  function ell(c, x, y, rx, ry) { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); }
  function rr(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  // ---- Infantry ------------------------------------------------------------
  // kind: rifle | repeater | lance | hammer. Facing +x. World box 48x48.
  function marine(schemeKey, kind) {
    const key = `m|${schemeKey}|${kind}`;
    if (cache.has(key)) return cache.get(key);
    const img = painted(`${kind}_${schemeKey}`, kind);
    if (img) { cache.set(key, img); return img; }
    const S = SCHEMES[schemeKey], box = 48;
    const cv = document.createElement('canvas');
    cv.width = cv.height = box * SPRITE_SCALE;
    const c = cv.getContext('2d');
    c.scale(SPRITE_SCALE, SPRITE_SCALE); c.translate(box / 2, box / 2);
    c.lineJoin = 'round';
    const metal = '#2a2c31', metalHi = '#5b5f68';

    // Cloak or robe trailing behind.
    if (S.cloth) {
      c.fillStyle = S.clothLo;
      c.beginPath(); c.moveTo(-2, -11); c.quadraticCurveTo(-16, -12, -17, 0); c.quadraticCurveTo(-16, 12, -2, 11); c.closePath(); c.fill();
      c.fillStyle = S.cloth;
      c.beginPath(); c.moveTo(-2, -10); c.quadraticCurveTo(-14, -10.5, -15, 0); c.quadraticCurveTo(-14, 10.5, -2, 10); c.closePath(); c.fill();
      c.strokeStyle = S.clothLo; c.lineWidth = 0.6;
      for (const y of [-6, -2, 2, 6]) { c.beginPath(); c.moveTo(-4, y * 0.8); c.lineTo(-14, y); c.stroke(); }
    }
    if (S.fur) {
      c.fillStyle = S.furLo;
      c.beginPath(); c.moveTo(-1, -12);
      for (let i = 0; i <= 12; i++) { const a = -Math.PI / 2 - (i / 12) * Math.PI; const r = i % 2 ? 13 : 16; c.lineTo(-3 + Math.cos(a) * r * 0.9, Math.sin(a) * r); }
      c.closePath(); c.fill();
      c.strokeStyle = S.fur; c.lineWidth = 0.8;
      for (let i = 0; i < 16; i++) { const a = Math.PI / 2 + (i / 15) * Math.PI; c.beginPath(); c.moveTo(-3 + Math.cos(a) * 6, Math.sin(a) * 8); c.lineTo(-3 + Math.cos(a) * 13, Math.sin(a) * 13); c.stroke(); }
    }

    // Power pack or jump pack.
    if (kind === 'hammer') {
      c.fillStyle = S.lo; rr(c, -15, -8, 12, 16, 3); c.fill();
      c.fillStyle = S.armor; rr(c, -13.5, -6.5, 9, 13, 2.5); c.fill();
      for (const y of [-4.6, 4.6]) {
        c.fillStyle = metal; c.beginPath(); c.arc(-15, y, 3.4, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#ff9a3a'; c.beginPath(); c.arc(-15, y, 1.6, 0, Math.PI * 2); c.fill();
      }
    } else {
      c.fillStyle = S.lo; rr(c, -12.5, -7, 10, 14, 2.5); c.fill();
      c.fillStyle = S.armor; rr(c, -11.5, -6, 8, 12, 2); c.fill();
      c.fillStyle = S.trim; c.fillRect(-8, -6, 1.2, 12);
      for (const y of [-4, 4]) {
        c.fillStyle = metal; c.beginPath(); c.arc(-12.5, y, 2.2, 0, Math.PI * 2); c.fill();
        c.fillStyle = metalHi; c.beginPath(); c.arc(-12.5, y, 1, 0, Math.PI * 2); c.fill();
      }
    }

    // Weapon.
    if (kind === 'rifle') {
      c.fillStyle = metal; rr(c, 1, 1.5, 15, 4.4, 1); c.fill();
      c.fillStyle = metalHi; c.fillRect(2, 2, 12, 1);
      c.fillStyle = '#1a1b1e'; c.fillRect(15.5, 2.7, 6, 2);
      c.fillStyle = S.trim; c.fillRect(9, 1.5, 1.2, 4.4);
      c.fillStyle = '#1a1b1e'; c.fillRect(6, 5.4, 3, 3);
    } else if (kind === 'repeater') {
      c.fillStyle = metal; rr(c, -1, 0.5, 20, 6.5, 1.5); c.fill();
      c.fillStyle = metalHi; c.fillRect(0, 1.3, 17, 1.2);
      c.fillStyle = '#18191b'; for (const y of [1.6, 4.2]) c.fillRect(18.5, y, 6, 1.8);
      c.fillStyle = '#3b3a33'; c.beginPath(); c.arc(1, 9.5, 3.4, 0, Math.PI * 2); c.fill();
      c.strokeStyle = S.trim; c.lineWidth = 0.7; c.stroke();
    } else if (kind === 'lance') {
      c.fillStyle = metal; rr(c, -3, 0.5, 27, 6, 2); c.fill();
      c.fillStyle = metalHi; c.fillRect(-2, 1.2, 24, 1);
      c.shadowColor = '#5ff0ff'; c.shadowBlur = 4;
      c.fillStyle = '#7ff4ff';
      for (const x of [4, 8, 12]) c.fillRect(x, 1.3, 1.6, 4.4);
      c.beginPath(); c.arc(24, 3.5, 1.8, 0, Math.PI * 2); c.fill();
      c.shadowBlur = 0;
    } else if (kind === 'hammer') {
      c.strokeStyle = '#6b4a2e'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, 6); c.lineTo(13, 4); c.stroke();
      c.strokeStyle = '#3a2818'; c.lineWidth = 0.6;
      for (let x = 2; x < 12; x += 2.2) { c.beginPath(); c.moveTo(x, 4.8 - x * 0.12); c.lineTo(x + 1, 7 - x * 0.12); c.stroke(); }
      c.shadowColor = '#5fc8ff'; c.shadowBlur = 6;
      c.fillStyle = '#3b4250'; rr(c, 11.5, -2.5, 7, 13, 1.5); c.fill();
      c.strokeStyle = '#8fe0ff'; c.lineWidth = 0.8;
      c.beginPath(); c.moveTo(12, -1.5); c.lineTo(15, 1.5); c.lineTo(13, 4.5); c.lineTo(17, 8.5); c.stroke();
      c.shadowBlur = 0;
      c.fillStyle = S.trim; c.fillRect(14.3, -2.5, 1.4, 13);
    }

    // Arms and gauntlets.
    const arm = (x1, y1, x2, y2) => {
      c.strokeStyle = S.lo; c.lineWidth = 5.2; c.lineCap = 'round';
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
      c.strokeStyle = S.armor; c.lineWidth = 3.8; c.stroke();
      c.fillStyle = S.lo; c.beginPath(); c.arc(x2, y2, 2.3, 0, Math.PI * 2); c.fill();
    };
    if (kind === 'hammer') { arm(-1, 8, 6, 6.5); arm(-1, -8, 7, -3); }
    else { arm(-1, 8, 4, 5.5); arm(-1, -8, 10, 2); }

    // Torso.
    c.fillStyle = radial(c, 0, 0, 9, S.hi, S.armor, S.lo); ell(c, -1, 0, 7.4, 8.2); c.fill();
    c.strokeStyle = '#0a0a0a'; c.lineWidth = 0.6; c.stroke();
    // Chest emblem: a small winged chevron.
    c.strokeStyle = S.trim; c.lineWidth = 1;
    c.beginPath(); c.moveTo(1, -4.5); c.lineTo(4.5, 0); c.lineTo(1, 4.5); c.stroke();
    c.beginPath(); c.moveTo(2.2, -3); c.lineTo(0.5, -6); c.moveTo(2.2, 3); c.lineTo(0.5, 6); c.stroke();
    if (S.cloth) {
      // Tabard down the front.
      c.fillStyle = S.cloth; c.fillRect(1.8, -2, 4.4, 4);
      c.fillStyle = S.clothLo; c.fillRect(1.8, -0.4, 4.4, 0.8);
    }

    // Pauldrons.
    for (const side of [-1, 1]) {
      const y = side * 7.2;
      c.fillStyle = 'rgba(0,0,0,0.35)'; ell(c, -1.4, y + side * 0.6, 7.4, 5.4); c.fill();
      c.fillStyle = radial(c, -1, y, 7, S.hi, S.armor, S.lo); ell(c, -1, y, 7, 5); c.fill();
      c.strokeStyle = S.trim; c.lineWidth = 0.9; c.stroke();
      c.strokeStyle = S.trimLo; c.lineWidth = 0.35; ell(c, -1, y, 5.6, 3.8); c.stroke();
      // Squad marking on the right shoulder, rivets on the left.
      if (side === 1) { c.fillStyle = S.accent; c.beginPath(); c.arc(-1.5, y + 1, 1.6, 0, Math.PI * 2); c.fill(); }
      else { c.fillStyle = S.trim; for (const a of [0, 2.1, 4.2]) { c.beginPath(); c.arc(-1 + Math.cos(a) * 4, y + Math.sin(a) * 2.6, 0.5, 0, Math.PI * 2); c.fill(); } }
      c.fillStyle = 'rgba(255,255,255,0.3)'; ell(c, -3, y - 1.6, 2.4, 1); c.fill();
    }

    // Hood, then helmet.
    if (S.hood) { c.fillStyle = radial(c, 1, 0, 6.5, '#efe7cf', S.cloth, S.clothLo); c.beginPath(); c.arc(0.8, 0, 5.8, 0, Math.PI * 2); c.fill(); }
    const helmHi = S.helm === S.armor ? S.hi : '#ffe08a';
    c.fillStyle = radial(c, 2, 0, 4.8, helmHi, S.helm, S.lo); c.beginPath(); c.arc(2, 0, 4.5, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#0a0a0a'; c.lineWidth = 0.5; c.stroke();
    c.fillStyle = '#1a1a1a'; c.fillRect(5.2, -0.8, 1.6, 1.6);
    c.shadowColor = S.lens; c.shadowBlur = 3; c.fillStyle = S.lens;
    c.fillRect(4.8, -2.6, 1.3, 1.5); c.fillRect(4.8, 1.1, 1.3, 1.5);
    c.shadowBlur = 0;

    const sprite = { canvas: cv, box };
    cache.set(key, sprite);
    return sprite;
  }

  // ---- Tank ------------------------------------------------------------------
  function tank(schemeKey) {
    const key = `t|${schemeKey}`;
    if (cache.has(key)) return cache.get(key);
    const img = painted(`tank_${schemeKey}`, 'tank');
    if (img) { cache.set(key, img); return img; }
    const S = SCHEMES[schemeKey], box = 76;
    const cv = document.createElement('canvas');
    cv.width = cv.height = box * SPRITE_SCALE;
    const c = cv.getContext('2d');
    c.scale(SPRITE_SCALE, SPRITE_SCALE); c.translate(box / 2, box / 2);
    // Tracks.
    for (const y of [-19, 12]) {
      c.fillStyle = '#18181a'; rr(c, -27, y, 52, 8, 2); c.fill();
      c.fillStyle = '#3b3b3e';
      for (let x = -26; x < 24; x += 3.6) c.fillRect(x, y + 0.6, 1.6, 6.8);
    }
    // Sponson guns.
    for (const s of [-1, 1]) {
      c.fillStyle = S.lo; rr(c, -4, s * 18 - 4, 11, 8, 2); c.fill();
      c.fillStyle = '#202125'; c.fillRect(6, s * 18 - 1.2, 9, 2.4);
    }
    // Hull.
    c.fillStyle = radial(c, 0, 0, 30, S.hi, S.armor, S.lo);
    c.beginPath(); c.moveTo(-25, -12); c.lineTo(17, -12); c.lineTo(25, -7); c.lineTo(25, 7); c.lineTo(17, 12); c.lineTo(-25, 12); c.closePath(); c.fill();
    c.strokeStyle = '#0b0b0b'; c.lineWidth = 0.8; c.stroke();
    c.strokeStyle = S.trim; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(17, -12); c.lineTo(25, -7); c.lineTo(25, 7); c.lineTo(17, 12); c.stroke();
    // Engine deck and plates.
    c.fillStyle = '#1e1f22'; c.fillRect(-24, -7, 9, 14);
    c.strokeStyle = '#4a4c52'; c.lineWidth = 0.6;
    for (let y = -6; y <= 6; y += 2) { c.beginPath(); c.moveTo(-23, y); c.lineTo(-16, y); c.stroke(); }
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 0.6;
    c.beginPath(); c.moveTo(-12, -12); c.lineTo(-12, 12); c.moveTo(10, -12); c.lineTo(10, 12); c.stroke();
    c.fillStyle = S.trim; for (const [x, y] of [[-12, -10], [-12, 10], [10, -10], [10, 10]]) { c.beginPath(); c.arc(x, y, 0.8, 0, Math.PI * 2); c.fill(); }
    // Turret with twin barrels.
    c.fillStyle = '#1b1c1f'; c.fillRect(8, -3.6, 26, 2.6); c.fillRect(8, 1, 26, 2.6);
    c.fillStyle = '#3a3c42'; c.fillRect(30, -4.1, 4, 3.6); c.fillRect(30, 0.5, 4, 3.6);
    c.fillStyle = radial(c, 0, 0, 12, S.hi, S.armor, S.lo); rr(c, -9, -9, 19, 18, 5); c.fill();
    c.strokeStyle = S.trim; c.lineWidth = 1.2; c.stroke();
    c.fillStyle = S.lo; c.beginPath(); c.arc(-3, -2, 3.2, 0, Math.PI * 2); c.fill();
    c.strokeStyle = S.trim; c.lineWidth = 0.6; c.stroke();
    c.fillStyle = S.accent; c.beginPath(); c.arc(4, 4, 1.8, 0, Math.PI * 2); c.fill();
    const sprite = { canvas: cv, box };
    cache.set(key, sprite);
    return sprite;
  }

  function drawSprite(ctx, sprite, x, y, angle, scale = 1) {
    const s = sprite.box * scale;
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    ctx.drawImage(sprite.canvas, -s / 2, -s / 2, s, s);
    ctx.restore();
  }

  // ---- HQ fortress ---------------------------------------------------------------
  function fortress(schemeKey) {
    const key = `hq|${schemeKey}`;
    if (cache.has(key)) return cache.get(key);
    const img = painted(`hq_${schemeKey}`, 'hq');
    if (img) { cache.set(key, img); return img; }
    const S = SCHEMES[schemeKey], box = 190, k = 2;
    const cv = document.createElement('canvas');
    cv.width = cv.height = box * k;
    const c = cv.getContext('2d');
    c.scale(k, k); c.translate(box / 2, box / 2);
    const oct = r => { c.beginPath(); for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); };
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.save(); c.translate(6, 8); oct(82); c.fill(); c.restore();
    c.fillStyle = '#57524a'; oct(82); c.fill();
    c.fillStyle = '#6e685d'; oct(76); c.fill();
    // Flagstones inside the walls.
    c.save(); oct(70); c.clip();
    c.fillStyle = '#3d3a35'; c.fillRect(-80, -80, 160, 160);
    for (let y = -80; y < 80; y += 14) for (let x = -80; x < 80; x += 14) {
      c.fillStyle = ((x + y) / 14) % 2 ? '#47433c' : '#36332e'; c.fillRect(x, y, 13, 13);
    }
    c.restore();
    c.strokeStyle = S.trim; c.lineWidth = 2; oct(73); c.stroke();
    // Corner towers with banners.
    for (let i = 0; i < 8; i += 2) {
      const a = Math.PI / 8 + i * Math.PI / 4, x = Math.cos(a) * 80, y = Math.sin(a) * 80;
      c.fillStyle = radial(c, x, y, 14, '#8a8378', '#6a645a', '#3a3631'); c.beginPath(); c.arc(x, y, 13, 0, Math.PI * 2); c.fill();
      c.strokeStyle = S.trim; c.lineWidth = 1.5; c.stroke();
      c.fillStyle = S.armor; c.beginPath(); c.arc(x, y, 6, 0, Math.PI * 2); c.fill();
      c.fillStyle = S.trim; c.beginPath(); c.arc(x, y, 2, 0, Math.PI * 2); c.fill();
    }
    // Central keep.
    c.fillStyle = radial(c, 0, 0, 42, S.hi, S.armor, S.lo); oct(40); c.fill();
    c.strokeStyle = S.trim; c.lineWidth = 3; c.stroke();
    c.strokeStyle = S.trimLo; c.lineWidth = 1; oct(33); c.stroke();
    // Winged skull emblem.
    c.fillStyle = S.trim;
    for (const s of [-1, 1]) {
      c.beginPath(); c.moveTo(s * 6, -2);
      for (let i = 0; i < 5; i++) c.lineTo(s * (12 + i * 4), -10 + i * 4), c.lineTo(s * (10 + i * 4), -6 + i * 4);
      c.lineTo(s * 6, 6); c.closePath(); c.fill();
    }
    c.fillStyle = '#eee3c6'; c.beginPath(); c.arc(0, -1, 7, 0, Math.PI * 2); c.fill();
    c.fillRect(-4, 4, 8, 4);
    c.fillStyle = '#1a1a1a'; c.beginPath(); c.arc(-2.6, -1.5, 1.9, 0, Math.PI * 2); c.arc(2.6, -1.5, 1.9, 0, Math.PI * 2); c.fill();
    c.fillRect(-0.6, 1.5, 1.2, 2);
    const sprite = { canvas: cv, box };
    cache.set(key, sprite);
    return sprite;
  }

  // ---- Battlefield --------------------------------------------------------------
  function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

  function marbleFloor(t, x, y, w, h, r, size = 22) {
    for (let yy = y; yy < y + h; yy += size) for (let xx = x; xx < x + w; xx += size) {
      const dark = (Math.floor((xx - x) / size) + Math.floor((yy - y) / size)) % 2;
      const v = (dark ? 70 : 118) + r() * 14;
      t.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
      t.fillRect(xx, yy, Math.min(size, x + w - xx) - 1, Math.min(size, y + h - yy) - 1);
    }
    t.strokeStyle = 'rgba(0,0,0,0.35)'; t.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      t.beginPath(); let px = x + r() * w, py = y + r() * h; t.moveTo(px, py);
      for (let j = 0; j < 4; j++) { px += (r() - 0.5) * 40; py += (r() - 0.5) * 40; t.lineTo(px, py); }
      t.stroke();
    }
    t.fillStyle = 'rgba(110,88,58,0.45)'; t.fillRect(x, y, w, h);
  }

  // Fills a region with a tiling image, with `tile` world pixels per repeat.
  function tiled(t, img, tile) {
    const p = t.createPattern(img, 'repeat');
    p.setTransform(new DOMMatrix().scale(tile / img.width));
    return p;
  }

  function battlefield(map) {
    if (IMG.ground) return paintedBattlefield(map);
    const c = document.createElement('canvas');
    c.width = map.w; c.height = map.h;
    const t = c.getContext('2d');
    const r = rng(4242);
    // Dusty ash ground.
    t.fillStyle = '#4b4334'; t.fillRect(0, 0, map.w, map.h);
    for (let i = 0; i < 1600; i++) {
      const x = r() * map.w, y = r() * map.h, rad = 20 + r() * 140;
      const g = t.createRadialGradient(x, y, 0, x, y, rad);
      const tone = ['92,78,56', '52,46,38', '110,92,64', '64,56,46'][Math.floor(r() * 4)];
      g.addColorStop(0, `rgba(${tone},0.32)`); g.addColorStop(1, `rgba(${tone},0)`);
      t.fillStyle = g; t.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // Paved roads drawn on their own layer, then cut into flagstones.
    const roads = document.createElement('canvas'); roads.width = map.w; roads.height = map.h;
    const rd = roads.getContext('2d');
    rd.strokeStyle = '#7a705f'; rd.lineCap = 'round';
    rd.lineWidth = 58;
    rd.beginPath(); rd.moveTo(0, 1000); rd.bezierCurveTo(800, 960, 1400, 1060, 1600, 1000); rd.bezierCurveTo(1800, 940, 2400, 1040, 3200, 1000); rd.stroke();
    rd.lineWidth = 40;
    for (const y of [350, 1650]) { rd.beginPath(); rd.moveTo(500, y + (y < 1000 ? 120 : -120)); rd.quadraticCurveTo(1600, y - (y < 1000 ? 80 : -80), 2700, y + (y < 1000 ? 120 : -120)); rd.stroke(); }
    rd.beginPath(); rd.moveTo(1600, 0); rd.lineTo(1600, 2000); rd.stroke();
    rd.globalCompositeOperation = 'source-atop';
    for (let y = 0; y < map.h; y += 18) for (let x = (y / 18) % 2 ? 9 : 0; x < map.w; x += 30) {
      const v = 100 + r() * 30;
      rd.fillStyle = `rgb(${v},${v - 8},${v - 22})`; rd.fillRect(x, y, 29, 17);
    }
    rd.fillStyle = 'rgba(70,58,40,0.35)'; rd.fillRect(0, 0, map.w, map.h);
    t.globalAlpha = 0.8; t.drawImage(roads, 0, 0); t.globalAlpha = 1;

    // Marble plaza around the central victory point.
    t.save(); t.beginPath(); t.arc(1600, 1000, 210, 0, Math.PI * 2); t.clip();
    marbleFloor(t, 1390, 790, 420, 420, r, 26);
    t.restore();
    t.strokeStyle = '#a8873a'; t.lineWidth = 4; t.beginPath(); t.arc(1600, 1000, 210, 0, Math.PI * 2); t.stroke();

    // Grit and stones.
    for (let i = 0; i < 12000; i++) {
      t.fillStyle = r() < 0.5 ? 'rgba(20,16,10,0.3)' : 'rgba(190,170,130,0.16)';
      t.fillRect(r() * map.w, r() * map.h, 1 + r() * 2.5, 1 + r() * 2.5);
    }
    // Craters.
    for (const cr of map.craters) {
      const g = t.createRadialGradient(cr.x, cr.y, cr.r * 0.1, cr.x, cr.y, cr.r * 1.3);
      g.addColorStop(0, '#15120d'); g.addColorStop(0.65, '#2c261c'); g.addColorStop(0.8, '#6d6048'); g.addColorStop(1, 'rgba(80,70,52,0)');
      t.fillStyle = g; t.beginPath(); t.arc(cr.x, cr.y, cr.r * 1.3, 0, Math.PI * 2); t.fill();
      for (let i = 0; i < 14; i++) {
        const a = r() * Math.PI * 2, d = cr.r * (1 + r() * 0.35);
        t.fillStyle = r() < 0.5 ? '#5e5544' : '#3a342a';
        t.fillRect(cr.x + Math.cos(a) * d, cr.y + Math.sin(a) * d, 2 + r() * 4, 2 + r() * 4);
      }
    }
    // Gothic ruins.
    for (const b of map.buildings) ruin(t, b, r);
    // Sandbag lines.
    for (const w of map.walls) {
      t.fillStyle = 'rgba(0,0,0,0.4)'; t.fillRect(w.x + 4, w.y + 5, w.w, w.h);
      const horiz = w.w > w.h, len = horiz ? w.w : w.h, n = Math.max(2, Math.round(len / 13));
      for (let i = 0; i < n; i++) {
        const sz = len / n, x = horiz ? w.x + i * sz : w.x, y = horiz ? w.y : w.y + i * sz;
        const bw = horiz ? sz - 1 : w.w - 1, bh = horiz ? w.h - 1 : sz - 1;
        const g = t.createLinearGradient(x, y, x + bw, y + bh);
        g.addColorStop(0, '#b8a678'); g.addColorStop(1, '#7a6a48');
        t.fillStyle = g; rr(t, x + 0.5, y + 0.5, bw, bh, 4); t.fill();
        t.strokeStyle = '#4a3f2a'; t.lineWidth = 1; t.stroke();
      }
    }
    // Gold shards and rubble scattered over the field.
    for (let i = 0; i < 220; i++) {
      const x = r() * map.w, y = r() * map.h;
      if (r() < 0.3) {
        t.fillStyle = '#c9a03e'; t.beginPath(); t.moveTo(x, y - 4); t.lineTo(x + 4, y + 3); t.lineTo(x - 4, y + 3); t.closePath(); t.fill();
        t.fillStyle = '#7d5f1f'; t.beginPath(); t.moveTo(x, y - 4); t.lineTo(x + 4, y + 3); t.lineTo(x, y + 3); t.closePath(); t.fill();
      } else {
        t.fillStyle = r() < 0.5 ? '#6a6355' : '#4a443a';
        t.beginPath(); t.arc(x, y, 2 + r() * 5, 0, Math.PI * 2); t.fill();
      }
    }
    // Warm dust grade.
    t.fillStyle = 'rgba(255,170,90,0.06)'; t.fillRect(0, 0, map.w, map.h);
    return c;
  }

  function paintedBattlefield(map) {
    const c = document.createElement('canvas');
    c.width = map.w; c.height = map.h;
    const t = c.getContext('2d');
    const r = rng(4242);
    t.fillStyle = tiled(t, IMG.ground, 420); t.fillRect(0, 0, map.w, map.h);
    // Break up the tiling with broad light and dark washes.
    for (let i = 0; i < 260; i++) {
      const x = r() * map.w, y = r() * map.h, rad = 80 + r() * 260;
      const g = t.createRadialGradient(x, y, 0, x, y, rad);
      const tone = r() < 0.5 ? '30,24,16' : '150,120,80';
      g.addColorStop(0, `rgba(${tone},${0.12 + r() * 0.12})`); g.addColorStop(1, `rgba(${tone},0)`);
      t.fillStyle = g; t.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // Flagstone roads: marble texture clipped to the road shapes.
    const roads = document.createElement('canvas'); roads.width = map.w; roads.height = map.h;
    const rd = roads.getContext('2d');
    rd.strokeStyle = '#000'; rd.lineCap = 'round';
    rd.lineWidth = 64;
    rd.beginPath(); rd.moveTo(0, 1000); rd.bezierCurveTo(800, 960, 1400, 1060, 1600, 1000); rd.bezierCurveTo(1800, 940, 2400, 1040, 3200, 1000); rd.stroke();
    rd.lineWidth = 44;
    for (const y of [350, 1650]) { rd.beginPath(); rd.moveTo(500, y + (y < 1000 ? 120 : -120)); rd.quadraticCurveTo(1600, y - (y < 1000 ? 80 : -80), 2700, y + (y < 1000 ? 120 : -120)); rd.stroke(); }
    rd.beginPath(); rd.moveTo(1600, 0); rd.lineTo(1600, 2000); rd.stroke();
    rd.globalCompositeOperation = 'source-in';
    rd.fillStyle = tiled(rd, IMG.marble, 200); rd.fillRect(0, 0, map.w, map.h);
    rd.fillStyle = 'rgba(90,70,40,0.45)'; rd.fillRect(0, 0, map.w, map.h);
    t.globalAlpha = 0.85; t.drawImage(roads, 0, 0); t.globalAlpha = 1;
    // Marble plaza around the central victory point.
    t.save(); t.beginPath(); t.arc(1600, 1000, 215, 0, Math.PI * 2); t.clip();
    t.fillStyle = tiled(t, IMG.marble, 130); t.fillRect(1380, 780, 440, 440);
    const pg = t.createRadialGradient(1600, 1000, 120, 1600, 1000, 215);
    pg.addColorStop(0, 'rgba(70,52,28,0.35)'); pg.addColorStop(1, 'rgba(50,38,20,0.7)');
    t.fillStyle = pg; t.fillRect(1380, 780, 440, 440);
    t.restore();
    t.strokeStyle = '#a8873a'; t.lineWidth = 5; t.beginPath(); t.arc(1600, 1000, 215, 0, Math.PI * 2); t.stroke();
    // Craters.
    for (const cr of map.craters) {
      if (IMG.crater) { const s = cr.r * 3.1; t.drawImage(IMG.crater, cr.x - s / 2, cr.y - s / 2, s, s); }
    }
    // Ruins, picked by shape and drawn with a drop shadow.
    for (const b of map.buildings) {
      const ar = b.w / b.h;
      const img = ar > 1.25 ? IMG.ruin_wide : ar < 0.8 ? IMG.ruin_tall : IMG.ruin_sq;
      if (!img) { ruin(t, b, r); continue; }
      t.fillStyle = 'rgba(0,0,0,0.5)'; t.fillRect(b.x + 10, b.y + 12, b.w, b.h);
      t.drawImage(img, b.x - 6, b.y - 6, b.w + 12, b.h + 12);
    }
    // Sandbags.
    for (const w of map.walls) {
      t.fillStyle = 'rgba(0,0,0,0.45)'; t.fillRect(w.x + 4, w.y + 5, w.w, w.h);
      const horiz = w.w > w.h, len = horiz ? w.w : w.h, n = Math.max(2, Math.round(len / 13));
      for (let i = 0; i < n; i++) {
        const sz = len / n, x = horiz ? w.x + i * sz : w.x, y = horiz ? w.y : w.y + i * sz;
        const bw = horiz ? sz - 1 : w.w - 1, bh = horiz ? w.h - 1 : sz - 1;
        const g = t.createLinearGradient(x, y, x + bw, y + bh);
        g.addColorStop(0, '#c2ad7c'); g.addColorStop(1, '#7a6a48');
        t.fillStyle = g; rr(t, x + 0.5, y + 0.5, bw, bh, 4); t.fill();
        t.strokeStyle = '#4a3f2a'; t.lineWidth = 1; t.stroke();
      }
    }
    t.fillStyle = 'rgba(255,170,90,0.05)'; t.fillRect(0, 0, map.w, map.h);
    return c;
  }

  function ruin(t, b, r) {
    t.fillStyle = 'rgba(0,0,0,0.5)'; t.fillRect(b.x + 10, b.y + 12, b.w, b.h);
    marbleFloor(t, b.x, b.y, b.w, b.h, r, 18);
    // Rubble heaps.
    for (let i = 0; i < 18; i++) {
      const x = b.x + 14 + r() * (b.w - 28), y = b.y + 14 + r() * (b.h - 28);
      t.fillStyle = r() < 0.5 ? '#6f685c' : '#4d483f';
      t.beginPath(); t.arc(x, y, 3 + r() * 7, 0, Math.PI * 2); t.fill();
    }
    // Fallen column.
    t.save(); t.translate(b.x + b.w / 2, b.y + b.h / 2); t.rotate(r() * Math.PI);
    const g = t.createLinearGradient(0, -7, 0, 7); g.addColorStop(0, '#a49c8c'); g.addColorStop(1, '#5a5448');
    t.fillStyle = g; t.fillRect(-Math.min(b.w, b.h) * 0.4, -7, Math.min(b.w, b.h) * 0.8, 14);
    t.strokeStyle = 'rgba(0,0,0,0.3)'; for (let x = -30; x < 30; x += 8) { t.beginPath(); t.moveTo(x, -7); t.lineTo(x, 7); t.stroke(); }
    t.restore();
    // Outer walls with gaps.
    const wall = 9;
    t.fillStyle = '#7b7365';
    t.fillRect(b.x, b.y, b.w, wall); t.fillRect(b.x, b.y + b.h - wall, b.w, wall);
    t.fillRect(b.x, b.y, wall, b.h); t.fillRect(b.x + b.w - wall, b.y, wall, b.h);
    t.fillStyle = '#a39a88';
    t.fillRect(b.x, b.y, b.w, 2.5); t.fillRect(b.x, b.y, 2.5, b.h);
    for (let i = 0; i < 2; i++) {
      const horiz = r() < 0.5, k = 0.25 + r() * 0.5;
      t.fillStyle = '#4d483f';
      if (horiz) t.fillRect(b.x + b.w * k, r() < 0.5 ? b.y : b.y + b.h - wall, 18, wall);
      else t.fillRect(r() < 0.5 ? b.x : b.x + b.w - wall, b.y + b.h * k, wall, 18);
    }
    // Buttress pillars.
    const pil = (x, y) => {
      t.fillStyle = 'rgba(0,0,0,0.35)'; t.fillRect(x - 6, y - 4, 14, 14);
      t.fillStyle = '#8d8574'; t.fillRect(x - 7, y - 7, 14, 14);
      t.fillStyle = '#b3a993'; t.fillRect(x - 7, y - 7, 14, 3);
      t.strokeStyle = '#a8873a'; t.lineWidth = 1.2; t.strokeRect(x - 5, y - 5, 10, 10);
    };
    for (let x = b.x; x <= b.x + b.w + 1; x += Math.max(40, b.w / Math.round(b.w / 50))) { pil(x, b.y); pil(x, b.y + b.h); }
    for (let y = b.y + 50; y < b.y + b.h - 20; y += 50) { pil(b.x, y); pil(b.x + b.w, y); }
    // Gold trim along the inner wall.
    t.strokeStyle = 'rgba(200,160,70,0.8)'; t.lineWidth = 1.5;
    t.strokeRect(b.x + wall + 2, b.y + wall + 2, b.w - wall * 2 - 4, b.h - wall * 2 - 4);
  }

  // Large preview of an armor scheme for the menu.
  function drawPreview(canvas, schemeKey, t) {
    const c = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);
    const g = c.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W * 0.6);
    g.addColorStop(0, 'rgba(217,180,90,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    const kinds = ['rifle', 'hammer', 'repeater'];
    kinds.forEach((k, i) => {
      const sp = marine(schemeKey, k);
      const x = W * (0.22 + i * 0.28), y = H / 2 + (i === 1 ? -6 : 8);
      c.fillStyle = 'rgba(0,0,0,0.4)'; c.beginPath(); c.ellipse(x + 4, y + 6, 26, 20, 0, 0, Math.PI * 2); c.fill();
      drawSprite(c, sp, x, y, -Math.PI / 2 + Math.sin(t / 900 + i) * 0.25, 2.3);
    });
  }

  return { SCHEMES, IMG, ready, marine, tank, fortress, drawSprite, battlefield, drawPreview };
})();
