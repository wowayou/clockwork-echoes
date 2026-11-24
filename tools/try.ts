// Quick design loop: node --experimental-strip-types tools/try.ts <file.json>
// file: { "map": [...], "ticks": n, "selves": [1,2], "pick": optional }
import { readFileSync } from 'node:fs';
import { parseBoard } from '../src/game/engine.ts';
import { solve } from '../src/game/solver.ts';
const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const c of Array.isArray(cfg) ? cfg : [cfg]) {
  const b = parseBoard(c.map);
  console.log(`\n-- ${c.name ?? ''} ticks=${c.ticks}`);
  for (const k of c.selves) {
    const t0 = performance.now();
    const r = solve(b, k, c.ticks, c.limit ?? 3_000_000);
    const ms = (performance.now() - t0).toFixed(0);
    if (r === 'limit') console.log(`  ${k}: limit (${ms}ms)`);
    else if (!r) console.log(`  ${k}: impossible (${ms}ms)`);
    else console.log(`  ${k}: ${r.ticks} ticks (${r.explored} states, ${ms}ms)\n     ${r.inputs.join('\n     ')}`);
  }
}
