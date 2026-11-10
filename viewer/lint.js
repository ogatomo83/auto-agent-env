#!/usr/bin/env node
// Usage: node viewer/lint.js docs/*.md   — prints only problems (silent = OK)
const fs = require('fs');
const MD = require('./parser.js');
let bad = 0;
for (const f of process.argv.slice(2)) {
  const r = MD.parse(fs.readFileSync(f, 'utf8'));
  const urls = r.refs.filter((x) => !/https?:\/\//.test(x.text)).map((x) => `URLのない出典: [^${x.id}]`);
  const w = [...r.warnings, ...urls];
  if (w.length) { bad = 1; console.log(`${f}\n  ` + w.join('\n  ')); }
  else console.log(`${f}: OK (節${r.toc.filter((t) => t.level === 2).length} / 出典${r.refs.length})`);
}
process.exit(bad);
