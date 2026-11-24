// Level design helper. Usage:
//   npm run solve -- <levelId|all> [maxSelves]
// For each level: is it solvable with fewer selves than par (it should not be),
// the shortest joint plan with `par` selves, and whether the stored reference
// solution replays to a win through the real session rules.
import { parseBoard } from '../src/game/engine.ts';
import { Session } from '../src/game/session.ts';
import { solve } from '../src/game/solver.ts';
import { LEVELS } from '../src/game/levels.ts';

const [which = 'all', maxArg] = process.argv.slice(2);
const list = which === 'all' ? LEVELS : LEVELS.filter((l) => l.id === which);
if (!list.length) { console.error('no such level'); process.exit(1); }

for (const lv of list) {
  const b = parseBoard(lv.map);
  console.log(`\n== ${lv.id} ${lv.name}  ticks=${lv.ticks} loops=${lv.loops} par=${lv.par}`);
  const top = Math.min(Number(maxArg ?? lv.par), lv.loops);
  for (let k = 1; k <= top; k++) {
    const t0 = performance.now();
    const r = solve(b, k, lv.ticks);
    const ms = (performance.now() - t0).toFixed(0);
    if (r === 'limit') console.log(`  ${k} selves: search limit hit (${ms}ms)`);
    else if (!r) console.log(`  ${k} selves: impossible (${ms}ms)`);
    else console.log(`  ${k} selves: ${r.ticks} ticks, explored ${r.explored} (${ms}ms)\n    ${r.inputs.join('\n    ')}`);
  }
  try {
    const s = Session.replay(lv, lv.solution);
    console.log(`  reference: ${s.status === 'won' ? 'WIN' : 'NO WIN (' + s.status + ')'} with ${s.committed.length + 1} selves at tick ${s.t}`);
  } catch (e) {
    console.log(`  reference: ERROR ${(e as Error).message}`);
  }
}
