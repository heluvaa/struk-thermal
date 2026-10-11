/* tools/contrast.cjs — WCAG contrast audit for every text/UI pair styles.css actually renders.
   Text floor 4.5:1 (3:1 at >=24px bold), non-text UI boundary 3:1. Run: node tools/contrast.cjs */
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

function hex(c) {
  const m = String(c).trim().replace('#', '');
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}
function lum(rgb) {
  const a = rgb.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}
function ratio(f, b) {
  const L1 = lum(hex(f)), L2 = lum(hex(b));
  const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

/* Pull the palette straight out of styles.css so this audit cannot drift from the source. */
function tokens(block) {
  const out = {};
  const re = /--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g;
  let m;
  while ((m = re.exec(block))) { out[m[1]] = m[2]; }
  return out;
}
const lightBlock = css.slice(css.indexOf(':root {'), css.indexOf('html[data-theme="dark"]'));
const darkBlock = css.slice(css.indexOf('html[data-theme="dark"]'));

const themes = { light: tokens(lightBlock), dark: tokens(darkBlock) };

const PAIRS = [
  ['ink', 'card', 'body text on card', 4.5],
  ['ink', 'bg', 'body text on page', 4.5],
  ['ink-soft', 'card', 'secondary text on card', 4.5],
  ['accent-ink', 'accent', 'button label on accent fill', 4.5],
  ['ink', 'accent-quiet', 'text on hover/quiet fill', 4.5],
  ['border-ctrl', 'card', 'input border on card (non-text)', 3.0],
  ['border-ctrl', 'bg', 'border on page (non-text)', 3.0]
];
const DARK_EXTRA = [['accent', 'accent-quiet', 'accent text on quiet fill', 4.5]];

let failures = 0;
let checks = 0;
Object.keys(themes).forEach((name) => {
  const t = themes[name];
  const list = name === 'dark' ? PAIRS.concat(DARK_EXTRA) : PAIRS;
  console.log('\n[' + name + ']');
  list.forEach(([fg, bg, label, floor]) => {
    if (!t[fg] || !t[bg]) { console.log('  ??  ' + label + ': token missing'); failures++; return; }
    const r = ratio(t[fg], t[bg]);
    checks++;
    const pass = r >= floor;
    if (!pass) { failures++; }
    console.log('  ' + (pass ? 'ok  ' : 'FAIL') + '  ' + r.toFixed(2) + ':1 (min ' + floor + ')  ' + label
      + '  ' + t[fg] + ' on ' + t[bg]);
  });
});

console.log('\n' + checks + ' pairs checked, ' + failures + ' below floor');
console.log(failures ? 'CONTRAST_FAIL' : 'CONTRAST_OK');
process.exit(failures ? 1 : 0);