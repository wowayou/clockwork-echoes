// The tower's insides behind everything: big faint gears that advance one
// tooth per tick, spin back during a rewind, and drift slowly otherwise.
import { gear } from './board.ts';

interface G { x: number; y: number; r: number; teeth: number; dir: 1 | -1; alpha: number }

export class Background {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private gears: G[] = [];
  private angle = 0;
  private target = 0;
  private w = 0;
  private h = 0;
  reduced = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const m = Math.max(this.w, this.h);
    // A meshing train: each gear's teeth sit against its neighbour's.
    const big = m * 0.34;
    const g1: G = { x: this.w * 0.02, y: this.h * 0.98, r: big, teeth: 24, dir: 1, alpha: 0.07 };
    const g2r = big * 0.5;
    const g2: G = { x: g1.x + (g1.r + g2r) * 0.93 * Math.cos(-0.55), y: g1.y + (g1.r + g2r) * 0.93 * Math.sin(-0.55), r: g2r, teeth: 12, dir: -1, alpha: 0.06 };
    const g3: G = { x: this.w * 1.0, y: this.h * 0.05, r: m * 0.22, teeth: 18, dir: -1, alpha: 0.055 };
    const g4r = m * 0.12;
    const g4: G = { x: g3.x - (g3.r + g4r) * 0.93 * Math.cos(0.5), y: g3.y + (g3.r + g4r) * 0.93 * Math.sin(0.5), r: g4r, teeth: 10, dir: 1, alpha: 0.05 };
    this.gears = [g1, g2, g3, g4];
  }

  /** +1 per tick forward; negative numbers spin back. */
  spin(amount: number): void { this.target += amount * (Math.PI / 24); }

  draw(now: number): void {
    const { ctx } = this;
    this.angle += (this.target - this.angle) * 0.18;
    const drift = this.reduced ? 0 : now / 60000;
    ctx.clearRect(0, 0, this.w, this.h);
    const g = ctx.createRadialGradient(this.w * 0.5, this.h * 0.45, 0, this.w * 0.5, this.h * 0.45, Math.max(this.w, this.h) * 0.75);
    g.addColorStop(0, '#141c33');
    g.addColorStop(1, '#080c18');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    // Moonlight from a high window
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = '#cfe0ff';
    ctx.beginPath();
    ctx.moveTo(this.w * 0.62, 0); ctx.lineTo(this.w * 0.74, 0); ctx.lineTo(this.w * 0.46, this.h); ctx.lineTo(this.w * 0.2, this.h);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    for (const gr of this.gears) {
      const base = (this.angle + drift) * gr.dir * (24 / gr.teeth);
      ctx.globalAlpha = gr.alpha;
      gear(ctx, gr.x, gr.y, gr.r, base, '#e0b25a', gr.teeth, 0.22);
      ctx.globalAlpha = gr.alpha * 0.8;
      ctx.strokeStyle = '#e0b25a';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(gr.x, gr.y, gr.r * 0.55, 0, Math.PI * 2); ctx.stroke();
      for (let k = 0; k < 5; k++) {
        const a = base + (k / 5) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(gr.x + Math.cos(a) * gr.r * 0.22, gr.y + Math.sin(a) * gr.r * 0.22); ctx.lineTo(gr.x + Math.cos(a) * gr.r * 0.55, gr.y + Math.sin(a) * gr.r * 0.55); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
}
