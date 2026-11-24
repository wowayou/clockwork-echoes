// Draws one level in a 3/4 view: floor, raised walls and gates, the selves,
// sentries, and the forecast of where past selves and sentries are headed.
// Pure drawing from a Frame plus a small particle system for impacts.
import { type Board, type Dir, type Ev, type State, FLOOR, WALL } from '../game/engine.ts';
import type { Trace } from '../game/session.ts';
import { C, KEYS, ROMAN } from './palette.ts';

export interface Frame {
  prev: State;
  cur: State;
  /** 0..1 progress of the tween from prev to cur. */
  p: number;
  events: Ev[];
  /** Bumped whenever a new transition starts, so impacts spawn once. */
  seq: number;
  present: number;
  /** Predicted states after cur (present standing still), up to the loop's end. */
  forecast: State[];
  recorded: Trace[][];
  drifted: boolean[];
  /** 0..1, how strongly the rewind effect is showing. */
  rewind: number;
  wonAt: number;
  now: number;
  reduced: boolean;
  ticks: number;
  /** Which self is highlighted from the timeline (-1 none). */
  focus: number;
  /** Preview of a tick from the timeline: draws translucent and labels it. */
  preview: boolean;
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; kind: 'spark' | 'shard' | 'ring' | 'gear'; rot: number; vr: number }

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class BoardView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private b: Board;
  S = 48;
  private ox = 0;
  private oy = 0;
  private wallH = 14;
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;
  private particles: Particle[] = [];
  private lastSeq = -1;
  private facing: Dir[] = [];
  private floorCache: HTMLCanvasElement | null = null;
  /** Trim the outer ring of walls to half a cell (off for tiny legend boards). */
  crop = true;

  constructor(canvas: HTMLCanvasElement, board: Board) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.b = board;
  }

  setBoard(b: Board): void {
    this.b = b;
    this.particles = [];
    this.facing = [];
    this.lastSeq = -1;
    this.floorCache = null;
    this.resize(this.cssW, this.cssH, this.dpr);
  }

  /**
   * Fit the board inside cssW × cssH. The outer ring of the map is cut to half
   * a cell, so the tower's walls frame the rooms without eating the space.
   */
  resize(cssW: number, cssH: number, dpr: number): { w: number; h: number } {
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    const { w, h } = this.b;
    const cut = this.crop ? 1 : 0;
    const S = Math.max(16, Math.min(80, Math.floor(Math.min(cssW / (w - cut), cssH / (h - cut)))));
    this.S = S;
    this.wallH = Math.round(S * 0.3);
    const bw = (w - cut) * S;
    const bh = (h - cut) * S;
    this.canvas.width = Math.round(bw * dpr);
    this.canvas.height = Math.round(bh * dpr);
    this.canvas.style.width = `${bw}px`;
    this.canvas.style.height = `${bh}px`;
    this.ox = -cut * S / 2;
    this.oy = -cut * S / 2;
    this.floorCache = null;
    return { w: bw, h: bh };
  }

  /** Cell under a CSS-pixel point on the canvas, or -1. */
  cellAt(px: number, py: number): number {
    const x = Math.floor((px - this.ox) / this.S);
    const y = Math.floor((py - this.oy) / this.S);
    if (x < 0 || y < 0 || x >= this.b.w || y >= this.b.h) return -1;
    return y * this.b.w + x;
  }

  private X(pos: number) { return this.ox + ((pos % this.b.w) + 0.5) * this.S; }
  private Y(pos: number) { return this.oy + (Math.floor(pos / this.b.w) + 0.5) * this.S; }

  draw(f: Frame): void {
    const { ctx, b } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (f.seq !== this.lastSeq) { this.lastSeq = f.seq; this.onEvents(f); }

    ctx.drawImage(this.floor(), 0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);
    const e = easeOut(Math.min(1, f.p));
    const ei = easeInOut(Math.min(1, f.p));

    this.drawExit(f);
    for (let i = 0; i < b.cells.length; i++) if (b.plate[i] >= 0) this.drawPlate(i, f, e);
    this.drawSpawn(f);
    if (!f.preview && f.rewind < 0.05) this.drawForecast(f);

    // Rows back to front so raised blocks overlap what stands behind them.
    const movers: { row: number; draw: () => void }[] = [];
    const rowOf = (a: number, c: number) => Math.max(Math.floor(a / b.w), Math.floor(c / b.w));
    f.cur.crates.forEach((c, i) => {
      const a = f.prev.crates[i] ?? c;
      movers.push({ row: rowOf(a, c), draw: () => this.drawCrate(lerp(this.X(a), this.X(c), e), lerp(this.Y(a), this.Y(c), e)) });
    });
    f.cur.sentries.forEach((s, j) => {
      const a = f.prev.sentries[j] ?? s;
      movers.push({ row: rowOf(a.pos, s.pos), draw: () => this.drawSentry(f, j, a.pos, s.pos, e, f.p > 0.5 ? s.dir : a.dir, s.frozen && a.frozen ? 1 : s.frozen ? e : 0) });
    });
    f.cur.selves.forEach((s, i) => {
      const a = f.prev.selves[i] ?? s;
      if (!a.alive && !s.alive) return;
      movers.push({ row: rowOf(a.pos, s.pos), draw: () => this.drawSelf(f, i, a.pos, s.pos, ei, s.alive ? 1 : 1 - e) });
    });
    movers.sort((p, q) => p.row - q.row);
    let mi = 0;
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        const i = y * b.w + x;
        if (b.cells[i] === WALL) this.drawWall(i);
        else if (b.doorAt[i] >= 0) this.drawDoor(i, f, e);
      }
      while (mi < movers.length && movers[mi].row <= y) movers[mi++].draw();
    }
    while (mi < movers.length) movers[mi++].draw();

    this.drawParticles();
    if (f.rewind > 0) this.drawRewind(f);
    if (f.wonAt) this.drawWin(f);
  }

  // ---------- static floor (cached) ----------

  private floor(): HTMLCanvasElement {
    if (this.floorCache) return this.floorCache;
    const cv = document.createElement('canvas');
    cv.width = this.canvas.width;
    cv.height = this.canvas.height;
    const g = cv.getContext('2d')!;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const { S, b } = this;
    for (let i = 0; i < b.cells.length; i++) {
      if (b.cells[i] !== FLOOR) continue;
      const x = this.ox + (i % b.w) * S;
      const y = this.oy + Math.floor(i / b.w) * S;
      const odd = ((i % b.w) + Math.floor(i / b.w)) % 2;
      g.fillStyle = odd ? C.floorAlt : C.floor;
      g.fillRect(x, y, S, S);
      g.strokeStyle = C.groove;
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, S - 1, S - 1);
      // Faint scratch of light from the upper left, like lamplight on stone.
      g.fillStyle = 'rgba(255,240,210,0.025)';
      g.fillRect(x + 1, y + 1, S - 2, 2);
    }
    // Ambient occlusion where floor meets wall.
    for (let i = 0; i < b.cells.length; i++) {
      if (b.cells[i] !== FLOOR) continue;
      const x = this.ox + (i % b.w) * S;
      const y = this.oy + Math.floor(i / b.w) * S;
      const up = i - b.w;
      if (up >= 0 && b.cells[up] === WALL) {
        const gr = g.createLinearGradient(0, y, 0, y + S * 0.35);
        gr.addColorStop(0, 'rgba(0,0,0,0.45)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(x, y, S, S * 0.35);
      }
    }
    this.floorCache = cv;
    return cv;
  }

  // ---------- static pieces ----------

  /** Walls stay inside their own cell: a lit top and, where floor lies below, a front face. */
  private drawWall(i: number): void {
    const { ctx, S, b, wallH } = this;
    const col = i % b.w, row = Math.floor(i / b.w);
    const x = this.ox + col * S;
    const y = this.oy + row * S;
    const isWall = (c: number, r: number) => c < 0 || r < 0 || c >= b.w || r >= b.h ? true : b.cells[r * b.w + c] === WALL;
    const openBelow = row + 1 < b.h && !isWall(col, row + 1);
    const topH = openBelow ? S - wallH : S;
    ctx.fillStyle = C.wallTop;
    ctx.fillRect(x, y, S, topH);
    // Stone courses: faint seams between neighbouring blocks
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    if (isWall(col + 1, row)) ctx.fillRect(x + S - 1, y + 2, 1, topH - 4);
    if (isWall(col, row + 1) && !openBelow) ctx.fillRect(x + 2, y + S - 1, S - 4, 1);
    // Lit rims where the wall mass meets open floor
    ctx.fillStyle = C.wallTopHi;
    if (!isWall(col, row - 1)) ctx.fillRect(x, y, S, 2);
    if (!isWall(col - 1, row)) ctx.fillRect(x, y, 2, topH);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    if (!isWall(col + 1, row)) ctx.fillRect(x + S - 2, y, 2, topH);
    if (openBelow) {
      const gr = ctx.createLinearGradient(0, y + topH, 0, y + S);
      gr.addColorStop(0, C.wallFace);
      gr.addColorStop(1, C.wallFaceLo);
      ctx.fillStyle = gr;
      ctx.fillRect(x, y + topH, S, wallH);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x, y + topH, S, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      const mid = y + topH + Math.round(wallH / 2);
      ctx.fillRect(x, mid, S, 1);
      ctx.fillRect(x + (col % 2 ? S * 0.5 : S * 0.25), y + topH, 1, Math.round(wallH / 2));
      ctx.fillRect(x + (col % 2 ? S * 0.2 : S * 0.75), mid, 1, Math.round(wallH / 2));
    }
  }

  private drawExit(f: Frame): void {
    const { ctx, S } = this;
    const p = this.b.exit;
    const x = this.X(p), y = this.Y(p);
    const r = S * 0.38;
    const pulse = f.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(f.now / 600);
    const glow = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 1.6);
    glow.addColorStop(0, `rgba(255,214,130,${0.22 + 0.12 * pulse})`);
    glow.addColorStop(1, 'rgba(255,214,130,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - r * 1.6, y - r * 1.6, r * 3.2, r * 3.2);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#10162a'; ctx.fill();
    ctx.lineWidth = Math.max(2, S * 0.05); ctx.strokeStyle = C.brass; ctx.stroke();
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const r0 = r * (k % 3 === 0 ? 0.68 : 0.78);
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
      ctx.lineTo(x + Math.cos(a) * r * 0.88, y + Math.sin(a) * r * 0.88);
      ctx.strokeStyle = C.brassHi; ctx.lineWidth = k % 3 === 0 ? 2 : 1; ctx.stroke();
    }
    // Hands: the minute hand steps with the ticks, the hour hand drifts.
    const tick = f.cur.t + (f.rewind > 0 ? 0 : Math.min(1, f.p)) - 1;
    const minute = (tick / Math.max(1, f.ticks)) * Math.PI * 2 - Math.PI / 2;
    const hour = f.now / 9000 - Math.PI / 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = C.brassHi;
    ctx.lineWidth = Math.max(2, S * 0.05);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(hour) * r * 0.42, y + Math.sin(hour) * r * 0.42); ctx.stroke();
    ctx.lineWidth = Math.max(1.5, S * 0.03);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(minute) * r * 0.7, y + Math.sin(minute) * r * 0.7); ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.arc(x, y, Math.max(2, S * 0.04), 0, Math.PI * 2); ctx.fillStyle = C.brassHi; ctx.fill();
  }

  private drawSpawn(f: Frame): void {
    const { ctx, S } = this;
    const p = this.b.spawn;
    const x = this.X(p), y = this.Y(p);
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = C.brass;
    ctx.setLineDash([S * 0.06, S * 0.08]);
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, S * 0.36, f.reduced ? 0 : f.now / 2500, (f.reduced ? 0 : f.now / 2500) + Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  private pressedNow(i: number, s: State): boolean {
    return s.selves.some((x) => x.alive && x.pos === i) || s.crates.includes(i);
  }

  private drawPlate(i: number, f: Frame, e: number): void {
    const { ctx, S } = this;
    const k = KEYS[this.b.plate[i]];
    const x = this.X(i), y = this.Y(i);
    const was = this.pressedNow(i, f.prev) ? 1 : 0;
    const now = this.pressedNow(i, f.cur) ? 1 : 0;
    const on = lerp(was, now, e);
    const r = S * 0.34;
    ctx.beginPath(); ctx.arc(x, y + 1, r, 0, Math.PI * 2); ctx.fillStyle = '#0d1222'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r * 0.86, 0, Math.PI * 2);
    ctx.fillStyle = on > 0.01 ? mix('#1a2033', k.color, 0.35 * on) : '#1a2033';
    ctx.fill();
    ctx.lineWidth = Math.max(2, S * 0.06);
    ctx.strokeStyle = k.color;
    ctx.globalAlpha = 0.55 + 0.45 * on;
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (on > 0.01) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.8);
      g.addColorStop(0, hexA(k.glow, 0.35 * on));
      g.addColorStop(1, hexA(k.glow, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r * 2, y - r * 2, r * 4, r * 4);
    }
    shape(ctx, k.shape, x, y, r * 0.36, true, on > 0.5 ? k.glow : k.color);
  }

  private drawDoor(i: number, f: Frame, e: number): void {
    const { ctx, S, wallH } = this;
    const di = this.b.doorAt[i];
    const d = this.b.doors[di];
    const k = KEYS[d.color];
    const open = lerp(f.prev.doorOpen[di] ? 1 : 0, f.cur.doorOpen[di] ? 1 : 0, e);
    const x = this.ox + (i % this.b.w) * S;
    const y = this.oy + Math.floor(i / this.b.w) * S;
    // The frame sunk in the floor is always there; dashed for inverted gates.
    ctx.fillStyle = '#0e1324';
    ctx.fillRect(x + S * 0.08, y + S * 0.08, S * 0.84, S * 0.84);
    ctx.strokeStyle = hexA(k.color, 0.75);
    ctx.lineWidth = 2;
    ctx.setLineDash(d.inverted ? [S * 0.08, S * 0.06] : []);
    ctx.strokeRect(x + S * 0.1, y + S * 0.1, S * 0.8, S * 0.8);
    ctx.setLineDash([]);
    if (open > 0.98) {
      shape(ctx, k.shape, x + S / 2, y + S / 2, S * 0.08, !d.inverted, hexA(k.color, 0.6));
      return;
    }
    const closed = 1 - open;
    // Raised gate inside its cell: a coloured block whose bars drop into the floor as it opens.
    const topH = S - wallH;
    ctx.save();
    ctx.globalAlpha = closed;
    ctx.fillStyle = mix(C.wallTop, k.color, 0.3);
    ctx.fillRect(x + 2, y + 2, S - 4, topH - 2);
    const face = ctx.createLinearGradient(0, y + topH, 0, y + S);
    face.addColorStop(0, mix(C.wallFace, k.color, 0.35));
    face.addColorStop(1, C.wallFaceLo);
    ctx.fillStyle = face;
    ctx.fillRect(x + 2, y + topH, S - 4, wallH - 1);
    ctx.restore();
    ctx.strokeStyle = hexA(k.glow, 0.9);
    ctx.lineWidth = Math.max(1.5, S * 0.045);
    const barBottom = y + 4 + (S - 8) * closed;
    for (let j = 1; j < 4; j++) {
      const bx = x + (S * j) / 4;
      if (d.inverted) ctx.setLineDash([S * 0.07, S * 0.06]);
      ctx.beginPath(); ctx.moveTo(bx, y + 4); ctx.lineTo(bx, barBottom); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = closed;
    ctx.strokeStyle = k.color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 3, y + 3, S - 6, S - 6);
    ctx.beginPath(); ctx.arc(x + S / 2, y + topH / 2 + 1, S * 0.17, 0, Math.PI * 2);
    ctx.fillStyle = '#0d1222'; ctx.fill();
    shape(ctx, k.shape, x + S / 2, y + topH / 2 + 1, S * 0.11, !d.inverted, k.glow);
    ctx.globalAlpha = 1;
  }

  // ---------- movers ----------

  private drawCrate(x: number, y: number): void {
    const { ctx, S } = this;
    const w = S * 0.76;
    const h = S * 0.24;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(x, y + S * 0.3, w * 0.55, S * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    const left = x - w / 2;
    const top = y - w / 2 - h * 0.6;
    ctx.fillStyle = C.woodLo;
    ctx.fillRect(left, top + w, w, h);
    ctx.fillStyle = C.wood;
    ctx.fillRect(left, top, w, w);
    ctx.strokeStyle = C.woodLo;
    ctx.lineWidth = Math.max(1, S * 0.03);
    ctx.strokeRect(left + 1, top + 1, w - 2, w - 2);
    ctx.beginPath(); ctx.moveTo(left + 3, top + 3); ctx.lineTo(left + w - 3, top + w - 3);
    ctx.moveTo(left + w - 3, top + 3); ctx.lineTo(left + 3, top + w - 3); ctx.stroke();
    ctx.fillStyle = C.woodHi;
    ctx.fillRect(left, top, w, 2);
    ctx.fillStyle = C.brass;
    for (const [dx, dy] of [[0.12, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88]]) {
      ctx.beginPath(); ctx.arc(left + w * dx, top + w * dy, Math.max(1.2, S * 0.03), 0, Math.PI * 2); ctx.fill();
    }
  }

  private drawSelf(f: Frame, i: number, from: number, to: number, ei: number, alpha: number): void {
    const { ctx, S } = this;
    let x = lerp(this.X(from), this.X(to), ei);
    let y = lerp(this.Y(from), this.Y(to), ei);
    const bump = f.events.find((ev) => ev.k === 'bump' && ev.who === i);
    if (bump && bump.k === 'bump' && bump.at >= 0) {
      const k = Math.sin(Math.min(1, f.p) * Math.PI) * 0.16 * S;
      const dx = this.X(bump.at) - this.X(from), dy = this.Y(bump.at) - this.Y(from);
      const len = Math.hypot(dx, dy) || 1;
      x += (dx / len) * k; y += (dy / len) * k;
    }
    const hop = from !== to && !f.reduced ? Math.sin(Math.min(1, f.p) * Math.PI) * S * 0.08 : 0;
    const ghost = i !== f.present;
    const drift = ghost && f.drifted[i];
    const dir = this.facing[i] ?? 3;
    const fx = [0, 0, 1, 0, -1][dir], fy = [0, -1, 0, 1, 0][dir];
    const r = S * 0.27;
    const dim = f.focus >= 0 && f.focus !== i ? 0.35 : 1;
    ctx.save();
    ctx.globalAlpha = alpha * dim * (f.preview ? 0.85 : 1);
    // Several selves can share a cell: the present stays centred and each echo
    // underneath peeks out up and to the left, so none of them is hidden.
    if (ghost) {
      const above = f.cur.selves.filter((s, j) => j > i && s.alive && s.pos === to && (f.prev.selves[j]?.pos ?? to) === to).length;
      x -= above * S * 0.14; y -= above * S * 0.07;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(x, y + S * 0.27, r * 0.95, S * 0.08, 0, 0, Math.PI * 2); ctx.fill();
    const cy = y - S * 0.06 - hop;
    if (ghost) {
      const col = drift ? C.drift : C.echo;
      const g = ctx.createRadialGradient(x - r * 0.3, cy - r * 0.4, r * 0.1, x, cy, r * 1.1);
      g.addColorStop(0, hexA('#ffffff', 0.55));
      g.addColorStop(0.35, hexA(col, 0.55));
      g.addColorStop(1, hexA(col, 0.18));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = hexA(col, 0.95);
      ctx.lineWidth = Math.max(1.5, S * 0.035);
      ctx.stroke();
      // Faint afterimage behind moving echoes
      if (from !== to && !f.reduced) {
        ctx.globalAlpha *= 0.3;
        ctx.beginPath(); ctx.arc(lerp(this.X(from), x, 0.5), lerp(this.Y(from), y, 0.5) - S * 0.06, r * 0.9, 0, Math.PI * 2);
        ctx.strokeStyle = col; ctx.stroke();
        ctx.globalAlpha /= 0.3;
      }
    } else {
      const g = ctx.createRadialGradient(x - r * 0.35, cy - r * 0.45, r * 0.1, x, cy, r * 1.05);
      g.addColorStop(0, C.brassHi);
      g.addColorStop(0.45, C.brass);
      g.addColorStop(1, C.brassLo);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#6b4519';
      ctx.lineWidth = Math.max(1, S * 0.025);
      ctx.stroke();
      // Rivet belt
      ctx.strokeStyle = 'rgba(90,55,15,0.5)';
      ctx.beginPath(); ctx.arc(x, cy, r * 0.72, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
    }
    // Eyes look where it last went
    const ex = fx * r * 0.28, ey = fy * r * 0.18;
    ctx.fillStyle = ghost ? '#f2fffd' : '#1d1a24';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(x + s * r * 0.36 + ex, cy - r * 0.12 + ey, r * 0.13, r * (fy === -1 ? 0.1 : 0.17), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Wind-up key on top. The present's key unwinds as the loop runs.
    const keyTurn = ghost ? 0.6 : ((f.cur.t + Math.min(1, f.p)) / Math.max(1, f.ticks)) * Math.PI * 4;
    const kx = x, ky = cy - r - S * 0.02;
    ctx.strokeStyle = ghost ? hexA(drift ? C.drift : C.echo, 0.9) : '#7a5222';
    ctx.lineWidth = Math.max(1.5, S * 0.04);
    ctx.beginPath(); ctx.moveTo(kx, ky + 2); ctx.lineTo(kx, ky - S * 0.09); ctx.stroke();
    const bw = Math.abs(Math.cos(keyTurn)) * S * 0.12 + S * 0.02;
    ctx.fillStyle = ghost ? hexA(drift ? C.drift : C.echo, 0.6) : C.brass;
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(kx + s * bw * 0.9, ky - S * 0.12, bw * 0.75, S * 0.055, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
    if (ghost) {
      ctx.font = `600 ${Math.max(10, Math.round(S * 0.22))}px "Noto Serif SC", "Songti SC", serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = drift ? C.drift : C.echo;
      ctx.fillText(ROMAN[i] ?? String(i + 1), x, cy + r * 0.48);
    }
    ctx.restore();
  }

  private drawSentry(f: Frame, j: number, from: number, to: number, e: number, dir: Dir, frozen: number): void {
    const { ctx, S } = this;
    const x = lerp(this.X(from), this.X(to), e);
    const y = lerp(this.Y(from), this.Y(to), e);
    const r = S * 0.3;
    const fx = [0, 0, 1, 0, -1][dir], fy = [0, -1, 0, 1, 0][dir];
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.ellipse(x, y + S * 0.28, r, S * 0.09, 0, 0, Math.PI * 2); ctx.fill();
    const cy = y - S * 0.04;
    // Body: an iron bell with a pendulum skirt
    ctx.fillStyle = C.iron;
    ctx.beginPath();
    ctx.moveTo(x - r, cy + r * 0.7);
    ctx.quadraticCurveTo(x - r * 1.05, cy - r * 1.1, x, cy - r * 1.05);
    ctx.quadraticCurveTo(x + r * 1.05, cy - r * 1.1, x + r, cy + r * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = C.ironHi; ctx.lineWidth = Math.max(1.5, S * 0.03); ctx.stroke();
    const swing = f.reduced || frozen > 0.5 ? 0 : Math.sin(f.now / 220 + j) * r * 0.35;
    ctx.beginPath(); ctx.moveTo(x, cy + r * 0.3); ctx.lineTo(x + swing, cy + r * 0.85);
    ctx.strokeStyle = C.ironHi; ctx.stroke();
    ctx.beginPath(); ctx.arc(x + swing, cy + r * 0.88, r * 0.14, 0, Math.PI * 2); ctx.fillStyle = C.brassLo; ctx.fill();
    // Eye
    const eyeCol = frozen > 0.5 ? '#5b6178' : C.danger;
    const ex = x + fx * r * 0.42, ey = cy - r * 0.35 + fy * r * 0.2;
    if (frozen < 0.5) {
      const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, r * 1.2);
      g.addColorStop(0, 'rgba(255,84,104,0.45)');
      g.addColorStop(1, 'rgba(255,84,104,0)');
      ctx.fillStyle = g;
      ctx.fillRect(ex - r * 1.2, ey - r * 1.2, r * 2.4, r * 2.4);
    }
    ctx.beginPath(); ctx.arc(ex, ey, r * 0.22, 0, Math.PI * 2); ctx.fillStyle = eyeCol; ctx.fill();
    ctx.beginPath(); ctx.arc(ex - r * 0.06, ey - r * 0.06, r * 0.07, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();
    if (frozen > 0.5) {
      // Stopped: holds its catch, shown as a small cage glyph
      ctx.strokeStyle = hexA(C.echo, 0.8);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, cy - r * 1.35, r * 0.28, Math.PI, 0); ctx.stroke();
      for (const s of [-0.18, 0, 0.18]) { ctx.beginPath(); ctx.moveTo(x + s * r, cy - r * 1.35); ctx.lineTo(x + s * r, cy - r * 1.05); ctx.stroke(); }
    } else {
      // Heading chevron
      ctx.fillStyle = hexA(C.danger, 0.9);
      const hx = x + fx * r * 1.25, hy = cy + fy * r * 1.15 + (fy === 0 ? r * 0.15 : 0);
      ctx.beginPath();
      ctx.moveTo(hx + fx * r * 0.28, hy + fy * r * 0.28);
      ctx.lineTo(hx - fy * r * 0.22 - fx * r * 0.05, hy + fx * r * 0.22 - fy * r * 0.05);
      ctx.lineTo(hx + fy * r * 0.22 - fx * r * 0.05, hy - fx * r * 0.22 - fy * r * 0.05);
      ctx.closePath(); ctx.fill();
    }
  }

  // ---------- forecast ----------

  private drawForecast(f: Frame): void {
    const { ctx, S } = this;
    const fade = Math.min(1, f.p * 1.6);
    if (fade <= 0) return;
    ctx.save();
    ctx.globalAlpha = fade;
    // Where past selves are headed if you stand still
    for (let i = 0; i < f.cur.selves.length; i++) {
      if (i === f.present || !f.cur.selves[i].alive) continue;
      const pts: number[] = [f.cur.selves[i].pos];
      for (const s of f.forecast) { if (!s.selves[i].alive) break; pts.push(s.selves[i].pos); }
      const col = f.drifted[i] ? C.drift : C.echo;
      const dim = f.focus >= 0 && f.focus !== i ? 0.25 : 1;
      // Where it originally went, where that differs now.
      const rec = f.recorded[i];
      if (rec && f.drifted[i]) {
        ctx.strokeStyle = hexA(C.muted, 0.35 * dim);
        ctx.setLineDash([2, 5]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let t = f.cur.t; t < rec.length; t++) {
          const p = rec[t].pos;
          if (t === f.cur.t) ctx.moveTo(this.X(p), this.Y(p)); else ctx.lineTo(this.X(p), this.Y(p));
        }
        ctx.stroke();
      }
      ctx.setLineDash([S * 0.08, S * 0.1]);
      ctx.lineWidth = Math.max(1.5, S * 0.04);
      ctx.strokeStyle = hexA(col, 0.55 * dim);
      ctx.beginPath();
      pts.forEach((p, k) => { if (k === 0) ctx.moveTo(this.X(p), this.Y(p)); else ctx.lineTo(this.X(p), this.Y(p)); });
      ctx.stroke();
      ctx.setLineDash([]);
      // Dots per tick, brighter for the near future; the next step gets a ring.
      for (let k = 1; k < pts.length; k++) {
        if (pts[k] === pts[k - 1]) continue;
        ctx.fillStyle = hexA(col, (0.85 - Math.min(0.6, k * 0.06)) * dim);
        ctx.beginPath(); ctx.arc(this.X(pts[k]), this.Y(pts[k]), S * 0.05, 0, Math.PI * 2); ctx.fill();
      }
      if (pts.length > 1 && pts[1] !== pts[0]) {
        ctx.strokeStyle = hexA(col, 0.9 * dim);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(this.X(pts[1]), this.Y(pts[1]), S * 0.16, 0, Math.PI * 2); ctx.stroke();
      }
      const last = f.forecast[f.forecast.length - 1];
      if (last && !last.selves[i].alive && f.cur.selves[i].alive) {
        // It will be caught: mark the spot
        const at = pts[pts.length - 1];
        ctx.strokeStyle = hexA(C.danger, 0.8 * dim);
        ctx.lineWidth = 2;
        const cx = this.X(at), cy = this.Y(at), q = S * 0.12;
        ctx.beginPath(); ctx.moveTo(cx - q, cy - q); ctx.lineTo(cx + q, cy + q); ctx.moveTo(cx + q, cy - q); ctx.lineTo(cx - q, cy + q); ctx.stroke();
      }
    }
    // Sentries: the next three steps, the very next one outlined.
    for (let j = 0; j < f.cur.sentries.length; j++) {
      if (f.cur.sentries[j].frozen) continue;
      let prev = f.cur.sentries[j].pos;
      for (let k = 0; k < Math.min(3, f.forecast.length); k++) {
        const s = f.forecast[k].sentries[j];
        if (s.frozen) break;
        if (k === 0) {
          const x = this.ox + (s.pos % this.b.w) * S, y = this.oy + Math.floor(s.pos / this.b.w) * S;
          ctx.strokeStyle = hexA(C.danger, 0.75);
          ctx.setLineDash([S * 0.1, S * 0.08]);
          ctx.lineWidth = 2;
          ctx.strokeRect(x + S * 0.1, y + S * 0.1, S * 0.8, S * 0.8);
          ctx.setLineDash([]);
        } else if (s.pos !== prev) {
          ctx.fillStyle = hexA(C.danger, 0.55 - k * 0.12);
          ctx.beginPath(); ctx.arc(this.X(s.pos), this.Y(s.pos), S * 0.06, 0, Math.PI * 2); ctx.fill();
        }
        prev = s.pos;
      }
    }
    ctx.restore();
  }

  // ---------- effects ----------

  private onEvents(f: Frame): void {
    const { S } = this;
    for (const ev of f.events) {
      if (ev.k === 'move' || ev.k === 'bump') {
        const from = ev.k === 'move' ? ev.from : f.prev.selves[ev.who]?.pos ?? 0;
        const to = ev.k === 'move' ? ev.to : ev.at;
        if (to >= 0 && to !== from) {
          const dx = (to % this.b.w) - (from % this.b.w), dy = Math.floor(to / this.b.w) - Math.floor(from / this.b.w);
          this.facing[ev.who] = (dy < 0 ? 1 : dx > 0 ? 2 : dy > 0 ? 3 : 4) as Dir;
        }
      }
      if (f.reduced) continue;
      if (ev.k === 'bump' && ev.what !== 'wall' && ev.at >= 0) this.burst(this.X(ev.at), this.Y(ev.at), 5, C.parchment, 'spark', 0.6);
      if (ev.k === 'push') this.burst(this.X(ev.to), this.Y(ev.to) + S * 0.25, 6, C.woodHi, 'spark', 0.5);
      if (ev.k === 'plate') this.ring(this.X(ev.pos), this.Y(ev.pos), KEYS[this.b.plate[ev.pos]].glow);
      if (ev.k === 'door') {
        const d = this.b.doors[ev.door];
        this.burst(this.X(d.pos), this.Y(d.pos), ev.open ? 10 : 6, KEYS[d.color].glow, 'spark', ev.open ? 1 : 0.6);
      }
      if (ev.k === 'caught') {
        this.burst(this.X(ev.at), this.Y(ev.at) - S * 0.1, 18, ev.who === f.present ? C.brassHi : C.echo, 'shard', 1.2);
        this.ring(this.X(ev.at), this.Y(ev.at), C.danger);
      }
      if (ev.k === 'win') {
        for (let k = 0; k < 3; k++) this.ring(this.X(this.b.exit), this.Y(this.b.exit), C.brassHi, k * 0.12);
        this.burst(this.X(this.b.exit), this.Y(this.b.exit), 26, C.brassHi, 'gear', 1.6);
      }
    }
  }

  /** Called when a new self winds up at the spawn. */
  windUp(): void {
    const x = this.X(this.b.spawn), y = this.Y(this.b.spawn);
    this.ring(x, y, C.brassHi);
    this.burst(x, y, 10, C.brass, 'spark', 0.7);
  }

  private burst(x: number, y: number, n: number, color: string, kind: Particle['kind'], power: number): void {
    const S = this.S;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = (0.4 + Math.random()) * S * 0.06 * power;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - S * 0.02 * power, life: 0, max: 30 + Math.random() * 25, color, size: (kind === 'gear' ? 0.09 : kind === 'shard' ? 0.07 : 0.035) * S * (0.6 + Math.random() * 0.8), kind, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3 });
    }
  }

  private ring(x: number, y: number, color: string, delay = 0): void {
    this.particles.push({ x, y, vx: 0, vy: 0, life: -delay * 60, max: 28, color, size: this.S * 0.2, kind: 'ring', rot: 0, vr: 0 });
  }

  private drawParticles(): void {
    const { ctx, S } = this;
    const alive: Particle[] = [];
    for (const p of this.particles) {
      p.life++;
      if (p.life > p.max) continue;
      alive.push(p);
      if (p.life < 0) continue;
      const t = p.life / p.max;
      ctx.globalAlpha = Math.max(0, 1 - t);
      if (p.kind === 'ring') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2 * (1 - t) + 0.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size + t * S * 0.55, 0, Math.PI * 2); ctx.stroke();
        continue;
      }
      p.x += p.vx; p.y += p.vy;
      p.vy += S * 0.0025;
      p.vx *= 0.96;
      p.rot += p.vr;
      ctx.fillStyle = p.color;
      if (p.kind === 'gear') { gear(ctx, p.x, p.y, p.size, p.rot, p.color); continue; }
      if (p.kind === 'shard') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.beginPath(); ctx.moveTo(-p.size, 0); ctx.lineTo(0, -p.size * 0.5); ctx.lineTo(p.size, p.size * 0.3); ctx.closePath(); ctx.fill();
        ctx.restore();
        continue;
      }
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.particles = alive;
  }

  private drawRewind(f: Frame): void {
    const { ctx } = this;
    const w = this.canvas.width / this.dpr, h = this.canvas.height / this.dpr;
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(111,230,220,${0.16 * f.rewind})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    if (!f.reduced) {
      ctx.fillStyle = `rgba(5,10,20,${0.22 * f.rewind})`;
      const off = (f.now / 12) % 4;
      for (let y = -4 + off; y < h; y += 4) ctx.fillRect(0, y, w, 1.2);
    }
    ctx.restore();
  }

  private drawWin(f: Frame): void {
    const { ctx, S } = this;
    const t = Math.min(1, (f.now - f.wonAt) / 900);
    const x = this.X(this.b.exit), y = this.Y(this.b.exit);
    const g = ctx.createRadialGradient(x, y, 0, x, y, S * (1 + t * 6));
    g.addColorStop(0, `rgba(255,227,161,${0.5 * (1 - t * 0.5)})`);
    g.addColorStop(1, 'rgba(255,227,161,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);
  }
}

// ---------- helpers ----------

export function shape(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, r: number, filled: boolean, color: string): void {
  ctx.beginPath();
  if (kind === 'circle') ctx.arc(x, y, r, 0, Math.PI * 2);
  else if (kind === 'triangle') { ctx.moveTo(x, y - r * 1.1); ctx.lineTo(x + r * 1.05, y + r * 0.75); ctx.lineTo(x - r * 1.05, y + r * 0.75); ctx.closePath(); }
  else if (kind === 'square') ctx.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
  else { ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r * 1.15); ctx.lineTo(x - r, y); ctx.closePath(); }
  if (filled) { ctx.fillStyle = color; ctx.fill(); }
  else { ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.5, r * 0.35); ctx.stroke(); }
}

export function gear(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number, color: string, teeth = 8, hole = 0.35): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  for (let k = 0; k < teeth * 2; k++) {
    const a0 = (k / (teeth * 2)) * Math.PI * 2;
    const a1 = ((k + 1) / (teeth * 2)) * Math.PI * 2;
    const rr = k % 2 ? r * 0.78 : r;
    ctx.arc(0, 0, rr, a0, a1);
  }
  ctx.closePath();
  ctx.moveTo(r * hole, 0);
  ctx.arc(0, 0, r * hole, 0, Math.PI * 2, true);
  ctx.fillStyle = color;
  ctx.fill('evenodd');
  ctx.restore();
}

export function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

function mix(a: string, b: string, t: number): string {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(lerp((x >> s) & 255, (y >> s) & 255, t));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
