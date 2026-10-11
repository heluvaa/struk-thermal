/* tools/render.cjs — node-side smoke test + visual proof for the receipt renderer.
   Renders random receipts to PNG, prints an ASCII overlay of the same layout, and asserts the maths. */
const fs = require('fs');
const path = require('path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const L = require('../receipt/layout.js');
const D = require('../receipt/draw.js');
const G = require('../receipt/gen.js');
const T = require('../receipt/text.js');

const outDir = path.join(__dirname, '..', 'shots');
fs.mkdirSync(outDir, { recursive: true });

/* Register a real monospace face so measure() and draw() use identical metrics.
   Without this, napi-rs falls back to one default face for every family name. */
const FONT = 'DejaVu Sans Mono';
const FONT_FILE = path.join(process.env.PREFIX || '/data/data/com.termux/files/usr', 'share/fonts/TTF/DejaVuSansMono.ttf');
const FONT_BOLD = path.join(process.env.PREFIX || '/data/data/com.termux/files/usr', 'share/fonts/TTF/DejaVuSansMono-Bold.ttf');
let fontFamily = FONT;
try {
  GlobalFonts.registerFromPath(FONT_FILE, FONT);
  GlobalFonts.registerFromPath(FONT_BOLD, FONT + ' Bold');
  if (!GlobalFonts.has(FONT)) { throw new Error('not registered'); }
} catch (e) {
  fontFamily = 'monospace';
  console.error('FONT_FALLBACK', e.message);
}

const probe = createCanvas(10, 10);
const pctx = probe.getContext('2d');
function measure(text, size, bold) {
  pctx.font = (bold ? 'bold ' : '') + size + 'px ' + fontFamily;
  return pctx.measureText(String(text)).width;
}

/* Pillar #1 proof: a real monospace means every glyph is the same width, so a
   right-aligned value and a left-aligned label can never drift into each other. */
const mW = measure('M', 20, false), mI = measure('i', 20, false), mS = measure(' ', 20, false);
console.log(JSON.stringify({
  check: 'monospace_metrics', family: fontFamily,
  M: mW.toFixed(2), i: mI.toFixed(2), space: mS.toFixed(2),
  is_monospace: Math.abs(mW - mI) < 0.001 && Math.abs(mW - mS) < 0.001,
  advance_ratio: (mW / 20).toFixed(4)
}));

/* ASCII overlay of the built layout: catches overlap/clipping that a PNG cannot show us here. */
/* A faithful 1:1 character map: one cell is one monospace advance at body size. Deriving the cell
   from the paper width instead would squeeze a 14px line into 12px cells and fake an overflow that
   the canvas never draws — the overlay must not invent defects the renderer does not have. */
function asciiOverlay(layout) {
  const rowH = 3;
  const cell = measure('M', layout.paper.base, false);
  const cols = layout.paper.cols;
  const rows = Math.ceil(layout.height / rowH);
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(' '));
  const cellText = (text, size) => Math.round(measure(text, size, false) / cell);
  layout.ops.forEach((op) => {
    if (op.t === 'text') {
      const r = Math.min(rows - 1, Math.max(0, Math.round(op.y / rowH)));
      const w = cellText(op.text, op.size);
      const start = Math.round(op.x / cell) - (op.align === 'center' ? Math.round(w / 2)
        : (op.align === 'right' ? w : 0));
      for (let i = 0; i < op.text.length; i++) {
        const cc = start + i;
        if (cc < 0 || cc >= cols) { continue; }
        grid[r][cc] = (grid[r][cc] !== ' ') ? '#' : op.text[i];
      }
    } else if (op.t === 'hr') {
      const r = Math.min(rows - 1, Math.max(0, Math.round(op.y / rowH)));
      const c1 = Math.round(op.x1 / cell), c2 = Math.round(op.x2 / cell);
      for (let cc = c1; cc < c2 && cc < cols; cc++) grid[r][cc] = op.style === 'solid' ? '=' : '-';
    }
  });
  return { rows, grid, rowH, cell };
}

function assert(cond, msg, bucket) { if (!cond) { bucket.push(msg); } }

const problems = [];
const report = [];
const N = Number(process.argv[2] || 5);

for (let i = 0; i < N; i++) {
  const paper = i % 3 === 2 ? '80' : '58';
  const input = G.randomReceipt({ paper: paper });
  const t0 = L.computeTotals(input.items, input.payment);
  input.payment.cash = G.friendlyCash(t0.total);
  const file = path.join(outDir, 'receipt-' + (i + 1) + (paper === '80' ? '-80mm' : '') + '.png');

  const layout = L.buildLayout(input, measure, { fontFamily: fontFamily });
  const canvas = createCanvas(10, 10);
  D.draw(canvas, layout, { scale: 2 });
  fs.writeFileSync(file, canvas.encodeSync('png'));

  const t = layout.totals;
  const cols = layout.paper.cols;
  const overlay = asciiOverlay(layout);
  const clipped = layout.ops.filter((op) => op.t === 'text' && (
    op.x + (op.align === 'left' ? measure(op.text, op.size, op.bold) : 0) > layout.width - layout.paper.margin + 1 ||
    op.x - (op.align === 'right' ? measure(op.text, op.size, op.bold) : 0) < layout.paper.margin - 1 ||
    op.y > layout.height
  )).length;

  assert(t.dpp + t.ppn === t.total, '#' + (i + 1) + ' DPP+PPN != TOTAL', problems);
  assert(t.change === input.payment.cash - t.total && t.change >= 0, '#' + (i + 1) + ' change inconsistent', problems);
  assert(t.total === Math.round(input.items[0].qty * input.items[0].price), '#' + (i + 1) + ' total != qty*price', problems);
  assert(layout.stats.truncated === 0, '#' + (i + 1) + ' ' + layout.stats.truncated + ' truncated line(s)', problems);
  assert(clipped === 0, '#' + (i + 1) + ' ' + clipped + ' text op(s) outside the paper', problems);
  assert(!overlay.grid.some((r) => r.includes('#')), '#' + (i + 1) + ' overlapping text detected in overlay', problems);

  report.push({
    file: path.basename(file), paper: paper, size: layout.width + 'x' + layout.height,
    bytes: fs.statSync(file).size, qty: input.items[0].qty, line_total: Math.round(input.items[0].qty * 6400),
    total: t.total, dpp: t.dpp, ppn: t.ppn, cash: input.payment.cash, change: t.change,
    code: input.meta.code, lines: layout.stats.lines, ascii_rows: overlay.rows, truncated: layout.stats.truncated
  });

  if (i === 0) {
    console.log('--- ASCII OVERLAY (receipt-1, ' + cols + ' cols) ---');
    overlay.grid.forEach((r) => console.log('|' + r.join('') + '|'));
    console.log('--- TEXT VERSION ---');
    fs.writeFileSync(path.join(outDir, 'receipt-1.txt'), T.buildText(input));
    console.log(T.buildText(input));
  }
}

report.forEach((r) => console.log(JSON.stringify(r)));
console.log(problems.length ? ('FAIL ' + problems.length + ': ' + problems.join(' | ')) : ('ALL_CHECKS_OK ' + N + ' receipts'));
process.exit(problems.length ? 1 : 0);
