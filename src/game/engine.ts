// Rules of 发条回响. Pure and deterministic: the same inputs always give the
// same world, which is what lets past selves replay their key presses and
// what lets tests and the solver prove every level is solvable.

/** 0 wait, 1 up, 2 right, 3 down, 4 left. */
export type Dir = 0 | 1 | 2 | 3 | 4;
export const WAIT: Dir = 0;
export const DX = [0, 0, 1, 0, -1] as const;
export const DY = [0, -1, 0, 1, 0] as const;
export const REVERSE: readonly Dir[] = [0, 3, 4, 1, 2];

export const VOID = 0;
export const WALL = 1;
export const FLOOR = 2;

export interface Door {
  pos: number;
  color: number;
  /** Inverted doors are open by default and close while their plate is held. */
  inverted: boolean;
}

export interface Board {
  w: number;
  h: number;
  cells: Uint8Array;
  /** Plate colour per cell, -1 when none. */
  plate: Int8Array;
  /** Index into `doors` per cell, -1 when none. */
  doorAt: Int16Array;
  doors: Door[];
  spawn: number;
  exit: number;
  crates: number[];
  sentries: { pos: number; dir: Dir }[];
  /** Colours that have at least one plate, in ascending order. */
  colors: number[];
}

export interface Self {
  pos: number;
  alive: boolean;
}

export interface Sentry {
  pos: number;
  dir: Dir;
  /** A sentry that caught someone stops for the rest of the loop. */
  frozen: boolean;
}

export interface State {
  t: number;
  selves: Self[];
  crates: number[];
  doorOpen: boolean[];
  sentries: Sentry[];
  won: boolean;
}

export type Ev =
  | { k: 'move'; who: number; from: number; to: number }
  | { k: 'bump'; who: number; at: number; what: 'wall' | 'door' | 'crate' }
  | { k: 'push'; who: number; crate: number; from: number; to: number }
  | { k: 'door'; door: number; open: boolean }
  | { k: 'jam'; door: number }
  | { k: 'plate'; pos: number; on: boolean }
  | { k: 'sentry'; sentry: number; from: number; to: number; turned: boolean }
  | { k: 'caught'; who: number; sentry: number; at: number }
  | { k: 'win'; who: number };

export const DIR_CHARS: Record<string, Dir> = { W: 0, '.': 0, U: 1, R: 2, D: 3, L: 4 };
export const DIR_LETTER = ['W', 'U', 'R', 'D', 'L'] as const;

/**
 * Map glyphs: `#` wall, space = void (outside the tower), `.` floor,
 * `S` spawn, `E` exit, `a`–`d` plates, `A`–`D` doors, `1`–`4` inverted doors,
 * `o` crate, `> < ^ v` sentries facing that way.
 */
export function parseBoard(map: readonly string[]): Board {
  const h = map.length;
  const w = Math.max(...map.map((r) => r.length));
  const n = w * h;
  const cells = new Uint8Array(n);
  const plate = new Int8Array(n).fill(-1);
  const doorAt = new Int16Array(n).fill(-1);
  const doors: Door[] = [];
  const crates: number[] = [];
  const sentries: { pos: number; dir: Dir }[] = [];
  const colorSet = new Set<number>();
  let spawn = -1;
  let exit = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = map[y][x] ?? ' ';
      const i = y * w + x;
      if (ch === ' ') { cells[i] = VOID; continue; }
      if (ch === '#') { cells[i] = WALL; continue; }
      cells[i] = FLOOR;
      if (ch === '.') continue;
      if (ch === 'S') { spawn = i; continue; }
      if (ch === 'E') { exit = i; continue; }
      if (ch === 'o') { crates.push(i); continue; }
      if (ch >= 'a' && ch <= 'd') { const c = ch.charCodeAt(0) - 97; plate[i] = c; colorSet.add(c); continue; }
      if (ch >= 'A' && ch <= 'D') { doorAt[i] = doors.length; doors.push({ pos: i, color: ch.charCodeAt(0) - 65, inverted: false }); continue; }
      if (ch >= '1' && ch <= '4') { doorAt[i] = doors.length; doors.push({ pos: i, color: ch.charCodeAt(0) - 49, inverted: true }); continue; }
      const sd = '^>v<'.indexOf(ch);
      if (sd >= 0) { sentries.push({ pos: i, dir: (sd + 1) as Dir }); continue; }
      throw new Error(`unknown map glyph ${JSON.stringify(ch)} at ${x},${y}`);
    }
  }
  if (spawn < 0) throw new Error('map has no spawn S');
  if (exit < 0) throw new Error('map has no exit E');
  return { w, h, cells, plate, doorAt, doors, spawn, exit, crates, sentries, colors: [...colorSet].sort() };
}

export function neighbor(b: Board, pos: number, d: Dir): number {
  if (d === 0) return pos;
  const x = (pos % b.w) + DX[d];
  const y = Math.floor(pos / b.w) + DY[d];
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return -1;
  return y * b.w + x;
}

function pressedColors(b: Board, selves: Self[], crates: number[]): boolean[] {
  const pressed: boolean[] = [];
  for (const s of selves) if (s.alive && b.plate[s.pos] >= 0) pressed[b.plate[s.pos]] = true;
  for (const c of crates) if (b.plate[c] >= 0) pressed[b.plate[c]] = true;
  return pressed;
}

export function initialState(b: Board, nSelves: number): State {
  const selves: Self[] = [];
  for (let i = 0; i < nSelves; i++) selves.push({ pos: b.spawn, alive: true });
  const crates = b.crates.slice();
  const pressed = pressedColors(b, selves, crates);
  const doorOpen = b.doors.map((d) => (d.inverted ? !pressed[d.color] : !!pressed[d.color]));
  return { t: 0, selves, crates, doorOpen, sentries: b.sentries.map((s) => ({ ...s, frozen: false })), won: false };
}

export function cloneState(s: State): State {
  return {
    t: s.t,
    selves: s.selves.map((x) => ({ ...x })),
    crates: s.crates.slice(),
    doorOpen: s.doorOpen.slice(),
    sentries: s.sentries.map((x) => ({ ...x })),
    won: s.won,
  };
}

/** Is this cell solid for a mover right now (walls, void, closed doors)? */
function solid(b: Board, s: State, pos: number): boolean {
  if (pos < 0 || b.cells[pos] !== FLOOR) return true;
  const d = b.doorAt[pos];
  return d >= 0 && !s.doorOpen[d];
}

/**
 * Advance one tick. `inputs[i]` is self i's key press; selves act oldest
 * first, then sentries patrol, then captures, plates and doors resolve.
 * Door states are fixed during a tick, so a door you step into stays yours.
 */
export function step(b: Board, prev: State, inputs: readonly Dir[]): { state: State; events: Ev[] } {
  const s = cloneState(prev);
  s.t++;
  const ev: Ev[] = [];
  const from = s.selves.map((x) => x.pos);

  for (let i = 0; i < s.selves.length; i++) {
    const me = s.selves[i];
    const d = inputs[i] ?? 0;
    if (!me.alive || d === 0) continue;
    const to = neighbor(b, me.pos, d);
    if (to < 0 || b.cells[to] !== FLOOR) { ev.push({ k: 'bump', who: i, at: to, what: 'wall' }); continue; }
    const door = b.doorAt[to];
    if (door >= 0 && !s.doorOpen[door]) { ev.push({ k: 'bump', who: i, at: to, what: 'door' }); continue; }
    const ci = s.crates.indexOf(to);
    if (ci >= 0) {
      const beyond = neighbor(b, to, d);
      const blocked =
        solid(b, s, beyond) ||
        s.crates.includes(beyond) ||
        s.selves.some((o) => o.alive && o.pos === beyond) ||
        s.sentries.some((o) => !o.frozen && o.pos === beyond);
      if (blocked) { ev.push({ k: 'bump', who: i, at: to, what: 'crate' }); continue; }
      s.crates[ci] = beyond;
      ev.push({ k: 'push', who: i, crate: ci, from: to, to: beyond });
    }
    me.pos = to;
    ev.push({ k: 'move', who: i, from: from[i], to });
  }

  const sentryFrom = s.sentries.map((x) => x.pos);
  for (let j = 0; j < s.sentries.length; j++) {
    const se = s.sentries[j];
    if (se.frozen) continue;
    const blocked = (p: number) => solid(b, s, p) || s.crates.includes(p);
    let turned = false;
    let to = neighbor(b, se.pos, se.dir);
    if (blocked(to)) {
      se.dir = REVERSE[se.dir];
      turned = true;
      to = neighbor(b, se.pos, se.dir);
      if (blocked(to)) to = se.pos;
    }
    ev.push({ k: 'sentry', sentry: j, from: se.pos, to, turned });
    se.pos = to;
  }

  for (let j = 0; j < s.sentries.length; j++) {
    const se = s.sentries[j];
    if (se.frozen) continue;
    for (let i = 0; i < s.selves.length; i++) {
      const me = s.selves[i];
      if (!me.alive) continue;
      const same = me.pos === se.pos;
      const swapped = me.pos === sentryFrom[j] && from[i] === se.pos && from[i] !== me.pos;
      if (same || swapped) {
        me.alive = false;
        se.frozen = true;
        ev.push({ k: 'caught', who: i, sentry: j, at: se.pos });
        break;
      }
    }
  }

  const prevPressed = pressedColors(b, prev.selves, prev.crates);
  const pressed = pressedColors(b, s.selves, s.crates);
  const platePos = new Set<number>();
  for (const x of [...prev.selves, ...s.selves]) if (b.plate[x.pos] >= 0) platePos.add(x.pos);
  for (const c of [...prev.crates, ...s.crates]) if (b.plate[c] >= 0) platePos.add(c);
  const occupiedNow = (p: number) => s.selves.some((x) => x.alive && x.pos === p) || s.crates.includes(p);
  const occupiedPrev = (p: number) => prev.selves.some((x) => x.alive && x.pos === p) || prev.crates.includes(p);
  for (const p of platePos) {
    const was = occupiedPrev(p);
    const now = occupiedNow(p);
    if (was !== now) ev.push({ k: 'plate', pos: p, on: now });
  }

  for (let k = 0; k < b.doors.length; k++) {
    const d = b.doors[k];
    const want = d.inverted ? !pressed[d.color] : !!pressed[d.color];
    if (want && !s.doorOpen[k]) { s.doorOpen[k] = true; ev.push({ k: 'door', door: k, open: true }); }
    else if (!want && s.doorOpen[k]) {
      const stuck = occupiedNow(d.pos) || s.sentries.some((x) => !x.frozen && x.pos === d.pos);
      // Report a jam once, on the tick the door first wanted to close.
      const wantedBefore = d.inverted ? !prevPressed[d.color] : !!prevPressed[d.color];
      if (stuck) { if (wantedBefore) ev.push({ k: 'jam', door: k }); }
      else { s.doorOpen[k] = false; ev.push({ k: 'door', door: k, open: false }); }
    }
  }

  for (let i = 0; i < s.selves.length; i++) {
    if (s.selves[i].alive && s.selves[i].pos === b.exit) { s.won = true; ev.push({ k: 'win', who: i }); break; }
  }
  return { state: s, events: ev };
}

export function parseInputs(str: string): { dirs: Dir[]; endEarly: boolean } {
  const dirs: Dir[] = [];
  let endEarly = false;
  for (const ch of str.replace(/\s+/g, '')) {
    if (ch === '|') { endEarly = true; break; }
    const d = DIR_CHARS[ch];
    if (d === undefined) throw new Error(`bad input char ${ch}`);
    dirs.push(d);
  }
  return { dirs, endEarly };
}
