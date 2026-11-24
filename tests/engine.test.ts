import { describe, expect, it } from 'vitest';
import { type Dir, initialState, parseBoard, step } from '../src/game/engine.ts';
import { type LevelDef, Session } from '../src/game/session.ts';

const R: Dir = 2, L: Dir = 4, W: Dir = 0;

function lvl(map: string[], ticks = 10, loops = 3): LevelDef {
  return { id: 't', chapter: 0, name: 't', map, ticks, loops, par: 1, intro: '', tip: '', solution: [] };
}

describe('engine rules', () => {
  it('a door opens the tick after its plate is pressed, and stays open for whoever is inside', () => {
    // a plate, door, exit in a row
    const b = parseBoard(['#######', '#aSA.E#', '#######']);
    let s = initialState(b, 2);
    expect(s.doorOpen[0]).toBe(false);
    // self 0 steps onto the plate; self 1 tries the door in the same tick and bumps
    let r = step(b, s, [L, R]);
    expect(r.events.some((e) => e.k === 'bump' && e.who === 1 && e.what === 'door')).toBe(true);
    expect(r.state.doorOpen[0]).toBe(true);
    s = r.state;
    r = step(b, s, [W, R]);
    expect(r.state.selves[1].pos).toBe(b.doors[0].pos);
    // self 0 leaves the plate while self 1 stands in the doorway: jammed, not closed
    r = step(b, r.state, [R, W]);
    expect(r.state.doorOpen[0]).toBe(true);
    expect(r.events.some((e) => e.k === 'jam')).toBe(true);
    // once the doorway is clear it closes
    r = step(b, r.state, [W, R]);
    expect(r.state.doorOpen[0]).toBe(false);
  });

  it('inverted doors close while their plate is held', () => {
    const b = parseBoard(['######', '#Sa1E#', '######']);
    let s = initialState(b, 1);
    expect(s.doorOpen[0]).toBe(true);
    s = step(b, s, [R]).state;
    expect(s.doorOpen[0]).toBe(false);
    // from the plate the door is shut: the press is a bump
    const r = step(b, s, [R]);
    expect(r.events.some((e) => e.k === 'bump' && e.what === 'door')).toBe(true);
  });

  it('crates push one at a time, never into a self, a wall or another crate', () => {
    const b = parseBoard(['#######', '#So.o.#', '#..E..#', '#######']);
    let s = initialState(b, 2);
    let r = step(b, s, [R, W]);
    expect(r.state.crates).toContain(b.w + 3);
    // a crate against another crate does not move
    r = step(b, r.state, [R, W]);
    expect(r.events.some((e) => e.k === 'bump' && e.what === 'crate')).toBe(true);
    // a self standing beyond a crate blocks it too
    s = { ...initialState(b, 2), selves: [{ pos: b.w + 1, alive: true }, { pos: b.w + 3, alive: true }] };
    r = step(b, s, [R, W]);
    expect(r.state.crates[0]).toBe(b.w + 2);
    expect(r.state.selves[0].pos).toBe(b.w + 1);
  });

  it('crates hold plates down', () => {
    const b = parseBoard(['######', '#Soa.#', '#..AE#', '######']);
    const r = step(b, initialState(b, 1), [R]);
    expect(r.state.doorOpen[0]).toBe(true);
  });

  it('sentries turn at walls and crates, catch on contact or when crossing, then stop', () => {
    const b = parseBoard(['#######', '#S..<E#', '#######']);
    let s = initialState(b, 1);
    // self at 1 moves right to 2, sentry at 4 moves left to 3: no contact yet
    let r = step(b, s, [R]);
    expect(r.state.selves[0].alive).toBe(true);
    // self 2 -> 3 while sentry 3 -> 2: they cross, which catches
    r = step(b, r.state, [R]);
    expect(r.state.selves[0].alive).toBe(false);
    expect(r.state.sentries[0].frozen).toBe(true);
    const frozenAt = r.state.sentries[0].pos;
    s = step(b, r.state, [W]).state;
    expect(s.sentries[0].pos).toBe(frozenAt);
    // reversal at a wall
    const b2 = parseBoard(['#####', '#S.>#', '#E..#', '#####']);
    const r2 = step(b2, initialState(b2, 1), [W]);
    expect(r2.events.find((e) => e.k === 'sentry')).toMatchObject({ turned: true });
  });

  it('a sentry catches the oldest self in reach, and only one', () => {
    const b = parseBoard(['######', '#S.<E#', '######']);
    const s = initialState(b, 2);
    const r = step(b, s, [R, R]);
    const caught = r.events.filter((e) => e.k === 'caught');
    expect(caught).toHaveLength(1);
    expect(caught[0]).toMatchObject({ who: 0 });
    expect(r.state.selves[1].alive).toBe(true);
  });

  it('any self on the exit wins', () => {
    const b = parseBoard(['#####', '#SE.#', '#####']);
    const r = step(b, initialState(b, 2), [R, W]);
    expect(r.state.won).toBe(true);
    expect(r.events.find((e) => e.k === 'win')).toMatchObject({ who: 0 });
  });
});

describe('session', () => {
  it('records bumps as presses and replays them, so a later loop can let the past self through', () => {
    // 推门 in miniature: loop 1 walks into the closed door; loop 2 holds the plate.
    const l = lvl(['#######', '#aS.AE#', '#######'], 6, 2);
    const s = new Session(l);
    for (const d of [R, R, R, R, R, R] as Dir[]) s.input(d);
    expect(s.present).toBe(1);
    expect(s.committed[0]).toEqual([R, R, R, R, R, R]);
    // The present holds the plate from tick 1; the past self, still pressing →,
    // goes through the door on tick 2 and reaches the exit on tick 3.
    s.input(L);
    s.input(W);
    expect(s.status).toBe('play');
    s.input(W);
    expect(s.status).toBe('won');
  });

  it('a caught present self runs out its loop and time winds back', () => {
    const l = lvl(['######', '#S.<E#', '######'], 5, 2);
    const s = new Session(l);
    const r = s.input(R);
    expect(r.ok && r.caught).toBe(true);
    expect(s.present).toBe(1);
    expect(s.committed[0]).toEqual([R, W, W, W, W]);
  });

  it('end loop waits out the rest of the spring as one undo step', () => {
    const l = lvl(['#####', '#S.E#', '#####'], 6, 2);
    const s = new Session(l);
    s.input(W);
    s.endLoop();
    expect(s.present).toBe(1);
    expect(s.committed[0]).toEqual([W, W, W, W, W, W]);
    s.undo();
    expect(s.present).toBe(0);
    expect(s.t).toBe(1);
  });

  it('undo walks back across loop boundaries and restart is undoable', () => {
    const l = lvl(['#####', '#S..#', '#.E.#', '#####'], 2, 3);
    const s = new Session(l);
    s.input(R); s.input(R);
    expect(s.present).toBe(1);
    s.undo();
    expect(s.present).toBe(0);
    expect(s.t).toBe(1);
    s.input(L); s.input(W);
    s.restart();
    expect(s.present).toBe(0);
    expect(s.t).toBe(0);
    s.undo();
    expect(s.present).toBe(1);
  });

  it('spends when the last loop runs out without a win', () => {
    const l = lvl(['#####', '#S..#', '#..E#', '#####'], 1, 2);
    const s = new Session(l);
    s.input(W);
    s.input(W);
    expect(s.status).toBe('spent');
    expect(s.input(R).ok).toBe(false);
  });

  it('forecast shows what happens if you stand still, and flags a changed past', () => {
    const l = lvl(['#######', '#aS.AE#', '#######'], 6, 2);
    const s = new Session(l);
    for (let k = 0; k < 6; k++) s.input(R);
    let fc = s.forecast();
    expect(fc).toHaveLength(6);
    expect(s.willDrift(0, fc)).toBe(false);
    s.input(L);
    fc = s.forecast();
    expect(s.willDrift(0, fc)).toBe(true);
    expect(fc[fc.length - 1].won).toBe(true);
  });
});
