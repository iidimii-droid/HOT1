'use strict';
// Three.js renderer for Ironfall. The simulation and HUD are unchanged; this
// draws the same view state as client.js's 2D renderer, in 3D with a tilted
// RTS camera, sun shadows, 3D cover, procedural marines and particle effects.
// It reads the client's globals (G, canvas, ctx, COLORS, SHOT_STYLE, ...).

const R3D = (() => {
  const T = window.THREE;
  const PITCH = 52 * Math.PI / 180; // camera angle above the ground
  const FOV = 38;
  let renderer = null, scene, camera, sun, glCanvas, ground, groundTex, fogPlane, fogCanvas, fogTex;
  let terrainDirty = 0;
  const units = new Map();      // model id -> { obj, parts, last }
  const fxPool = [];            // reusable sprites
  const lines = [];             // active tracer meshes
  let tracerMesh = null;
  const pointObjs = [];         // capture point banners / rings
  const ringPool = [];
  let rally = null, hqRing = null;
  const grenadePool = [];
  const raycaster = T ? new T.Raycaster() : null;
  const groundPlane = T ? new T.Plane(new T.Vector3(0, 1, 0), 0) : null;
  const mats = {};

  function available() { return !!T; }

  // ---- Textures -----------------------------------------------------------------
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace; t.encoding = T.sRGBEncoding;
    return t;
  }
  function glowTex(inner, outer) {
    return canvasTex(64, 64, (c) => {
      const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, inner); g.addColorStop(0.35, outer); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    });
  }
  function stoneTex() {
    return canvasTex(256, 256, (c, w, h) => {
      c.fillStyle = '#857d6d'; c.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 32) for (let x = (y / 32) % 2 ? 24 : 0; x < w; x += 48) {
        const v = 110 + Math.random() * 40;
        c.fillStyle = `rgb(${v},${v - 8},${v - 22})`; c.fillRect(x + 1, y + 1, 46, 30);
      }
      for (let i = 0; i < 2500; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.25})`; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    });
  }

  function material(key, make) { return mats[key] || (mats[key] = make()); }
  function std(color, opts = {}) { return new T.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.25, ...opts }); }

  // ---- Setup ------------------------------------------------------------------------
  function init(map) {
    // Treat material hex colors as sRGB so armor keeps its real colors.
    if (T.ColorManagement && 'legacyMode' in T.ColorManagement) T.ColorManagement.legacyMode = false;
    if (T.ColorManagement && 'enabled' in T.ColorManagement) T.ColorManagement.enabled = true;
    if (!renderer) {
      glCanvas = document.createElement('canvas');
      glCanvas.id = 'view3d';
      canvas.parentNode.insertBefore(glCanvas, canvas);
      renderer = new T.WebGLRenderer({ canvas: glCanvas, antialias: true });
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFSoftShadowMap;
      if ('outputColorSpace' in renderer) renderer.outputColorSpace = T.SRGBColorSpace; else renderer.outputEncoding = T.sRGBEncoding;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
    }
    // Render at the screen's real resolution (capped for speed on very dense displays).
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    glCanvas.style.display = 'block';
    scene = new T.Scene();
    scene.background = new T.Color('#3a3226');
    scene.fog = new T.Fog('#5a4a36', 1600, 4200);
    camera = new T.PerspectiveCamera(FOV, 1, 10, 8000);

    // Soft studio reflections so metal and gold trim catch the light.
    if (T.RoomEnvironment) {
      const pm = new T.PMREMGenerator(renderer);
      scene.environment = pm.fromScene(new T.RoomEnvironment(), 0.04).texture;
      pm.dispose();
    }
    scene.add(new T.HemisphereLight('#ffe2b8', '#3b2f22', scene.environment ? 0.45 : 0.75));
    sun = new T.DirectionalLight('#ffd9a0', 1.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0008;
    scene.add(sun); scene.add(sun.target);

    // Ground: the painted 2D battlefield (ruin floors, craters, roads) as a texture.
    groundTex = new T.CanvasTexture(G.terrain);
    groundTex.colorSpace = T.SRGBColorSpace; groundTex.encoding = T.sRGBEncoding;
    groundTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    ground = new T.Mesh(new T.PlaneGeometry(map.w, map.h), new T.MeshStandardMaterial({ map: groundTex, roughness: 0.95, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(map.w / 2, 0, map.h / 2);
    ground.receiveShadow = true;
    scene.add(ground);
    // Darker ground beyond the map edge.
    const outer = new T.Mesh(new T.PlaneGeometry(map.w * 3, map.h * 3), std('#2a241b', { roughness: 1 }));
    outer.rotation.x = -Math.PI / 2; outer.position.set(map.w / 2, -0.5, map.h / 2); scene.add(outer);

    buildCover(map);
    fortressObjs = [null, null, null];
    for (const p of [1, 2]) buildFortress(map.hq[p], p);
    buildPoints(map);

    // Fog of war: a low-resolution shroud just above the ground.
    fogCanvas = document.createElement('canvas'); fogCanvas.width = Math.round(map.w / 10); fogCanvas.height = Math.round(map.h / 10);
    fogTex = new T.CanvasTexture(fogCanvas);
    fogPlane = new T.Mesh(new T.PlaneGeometry(map.w, map.h), new T.MeshBasicMaterial({ map: fogTex, transparent: true, depthWrite: false }));
    fogPlane.rotation.x = -Math.PI / 2; fogPlane.position.set(map.w / 2, 1.5, map.h / 2);
    fogPlane.renderOrder = 5;
    scene.add(fogPlane);

    // Tracers share one line buffer.
    const tg = new T.BufferGeometry();
    tg.setAttribute('position', new T.BufferAttribute(new Float32Array(600 * 6), 3));
    tg.setAttribute('color', new T.BufferAttribute(new Float32Array(600 * 6), 3));
    tracerMesh = new T.LineSegments(tg, new T.LineBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
    tracerMesh.frustumCulled = false;
    scene.add(tracerMesh);

    units.clear(); fxPool.length = 0; ringPool.length = 0; grenadePool.length = 0;
    loadModels();
    if (protos.hq) for (const p of [1, 2]) placeFortressModel(p);
  }

  function setVisible(on) { if (glCanvas) glCanvas.style.display = on ? 'block' : 'none'; }

  function buildCover(map) {
    const stone = material('stone', () => std('#a59c8a', { map: stoneTex(), roughness: 0.9, metalness: 0.05 }));
    const gold = material('gold', () => std('#c9a03e', { metalness: 0.8, roughness: 0.35 }));
    const rnd = (seed => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; })(777);
    // Ruined walls: broken segments of varying height around each building.
    for (const b of map.buildings) {
      const edges = [
        [b.x, b.y, b.x + b.w, b.y], [b.x + b.w, b.y, b.x + b.w, b.y + b.h],
        [b.x + b.w, b.y + b.h, b.x, b.y + b.h], [b.x, b.y + b.h, b.x, b.y],
      ];
      for (const [x1, y1, x2, y2] of edges) {
        const len = Math.hypot(x2 - x1, y2 - y1), n = Math.max(2, Math.round(len / 22));
        for (let i = 0; i < n; i++) {
          if (rnd() < 0.14) continue; // blown-out gap
          const k = (i + 0.5) / n, h = 22 + rnd() * 46;
          const m = new T.Mesh(new T.BoxGeometry(len / n + 1, h, 9), stone);
          m.position.set(x1 + (x2 - x1) * k, h / 2, y1 + (y2 - y1) * k);
          m.rotation.y = -Math.atan2(y2 - y1, x2 - x1);
          m.castShadow = m.receiveShadow = true;
          scene.add(m);
        }
      }
      // Buttress pillars at the corners with gold caps.
      for (const [x, y] of [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]) {
        const h = 70 + rnd() * 30;
        const p = new T.Mesh(new T.BoxGeometry(16, h, 16), stone);
        p.position.set(x, h / 2, y); p.castShadow = p.receiveShadow = true; scene.add(p);
        const cap = new T.Mesh(new T.ConeGeometry(10, 16, 4), gold);
        cap.position.set(x, h + 8, y); cap.rotation.y = Math.PI / 4; cap.castShadow = true; scene.add(cap);
      }
      // A fallen column inside.
      const col = new T.Mesh(new T.CylinderGeometry(7, 7, Math.min(b.w, b.h) * 0.7, 10), stone);
      col.rotation.z = Math.PI / 2; col.rotation.y = rnd() * Math.PI;
      col.position.set(b.x + b.w / 2, 7, b.y + b.h / 2); col.castShadow = col.receiveShadow = true; scene.add(col);
    }
    // Sandbag lines: rows of soft lumps.
    const bag = material('bag', () => std('#a8946a', { roughness: 1, metalness: 0 }));
    for (const w of map.walls) {
      const horiz = w.w > w.h, len = horiz ? w.w : w.h, n = Math.max(2, Math.round(len / 13));
      for (let row = 0; row < 2; row++) for (let i = 0; i < n - row; i++) {
        const k = (i + 0.5 + row * 0.5) / n;
        const m = new T.Mesh(new T.SphereGeometry(1, 10, 6), bag);
        m.scale.set(horiz ? len / n * 0.55 : 8.5, 5, horiz ? 8.5 : len / n * 0.55);
        const cx = horiz ? w.x + len * k : w.x + w.w / 2, cy = horiz ? w.y + w.h / 2 : w.y + len * k;
        m.position.set(cx, 4 + row * 7, cy);
        m.castShadow = m.receiveShadow = true;
        scene.add(m);
      }
    }
  }

  function buildFortress(h, p) {
    const S = ART.SCHEMES[G.schemes[p]];
    const stone = material('stone', () => std('#a59c8a'));
    const armor = std(S.armor, { metalness: 0.45, roughness: 0.4 });
    const gold = std(S.trim, { metalness: 0.85, roughness: 0.3 });
    const g = new T.Group();
    const base = new T.Mesh(new T.CylinderGeometry(88, 92, 16, 8), stone);
    base.position.y = 8; base.rotation.y = Math.PI / 8; g.add(base);
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + i * Math.PI / 4, a2 = a + Math.PI / 4;
      const x1 = Math.cos(a) * 84, z1 = Math.sin(a) * 84, x2 = Math.cos(a2) * 84, z2 = Math.sin(a2) * 84;
      const w = new T.Mesh(new T.BoxGeometry(Math.hypot(x2 - x1, z2 - z1), 30, 10), stone);
      w.position.set((x1 + x2) / 2, 30, (z1 + z2) / 2); w.rotation.y = -Math.atan2(z2 - z1, x2 - x1); g.add(w);
    }
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2;
      const t = new T.Mesh(new T.CylinderGeometry(16, 18, 64, 12), stone);
      t.position.set(Math.cos(a) * 86, 32, Math.sin(a) * 86); g.add(t);
      const roof = new T.Mesh(new T.ConeGeometry(19, 26, 12), armor);
      roof.position.set(Math.cos(a) * 86, 77, Math.sin(a) * 86); g.add(roof);
      const ring = new T.Mesh(new T.TorusGeometry(17, 1.6, 6, 16), gold);
      ring.rotation.x = Math.PI / 2; ring.position.set(Math.cos(a) * 86, 64, Math.sin(a) * 86); g.add(ring);
    }
    const keep = new T.Mesh(new T.BoxGeometry(70, 54, 70), armor);
    keep.position.y = 43; g.add(keep);
    const keepTop = new T.Mesh(new T.BoxGeometry(76, 6, 76), gold);
    keepTop.position.y = 72; g.add(keepTop);
    const spire = new T.Mesh(new T.ConeGeometry(14, 48, 4), gold);
    spire.position.y = 99; spire.rotation.y = Math.PI / 4; g.add(spire);
    // Banners on the keep.
    const banner = std(S.armor, { side: T.DoubleSide, roughness: 0.9, metalness: 0 });
    for (const s of [-1, 1]) {
      const b = new T.Mesh(new T.PlaneGeometry(18, 40), banner);
      b.position.set(s * 36, 40, 0); b.rotation.y = s * Math.PI / 2; g.add(b);
    }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.position.set(h.x, 0, h.y);
    scene.add(g);
    fortressObjs[p] = g;
  }

  function buildPoints(map) {
    pointObjs.length = 0;
    const stone = material('stone', () => std('#a59c8a'));
    for (const p of map.points) {
      const g = new T.Group();
      const plinth = new T.Mesh(new T.CylinderGeometry(26, 30, 8, 16), stone);
      plinth.position.y = 4; plinth.castShadow = plinth.receiveShadow = true; g.add(plinth);
      const pole = new T.Mesh(new T.CylinderGeometry(1.4, 1.4, 70, 6), std('#3a3530'));
      pole.position.set(18, 35, 0); pole.castShadow = true; g.add(pole);
      const flagMat = std('#bbbbbb', { side: T.DoubleSide, roughness: 0.9, metalness: 0 });
      const flag = new T.Mesh(new T.PlaneGeometry(30, 18, 6, 1), flagMat);
      flag.position.set(34, 60, 0); flag.castShadow = true; g.add(flag);
      const icon = p.type === 'vp' ? new T.Mesh(new T.OctahedronGeometry(10), std('#e0b650', { metalness: 0.8, roughness: 0.3, emissive: '#3a2a00' }))
        : new T.Mesh(new T.BoxGeometry(12, 12, 12), std(p.type === 'req' ? '#d9b45a' : '#6fd0e8', { emissive: p.type === 'req' ? '#2a1e00' : '#003040' }));
      icon.position.y = 22; icon.castShadow = true; g.add(icon);
      const border = new T.Mesh(new T.RingGeometry((map.captureRadius || 75) - 3, map.captureRadius || 75, 64), new T.MeshBasicMaterial({ color: '#dddddd', transparent: true, opacity: 0.5, depthWrite: false }));
      border.rotation.x = -Math.PI / 2; border.position.y = 2; g.add(border);
      const prog = new T.Mesh(new T.RingGeometry(32, 37, 48, 1, 0, 0.001), new T.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false, side: T.DoubleSide }));
      prog.rotation.x = -Math.PI / 2; prog.position.y = 9; g.add(prog);
      g.position.set(p.x, 0, p.y);
      scene.add(g);
      pointObjs.push({ g, flag, flagMat, icon, border, prog, lastV: 0 });
    }
  }

  // ---- Generated 3D models (Higgsfield GLBs published next to the page) -----------------
  // size: world units along `axis`; yaw turns the mesh so it faces +x (our forward).
  const MODEL_SPECS = {
    tank:     { file: 'tank',   size: 84,  axis: 'len',    yaw: Math.PI,     metal: 0.5 },
    hq:       { file: 'hq',     size: 205, axis: 'len',    yaw: 0,           metal: 0.25 },
    rifle:    { file: 'rifle',  size: 38,  axis: 'height', yaw: Math.PI / 2, metal: 0.35 },
    repeater: { file: 'heavy',  size: 38,  axis: 'height', yaw: Math.PI / 2, metal: 0.35 },
    lance:    { file: 'lance',  size: 38,  axis: 'height', yaw: Math.PI / 2, metal: 0.35 },
    hammer:   { file: 'hammer', size: 38,  axis: 'height', yaw: Math.PI / 2, metal: 0.35 },
  };
  const protos = {};
  let modelsRequested = false;

  function loadModels() {
    if (modelsRequested || !T.GLTFLoader) return;
    modelsRequested = true;
    const base = window.IRONFALL_MODEL_BASE ?? 'models/';
    for (const [kind, spec] of Object.entries(MODEL_SPECS)) {
      fetch(base + spec.file + '.glb').then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
        .then(buf => parseModel(kind, spec, buf))
        .catch(err => console.warn(`Ironfall: ${spec.file} model unavailable, using simple shapes`, err));
    }
  }

  function parseModel(kind, spec, buf) {
    // GLTFLoader decodes textures with fetch() + createImageBitmap when it can;
    // hiding createImageBitmap makes it use a plain <img>, which the page allows.
    const cib = window.createImageBitmap;
    try { window.createImageBitmap = undefined; } catch {}
    new T.GLTFLoader().parse(buf, '', gltf => {
      const obj = gltf.scene;
      obj.updateMatrixWorld(true);
      // Skinned meshes render in their bind-pose units (the skeleton's own
      // scale cancels out), so measure their raw geometry; others as placed.
      const box = new T.Box3();
      obj.traverse(o => {
        if (o.isSkinnedMesh) { o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox); }
        else if (o.isMesh) box.expandByObject(o);
      });
      const size = box.getSize(new T.Vector3()), c = box.getCenter(new T.Vector3());
      obj.position.set(-c.x, -box.min.y, -c.z);
      const yawG = new T.Group(); yawG.rotation.y = spec.yaw; yawG.add(obj);
      const root = new T.Group(); root.add(yawG);
      root.scale.setScalar(spec.size / (spec.axis === 'height' ? size.y : Math.max(size.x, size.z)));
      let skinned = false;
      root.traverse(o => {
        if (!o.isMesh) return;
        if (o.isSkinnedMesh) { skinned = true; o.frustumCulled = false; }
        o.castShadow = true; o.receiveShadow = true;
        const m = o.material;
        m.metalness = spec.metal; m.roughness = 0.45; m.envMapIntensity = 0.9;
        if (m.map) { m.map.anisotropy = renderer.capabilities.getMaxAnisotropy(); m.map.needsUpdate = true; }
      });
      protos[kind] = { root, clips: gltf.animations || [], skinned };
      // Swap stand-ins already on the field.
      for (const [id, u] of units) if (u.kind === kind && !u.gen) { scene.remove(u.obj); units.delete(id); }
      if (kind === 'hq') for (const p of [1, 2]) placeFortressModel(p);
    }, err => console.warn(`Ironfall: ${spec.file} model failed to parse`, err));
    try { window.createImageBitmap = cib; } catch {}
  }

  // Team colors: shift the blue armor in a texture to another scheme, leaving
  // gold trim, metal, cloth and glowing lenses alone.
  const RECOLOR = { crimson: { h: 358, s: 1.05, v: 0.92 }, emerald: { h: 146, s: 0.85, v: 0.78 }, storm: { h: 208, s: 0.2, v: 1.08 } };
  const recolorCache = new Map();
  function recolorTex(tex, scheme) {
    const R = RECOLOR[scheme];
    if (!R || !tex || !tex.image) return tex;
    const key = tex.uuid + scheme;
    if (recolorCache.has(key)) return recolorCache.get(key);
    const img = tex.image, w = img.width, h = img.height;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d'); c.drawImage(img, 0, 0);
    const d = c.getImageData(0, 0, w, h), px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), dl = mx - mn;
      if (dl < 0.08 || mx < 0.06) continue;
      let hue = mx === r ? ((g - b) / dl) % 6 : mx === g ? (b - r) / dl + 2 : (r - g) / dl + 4;
      hue *= 60; if (hue < 0) hue += 360;
      if (hue < 190 || hue > 265) continue;
      const sat = Math.min(1, (dl / mx) * R.s), val = Math.min(1, mx * R.v);
      const hh = R.h / 60, k = n => (n + hh) % 6;
      const f = n => val - val * sat * Math.max(0, Math.min(k(n), 4 - k(n), 1));
      px[i] = f(5) * 255; px[i + 1] = f(3) * 255; px[i + 2] = f(1) * 255;
    }
    c.putImageData(d, 0, 0);
    const out = new T.CanvasTexture(cv);
    out.flipY = tex.flipY; out.encoding = tex.encoding; if ('colorSpace' in tex) out.colorSpace = tex.colorSpace;
    out.wrapS = tex.wrapS; out.wrapT = tex.wrapT; out.anisotropy = tex.anisotropy;
    recolorCache.set(key, out);
    return out;
  }

  const matCache = new Map();
  function instance(kind, scheme) {
    const P = protos[kind];
    const obj = P.skinned && T.SkeletonUtils ? T.SkeletonUtils.clone(P.root) : P.root.clone(true);
    if (RECOLOR[scheme]) obj.traverse(o => {
      if (!o.isMesh) return;
      const key = o.material.uuid + scheme;
      if (!matCache.has(key)) { const m = o.material.clone(); m.map = recolorTex(o.material.map, scheme); matCache.set(key, m); }
      o.material = matCache.get(key);
    });
    const u = { obj: new T.Group(), parts: {}, gen: true };
    u.obj.add(obj);
    if (P.clips.length) {
      u.mixer = new T.AnimationMixer(obj);
      u.action = u.mixer.clipAction(P.clips[0]);
      u.action.play();
      u.mixer.update(Math.random() * P.clips[0].duration);
    }
    return u;
  }

  let fortressObjs = [null, null, null];
  function placeFortressModel(p) {
    if (!protos.hq || !scene) return;
    if (fortressObjs[p]) scene.remove(fortressObjs[p]);
    const u = instance('hq', G.schemes[p]);
    const h = G.map.hq[p];
    u.obj.position.set(h.x, 0, h.y);
    u.obj.rotation.y = p === 1 ? 0 : Math.PI;
    scene.add(u.obj);
    fortressObjs[p] = u.obj;
  }

  // ---- Units ---------------------------------------------------------------------------
  function schemeMats(key) {
    return material(`sch|${key}`, () => {
      const S = ART.SCHEMES[key];
      return {
        armor: std(S.armor, { metalness: 0.15, roughness: 0.45 }),
        dark: std(S.lo, { metalness: 0.15, roughness: 0.55 }),
        trim: std(S.trim, { metalness: 0.85, roughness: 0.3 }),
        helm: std(S.helm, { metalness: 0.2, roughness: 0.4 }),
        lens: new T.MeshBasicMaterial({ color: S.lens }),
        metal: std('#2c2e33', { metalness: 0.7, roughness: 0.45 }),
        cloth: S.cloth ? std(S.cloth, { roughness: 1, metalness: 0, side: T.DoubleSide }) : null,
        fur: S.fur ? std(S.fur, { roughness: 1, metalness: 0, side: T.DoubleSide }) : null,
        glow: new T.MeshBasicMaterial({ color: '#7ff4ff' }),
        hammer: new T.MeshBasicMaterial({ color: '#8fd8ff' }),
      };
    });
  }

  // A marine built from primitives, facing +x, about 26 units tall.
  function makeMarine(scheme, kind) {
    const M = schemeMats(scheme);
    const g = new T.Group(), parts = {};
    const box = (w, h, d, m, x, y, z) => { const o = new T.Mesh(new T.BoxGeometry(w, h, d), m); o.position.set(x, y, z); g.add(o); return o; };
    const ball = (r, m, x, y, z, sx = 1, sy = 1, sz = 1) => { const o = new T.Mesh(new T.SphereGeometry(r, 12, 8), m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); g.add(o); return o; };
    parts.legL = box(4, 11, 4.5, M.armor, 0, 5.5, -3.2);
    parts.legR = box(4, 11, 4.5, M.armor, 0, 5.5, 3.2);
    box(4.6, 2, 5, M.dark, 0.5, 1, -3.2); box(4.6, 2, 5, M.dark, 0.5, 1, 3.2);
    parts.body = new T.Group(); g.add(parts.body);
    const add = o => { g.remove(o); parts.body.add(o); return o; };
    add(box(7, 9, 11, M.armor, 0, 15.5, 0));
    add(box(2, 3, 11.4, M.trim, 0, 11.5, 0));
    add(box(6, 9, 9, kind === 'hammer' ? M.dark : M.armor, -6, 16.5, 0));
    if (kind === 'hammer') { for (const z of [-3, 3]) { const n = add(new T.Mesh(new T.CylinderGeometry(1.8, 2.4, 6, 8), M.metal)); n.position.set(-9.5, 12.5, z); } }
    for (const z of [-7.6, 7.6]) {
      add(ball(5.4, M.armor, -0.5, 18.5, z, 1.05, 0.85, 1));
      const rim = add(new T.Mesh(new T.TorusGeometry(5.2, 0.7, 6, 14), M.trim)); rim.position.set(-0.5, 16.2, z); rim.rotation.x = Math.PI / 2;
    }
    add(ball(3.6, M.helm, 1, 22.5, 0));
    add(box(1, 1.1, 1.2, M.lens, 4.2, 23, -1.3)); add(box(1, 1.1, 1.2, M.lens, 4.2, 23, 1.3));
    if (M.cloth) { const c = add(new T.Mesh(new T.PlaneGeometry(10, 15), M.cloth)); c.position.set(-9.2, 13, 0); c.rotation.y = Math.PI / 2; c.rotation.z = 0.15; }
    if (M.fur) { const c = add(new T.Mesh(new T.PlaneGeometry(13, 14), M.fur)); c.position.set(-8.8, 15, 0); c.rotation.y = Math.PI / 2; c.rotation.z = 0.2; }
    // Weapon in the right hand, pointing forward.
    parts.gun = new T.Group(); parts.gun.position.set(3, 14.5, 4.5); parts.body.add(parts.gun);
    const gun = (w, h, d, m, x, y = 0, z = 0) => { const o = new T.Mesh(new T.BoxGeometry(w, h, d), m); o.position.set(x, y, z); parts.gun.add(o); return o; };
    if (kind === 'rifle') { gun(14, 3, 2.4, M.metal, 5); gun(5, 1.4, 1.4, M.metal, 14); gun(2, 3.2, 2.6, M.trim, 5); }
    else if (kind === 'repeater') { gun(18, 4.5, 4, M.metal, 7); for (const y of [-1, 1]) gun(7, 1.2, 1.2, M.metal, 19, y); }
    else if (kind === 'lance') { gun(24, 4.5, 4.5, M.metal, 8); for (const x of [2, 6, 10]) gun(1.4, 5, 5, M.glow, x); gun(1.6, 3, 3, M.glow, 20.5); }
    else if (kind === 'hammer') {
      const h = new T.Mesh(new T.CylinderGeometry(0.9, 0.9, 16, 6), M.dark); h.rotation.z = Math.PI / 2; h.position.set(6, 0, 0); parts.gun.add(h);
      gun(5, 8, 8, M.metal, 14); gun(5.4, 2, 8.4, M.hammer, 14);
    }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
    return { obj: g, parts };
  }

  function makeTank(scheme) {
    const M = schemeMats(scheme);
    if (protos.tank) return instance('tank', scheme);
    const g = new T.Group();
    const b = (w, h, d, m, x, y, z) => { const o = new T.Mesh(new T.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
    b(52, 10, 9, M.metal, 0, 6, -15); b(52, 10, 9, M.metal, 0, 6, 15);
    b(46, 12, 22, M.armor, 0, 13, 0); b(10, 12.4, 22.4, M.trim, 20, 13, 0);
    const tur = new T.Group(); tur.position.set(2, 22, 0); g.add(tur);
    const t1 = new T.Mesh(new T.BoxGeometry(18, 8, 16), M.armor); t1.castShadow = true; tur.add(t1);
    for (const z of [-3, 3]) { const bar = new T.Mesh(new T.BoxGeometry(26, 2.4, 2.4), M.metal); bar.position.set(18, 0, z); bar.castShadow = true; tur.add(bar); }
    return { obj: g, parts: { turret: tur } };
  }

  function unitFor(s, m) {
    let u = units.get(m.id);
    const kind = s.def.armor ? 'tank' : spriteKind(s, m);
    if (u && u.kind !== kind) { scene.remove(u.obj); u = null; }
    if (!u) {
      const scheme = G.schemes[s.o];
      u = s.def.armor ? makeTank(scheme) : protos[kind] ? instance(kind, scheme) : makeMarine(scheme, kind);
      u.kind = kind; u.walk = Math.random() * 6; u.lastX = m.x; u.lastY = m.y;
      scene.add(u.obj);
      units.set(m.id, u);
    }
    return u;
  }

  // ---- Effects --------------------------------------------------------------------------
  const TEX = {};
  function fxTex(kind) {
    if (TEX[kind]) return TEX[kind];
    return TEX[kind] = kind === 'flash' ? glowTex('rgba(255,240,200,1)', 'rgba(255,170,60,0.7)')
      : kind === 'boom' ? glowTex('rgba(255,250,220,1)', 'rgba(255,120,30,0.8)')
      : kind === 'zap' ? glowTex('rgba(220,250,255,1)', 'rgba(90,190,255,0.8)')
      : kind === 'smoke' ? glowTex('rgba(150,140,125,0.6)', 'rgba(110,100,90,0.35)')
      : glowTex('rgba(255,200,150,1)', 'rgba(255,90,40,0.6)');
  }
  function sprite(kind) {
    let s = fxPool.find(p => !p.visible && p.userData.kind === kind);
    if (!s) {
      const additive = kind !== 'smoke' && kind !== 'debris';
      s = new T.Sprite(new T.SpriteMaterial({ map: fxTex(kind === 'debris' ? 'smoke' : kind), transparent: true, depthWrite: false, blending: additive ? T.AdditiveBlending : T.NormalBlending, color: kind === 'debris' ? '#3a3026' : '#ffffff' }));
      s.userData.kind = kind;
      fxPool.push(s); scene.add(s);
    }
    s.visible = true;
    return s;
  }

  function updateEffects(dt) {
    // Tracers (shots) go into the shared line buffer; lance shots also get a beam.
    const pos = tracerMesh.geometry.attributes.position.array, col = tracerMesh.geometry.attributes.color.array;
    let n = 0;
    G.tracers = G.tracers.filter(t => {
      t.t += dt;
      if (t.t > t.life) { if (t.beam) { scene.remove(t.beam); t.beam.geometry.dispose(); } return false; }
      const k = t.t / t.life, st = SHOT_STYLE[t.kind];
      const hy = 15, ty = t.hit ? 12 : 4;
      if (t.kind === 3) {
        if (!t.beam) {
          const len = Math.hypot(t.x2 - t.x1, t.y2 - t.y1);
          t.beam = new T.Mesh(new T.CylinderGeometry(1.6, 1.6, len, 6, 1, true), new T.MeshBasicMaterial({ color: '#8ff6ff', transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
          t.beam.position.set((t.x1 + t.x2) / 2, hy, (t.y1 + t.y2) / 2);
          t.beam.rotation.z = Math.PI / 2; t.beam.rotation.y = -Math.atan2(t.y2 - t.y1, t.x2 - t.x1);
          scene.add(t.beam);
        }
        t.beam.material.opacity = 1 - k;
        return true;
      }
      if (n >= 600) return true;
      const c = new T.Color(st.c).multiplyScalar(1.4 * (1 - k));
      let a = 0, b = 1;
      if (t.kind !== 7) { a = Math.min(1, k * 1.6); b = Math.max(0, a - 0.35); }
      const ax = t.x1 + (t.x2 - t.x1) * b, az = t.y1 + (t.y2 - t.y1) * b, bx = t.x1 + (t.x2 - t.x1) * a, bz = t.y1 + (t.y2 - t.y1) * a;
      pos.set([ax, hy + (ty - hy) * b, az, bx, hy + (ty - hy) * a, bz], n * 6);
      col.set([c.r, c.g, c.b, c.r, c.g, c.b], n * 6);
      n++;
      return true;
    });
    tracerMesh.geometry.setDrawRange(0, n * 2);
    tracerMesh.geometry.attributes.position.needsUpdate = true;
    tracerMesh.geometry.attributes.color.needsUpdate = true;

    G.effects = G.effects.filter(e => {
      e.t += dt;
      const k = e.t / e.life;
      if (k >= 1) { if (e.spr) e.spr.visible = false; return false; }
      if (!e.spr) e.spr = sprite(e.type === 'spark' ? 'spark' : e.type);
      const s = e.spr;
      if (e.type === 'flash') { s.position.set(e.x, 15, e.y); s.scale.setScalar(e.r * 3.2); s.material.opacity = 1 - k; }
      else if (e.type === 'spark' || e.type === 'zap') { s.position.set(e.x, 10, e.y); s.scale.setScalar((e.type === 'zap' ? 26 : 12) * (0.6 + k)); s.material.opacity = 1 - k; }
      else if (e.type === 'boom') { s.position.set(e.x, 12 + k * 20, e.y); s.scale.setScalar(e.r * (1.6 + k * 2.2)); s.material.opacity = 1 - k; }
      else if (e.type === 'smoke') { e.x += e.vx * dt; e.y += e.vy * dt; s.position.set(e.x, 18 + k * 30, e.y); s.scale.setScalar(e.r * (2 + k * 3)); s.material.opacity = 0.55 * (1 - k); }
      else if (e.type === 'debris') {
        e.x += e.vx * dt; e.y += e.vy * dt; e.vx *= 0.92; e.vy *= 0.92;
        s.position.set(e.x, 4 + Math.sin(k * Math.PI) * 26, e.y); s.scale.setScalar(5); s.material.opacity = 1 - k;
      }
      return true;
    });
  }

  // ---- Per-frame -------------------------------------------------------------------------
  function viewCenter() {
    const W = canvas.width, H = canvas.height;
    return { x: G.cam.x + W / 2 / G.cam.z, y: G.cam.y + H / 2 / G.cam.z };
  }

  function placeCamera() {
    const W = canvas.width, H = canvas.height;
    if (renderer.domElement.width !== W || renderer.domElement.height !== H) renderer.setSize(W, H, false);
    camera.aspect = W / H; camera.updateProjectionMatrix();
    const c = viewCenter();
    // Distance chosen so the visible ground height roughly matches the 2D zoom.
    const D = (H / G.cam.z) / (2 * Math.tan(FOV * Math.PI / 360)) * 0.9;
    camera.position.set(c.x, Math.sin(PITCH) * D, c.y + Math.cos(PITCH) * D);
    camera.lookAt(c.x, 0, c.y);
    // Keep the sun's shadow box around what the camera sees.
    const span = D * 1.1;
    sun.position.set(c.x - 600, 900, c.y - 500); sun.target.position.set(c.x, 0, c.y - span * 0.15);
    const sc = sun.shadow.camera;
    sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.near = 10; sc.far = 3000;
    sc.updateProjectionMatrix();
  }

  function pick(sx, sy) {
    const r = canvas.getBoundingClientRect();
    const ndc = new T.Vector2((sx - r.left) / r.width * 2 - 1, -((sy - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = new T.Vector3();
    if (!raycaster.ray.intersectPlane(groundPlane, hit)) return { x: G.cam.x, y: G.cam.y };
    return { x: hit.x, y: hit.z };
  }

  const tmpV = T ? new T.Vector3() : null;
  function project(x, y, h = 0) {
    tmpV.set(x, h, y).project(camera);
    return { x: (tmpV.x + 1) / 2 * canvas.width, y: (1 - tmpV.y) / 2 * canvas.height, behind: tmpV.z > 1 };
  }

  function updateUnits(v, dt) {
    const seen = new Set();
    for (const s of v.squads) {
      const vis = squadVisible(s);
      for (const m of s.ms) {
        const u = unitFor(s, m);
        seen.add(m.id);
        u.obj.visible = vis;
        if (!vis) continue;
        const moved = Math.hypot(m.x - u.lastX, m.y - u.lastY);
        u.lastX = m.x; u.lastY = m.y;
        const lift = m.jz || 0;
        u.obj.position.set(m.x, lift * 46, m.y);
        u.obj.rotation.y = -m.face;
        if (u.mixer) {
          // Play the walk cycle while moving; settle into the first frame when stopped.
          if (moved > 0.05) { u.action.paused = false; u.mixer.update(dt * (s.st === 'retreat' ? 1.5 : 1)); u.still = 0; }
          else if ((u.still = (u.still || 0) + dt) > 0.25 && !u.settled) { u.action.time = 0; u.mixer.update(0); u.settled = true; }
          if (moved > 0.05) u.settled = false;
        }
        if (u.parts.legL) {
          // Simple walk cycle while moving, a slight breathing bob when still.
          u.walk += moved * 0.35;
          const sw = moved > 0.05 ? Math.sin(u.walk) * 0.5 : 0;
          u.parts.legL.rotation.z = sw; u.parts.legR.rotation.z = -sw;
          u.parts.body.position.y = moved > 0.05 ? Math.abs(Math.sin(u.walk)) * 0.9 : Math.sin(performance.now() / 600 + m.id) * 0.25;
          u.parts.body.rotation.z = s.st === 'retreat' ? 0.25 : 0;
          if (u.parts.gun) u.parts.gun.position.x = 3 - (u.recoil || 0);
          u.recoil = Math.max(0, (u.recoil || 0) - dt * 30);
        }
      }
    }
    for (const [id, u] of units) if (!seen.has(id)) { scene.remove(u.obj); units.delete(id); }
  }

  function kickRecoil(x, y) {
    for (const u of units.values()) if (Math.abs(u.lastX - x) < 4 && Math.abs(u.lastY - y) < 4) { u.recoil = 2.2; break; }
  }

  function updatePoints(snap, t) {
    G.map.points.forEach((p, i) => {
      const [owner, val, contested] = snap.pts[i], o = pointObjs[i];
      o.flagMat.color.set(owner ? COLORS[owner].body : '#9a9a9a');
      o.flag.visible = !!owner;
      const pos = o.flag.geometry.attributes.position;
      for (let j = 0; j < pos.count; j++) { const x = pos.getX(j); pos.setZ(j, Math.sin(t / 300 + x * 0.25 + i) * (x + 15) * 0.08); }
      pos.needsUpdate = true;
      o.icon.rotation.y = t / 900 + i;
      o.border.material.color.set(owner ? COLORS[owner].light : '#dddddd');
      o.border.material.opacity = contested ? 0.9 : 0.5;
      const a = Math.abs(val);
      if (Math.abs(a - o.lastV) > 0.004) {
        o.prog.geometry.dispose();
        o.prog.geometry = new T.RingGeometry(32, 37, 48, 1, Math.PI / 2, -Math.max(0.001, a) * Math.PI * 2);
        o.lastV = a;
      }
      o.prog.material.color.set(val > 0 ? COLORS[1].light : COLORS[2].light);
      o.prog.visible = a > 0.004;
    });
  }

  function groundRings(v) {
    let i = 0;
    const ring = (x, y, r, color, opacity = 0.9) => {
      let m = ringPool[i];
      if (!m) {
        m = new T.Mesh(new T.RingGeometry(0.86, 1, 32), new T.MeshBasicMaterial({ transparent: true, depthWrite: false }));
        m.rotation.x = -Math.PI / 2; m.renderOrder = 6; scene.add(m); ringPool.push(m);
      }
      m.visible = true; m.position.set(x, 2.2, y); m.scale.setScalar(r);
      m.material.color.set(color); m.material.opacity = opacity;
      i++;
    };
    for (const s of v.squads) {
      if (!G.sel.has(s.id) || !squadVisible(s)) continue;
      for (const m of s.ms) ring(m.x, m.y, (s.def.radius || 10) + 6, '#8be37a');
    }
    if (hover && !G.sel.has(hover.id)) for (const m of hover.ms) ring(m.x, m.y, (hover.def.radius || 10) + 6, hover.o === G.you ? '#cfe' : '#ff6a5a', 0.6);
    if (G.hqSel) ring(G.map.hq[G.you].x, G.map.hq[G.you].y, 100, '#8be37a');
    if (G.marker) ring(G.marker.x, G.marker.y, 8 + G.marker.t * 30, G.marker.color, 1 - G.marker.t / 0.6);
    for (; i < ringPool.length; i++) ringPool[i].visible = false;
  }

  function updateRally(snap) {
    const ry = snap.pl[G.you].ry;
    if (!rally) {
      rally = new T.Group();
      const pole = new T.Mesh(new T.CylinderGeometry(1.2, 1.2, 50, 6), std('#d8ad4a', { metalness: 0.8 }));
      pole.position.y = 25; rally.add(pole);
      const f = new T.Mesh(new T.PlaneGeometry(24, 14), std(COLORS[G.you].body, { side: T.DoubleSide }));
      f.position.set(12, 42, 0); rally.add(f);
      rally.traverse(o => { if (o.isMesh) o.castShadow = true; });
      scene.add(rally);
    }
    rally.visible = !!ry;
    if (ry) rally.position.set(ry[0], 0, ry[1]);
  }

  function updateGrenades(snap) {
    snap.pr.forEach((p, i) => {
      let g = grenadePool[i];
      if (!g) { g = new T.Mesh(new T.SphereGeometry(3, 8, 6), std('#dddddd')); g.castShadow = true; scene.add(g); grenadePool[i] = g; }
      g.visible = true; g.position.set(p[0], 4 + p[2] * 60, p[1]);
    });
    for (let i = snap.pr.length; i < grenadePool.length; i++) grenadePool[i].visible = false;
  }

  function updateFog() {
    const f = fogCanvas.getContext('2d'), sx = fogCanvas.width / G.map.w, sy = fogCanvas.height / G.map.h;
    f.globalCompositeOperation = 'source-over';
    f.clearRect(0, 0, fogCanvas.width, fogCanvas.height);
    f.fillStyle = 'rgba(8,8,6,0.6)'; f.fillRect(0, 0, fogCanvas.width, fogCanvas.height);
    f.globalCompositeOperation = 'destination-out';
    for (const s of sightSources) {
      const g = f.createRadialGradient(s.x * sx, s.y * sy, s.r * sx * 0.75, s.x * sx, s.y * sy, s.r * sx);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      f.fillStyle = g; f.beginPath(); f.arc(s.x * sx, s.y * sy, s.r * sx, 0, Math.PI * 2); f.fill();
    }
    fogTex.needsUpdate = true;
  }

  // 2D overlay on the regular canvas: health bars, labels, drag box, ability previews.
  function overlay(v) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of v.squads) {
      if (!squadVisible(s)) continue;
      const sel = G.sel.has(s.id), hov = hover && hover.id === s.id;
      const hp = s.ms.reduce((a, m) => a + m.hp, 0), max = s.def.models * s.def.hp;
      if (!(sel || hov || hp < max || s.sp > 0 || s.v)) continue;
      const p = project(s.cx, s.cy, s.def.armor ? 52 : 38);
      if (p.behind) continue;
      const w = 40, x = p.x - w / 2, y = p.y;
      if (sel || hov || hp < max || s.sp > 0) {
        ctx.fillStyle = '#000'; ctx.fillRect(x - 1, y - 1, w + 2, 6);
        ctx.fillStyle = '#5a1515'; ctx.fillRect(x, y, w, 4);
        ctx.fillStyle = s.o === G.you ? '#6c6' : '#e65'; ctx.fillRect(x, y, w * hp / max, 4);
        if (s.sp > 0) { ctx.fillStyle = s.sp >= 80 ? '#f33' : s.sp >= 40 ? '#fb3' : '#cc9'; ctx.fillRect(x, y + 5, w * s.sp / 100, 2); }
      }
      let label = '';
      if (s.v) label += '★'.repeat(s.v);
      if (s.st === 'retreat') label += ' ⟲';
      if (s.sp >= 80) label += ' PINNED'; else if (s.sp >= 40) label += ' SUPPRESSED';
      if (label) { ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillStyle = s.sp >= 40 ? '#fb3' : '#d9b45a'; ctx.fillText(label.trim(), p.x, y - 2); }
      if (sel && s.o === G.you && !s.def.armor) {
        for (const m of s.ms) {
          if (!m.cover) continue;
          const q = project(m.x, m.y, 30);
          ctx.fillStyle = m.cover === 2 ? '#5cd65c' : '#e6c84a';
          ctx.beginPath(); ctx.moveTo(q.x - 4, q.y - 5); ctx.lineTo(q.x + 4, q.y - 5); ctx.lineTo(q.x + 4, q.y); ctx.lineTo(q.x, q.y + 4); ctx.lineTo(q.x - 4, q.y); ctx.closePath(); ctx.fill();
        }
      }
    }
    // Fortress health.
    if (v.snap.hq) for (const p of [1, 2]) {
      const h = G.map.hq[p], q = project(h.x, h.y, 125);
      if (!q.behind) drawHqBar(ctx, q.x, q.y, v.snap.hq[p], p, 1);
    }
    // Ability range and blast preview.
    const circle = (x, y, r, stroke, fill, dash) => {
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) { const a = i / 40 * Math.PI * 2, q = project(x + Math.cos(a) * r, y + Math.sin(a) * r, 1); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }
      ctx.setLineDash(dash ? [6, 6] : []); ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    };
    const w = pick(mouse.sx, mouse.sy);
    const mine = v.squads.filter(s => G.sel.has(s.id) && s.o === G.you);
    if (G.mode === 'ability') {
      const s = mine.find(q => q.def.ability && q.cd === 0) || mine.find(q => q.def.ability);
      if (s) { circle(s.cx, s.cy, G.abilities[s.def.ability].range, 'rgba(255,220,120,0.45)', null, true); circle(w.x, w.y, s.def.ability === 'jump' ? 75 : 65, '#ffb347', 'rgba(255,140,40,0.15)'); }
    } else if (G.mode === 'amove') circle(w.x, w.y, 16, '#ff6a4a', 'rgba(255,90,60,0.12)');
    if (G.hqSel && snapRally(v)) {
      const h = G.map.hq[G.you], a = project(h.x, h.y, 2), b = project(snapRally(v)[0], snapRally(v)[1], 2);
      ctx.setLineDash([10, 8]); ctx.strokeStyle = 'rgba(139,227,122,0.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
    }
    if (G.marker) { G.marker.t += 1 / 60; if (G.marker.t > 0.6) G.marker = null; }
    if (drag && drag.box) {
      ctx.strokeStyle = '#8be37a'; ctx.lineWidth = 1; ctx.fillStyle = 'rgba(139,227,122,0.08)';
      const x = Math.min(drag.sx, mouse.sx), y = Math.min(drag.sy, mouse.sy);
      ctx.fillRect(x, y, Math.abs(mouse.sx - drag.sx), Math.abs(mouse.sy - drag.sy));
      ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(mouse.sx - drag.sx), Math.abs(mouse.sy - drag.sy));
    }
    canvas.style.cursor = rdrag && rdrag.moved ? 'grabbing' : G.mode || G.hqSel ? 'crosshair' : hover && hover.o !== G.you && mine.length ? 'crosshair' : 'default';
  }
  function snapRally(v) { return v.snap.pl[G.you].ry; }

  function render(v, dt) {
    placeCamera();
    const t = performance.now();
    if (terrainDirty && t - terrainDirty > 700) { groundTex.needsUpdate = true; terrainDirty = 0; }
    updateUnits(v, dt);
    updatePoints(v.snap, t);
    updateRally(v.snap);
    updateGrenades(v.snap);
    groundRings(v);
    updateEffects(dt);
    updateFog();
    renderer.render(scene, camera);
    overlay(v);
  }

  function markTerrain() { if (!terrainDirty) terrainDirty = performance.now(); }

  // Inspection hook for automated tests.
  function debugModel(kind) {
    const P = protos[kind]; if (!P) return null;
    const u = [...units.values()].find(x => x.kind === kind && x.gen);
    const info = { scale: P.root.scale.x, skinned: P.skinned, clips: P.clips.map(c => c.name) };
    if (u) { u.obj.updateMatrixWorld(true); const b = new T.Box3().setFromObject(u.obj); info.worldBox = [b.min.toArray().map(Math.round), b.max.toArray().map(Math.round)]; info.pos = u.obj.position.toArray().map(Math.round); }
    return info;
  }
  function debugUnits() { return { protos: Object.keys(protos), units: [...units.values()].map(u => ({ kind: u.kind, gen: !!u.gen, visible: u.obj.visible, pos: u.obj.position.toArray().map(Math.round) })) }; }

  return { available, init, render, pick, project, setVisible, markTerrain, kickRecoil, debugUnits, debugModel };
})();
