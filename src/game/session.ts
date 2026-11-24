// One attempt at one level: the key presses of every loop so far, plus undo.
// Everything visible is re-simulated from those presses, so undo, restart
// and replays can never drift from what the rules say.
import { type Board, type Dir, type Ev, type State, WAIT, initialState, parseBoard, parseInputs, step } from './engine.ts';

export interface LevelDef {
  /** Stable save key. Never renumber; see docs/LEVEL-FORMAT.md. */
  id: string;
  chapter: number;
  name: string;
  map: string[];
  /** Ticks per loop (how far one winding of the spring goes). */
  ticks: number;
  /** Most selves you may wind up, including the present one. */
  loops: number;
  /** Fewest selves the reference solution needs; matching it earns the gold gear. */
  par: number;
  /** One line shown when the level opens. */
  intro: string;
  /** A nudge for players who ask for it. */
  tip: string;
  /** Reference solution, one string per loop; `|` = end that loop early. */
  solution: string[];
}

export interface Trace {
  pos: number;
  alive: boolean;
}

export type Status = 'play' | 'won' | 'spent';

export interface StepOutcome {
  events: Ev[];
  state: State;
  /** Set when this tick finished a loop and time wound back. */
  rewound?: State[];
}

export type InputResult =
  | { ok: true; steps: StepOutcome[]; /** The present self was caught by a sentry. */ caught: boolean }
  | { ok: false; reason: 'over' };

interface Snap {
  committed: Dir[][];
  recorded: Trace[][];
  current: Dir[];
}

export class Session {
  readonly level: LevelDef;
  readonly board: Board;
  committed: Dir[][] = [];
  /** Where each committed self actually went while it was the present. */
  recorded: Trace[][] = [];
  current: Dir[] = [];
  /** states[t] for the current loop; states[0] is the wind-up moment. */
  states: State[] = [];
  /** events[t] are what happened on the way into tick t. */
  events: Ev[][] = [];
  status: Status = 'play';
  private history: Snap[] = [];

  constructor(level: LevelDef) {
    this.level = level;
    this.board = parseBoard(level.map);
    this.rebuild();
  }

  get present(): number { return this.committed.length; }
  get t(): number { return this.current.length; }
  get state(): State { return this.states[this.states.length - 1]; }
  get canUndo(): boolean { return this.history.length > 0; }
  get loopsLeft(): number { return this.level.loops - this.committed.length - 1; }

  /** The key press of every self at tick t (the present's from `cur`). */
  private inputsAt(t: number, cur: readonly Dir[]): Dir[] {
    const out = this.committed.map((c) => c[t] ?? WAIT);
    out.push(cur[t] ?? WAIT);
    return out;
  }

  private rebuild(): void {
    let s = initialState(this.board, this.committed.length + 1);
    this.states = [s];
    this.events = [[]];
    this.status = 'play';
    for (let t = 0; t < this.current.length; t++) {
      const r = step(this.board, s, this.inputsAt(t, this.current));
      s = r.state;
      this.states.push(s);
      this.events.push(r.events);
      if (s.won) { this.status = 'won'; break; }
    }
    if (this.status === 'play' && this.current.length >= this.level.ticks) this.status = 'spent';
  }

  private snap(): void {
    this.history.push({
      committed: this.committed.map((c) => c.slice()),
      recorded: this.recorded.map((r) => r.slice()),
      current: this.current.slice(),
    });
  }

  /**
   * One key press for the present self. Every press is recorded, even one that
   * bumps a wall, because past selves replay presses, not positions. If the
   * present self gets caught, the rest of its loop plays out on its own.
   */
  input(d: Dir): InputResult {
    if (this.status !== 'play') return { ok: false, reason: 'over' };
    this.snap();
    const loop = this.present;
    const steps = [this.tick(d)];
    if (this.status === 'play' && this.present === loop && !this.state.selves[loop].alive) steps.push(...this.runOut(loop));
    return { ok: true, steps, caught: steps[0].events.some((e) => e.k === 'caught' && e.who === loop) };
  }

  /**
   * Stop acting for the rest of this loop: the present self waits until the
   * spring runs out (or until a past self wins). One undo step.
   */
  endLoop(): InputResult {
    if (this.status !== 'play') return { ok: false, reason: 'over' };
    this.snap();
    const loop = this.present;
    const steps = this.runOut(loop);
    return { ok: true, steps, caught: steps.some((st) => st.events.some((e) => e.k === 'caught' && e.who === loop)) };
  }

  private runOut(loop: number): StepOutcome[] {
    const steps: StepOutcome[] = [];
    while (this.status === 'play' && this.present === loop) steps.push(this.tick(WAIT));
    return steps;
  }

  private tick(d: Dir): StepOutcome {
    const cur = [...this.current, d];
    const { state, events } = step(this.board, this.state, this.inputsAt(this.t, cur));
    this.current.push(d);
    this.states.push(state);
    this.events.push(events);
    const out: StepOutcome = { events, state };
    if (state.won) { this.status = 'won'; return out; }
    if (this.t >= this.level.ticks) {
      if (this.loopsLeft > 0) {
        out.rewound = this.states.slice();
        this.recorded.push(this.states.map((x) => ({ ...x.selves[this.present] })));
        this.committed.push(this.current.slice());
        this.current = [];
        this.rebuild();
      } else {
        this.status = 'spent';
      }
    }
    return out;
  }

  undo(): boolean {
    const s = this.history.pop();
    if (!s) return false;
    this.committed = s.committed;
    this.recorded = s.recorded;
    this.current = s.current;
    this.rebuild();
    return true;
  }

  restart(): void {
    if (!this.committed.length && !this.current.length) return;
    this.snap();
    this.committed = [];
    this.recorded = [];
    this.current = [];
    this.rebuild();
  }

  /**
   * What happens from now to the end of the loop if the present self stands
   * still. Drawn as the dotted paths, so the player sees the consequence of
   * every press (a door you hold open bends a past self's path) before time runs out.
   */
  forecast(): State[] {
    const out: State[] = [];
    if (this.status !== 'play') return out;
    let s = this.state;
    for (let t = this.t; t < this.level.ticks; t++) {
      s = step(this.board, s, this.inputsAt(t, this.current)).state;
      out.push(s);
      if (s.won) break;
    }
    return out;
  }

  /** Will past self k end up somewhere other than where it originally went? */
  willDrift(k: number, forecast: readonly State[]): boolean {
    const rec = this.recorded[k];
    if (!rec) return false;
    if (this.diverged(k)) return true;
    return forecast.some((s, i) => {
      const r = rec[this.t + 1 + i];
      return !!r && (r.pos !== s.selves[k].pos || r.alive !== s.selves[k].alive);
    });
  }

  /** Has past self k strayed from the path it walked when it was the present? */
  diverged(k: number, t = this.t): boolean {
    const rec = this.recorded[k]?.[t];
    const now = this.states[t]?.selves[k];
    if (!rec || !now) return false;
    return rec.pos !== now.pos || rec.alive !== now.alive;
  }

  /** First tick at which past self k strayed in the current timeline, or -1. */
  divergedSince(k: number): number {
    for (let t = 0; t < this.states.length; t++) if (this.diverged(k, t)) return t;
    return -1;
  }

  /** Every self's key press at tick t of the current loop (undefined = not yet pressed). */
  pressAt(k: number, t: number): Dir | undefined {
    if (k < this.committed.length) return this.committed[k][t];
    return this.current[t];
  }

  /** Play a reference solution (or any recorded one) through the real rules. */
  static replay(level: LevelDef, loops: readonly string[]): Session {
    const s = new Session(level);
    for (const str of loops) {
      const { dirs, endEarly } = parseInputs(str);
      const loopIndex = s.present;
      for (const d of dirs) {
        if (s.status !== 'play' || s.present !== loopIndex) break;
        s.input(d);
      }
      if (endEarly && s.status === 'play' && s.present === loopIndex) s.endLoop();
      if (s.status !== 'play') break;
    }
    return s;
  }
}
