// Legend icons are cut from the real board renderer, so the help shows
// exactly what the board shows. Medals are drawn gears.
import { type State, initialState, parseBoard } from '../game/engine.ts';
import { BoardView, gear } from '../render/board.ts';
import { C } from '../render/palette.ts';

export type IconKind = 'you' | 'echo' | 'plate' | 'door' | 'inverse' | 'crate' | 'sentry' | 'exit';

const MAPS: Record<IconKind, string> = {
  you: 'S.E', echo: 'S.E', plate: 'SaE', door: 'SAE', inverse: 'S1E', crate: 'SoE', sentry: 'S<E', exit: 'SE.',
};

export function drawIcon(target: HTMLCanvasElement, kind: IconKind): void {
  const S = 40;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const board = parseBoard([MAPS[kind]]);
  const scratch = document.createElement('canvas');
  const view = new BoardView(scratch, board);
  view.crop = false;
  view.resize(S * 3, S, dpr);
  let st: State = initialState(board, 0);
  if (kind === 'you' || kind === 'echo') st = { ...st, selves: [{ pos: 1, alive: true }] };
  view.draw({
    prev: st, cur: st, p: 1, events: [], seq: 0, present: kind === 'you' ? 0 : -1,
    forecast: [], recorded: [], drifted: [], rewind: 0, wonAt: 0, now: 0, reduced: true,
    ticks: 1, focus: -1, preview: false,
  });
  const cellS = view.S * dpr;
  target.width = Math.round(cellS);
  target.height = Math.round(cellS);
  // The middle cell of the strip is the icon.
  target.getContext('2d')!.drawImage(scratch, cellS, 0, cellS, cellS, 0, 0, cellS, cellS);
}

export function drawMedal(target: HTMLCanvasElement, gold: boolean, label: string): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = 84;
  target.width = size * dpr;
  target.height = size * dpr;
  const g = target.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const col = gold ? C.brassHi : '#c58a4a';
  const glow = g.createRadialGradient(42, 42, 10, 42, 42, 42);
  glow.addColorStop(0, gold ? 'rgba(255,227,161,0.45)' : 'rgba(197,138,74,0.3)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, size, size);
  gear(g, 42, 42, 34, 0.12, col, 12, 0.001);
  g.beginPath(); g.arc(42, 42, 21, 0, Math.PI * 2);
  g.fillStyle = '#1a1408'; g.fill();
  g.lineWidth = 2; g.strokeStyle = col; g.stroke();
  g.font = `900 ${label.length > 2 ? 15 : 19}px "Noto Serif SC", "Songti SC", serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = col;
  g.fillText(label, 42, 43);
}
