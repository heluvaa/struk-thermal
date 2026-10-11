/* tools/make-icons.cjs — real PNG icons for the PWA (draw a receipt mark). */
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');

const outDir = path.join(__dirname, '..', 'assets', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const ACCENT = '#0f766e';
const PAPER = '#ffffff';

function drawIcon(size, opts) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const safe = opts.maskable ? size * 0.5 : size * 0.68;   // maskable art stays in the middle 80% circle
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, size, size);

  const w = safe * 0.72, h = safe * 0.94;
  const x = (size - w) / 2, y = (size - h) / 2;
  const r = Math.max(2, size * 0.02);
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = ACCENT;
  ctx.font = 'bold ' + Math.round(w * 0.30) + 'px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Rp', x + w / 2, y + h * 0.42);

  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = Math.max(2, size * 0.035);
  ctx.beginPath();
  ctx.moveTo(x + w * 0.18, y + h * 0.68);
  ctx.lineTo(x + w * 0.82, y + h * 0.68);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + w * 0.28, y + h * 0.80);
  ctx.lineTo(x + w * 0.72, y + h * 0.80);
  ctx.stroke();

  return c;
}

const jobs = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false]
];
jobs.forEach(([name, size, maskable]) => {
  fs.writeFileSync(path.join(outDir, name), drawIcon(size, { maskable }).encodeSync('png'));
  console.log(name, size, fs.statSync(path.join(outDir, name)).size);
});
console.log('ICONS_OK');
