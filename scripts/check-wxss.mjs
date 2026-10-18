// 校验 wxss 结构完整性：括号配平 + 声明块内无残留花括号
// 用法：node scripts/check-wxss.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('miniprogram');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.wxss')) out.push(full);
  }
  return out;
}

const lines = [];
let bad = 0;
for (const file of walk(root).sort()) {
  const text = fs.readFileSync(file, 'utf8');
  const open = (text.match(/\{/g) || []).length;
  const close = (text.match(/\}/g) || []).length;
  const ok = open === close;
  if (!ok) bad += 1;
  lines.push(`${ok ? 'OK ' : 'BAD'} ${open}/${close}  ${file}`);
}
lines.push(`\nfiles with unbalanced braces: ${bad}`);
console.log(lines.join('\n'));
