// Joint breadth-first search over every self's key presses at once.
// The final loop's world is a pure function of all selves' presses, so if no
// joint plan with k selves reaches the exit, no k-loop solution exists. (The
// search also allows plans a player could not record, e.g. an earlier self
// getting caught during its own loop, so a "found" plan still needs a replay.)
import { type Board, type Dir, type State, DIR_LETTER, FLOOR, initialState, neighbor, step } from './engine.ts';

export interface SolveResult {
  /** One input string per self, all the same length. */
  inputs: string[];
  ticks: number;
  explored: number;
}

function key(s: State): string {
  let k = '';
  for (const x of s.selves) k += (x.alive ? x.pos : -1) + ',';
  k += '|' + s.crates.slice().sort((a, b) => a - b).join(',');
  k += '|';
  for (const o of s.doorOpen) k += o ? '1' : '0';
  k += '|';
  for (const se of s.sentries) k += se.frozen ? 'f,' : se.pos + ':' + se.dir + ',';
  return k;
}

export function solve(b: Board, selves: number, maxTicks: number, limit = 3_000_000): SolveResult | null | 'limit' {
  const start = initialState(b, selves);
  const parent = new Map<string, { from: string; inputs: Dir[] } | null>();
  const k0 = key(start);
  parent.set(k0, null);
  let frontier: { s: State; k: string }[] = [{ s: start, k: k0 }];
  for (let t = 0; t < maxTicks; t++) {
    const next: { s: State; k: string }[] = [];
    for (const { s, k } of frontier) {
      const options = s.selves.map((me) => {
        if (!me.alive) return [0 as Dir];
        const o: Dir[] = [0];
        for (let d = 1 as Dir; d <= 4; d = (d + 1) as Dir) {
          const n = neighbor(b, me.pos, d);
          if (n >= 0 && b.cells[n] === FLOOR) o.push(d);
        }
        return o;
      });
      const combo: Dir[] = new Array(selves).fill(0);
      const rec = (i: number): SolveResult | null => {
        if (i === selves) {
          const r = step(b, s, combo);
          const nk = key(r.state);
          if (parent.has(nk)) return null;
          parent.set(nk, { from: k, inputs: combo.slice() });
          if (r.state.won) return build(nk, t + 1);
          next.push({ s: r.state, k: nk });
          return null;
        }
        for (const d of options[i]) {
          combo[i] = d;
          const found = rec(i + 1);
          if (found) return found;
        }
        return null;
      };
      const found = rec(0);
      if (found) return found;
      if (parent.size > limit) return 'limit';
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return null;

  function build(endKey: string, ticks: number): SolveResult {
    const rows: Dir[][] = [];
    for (let at = parent.get(endKey); at; at = parent.get(at.from)) rows.push(at.inputs);
    rows.reverse();
    const inputs: string[] = [];
    for (let i = 0; i < selves; i++) inputs.push(rows.map((r) => DIR_LETTER[r[i]]).join(''));
    return { inputs, ticks, explored: parent.size };
  }
}
