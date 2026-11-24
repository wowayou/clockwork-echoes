import { describe, expect, it } from 'vitest';
import { parseBoard } from '../src/game/engine.ts';
import { Session } from '../src/game/session.ts';
import { solve } from '../src/game/solver.ts';
import { LEVELS } from '../src/game/levels.ts';

describe('levels', () => {
  it('have unique ids and sane limits', () => {
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(LEVELS.length);
    for (const l of LEVELS) {
      expect(l.par).toBeLessThanOrEqual(l.loops);
      expect(l.solution.length).toBe(l.par);
      // Phone portrait fits 11 columns at a comfortable tile size.
      expect(parseBoard(l.map).w).toBeLessThanOrEqual(11);
    }
  });

  for (const l of LEVELS) {
    it(`${l.id}: reference solution wins with par selves`, () => {
      const s = Session.replay(l, l.solution);
      expect(s.status).toBe('won');
      expect(s.committed.length + 1).toBe(l.par);
    });

    it(`${l.id}: no plan with fewer selves than par`, () => {
      const b = parseBoard(l.map);
      for (let k = 1; k < l.par; k++) expect(solve(b, k, l.ticks)).toBeNull();
    });
  }
});
