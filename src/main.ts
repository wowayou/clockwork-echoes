import './styles.css';
import { type Dir, type Ev, parseInputs } from './game/engine.ts';
import { CHAPTERS, LEVELS } from './game/levels.ts';
import type { InputResult, LevelDef } from './game/session.ts';
import { KEYS, ROMAN } from './render/palette.ts';
import { Background } from './render/bg.ts';
import { Sfx } from './audio/sfx.ts';
import { Player } from './ui/player.ts';
import { type IconKind, drawIcon, drawMedal } from './ui/icons.ts';
import * as store from './storage.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const app = $('app');
const HOURS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const DIR_SVG = [
  '',
  '<svg viewBox="0 0 16 16"><path d="M8 13V3M4 7l4-4 4 4"/></svg>',
  '<svg viewBox="0 0 16 16"><path d="M3 8h10M9 4l4 4-4 4"/></svg>',
  '<svg viewBox="0 0 16 16"><path d="M8 3v10M4 9l4 4 4-4"/></svg>',
  '<svg viewBox="0 0 16 16"><path d="M13 8H3M7 4 3 8l4 4"/></svg>',
];
const DIR_NAME = ['等', '上', '右', '下', '左'];

let saved = store.load();
const coachSeen = new Set<string>(JSON.parse(safeGet('clockwork-echoes:coach') ?? '[]') as string[]);
const sfx = new Sfx();
sfx.sfxOn = saved.sfx;
sfx.musicOn = saved.music;
const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const isReduced = () => saved.reduced ?? reducedQuery.matches;

const bg = new Background($<HTMLCanvasElement>('bg'));
const game = new Player($<HTMLCanvasElement>('board'), LEVELS[0], sfx, {
  spin: (n) => bg.spin(n),
  idle: () => onIdle(),
  wound: () => onWound(),
});
const demo = new Player($<HTMLCanvasElement>('demo'), LEVELS[1], null, { spin: (n) => bg.spin(n * 0.5) });

let levelIndex = 0;
let selected = 0;
let demoMode: { queue: string[]; timer: number } | null = null;
let winShownFor = -1;

applyReduced();

// ================= screens =================

type Screen = 'title' | 'levels' | 'play';
function show(screen: Screen): void {
  app.dataset.screen = screen;
  closeOverlays();
  if (screen === 'title') { refreshTitle(); requestAnimationFrame(() => fitDemo()); }
  if (screen === 'levels') { buildDial(); requestAnimationFrame(() => document.querySelector<HTMLElement>('.hour.selected')?.focus()); }
  if (screen === 'play') requestAnimationFrame(() => fitBoard());
}

function isUnlocked(i: number): boolean {
  if (i === 0) return true;
  const l = LEVELS[i], p = LEVELS[i - 1];
  return !!saved.clears[l.id] || !!saved.clears[p.id] || !!saved.watched[p.id];
}

function nextUnsolved(): number {
  const i = LEVELS.findIndex((l, k) => !saved.clears[l.id] && isUnlocked(k));
  return i < 0 ? 0 : i;
}

function refreshTitle(): void {
  const btn = $('btn-continue');
  const any = Object.keys(saved.clears).length;
  const done = LEVELS.every((l) => saved.clears[l.id]);
  const i = nextUnsolved();
  btn.textContent = !any ? '开始' : done ? '再访钟楼' : `继续 · ${HOURS[i]} ${LEVELS[i].name}`;
}

// ================= title demo =================

const DEMO_SCRIPT: { act: string; caption: string }[] = [
  { act: 'UU', caption: '第一轮：踩住红色圆盘，红门打开' },
  { act: '|', caption: '收束本轮：剩下的时间都站在这里' },
  { act: 'UURRRR', caption: '第二轮：过去的你替你踩着' },
];
let demoStep = 0;
let demoChar = 0;
let demoWait = 0;
function tickDemo(now: number): void {
  if (app.dataset.screen !== 'title' || demo.busy || now < demoWait) return;
  if (demo.session.status === 'won') {
    $('demo-caption').textContent = '任何一个你走到钟面，就过关';
    demoWait = now + 2200;
    demo.session.status = 'play';
    demo.restart();
    demoStep = 0; demoChar = 0;
    return;
  }
  const s = DEMO_SCRIPT[demoStep];
  if (!s) return;
  if (demoChar === 0) $('demo-caption').textContent = s.caption;
  const ch = s.act[demoChar];
  if (ch === '|') { demo.endLoop(); $('demo-caption').textContent = '时间倒流，第一个你变成了回响'; }
  else demo.move(parseInputs(ch).dirs[0]);
  demoChar++;
  demoWait = now + (ch === '|' ? 400 : 460);
  if (demoChar >= s.act.length) { demoStep++; demoChar = 0; demoWait += 500; }
}

function fitDemo(): void {
  const fig = document.querySelector<HTMLElement>('.title-demo')!;
  const w = Math.min(fig.clientWidth || 420, 520);
  const h = window.innerWidth <= 860 ? Math.min(260, window.innerHeight * 0.3) : Math.min(420, window.innerHeight * 0.6);
  demo.view.resize(w, h, Math.min(2, window.devicePixelRatio || 1));
}

// ================= dial =================

function buildDial(): void {
  const dial = $('dial');
  dial.querySelectorAll('.hour').forEach((n) => n.remove());
  if (app.dataset.screen === 'levels' && !dial.dataset.touched) selected = nextUnsolved();
  LEVELS.forEach((l, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hour';
    b.style.setProperty('--a', `${(i + 1) * 30}deg`);
    const c = saved.clears[l.id];
    const gold = !!c && c.selves <= l.par;
    if (c) b.classList.add('cleared');
    if (gold) b.classList.add('gold');
    const open = isUnlocked(i);
    if (!open) b.classList.add('locked');
    b.innerHTML = `<span class="h-num">${HOURS[i]}</span><span class="h-pip"></span>`;
    b.setAttribute('aria-label', `${HOURS[i]} ${l.name}，${CHAPTERS[l.chapter].name}，${c ? (gold ? '金齿轮' : '已过关') : open ? '未过关' : '未解锁'}`);
    b.addEventListener('click', () => {
      sfx.unlock();
      if (selected === i && open) { startLevel(i); return; }
      dial.dataset.touched = '1';
      selectHour(i);
      sfx.ui();
    });
    b.addEventListener('dblclick', () => { if (open) startLevel(i); });
    dial.appendChild(b);
  });
  const clears = LEVELS.filter((l) => saved.clears[l.id]).length;
  const golds = LEVELS.filter((l) => saved.clears[l.id] && saved.clears[l.id].selves <= l.par).length;
  $('levels-stat').textContent = `已过 ${clears} / 12 层 · 金齿轮 ${golds}`;
  selectHour(selected);
}

function selectHour(i: number): void {
  selected = i;
  const l = LEVELS[i];
  document.querySelectorAll('.hour').forEach((n, k) => n.classList.toggle('selected', k === i));
  $('dial-hand').style.rotate = `${(i + 1) * 30}deg`;
  $('dc-chapter').textContent = `第${'一二三'[l.chapter]}章 · ${CHAPTERS[l.chapter].name}`;
  $('dc-name').textContent = l.name;
  const c = saved.clears[l.id];
  const open = isUnlocked(i);
  $('dc-meta').textContent = c
    ? c.selves <= l.par ? `金齿轮 · ${c.selves} 个你` : `已过关 · ${c.selves} 个你（最少 ${l.par} 个）`
    : open ? `${l.ticks} 拍 · 最多 ${l.loops} 个你` : '先走完上一层';
  ($('dc-enter') as HTMLButtonElement).disabled = !open;
}

// ================= play =================

function startLevel(i: number): void {
  stopDemo();
  levelIndex = i;
  const l = LEVELS[i];
  game.load(l);
  winShownFor = -1;
  $('lvl-hour').textContent = HOURS[i];
  $('lvl-name').textContent = l.name;
  $<HTMLCanvasElement>('board').setAttribute('aria-label', `第 ${HOURS[i]} 层 ${l.name} 的棋盘。${l.intro}`);
  setBanner('intro');
  show('play');
  refreshHud();
}

function fitBoard(): void {
  const stage = $('stage');
  const cs = getComputedStyle(stage);
  const w = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const h = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  game.view.resize(Math.max(120, w - 4), Math.max(120, h - 8), Math.min(2.5, window.devicePixelRatio || 1));
}

type BannerMode = 'intro' | 'tip' | 'coach' | 'demo' | 'demo-done' | 'hidden';
let bannerMode: BannerMode = 'intro';
function setBanner(mode: BannerMode, text?: string): void {
  bannerMode = mode;
  const el = $('banner');
  const l = LEVELS[levelIndex];
  el.classList.toggle('hide', mode === 'hidden');
  el.classList.toggle('tip', mode === 'tip' || mode === 'coach');
  const t = $('banner-text');
  if (mode === 'intro') t.innerHTML = `<b>${l.name}</b>　${esc(l.intro)}`;
  else if (mode === 'tip') t.innerHTML = `<b>提示</b>　${esc(l.tip)}`;
  else if (mode === 'demo') t.innerHTML = '<b>参考解法演示中</b>　按任意键停止。';
  else if (mode === 'demo-done') t.innerHTML = '<b>演示结束</b>　下一层已经解锁。按 R 自己走一遍，或者回到钟面。';
  else if (text) t.innerHTML = text;
  $('btn-tip').hidden = mode !== 'intro' && mode !== 'coach';
  $('btn-demo').hidden = mode !== 'tip';
}

function coach(key: string, html: string): void {
  if (coachSeen.has(key)) return;
  coachSeen.add(key);
  safeSet('clockwork-echoes:coach', JSON.stringify([...coachSeen]));
  setBanner('coach', html);
}

function refreshHud(): void {
  const s = game.session;
  const l = s.level;
  // How many times the spring can be wound, and which one is running
  const km = $('keys-meter');
  km.innerHTML = '';
  for (let k = 0; k < l.loops; k++) {
    const d = document.createElement('span');
    d.className = 'km' + (k < s.present ? ' used' : k === s.present ? ' now' : '');
    d.textContent = k < s.present ? ROMAN[k] : k === s.present ? '今' : '';
    km.appendChild(d);
  }
  km.setAttribute('aria-label', `第 ${s.present + 1} 个你，共可上弦 ${l.loops} 次`);
  $('tl-tick').textContent = String(s.t);
  $('tl-ticks').textContent = String(l.ticks);
  $('tl-who').textContent = s.status === 'won' ? '钟声响了' : s.status === 'spent' ? '发条用完了' : s.present === 0 ? '第一个你' : `第 ${s.present + 1} 个你 · 身后有 ${s.present} 个回响`;
  ($('btn-undo') as HTMLButtonElement).disabled = !s.canUndo;
  // Ending the loop early only helps if time can wind back or a past self is still out there.
  ($('btn-end') as HTMLButtonElement).disabled = s.status !== 'play' || (s.loopsLeft === 0 && s.present === 0);
  ($('btn-restart') as HTMLButtonElement).disabled = !s.committed.length && !s.current.length;
  // Teach "end the loop" the first time it matters: standing on a plate in 回响
  const me = s.state.selves[s.present];
  const onPlate = me && me.alive && s.board.plate[me.pos] >= 0;
  $('btn-end').classList.toggle('pulse', l.id === 'echo' && s.present === 0 && !!onPlate && s.status === 'play');
  renderTimeline();
}

function renderTimeline(): void {
  const s = game.session;
  const T = s.level.ticks;
  const tl = $('timeline');
  tl.style.setProperty('--cols', String(T));
  tl.classList.toggle('dense', T > 13 && tl.clientWidth < 520);
  const fc = game.forecast();
  const html: string[] = ['<div class="tl-label" aria-hidden="true"></div>'];
  for (let t = 0; t < T; t++) html.push(`<div class="tl-num${t === s.t ? ' now' : ''}" data-col="${t + 1}">${t + 1}</div>`);
  const n = s.present + 1;
  for (let k = 0; k < n; k++) {
    const isPresent = k === s.present;
    const drift = !isPresent && fc.drift[k];
    html.push(`<div class="tl-label${isPresent ? ' present' : ''}${drift ? ' drift' : ''}" data-row="${k}" role="rowheader">${isPresent ? '现在' : ROMAN[k]}</div>`);
    let dead = false;
    for (let t = 0; t < T; t++) {
      const d = s.pressAt(k, t);
      const cls = ['tl-cell'];
      if (isPresent) cls.push('present');
      if (t < s.t) cls.push('past');
      if (t === s.t && s.status === 'play') cls.push('col-now');
      const ev: Ev[] = t < s.t ? s.events[t + 1] ?? [] : [];
      const caught = ev.some((e) => e.k === 'caught' && e.who === k) || (t >= s.t && !isPresent && caughtInForecast(fc.states, k, t - s.t));
      const bumped = ev.some((e) => e.k === 'bump' && e.who === k && e.what !== 'wall');
      if (dead) cls.push('dead');
      if (caught) { cls.push('caught'); dead = true; }
      if (bumped) cls.push('bump');
      if (!isPresent && (s.diverged(k, Math.min(t + 1, s.t)) && t < s.t || t >= s.t && drift)) cls.push('drift');
      let inner = '';
      if (d === undefined) inner = '';
      else if (d === 0) cls.push('wait');
      else inner = DIR_SVG[d];
      const label = d === undefined ? '' : `${isPresent ? '现在的你' : `回响 ${ROMAN[k]}`} 第 ${t + 1} 拍：${DIR_NAME[d]}${bumped ? '（被挡住）' : ''}${caught ? '（被抓住）' : ''}`;
      html.push(`<div class="${cls.join(' ')}" data-col="${t + 1}" data-row="${k}" role="gridcell"${label ? ` aria-label="${label}"` : ''}>${inner}</div>`);
    }
  }
  tl.innerHTML = html.join('');
}

function caughtInForecast(states: readonly { selves: { alive: boolean }[] }[], k: number, i: number): boolean {
  const a = i === 0 ? true : states[i - 1]?.selves[k]?.alive;
  const b = states[i]?.selves[k]?.alive;
  return !!a && b === false;
}

// ---------- actions ----------

function act(kind: 'move' | 'end', d: Dir = 0): void {
  sfx.unlock();
  if (kind === 'end' && ($('btn-end') as HTMLButtonElement).disabled && game.session.status === 'play') { toast('只有一个你，也没有下一轮了，收束只会白白耗掉时间', 'info'); return; }
  if (demoMode) { stopDemo(); return; }
  if (!overlaysClosed() || app.dataset.screen !== 'play') return;
  if (game.rewinding) { game.skip(); return; }
  if (game.session.status !== 'play') {
    // The level is over: bring the result card back instead of doing nothing.
    game.skip();
    if (game.session.status === 'won' && !demoMode && bannerMode !== 'demo-done') showWin();
    else if (game.session.status === 'spent') showSpent();
    return;
  }
  const r = kind === 'move' ? game.move(d) : game.endLoop();
  afterAct(r);
}

function afterAct(r: InputResult): void {
  if (!r.ok) return;
  if (bannerMode === 'intro' || bannerMode === 'tip' || bannerMode === 'coach') setBanner('hidden');
  game.preview = null;
  announce(r);
  if (r.caught) toast('你被巡逻机抓住了，这一轮剩下的时间自动走完', 'warn');
  const ev = r.steps.flatMap((s) => s.events);
  const s = game.session;
  if (ev.some((e) => e.k === 'bump' && e.what === 'door' && e.who === s.present)) {
    coach('bump', '<b>撞门也会被记住。</b>下一轮如果有人替你把门打开，过去的你就会照着这一下走进去。');
  }
  refreshHud();
}

function announce(r: InputResult): void {
  if (!r.ok) return;
  const s = game.session;
  const parts: string[] = [];
  for (const st of r.steps) for (const e of st.events) {
    if (e.k === 'door') parts.push(`${KEYS[s.board.doors[e.door].color].name}门${e.open ? '打开' : '关上'}`);
    if (e.k === 'caught') parts.push(e.who === s.present ? '你被抓住了' : `回响 ${ROMAN[e.who]} 被抓住了`);
    if (e.k === 'win') parts.push('有人走到了钟面，过关');
  }
  if (r.steps.some((st) => st.rewound)) parts.push(`时间倒流，第 ${s.present + 1} 个你出发`);
  live(`第 ${s.t} 拍。${parts.join('，')}`);
}

function onWound(): void {
  const s = game.session;
  coach('rewind', `<b>时间倒流了。</b>青色的是上一轮的你，它会重演你按过的每一个键。虚线是它接下来要走的路。`);
  refreshHud();
  void s;
}

function onIdle(): void {
  const s = game.session;
  const fc = game.forecast();
  if (s.status === 'play' && fc.drift.some(Boolean)) {
    coach('drift', '<b>粉色表示过去被改变了。</b>你做的事让某个回响走上了新的路线，灰色虚线是它原本的路。');
  }
  if (app.dataset.screen === 'play') maybeEndOverlay(false);
}

function maybeEndOverlay(immediate: boolean): void {
  const s = game.session;
  if (s.status === 'won' && winShownFor !== levelIndex) {
    winShownFor = levelIndex;
    if (demoMode || bannerMode === 'demo') { finishDemo(); return; }
    recordClear();
    window.setTimeout(() => { if (game.session.status === 'won' && app.dataset.screen === 'play') showWin(); }, immediate ? 0 : 1100);
  } else if (s.status === 'spent') {
    window.setTimeout(() => { if (game.session.status === 'spent' && app.dataset.screen === 'play' && overlaysClosed()) showSpent(); }, immediate ? 0 : 450);
  }
}

function recordClear(): void {
  const s = game.session;
  const l = s.level;
  const selves = s.committed.length + 1;
  const prev = saved.clears[l.id];
  if (!prev || selves < prev.selves || (selves === prev.selves && s.t < prev.ticks)) {
    saved.clears[l.id] = { selves, ticks: s.t };
    store.save(saved);
  }
}

function showWin(): void {
  const s = game.session;
  const l = s.level;
  const selves = s.committed.length + 1;
  const gold = selves <= l.par;
  const last = levelIndex === LEVELS.length - 1;
  drawMedalInto($('win-medal'), gold, HOURS[levelIndex]);
  $('win-eyebrow').textContent = `${HOURS[levelIndex]} · ${l.name}`;
  $('win-h').textContent = last ? '钟楼又走起来了' : '钟声响了';
  const goldLine = gold
    ? selves === 1 ? '一个人就够了。' : `正好是最少的人数，拿到<b>金齿轮</b>。`
    : `最少只要 <b>${l.par}</b> 个你。再来一次，试试拿金齿轮。`;
  let extra = '';
  const next = LEVELS[levelIndex + 1];
  if (next && next.chapter !== l.chapter) extra = `<br />下一章「${CHAPTERS[next.chapter].name}」：${CHAPTERS[next.chapter].blurb}`;
  if (last) {
    const golds = LEVELS.filter((x) => saved.clears[x.id] && saved.clears[x.id].selves <= x.par).length;
    extra = `<br />十二层都走过了，金齿轮 ${golds} / 12。谢谢你陪这些发条小人走完。`;
  }
  $('win-text').innerHTML = `用了 <b>${selves}</b> 个你，<b>${s.t}</b> 拍。${goldLine}${extra}`;
  $('btn-next').textContent = last ? '回到钟面' : '下一层';
  openOverlay('ov-win');
}

function showSpent(): void {
  const l = game.session.level;
  $('spent-text').innerHTML = l.loops === 1
    ? `${l.ticks} 拍走完了，还没走到钟面。撤销几步换条路，或者从头再来。`
    : `${l.loops} 次上弦都用完了，没有人走到钟面。撤销几步换个走法，或者从头再来。`;
  openOverlay('ov-spent');
}

function drawMedalInto(host: HTMLElement, gold: boolean, label: string): void {
  host.innerHTML = '';
  const c = document.createElement('canvas');
  host.appendChild(c);
  drawMedal(c, gold, label);
}

// ---------- reference solution demo ----------

function startDemo(): void {
  const l = game.session.level;
  closeOverlays();
  game.load(l);
  winShownFor = -1;
  const queue: string[] = [];
  for (const loop of l.solution) {
    const { dirs, endEarly } = parseInputs(loop);
    for (const d of dirs) queue.push(String(d));
    if (endEarly) queue.push('|');
  }
  demoMode = { queue, timer: 0 };
  setBanner('demo');
  refreshHud();
  const run = () => {
    if (!demoMode) return;
    if (game.busy) { demoMode.timer = window.setTimeout(run, 60); return; }
    const next = demoMode.queue.shift();
    if (next === undefined || game.session.status !== 'play') return;
    const r = next === '|' ? game.endLoop() : game.move(Number(next) as Dir);
    if (r.ok) { announce(r); refreshHud(); }
    demoMode.timer = window.setTimeout(run, 380);
  };
  demoMode.timer = window.setTimeout(run, 600);
}

function stopDemo(): void {
  if (!demoMode) return;
  window.clearTimeout(demoMode.timer);
  demoMode = null;
  if (bannerMode === 'demo') setBanner('hidden');
}

function finishDemo(): void {
  const l = game.session.level;
  if (demoMode) { window.clearTimeout(demoMode.timer); demoMode = null; }
  saved.watched[l.id] = true;
  store.save(saved);
  setBanner('demo-done');
}

// ================= overlays =================

let lastFocus: HTMLElement | null = null;
function openOverlay(id: string): void {
  closeOverlays();
  lastFocus = document.activeElement as HTMLElement | null;
  const ov = $(id);
  ov.hidden = false;
  requestAnimationFrame(() => ov.querySelector<HTMLElement>('.btn.primary, button')?.focus());
}
function closeOverlays(): void {
  document.querySelectorAll<HTMLElement>('.overlay').forEach((o) => (o.hidden = true));
  $('reset-confirm').hidden = true;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  lastFocus = null;
}
function overlaysClosed(): boolean {
  return [...document.querySelectorAll<HTMLElement>('.overlay')].every((o) => o.hidden);
}

let legendBuilt = false;
function openHelp(): void {
  if (!legendBuilt) {
    legendBuilt = true;
    const items: [IconKind, string][] = [
      ['you', '现在的你。铜色，头顶的发条随拍数转动。'],
      ['echo', '回响：上一轮的你，青色，标着罗马数字。路线变了会变成粉色。'],
      ['plate', '圆盘：有人或木箱压着时，同色的门打开。'],
      ['door', '门：同色圆盘被压住时打开。有人站在门里，门就关不上。'],
      ['inverse', '反向门（空心）：平时开着，同色圆盘被压住时关上。'],
      ['crate', '木箱：只能推，不能拉。巡逻机过不去。'],
      ['sentry', '巡逻机：每拍走一格，撞墙掉头，抓住一个人后停下。'],
      ['exit', '钟面：任何一个你走到这里，就过关。'],
    ];
    const ul = $('legend');
    for (const [kind, text] of items) {
      const li = document.createElement('li');
      const c = document.createElement('canvas');
      c.setAttribute('aria-hidden', 'true');
      li.appendChild(c);
      const span = document.createElement('span');
      span.textContent = text;
      li.appendChild(span);
      ul.appendChild(li);
      drawIcon(c, kind);
    }
  }
  openOverlay('ov-help');
}

function openSettings(): void {
  ($('set-sfx') as HTMLInputElement).checked = saved.sfx;
  ($('set-music') as HTMLInputElement).checked = saved.music;
  ($('set-reduced') as HTMLInputElement).checked = isReduced();
  openOverlay('ov-settings');
}

function applyReduced(): void {
  const r = isReduced();
  document.documentElement.classList.toggle('reduced', r);
  game.reduced = r;
  demo.reduced = r;
  bg.reduced = r;
}

// ================= input wiring =================

document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!el) return;
  sfx.unlock();
  // A pointer click should not leave focus on the button, or the next Space/Enter would press it again.
  if ((e as MouseEvent).detail > 0 && el.closest('#screen-play')) el.blur();
  const a = el.dataset.action!;
  switch (a) {
    case 'continue': startLevel(nextUnsolved()); break;
    case 'levels': stopDemo(); show('levels'); break;
    case 'title': show('title'); break;
    case 'howto': openHelp(); break;
    case 'help': openHelp(); break;
    case 'settings': openSettings(); break;
    case 'close': closeOverlays(); break;
    case 'enter': if (isUnlocked(selected)) startLevel(selected); break;
    case 'undo': closeOverlays(); stopDemo(); if (game.undo()) { refreshHud(); live('撤销'); } break;
    case 'wait': act('move', 0); break;
    case 'end': act('end'); break;
    case 'restart': closeOverlays(); stopDemo(); game.restart(); winShownFor = -1; refreshHud(); live('从头再来'); break;
    case 'tip': closeOverlays(); setBanner('tip'); break;
    case 'demo': startDemo(); break;
    case 'dismiss': setBanner('hidden'); break;
    case 'next': closeOverlays(); if (levelIndex < LEVELS.length - 1) startLevel(levelIndex + 1); else show('levels'); break;
    case 'again': closeOverlays(); startLevel(levelIndex); break;
    case 'reset-ask': $('reset-confirm').hidden = false; break;
    case 'reset-cancel': $('reset-confirm').hidden = true; break;
    case 'reset-do': saved = store.reset(saved); $('reset-confirm').hidden = true; toast('进度已清除', 'info'); refreshTitle(); break;
  }
});

document.querySelectorAll<HTMLElement>('.pad').forEach((p) => {
  p.addEventListener('pointerdown', (e) => { e.preventDefault(); act('move', Number(p.dataset.dir) as Dir); });
  p.addEventListener('click', (e) => e.preventDefault());
});

$('set-sfx').addEventListener('change', (e) => { saved.sfx = (e.target as HTMLInputElement).checked; sfx.setSfx(saved.sfx); store.save(saved); });
$('set-music').addEventListener('change', (e) => { saved.music = (e.target as HTMLInputElement).checked; sfx.unlock(); sfx.setMusic(saved.music); store.save(saved); });
$('set-reduced').addEventListener('change', (e) => { saved.reduced = (e.target as HTMLInputElement).checked; store.save(saved); applyReduced(); });

document.querySelectorAll<HTMLElement>('.overlay').forEach((ov) => ov.addEventListener('click', (e) => {
  if (e.target === ov && ov.id !== 'ov-win') closeOverlays();
}));

const KEY_DIR: Record<string, Dir> = {
  ArrowUp: 1, ArrowRight: 2, ArrowDown: 3, ArrowLeft: 4, KeyW: 1, KeyD: 2, KeyS: 3, KeyA: 4,
};

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.code !== 'KeyZ' || e.metaKey || e.altKey) return;
  const screen = app.dataset.screen;
  const target = e.target as HTMLElement;
  if (target.tagName === 'INPUT') return;
  if (!overlaysClosed()) {
    if (e.key === 'Escape') { closeOverlays(); e.preventDefault(); }
    else if (!$('ov-spent').hidden && (e.code === 'KeyZ' || e.code === 'Backspace')) { closeOverlays(); if (game.undo()) refreshHud(); e.preventDefault(); }
    else if (!$('ov-spent').hidden && e.code === 'KeyR') { closeOverlays(); game.restart(); winShownFor = -1; refreshHud(); e.preventDefault(); }
    return;
  }
  if (screen === 'levels') {
    if (e.key === 'Escape') { show('title'); return; }
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (delta) {
      e.preventDefault();
      $('dial').dataset.touched = '1';
      selectHour((selected + delta + LEVELS.length) % LEVELS.length);
      document.querySelectorAll<HTMLElement>('.hour')[selected]?.focus();
      sfx.ui();
    }
    return;
  }
  if (screen === 'title') {
    if (e.key === 'Enter' && target === document.body) { sfx.unlock(); startLevel(nextUnsolved()); }
    return;
  }
  if (screen !== 'play') return;
  if (e.key === 'Escape') { stopDemo(); show('levels'); return; }
  const d = KEY_DIR[e.code];
  if (d !== undefined) {
    e.preventDefault();
    if (e.repeat && game.busy) return;
    act('move', d);
    flashPad(d);
    return;
  }
  if (e.code === 'Space' || e.key === '.') { e.preventDefault(); if (!e.repeat) { act('move', 0); flashPad(0); } return; }
  if (e.key === 'Enter' && target.tagName !== 'BUTTON') { e.preventDefault(); act('end'); return; }
  if (e.code === 'KeyE' || e.code === 'KeyQ') { act('end'); return; }
  if (e.code === 'KeyZ' || e.code === 'Backspace' || e.code === 'KeyU') {
    e.preventDefault();
    sfx.unlock();
    stopDemo();
    if (game.undo()) { refreshHud(); live('撤销'); } else sfx.refuse();
    return;
  }
  if (e.code === 'KeyR') { stopDemo(); game.restart(); winShownFor = -1; refreshHud(); live('从头再来'); return; }
  if (e.code === 'KeyH') { setBanner(bannerMode === 'tip' ? 'hidden' : 'tip'); return; }
  if (e.key === '?' || e.code === 'Slash') { openHelp(); }
});

function flashPad(d: Dir): void {
  const p = document.querySelector<HTMLElement>(`.pad[data-dir="${d}"]`);
  if (!p) return;
  p.classList.add('hit');
  window.setTimeout(() => p.classList.remove('hit'), 120);
}

// Swipe on the board: each 30px of drag is one step, so you can walk by sliding.
{
  const stage = $('stage');
  let sx = 0, sy = 0, active = false;
  stage.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('.banner')) return;
    active = true; sx = e.clientX; sy = e.clientY;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!active) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    const th = Math.max(26, game.view.S * 0.6);
    if (Math.max(Math.abs(dx), Math.abs(dy)) < th) return;
    const d: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 2 : 4) : dy > 0 ? 3 : 1;
    sx = e.clientX; sy = e.clientY;
    if (game.busy && game.rewinding) return;
    act('move', d);
  });
  const end = () => { active = false; };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
}

// Timeline: hover (or hold) a tick to preview the board at that moment;
// hover a row's label to pick out that self.
{
  const tl = $('timeline');
  let holdTimer = 0;
  const setPreview = (col: number | null) => {
    const s = game.session;
    if (col === null || s.status !== 'play' || game.busy) {
      game.preview = null;
      $('preview-tag').classList.remove('show');
      tl.querySelectorAll('.col-hover').forEach((n) => n.classList.remove('col-hover'));
      return;
    }
    game.preview = col;
    const tag = $('preview-tag');
    tag.textContent = col <= s.t ? `回看 · 第 ${col} 拍` : `预览 · 第 ${col} 拍（你原地不动时）`;
    tag.classList.add('show');
    tl.querySelectorAll('.col-hover').forEach((n) => n.classList.remove('col-hover'));
    tl.querySelectorAll(`[data-col="${col}"]`).forEach((n) => n.classList.add('col-hover'));
  };
  tl.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-col],[data-row]');
    if (el?.dataset.col) setPreview(Number(el.dataset.col)); else setPreview(null);
    game.focus = el && el.classList.contains('tl-label') && el.dataset.row ? Number(el.dataset.row) : -1;
  });
  tl.addEventListener('pointerleave', () => { setPreview(null); game.focus = -1; });
  tl.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-col]');
    if (!el) return;
    holdTimer = window.setTimeout(() => setPreview(Number(el.dataset.col)), 220);
  });
  const up = () => { window.clearTimeout(holdTimer); if (game.preview !== null) setPreview(null); };
  tl.addEventListener('pointerup', up);
  tl.addEventListener('pointercancel', up);
}

// ================= misc =================

let toastTimer = 0;
function toast(text: string, kind: 'warn' | 'info'): void {
  const t = $('toast');
  t.textContent = text;
  t.className = `toast show${kind === 'info' ? ' info' : ''}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 2600);
}

let liveTimer = 0;
function live(text: string): void {
  window.clearTimeout(liveTimer);
  liveTimer = window.setTimeout(() => { $('live').textContent = text; }, 60);
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function safeGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k: string, v: string): void { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

let resizeTimer = 0;
window.addEventListener('resize', () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    bg.resize();
    if (app.dataset.screen === 'play') { fitBoard(); renderTimeline(); }
    if (app.dataset.screen === 'title') fitDemo();
  }, 80);
});
reducedQuery.addEventListener?.('change', applyReduced);

function frame(now: number): void {
  bg.draw(now);
  if (app.dataset.screen === 'play') game.draw(now);
  else if (app.dataset.screen === 'title') { tickDemo(now); demo.draw(now); }
  requestAnimationFrame(frame);
}

// Debug and test hook (used by tools/shots.mjs).
(window as unknown as { __ce: unknown }).__ce = {
  state: () => ({ screen: app.dataset.screen, level: LEVELS[levelIndex].id, t: game.session.t, present: game.session.present, status: game.session.status, busy: game.busy }),
  start: (i: number) => startLevel(i),
  levels: LEVELS.map((l: LevelDef) => l.id),
  solutions: LEVELS.map((l: LevelDef) => l.solution),
  /** Offline loudness check of every sound (tools/shots.mjs). */
  audio: async () => {
    const out: Record<string, unknown> = {};
    const cases: [string, (s: Sfx) => void][] = [
      ['tick', (s) => s.tick()], ['bump', (s) => s.bump()], ['push', (s) => s.push()],
      ['plate', (s) => s.plate(true, 0)], ['door', (s) => s.door(true, 1)], ['caught', (s) => s.caught(true)],
      ['rewind', (s) => s.rewind(1)], ['windUp', (s) => s.windUp()], ['win', (s) => s.win()],
    ];
    for (const [name, fn] of cases) out[name] = await Sfx.measure(fn, name === 'win' ? 4 : 1.5);
    return out;
  },
};

show('title');
requestAnimationFrame(frame);
