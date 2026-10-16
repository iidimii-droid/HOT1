'use strict';
// Bundles the game into one self-contained HTML page that plays against the
// AI entirely in the browser (no server). Output: dist/ironfall.html
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const modules = ['data', 'geo', 'sim', 'ai'].map(name =>
  `__mods['./${name}'] = function (module, exports, require) {\n${read(`server/${name}.js`)}\n};`).join('\n');

const runtime = `
(function () {
  const __mods = {}, __cache = {};
  function require(name) {
    if (__cache[name]) return __cache[name].exports;
    const module = { exports: {} };
    __cache[name] = module;
    __mods[name](module, module.exports, require);
    return module.exports;
  }
${modules}
  const { Game, ABILITIES } = require('./sim');
  const { AI } = require('./ai');
  const { TICK_RATE, UNITS, WEAPONS, ECON, MAP, resolveSchemes } = require('./data');

  // Stands in for the WebSocket: same messages, delivered in-page.
  window.IronfallLocal = function (deliver) {
    let game = null, timer = null;
    const post = m => setTimeout(() => deliver(m), 0);
    return {
      readyState: 1,
      send(raw) {
        const msg = JSON.parse(raw);
        if (msg.t === 'ai' && !game) {
          game = new Game();
          const ai = new AI(game, 2);
          const name = String(msg.name || '').replace(/[^\\w \\-]/g, '').trim().slice(0, 16) || 'Commander';
          post({ t: 'start', you: 1, names: ['', name, 'Iron AI'], schemes: resolveSchemes(msg.scheme, 'crimson'), map: MAP, units: UNITS, weapons: WEAPONS,
            abilities: ABILITIES, econ: ECON, tickRate: TICK_RATE });
          timer = setInterval(() => {
            ai.update();
            game.step();
            deliver(game.snapshot());
            if (game.over) clearInterval(timer);
          }, 1000 / TICK_RATE);
        } else if (msg.t === 'cmd' && game) {
          const err = game.command(1, msg.c);
          if (err) post({ t: 'err', msg: err });
        }
      },
    };
  };
})();`;

const html = read('public/index.html');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script src="img/assets.js">'));
const assetsPath = path.join(root, 'public', 'img', 'assets.js');
const assets = fs.existsSync(assetsPath) ? fs.readFileSync(assetsPath, 'utf8') : '';
const out = `<title>Ironfall</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;800&display=swap">
<style>
${read('public/style.css')}
</style>
${body.trim()}
<script>
${runtime}
</script>
<script>
${assets}
</script>
<script>
${read('public/art.js')}
</script>
<script>
${read('public/client.js')}
</script>
`;
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'ironfall.html'), out);
console.log(`dist/ironfall.html written (${(out.length / 1024).toFixed(0)} KB)`);
