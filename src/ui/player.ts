// Turns session changes into animation: steps tween, fast-forwards run quick,
// a finished loop plays backwards (the rewind), then a new self winds up.
import type { Dir, Ev, State } from '../game/engine.ts';
import { type InputResult, type LevelDef, Session } from '../game/session.ts';
import { BoardView, type Frame } from '../render/board.ts';
import type { Sfx } from '../audio/sfx.ts';

interface Anim {
  kind: 'step' | 'rewind';
  prev: State;
  cur: State;
  events: Ev[];
  dur: number;
  present: number;
  frames?: State[];
  seq: number;
  /** Runs once when the animation starts (sounds, background spin). */
  onStart?: () => void;
}

export interface PlayerHooks {
  /** Background spin, +1 per tick forward, negative while rewinding. */
  spin?: (amount: number) => void;
  /** Called when every queued animation has finished. */
  idle?: () => void;
  /** A rewind finished and a new self wound up. */
  wound?: () => void;
}

const STEP_MS = 150;
const FF_MS = 70;

export class Player {
  session: Session;
  readonly view: BoardView;
  sfx: Sfx | null;
  hooks: PlayerHooks;
  reduced = false;
  /** Tick to preview from the timeline, or null. */
  preview: number | null = null;
  focus = -1;
  private queue: Anim[] = [];
  private started = 0;
  private seq = 0;
  private shown: State;
  private wonAt = 0;
  private forecastCache: { key: string; states: State[]; drift: boolean[] } | null = null;

  constructor(canvas: HTMLCanvasElement, level: LevelDef, sfx: Sfx | null, hooks: PlayerHooks = {}) {
    this.session = new Session(level);
    this.view = new BoardView(canvas, this.session.board);
    this.sfx = sfx;
    this.hooks = hooks;
    this.shown = this.session.state;
  }

  load(level: LevelDef): void {
    this.session = new Session(level);
    this.view.setBoard(this.session.board);
    this.reset();
  }

  private reset(): void {
    this.queue = [];
    this.shown = this.session.state;
    this.wonAt = this.session.status === 'won' ? performance.now() - 2000 : 0;
    this.forecastCache = null;
    this.preview = null;
  }

  get busy(): boolean { return this.queue.length > 0; }
  get rewinding(): boolean { return this.queue[0]?.kind === 'rewind'; }

  /** Finish every queued animation now (sounds of skipped steps are dropped). */
  skip(): void {
    if (!this.queue.length) return;
    const rewound = this.queue.some((a) => a.kind === 'rewind');
    this.queue = [];
    this.shown = this.session.state;
    if (rewound) { this.view.windUp(); this.hooks.wound?.(); }
    if (this.session.status === 'won' && !this.wonAt) this.wonAt = performance.now();
    this.hooks.idle?.();
  }

  move(d: Dir): InputResult { return this.apply(() => this.session.input(d)); }
  endLoop(): InputResult { return this.apply(() => this.session.endLoop()); }

  undo(): boolean {
    const before = this.session.state;
    const beforePresent = this.session.present;
    if (!this.session.undo()) return false;
    this.queue = [];
    this.wonAt = 0;
    this.forecastCache = null;
    const after = this.session.state;
    // Tween back only when the same selves are on the board; across a loop
    // boundary snap, since the selves themselves changed.
    if (beforePresent === this.session.present) {
      this.enqueue({ kind: 'step', prev: before, cur: after, events: [], dur: 90, present: this.session.present });
    } else {
      this.shown = after;
      this.view.windUp();
    }
    return true;
  }

  restart(): void {
    this.session.restart();
    this.reset();
    this.view.windUp();
  }

  private apply(fn: () => InputResult): InputResult {
    const before = this.session.state;
    const present = this.session.present;
    const r = fn();
    if (!r.ok) return r;
    this.forecastCache = null;
    let prev = before;
    let p = present;
    const fast = r.steps.length > 1;
    for (const st of r.steps) {
      const events = st.events;
      this.enqueue({
        kind: 'step', prev, cur: st.state, events, present: p,
        dur: fast ? FF_MS : STEP_MS,
        onStart: () => this.sound(events, p),
      });
      if (st.rewound) {
        const frames = st.rewound;
        const secs = Math.min(1.1, 0.3 + frames.length * 0.045);
        this.enqueue({
          kind: 'rewind', prev: st.state, cur: frames[0], events: [], present: p,
          dur: this.reduced ? 350 : secs * 1000, frames,
          onStart: () => { this.sfx?.rewind(this.reduced ? 0.35 : secs); this.hooks.spin?.(-frames.length); },
        });
        p += 1;
        prev = this.session.states[0];
        const start = prev;
        this.enqueue({
          kind: 'step', prev: start, cur: start, events: [], present: p, dur: 220,
          onStart: () => { this.sfx?.windUp(); this.view.windUp(); this.hooks.wound?.(); },
        });
      } else {
        prev = st.state;
      }
    }
    return r;
  }

  private enqueue(a: Omit<Anim, 'seq'>): void {
    const anim = { ...a, seq: ++this.seq } as Anim;
    if (!this.queue.length) { this.started = performance.now(); anim.onStart?.(); }
    this.queue.push(anim);
  }

  private sound(events: Ev[], present: number): void {
    const s = this.sfx;
    this.hooks.spin?.(1);
    if (!s) return;
    s.tick();
    let sentry = false;
    for (const e of events) {
      if (e.k === 'bump' && e.who === present) s.bump();
      else if (e.k === 'push') s.push();
      else if (e.k === 'plate') s.plate(e.on, this.session.board.plate[e.pos]);
      else if (e.k === 'door') s.door(e.open, this.session.board.doors[e.door].color);
      else if (e.k === 'jam') s.jam();
      else if (e.k === 'sentry') sentry = true;
      else if (e.k === 'caught') s.caught(e.who === present);
      else if (e.k === 'win') s.win();
    }
    if (sentry) s.sentry();
  }

  /** Forecast and drift flags for the session's current state (cached). */
  forecast(): { states: State[]; drift: boolean[] } {
    const s = this.session;
    const key = `${s.committed.length}:${s.t}:${s.status}:${s.current.join('')}`;
    if (this.forecastCache?.key === key) return this.forecastCache;
    const states = s.forecast();
    const drift = s.state.selves.map((_, k) => k < s.present && s.willDrift(k, states));
    this.forecastCache = { key, states, drift };
    return this.forecastCache;
  }

  draw(now: number): void {
    const s = this.session;
    let a = this.queue[0];
    // Advance the queue; a long queue (fast typing) plays faster.
    while (a) {
      const speed = this.queue.length > 2 && a.kind === 'step' ? 2.5 : 1;
      if (now - this.started < a.dur / speed) break;
      this.queue.shift();
      this.shown = a.kind === 'rewind' ? a.frames![0] : a.cur;
      this.started = now;
      a = this.queue[0];
      a?.onStart?.();
      if (!a) {
        this.shown = s.state;
        if (s.status === 'won' && !this.wonAt) this.wonAt = now;
        this.hooks.idle?.();
      }
    }
    const fc = this.forecast();
    const base = {
      seq: a ? a.seq : this.seq,
      recorded: s.recorded,
      drifted: fc.drift,
      wonAt: !a && this.wonAt ? this.wonAt : 0,
      now,
      reduced: this.reduced,
      ticks: s.level.ticks,
      focus: this.focus,
      preview: false,
    };
    let frame: Frame;
    if (!a && this.preview !== null) {
      const t = this.preview;
      const st = t <= s.t ? s.states[t] : fc.states[t - s.t - 1] ?? fc.states[fc.states.length - 1] ?? s.state;
      frame = { ...base, prev: st, cur: st, p: 1, events: [], present: s.present, forecast: [], rewind: 0, preview: true, wonAt: 0 };
    } else if (!a) {
      frame = { ...base, prev: this.shown, cur: this.shown, p: 1, events: [], present: s.present, forecast: s.status === 'play' ? fc.states : [], rewind: 0 };
    } else if (a.kind === 'rewind') {
      const frames = a.frames!;
      const p = Math.min(1, (now - this.started) / a.dur);
      const x = (frames.length - 1) * (1 - easeInOut(p));
      const k = Math.min(frames.length - 2, Math.floor(x));
      const frac = x - k;
      const env = Math.min(1, p * 5, (1 - p) * 5);
      frame = { ...base, prev: frames[k + 1] ?? frames[k], cur: frames[k], p: 1 - frac, events: [], present: a.present, forecast: [], rewind: env, drifted: [] };
    } else {
      const speed = this.queue.length > 2 ? 2.5 : 1;
      const p = Math.min(1, ((now - this.started) * speed) / a.dur);
      const last = this.queue.length === 1 && a.cur === s.state;
      frame = { ...base, prev: a.prev, cur: a.cur, p, events: a.events, present: a.present, forecast: last && s.status === 'play' ? fc.states : [], rewind: 0 };
    }
    this.view.draw(frame);
  }
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
