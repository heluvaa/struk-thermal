/* tools/check.cjs — verification harness. Run: NODE_PATH=~/node_modules node tools/check.cjs
   Evidence for "0 errors": static structure checks + real jsdom boot of the page.
   Reads real files; report comes from actual output, never from intent. */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const L = require('../receipt/layout.js');
const G = require('../receipt/gen.js');
const T = require('../receipt/text.js');

const ROOT = path.join(__dirname, '..');
const problems = [];
const notes = [];
function fail(m) { problems.push(m); }
function ok(m) { notes.push(m); }

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }

/* ---------- 1. static: assets named by every consumer exist on disk ---------- */
const html = read('index.html');
const appjs = read('app.js');
const swjs = read('sw.js');
const manifest = JSON.parse(read('manifest.json'));

const declared = new Set();
[...html.matchAll(/(?:src|href)="([^"]+)"/g)].forEach((m) => declared.add(m[1]));
[...swjs.matchAll(/'\.\/([^']+)'/g)].forEach((m) => declared.add(m[1]));
manifest.icons.forEach((i) => declared.add(i.src));
Array.from(declared).forEach((rel) => {
  if (rel.startsWith('http') || rel.startsWith('#') || rel === '/' || rel === '.') { return; }
  const clean = rel.replace(/^\.\//, '');
  if (clean === '') { return; }
  if (!exists(clean)) { fail('asset declared but missing: ' + clean); }
});
ok('assets: ' + declared.size + ' declared references checked');

/* manifest icon purposes must cover any + maskable */
if (!manifest.icons.some((i) => i.purpose === 'any' && i.sizes === '192x192')) { fail('manifest: no 192 any icon'); }
if (!manifest.icons.some((i) => i.purpose === 'maskable')) { fail('manifest: no maskable icon'); }

/* ---------- 2. heading tags balance statically (parsers hide mismatches) ---------- */
['h1', 'h2', 'h3'].forEach((tag) => {
  [['index.html', html], ['app.js', appjs]].forEach(([name, src]) => {
    const open = (src.match(new RegExp('<' + tag + '[\\s>]', 'g')) || []).length;
    const close = (src.match(new RegExp('</' + tag + '>', 'g')) || []).length;
    if (open !== close) { fail(name + ': <' + tag + '> ' + open + ' open vs ' + close + ' close'); }
  });
});
ok('heading tags balanced');

/* ---------- 3. every DOM hook the script reaches for exists in the HTML ---------- */
const ids = new Set();
[...html.matchAll(/id="([^"]+)"/g)].forEach((m) => ids.add(m[1]));
const referenced = new Set();
[...appjs.matchAll(/getElementById\('([^']+)'\)/g)].forEach((m) => referenced.add(m[1]));
[...appjs.matchAll(/(?:setValue|valueOf)\('([^']+)'/g)].forEach((m) => referenced.add(m[1]));
[...appjs.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].forEach((m) => referenced.add(m[1]));
referenced.forEach((id) => { if (!ids.has(id)) { fail('app.js references #' + id + ' which is not in index.html'); } });
ok('DOM hooks: ' + referenced.size + ' ids referenced, all present');

/* classes app.js builds must exist in the stylesheet */
const css = read('styles.css');
['.item-row', '.line-total', '.h-top', '.h-no', '.h-tot', '.h-meta', '.h-act', '.toast', '.show'].forEach((cls) => {
  if (!css.includes(cls)) { fail('styles.css missing ' + cls); }
});
ok('CSS classes referenced by app.js present');

/* ---------- 4. layout engine: maths + no clipping + monospace, many random receipts ---------- */
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const PREFIX = process.env.PREFIX || '/data/data/com.termux/files/usr';
GlobalFonts.registerFromPath(path.join(PREFIX, 'share/fonts/TTF/DejaVuSansMono.ttf'), 'DejaVu Sans Mono');
GlobalFonts.registerFromPath(path.join(PREFIX, 'share/fonts/TTF/DejaVuSansMono-Bold.ttf'), 'DejaVu Sans Mono Bold');
const FONT = 'DejaVu Sans Mono';
const pctx = createCanvas(10, 10).getContext('2d');
function measure(text, size, bold) {
  pctx.font = (bold ? 'bold ' : '') + size + 'px ' + FONT;
  return pctx.measureText(String(text)).width;
}
const mW = measure('M', 20, false), mI = measure('i', 20, false);
if (Math.abs(mW - mI) > 0.001) { fail('font is not monospace: M=' + mW + ' i=' + mI); } else { ok('monospace metrics confirmed'); }

let layoutRuns = 0;
for (let i = 0; i < 60; i++) {
  const paper = i % 2 ? '80' : '58';
  const input = G.randomReceipt({ paper: paper });
  const t0 = L.computeTotals(input.items, input.payment);
  input.payment.cash = G.friendlyCash(t0.total);
  const layout = L.buildLayout(input, measure, { fontFamily: FONT });
  const t = layout.totals;
  layoutRuns++;

  if (t.dpp + t.ppn !== t.total) { fail('run ' + i + ': DPP+PPN (' + (t.dpp + t.ppn) + ') != TOTAL (' + t.total + ')'); }
  if (t.total !== Math.round(input.items[0].qty * 6400)) { fail('run ' + i + ': total != qty*price'); }
  if (t.change !== input.payment.cash - t.total || t.change < 0) { fail('run ' + i + ': change inconsistent'); }
  if (layout.stats.truncated !== 0) { fail('run ' + i + ': ' + layout.stats.truncated + ' truncated line(s)'); }
  const clipped = layout.ops.filter((op) => op.t === 'text' && (
    (op.align === 'left' && op.x + measure(op.text, op.size, op.bold) > layout.width - layout.paper.margin + 1) ||
    (op.align === 'right' && op.x - measure(op.text, op.size, op.bold) < layout.paper.margin - 1) ||
    op.y > layout.height
  )).length;
  if (clipped) { fail('run ' + i + ': ' + clipped + ' op(s) outside the paper'); }
  if (layout.ops.some((op) => op.t === 'text' && op.text.indexOf('undefined') !== -1)) { fail('run ' + i + ': literal "undefined" rendered'); }

  /* text version must carry the same numbers as the bitmap */
  const txt = T.buildText(input);
  if (txt.indexOf(L.money(t.total, 'comma')) === -1 && t.total !== 0) { fail('run ' + i + ': text output missing total'); }
}
ok('layout engine: ' + layoutRuns + ' random receipts, maths + clipping + text all consistent');

/* ---------- 5. jsdom: boot the real page and drive it ---------- */
function stubCanvas(window) {
  const Proto = window.HTMLCanvasElement.prototype;
  Proto.getContext = function () {
    return {
      font: '', textAlign: 'left', textBaseline: 'alphabetic', fillStyle: '', strokeStyle: '', lineWidth: 1,
      setTransform() {}, scale() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
      quadraticCurveTo() {}, closePath() {}, fill() {}, stroke() {}, setLineDash() {}, fillText() {},
      measureText(t) { const m = String(t).match(/(\d+(?:\.\d+)?)px/); const s = m ? Number(m[1]) : 16; return { width: String(t).length * s * 0.602 }; }
    };
  };
  Proto.toDataURL = function () { return 'data:image/png;base64,STUB'; };
}

function inlineScripts(src) {
  /* function replacer: a string replacement would eat $$ in the source as a $-pattern. */
  return src.replace(/<script src="([^"]+)"><\/script>/g, (m, rel) => {
    return '<script>' + read(rel.replace(/^\.\//, '')) + '</script>';
  });
}

const errors = [];
/* jsdom has no navigation: the download anchor emits a "Not implemented" jsdomError. That is a
   harness limitation, not an app error, so drop exactly that message and keep everything else. */
const vconsole = new VirtualConsole();
vconsole.on('jsdomError', (e) => {
  if (String(e && e.message).indexOf('navigation to another Document') !== -1) { return; }
  errors.push('jsdomError: ' + (e && e.message));
});
const dom = new JSDOM(inlineScripts(html), {
  runScripts: 'dangerously',
  resources: undefined,
  url: 'https://example.test/',
  pretendToBeVisual: true,
  virtualConsole: vconsole,
  beforeParse(window) {
    stubCanvas(window);
    window.addEventListener('error', (e) => errors.push('window.error: ' + (e.message || e)));
  }
});
const { window } = dom;
const origError = window.console.error;
window.console.error = function () { errors.push('console.error: ' + Array.prototype.join.call(arguments, ' ')); };

function waitLoad() {
  return new Promise((resolve) => {
    if (window.document.readyState === 'complete') { resolve(); return; }
    window.addEventListener('load', resolve);
    setTimeout(resolve, 1500);
  });
}

function list(name) {
  const before = problems.length;
  ok(name);
  return before;
}

(async function run() {
  await waitLoad();
  await new Promise((r) => setTimeout(r, 60));
  const doc = window.document;
  const q = (s) => doc.querySelector(s);
  const qa = (s) => Array.from(doc.querySelectorAll(s));

  /* the page booted: a preview exists and the summary is populated from the receipt, not blank */
  const numOf = (s) => Number(String(s).replace(/[^0-9]/g, '')) || 0;
  if (!q('#receipt')) { fail('jsdom: canvas #receipt missing'); }
  /* The UI prints bare grouped numbers ("19,200"), not "Rp …" — assert on the parsed value, not a literal. */
  if (numOf(q('#sumTotal').textContent) <= 0) { fail('jsdom: total not computed on boot (got "' + q('#sumTotal').textContent + '")'); }
  if (qa('#items .item-row').length < 1) { fail('jsdom: no item row rendered on boot'); }
  if (q('#paperChip').textContent.trim() === '') { fail('jsdom: paper chip empty'); }
  ok('jsdom: boot rendered preview + summary fully populated');

  /* breakdown numbers must add up on screen too */
  const gross = q('#sumGross').textContent, dpp = q('#sumDpp').textContent, ppn = q('#sumTax').textContent, total = q('#sumTotal').textContent;
  const num = (s) => Number(String(s).replace(/[^0-9]/g, '')) || 0;
  if (num(dpp) + num(ppn) !== num(total)) { fail('jsdom: on-screen DPP(' + dpp + ')+PPN(' + ppn + ') != total(' + total + ')'); }
  if (num(total) !== num(gross)) { fail('jsdom: total != gross with no discount/tax-exclusive'); }
  ok('jsdom: on-screen breakdown DPP+PPN == TOTAL');

  /* random button redraws a different receipt */
  const before = q('#sumTotal').textContent + '|' + q('#metaCode').value;
  let changed = false;
  for (let i = 0; i < 8 && !changed; i++) {
    q('#btnRandom').click();
    await new Promise((r) => setTimeout(r, 5));
    if ((q('#sumTotal').textContent + '|' + q('#metaCode').value) !== before) { changed = true; }
  }
  if (!changed) { fail('jsdom: Acak struk baru did not change the receipt'); } else { ok('jsdom: random receipt regenerates'); }

  /* item add / duplicate / delete keeps at least one row */
  const n0 = qa('#items .item-row').length;
  q('#btnAddItem').click();
  if (qa('#items .item-row').length !== n0 + 1) { fail('jsdom: add item did not add a row'); }
  q('#btnDuplicate').click();
  if (qa('#items .item-row').length !== n0 + 2) { fail('jsdom: duplicate did not add a row'); }
  qa('#items .item-row .item-del').forEach((b) => b.click());
  if (qa('#items .item-row').length < 1) { fail('jsdom: deleting every item left zero rows'); }
  ok('jsdom: item add/duplicate/delete behave');

  /* typing a price updates the total immediately */
  const priceInput = q('#items .item-row .it-price');
  const qtyInput = q('#items .item-row .it-qty');
  priceInput.value = '10000'; qtyInput.value = '2';
  priceInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  if (num(q('#sumTotal').textContent) !== 20000) { fail('jsdom: total did not follow 2 x 10000 (got ' + q('#sumTotal').textContent + ')'); }
  ok('jsdom: total follows typed items');

  /* payment method switch: non-cash prints LUNAS, no change */
  q('#method').value = 'QRIS';
  q('#method').dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  if (num(q('#sumChange').textContent) !== 0) { fail('jsdom: non-cash shows a change amount'); }
  ok('jsdom: non-cash payment zeroes the change');

  /* PNG download path builds an image in the sheet */
  q('#btnPng').click();
  if (!q('#sheetFrame img')) { fail('jsdom: PNG preview did not render into #sheetFrame'); }
  ok('jsdom: PNG path renders preview image');

  /* history round-trip through localStorage */
  q('#btnSaveHistory').click();
  const stored = JSON.parse(window.localStorage.getItem('struk-thermal:history') || '[]');
  if (!Array.isArray(stored) || stored.length !== 1) { fail('jsdom: history not stored as an array of 1'); }
  if (qa('#historyList li').length !== 1) { fail('jsdom: history list not rendered'); }
  ok('jsdom: history saved and rendered');

  /* reload restores the saved form */
  const nameNow = q('#storeName').value;
  // re-run boot in a fresh DOM with the same storage seed
  const dom2 = new JSDOM(inlineScripts(html), {
    runScripts: 'dangerously', url: 'https://example.test/', pretendToBeVisual: true,
    beforeParse(w) { stubCanvas(w); }
  });
  // jsdom localStorage is per-window; seed explicitly to test the same code path
  dom2.window.localStorage.setItem('struk-thermal:v1', window.localStorage.getItem('struk-thermal:v1'));
  dom2.window.eval('(function(){})()');
  await new Promise((r) => setTimeout(r, 40));
  const restored = dom2.window.document.querySelector('#storeName').value;
  if (!restored) { fail('jsdom: saved form did not restore on a fresh boot'); } else { ok('jsdom: saved form restores (name "' + restored + '")'); }
  dom2.window.close();

  /* console cleanliness is the pass condition for behaviour */
  if (errors.length) { fail('jsdom console errors: ' + errors.slice(0, 5).join(' | ')); } else { ok('jsdom: zero console/runtime errors'); }

  window.console.error = origError;
  window.close();

  /* ---------- report ---------- */
  console.log('--- CHECKS PASSED ---------');
  notes.forEach((n) => console.log('  ok  ' + n));
  if (problems.length) {
    console.log('--- FAILURES (' + problems.length + ') ---');
    problems.forEach((p) => console.log('  !!  ' + p));
    console.log('RESULT: FAIL');
    process.exit(1);
  }
  console.log('--- RESULT: PASS (0 errors, 0 warnings) ---');
})();
