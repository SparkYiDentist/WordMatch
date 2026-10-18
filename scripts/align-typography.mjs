// Typography alignment audit / fixer for WordMatch miniprogram styles.
//
// Canonical type scale (see miniprogram/app.wxss):
//   micro eyebrow 18 / meta 20 / caption 22 / assistive 24 / body 26 / body-lg 28
//   / title-sm 30 / title 32 / page-title 36 / display 44, 52 / brand 56
// Weights: 400 / 600 / 700 (glyph arrows keep 300).
//
// Usage:
//   node scripts/align-typography.mjs           # audit: report planned changes
//   node scripts/align-typography.mjs --fix     # apply changes in place
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', 'miniprogram');
const FIX = process.argv.includes('--fix');

// font-size snap table (text typography only)
const SIZE_MAP = { 16: 18, 17: 18, 19: 20, 21: 22, 23: 24, 25: 26, 27: 28, 29: 30, 31: 32, 43: 44 };
// font-weight snap table
const WEIGHT_MAP = { 500: 600, 650: 600 };
// sizes considered legal for text after snapping (audit leftovers)
const OK_SIZES = new Set([18, 20, 22, 24, 26, 28, 30, 32, 36, 44, 52, 56]);

// selectors that hold box-fitted single-character glyphs (icons, arrows, marks),
// their font sizes are tied to container boxes and must not be snapped
const GLYPH_KEYWORDS = [
  '__icon', '__arrow', '__mark', '__chevron', '__close', '__remove',
  '__clear', '__check', '__add', '__index', '__illustration', '__stars',
  'back-button', 'header-back', 'month-button', 'welcome-mark', 'file-mark', '-stars',
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.wxss')) out.push(p);
  }
  return out;
}

const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
let planned = 0;
let leftovers = [];

for (const file of walk(ROOT).sort()) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(path.resolve(import.meta.dirname, '..'), file);
  let out = '';
  let last = 0;
  let m;
  ruleRe.lastIndex = 0;
  while ((m = ruleRe.exec(src))) {
    const selRaw = m[1];
    const body = m[2];
    const sel = selRaw.toLowerCase();
    const isGlyph = GLYPH_KEYWORDS.some((k) => sel.includes(k));
    let newBody = body;
    const notes = [];
    if (!isGlyph) {
      newBody = newBody.replace(/font-size:\s*(\d+)rpx/g, (all, n) => {
        const v = +n;
        if (SIZE_MAP[v]) {
          notes.push(`size ${n}->${SIZE_MAP[v]}`);
          return `font-size: ${SIZE_MAP[v]}rpx`;
        }
        if (!OK_SIZES.has(v)) leftovers.push(`${rel} :: ${sel.trim().slice(0, 60)} :: font-size ${n}rpx (off-scale)`);
        return all;
      });
      newBody = newBody.replace(/font-weight:\s*(\d+)/g, (all, n) => {
        const v = +n;
        if (WEIGHT_MAP[v]) {
          notes.push(`weight ${n}->${WEIGHT_MAP[v]}`);
          return `font-weight: ${WEIGHT_MAP[v]}`;
        }
        return all;
      });
      newBody = newBody.replace(/line-height:\s*1\.18\b/g, () => {
        notes.push('line-height 1.18->1.2');
        return 'line-height: 1.2';
      });
    }
    if (notes.length) {
      planned += notes.length;
      console.log(`${rel} :: ${sel.trim().slice(0, 60)} :: ${notes.join(', ')}`);
    }
    out += src.slice(last, m.index) + selRaw + '{' + newBody + '}';
    last = ruleRe.lastIndex;
  }
  out += src.slice(last);
  if (FIX && out !== src) fs.writeFileSync(file, out);
}

console.log(`\n${FIX ? 'Applied' : 'Planned'} changes: ${planned}`);
if (leftovers.length) {
  console.log('\nOff-scale leftovers (need manual review):');
  for (const l of leftovers) console.log('  ' + l);
}
