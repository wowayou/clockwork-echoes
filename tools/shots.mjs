// Drives the production build in headless Chromium over CDP (no npm deps):
// real key presses on desktop, real taps on the phone D-pad, through several
// levels including rewinds, a past self changing course, the win card, help
// and settings; screenshots at each step; fails on console errors.
// Usage: npm run build && [BASE=https://…/] node tools/shots.mjs <outDir>
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const out = process.argv[2] ?? 'shots';
mkdirSync(out, { recursive: true });
const CHROME = process.env.CHROME ?? `${homedir()}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = process.env.BASE ?? 'http://localhost:4199/';
const server = process.env.BASE ? null : spawn('npx', ['vite', 'preview', '--port', '4199', '--strictPort'], { stdio: 'ignore', detached: true });
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--remote-debugging-port=9344', '--user-data-dir=/tmp/ce-chrome-' + process.pid, '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore', detached: true });
const failures = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures.push(msg); };

const KEYS = {
  U: ['ArrowUp', 38], D: ['ArrowDown', 40], L: ['ArrowLeft', 37], R: ['ArrowRight', 39],
  W: [' ', 32, 'Space'], Enter: ['Enter', 13], z: ['z', 90, 'KeyZ'], Escape: ['Escape', 27],
};

try {
  let targets;
  for (let k = 0; k < 60; k++) {
    try { targets = await (await fetch('http://127.0.0.1:9344/json/list')).json(); if (targets.length) break; } catch {}
    await sleep(200);
  }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? 'exception');
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(JSON.stringify(msg.params.args.map((a) => a.value)));
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const state = () => evaluate('__ce.state()');
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${out}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
  const tap = async ([x, y], mobile) => {
    if (mobile) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await sleep(30);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    }
  };
  const center = (sel) => evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden'); if (!el) return null; const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  const press = async (sel, mobile = false) => {
    const c = await center(sel);
    if (!c) throw new Error(`no visible ${sel}`);
    await tap(c, mobile);
    await sleep(200);
  };
  const key = async (k) => {
    const [keyName, code, codeName] = KEYS[k];
    const c = codeName ?? keyName;
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code: c, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code: c, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  };
  const waitFor = async (expr, ms = 15000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(80)) if (await evaluate(expr)) return true;
    return false;
  };
  const idle = () => waitFor('!__ce.state().busy', 8000);
  const PAD = { U: '.pad.up', D: '.pad.down', L: '.pad.left', R: '.pad.right', W: '.pad.wait' };
  /** Play a solution string: keys on desktop, D-pad taps on the phone. `|` ends the loop. */
  const play = async (str, mobile) => {
    for (const ch of str) {
      if (ch === '|') {
        if (mobile) await press('#btn-end', true); else await key('Enter');
        await idle();
        continue;
      }
      if (mobile) { const c = await center(PAD[ch]); await tap(c, true); } else await key(ch);
      await sleep(40);
      await idle();
    }
  };
  const visible = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return !!el && !el.hidden && el.getClientRects().length > 0; })()`);
  const noHScroll = () => evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1');

  await send('Runtime.enable');
  await send('Page.enable');

  for (const [label, w, h, mobile] of [['phone', 390, 844, true], ['desktop', 1280, 800, false]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 0 });
    await send('Page.navigate', { url: BASE });
    await sleep(700);
    await evaluate('localStorage.clear()');
    await send('Page.reload');
    await sleep(3200);
    await shot(`${label}-01-title`);
    check(await noHScroll(), `${label}: title has no horizontal scroll`);

    await press('[data-action=levels]', mobile);
    await sleep(500);
    await shot(`${label}-02-dial`);
    check((await state()).screen === 'levels', `${label}: dial opens`);
    const locked = await evaluate(`document.querySelectorAll('.hour.locked').length`);
    check(locked === 11, `${label}: only the first floor is open on a fresh save (${locked} locked)`);
    check(await noHScroll(), `${label}: dial has no horizontal scroll`);

    await press('#dc-enter', mobile);
    await sleep(500);
    let s = await state();
    check(s.screen === 'play' && s.level === 'wind', `${label}: enter starts level I`);
    await shot(`${label}-03-wind-intro`);
    check(await noHScroll(), `${label}: play screen has no horizontal scroll`);
    const fits = await evaluate(`(() => { const c = document.getElementById('board').getBoundingClientRect(); const st = document.getElementById('stage').getBoundingClientRect(); return c.width <= st.width + 1 && c.height <= st.height + 1 && c.width > 150; })()`);
    check(fits, `${label}: board fits its stage`);

    await play('DDRRR', mobile);
    s = await state();
    check(s.t === 5, `${label}: five real inputs = tick 5 (t=${s.t})`);
    await play('UURRDD', mobile);
    check(await waitFor(`!document.getElementById('ov-win').hidden`, 4000), `${label}: winning level I shows the card`);
    await sleep(500);
    await shot(`${label}-04-win`);
    await press('#btn-next', mobile);
    await sleep(400);

    // ---- level II: hold the plate, end the loop, rewind, second self walks through
    s = await state();
    check(s.level === 'echo', `${label}: next goes to level II`);
    await play('UU', mobile);
    const pulsing = await evaluate(`document.getElementById('btn-end').classList.contains('pulse')`);
    check(pulsing, `${label}: standing on the plate in II highlights 收束`);
    if (mobile) await press('#btn-end', true); else await key('Enter');
    await sleep(mobile ? 520 : 480);
    await shot(`${label}-05-rewinding`);
    await idle();
    s = await state();
    check(s.present === 1 && s.t === 0, `${label}: after the rewind a second self starts at tick 0`);
    await sleep(300);
    await shot(`${label}-06-echo-second-loop`);
    const coach = await evaluate(`document.getElementById('banner-text').textContent`);
    check(/时间倒流/.test(coach), `${label}: first rewind explains itself ("${coach.slice(0, 18)}…")`);
    await play('UURRRR', mobile);
    check(await waitFor(`!document.getElementById('ov-win').hidden`, 4000), `${label}: level II won with two selves`);
    await press('#btn-next', mobile);
    await sleep(300);

    // ---- level V (推门): a past self walks through a door opened later
    await evaluate('__ce.start(4)');
    await sleep(400);
    await play('LLWRRRRRR', mobile);
    s = await state();
    check(s.present === 1, `${label}: V loop 1 ran out of ticks and rewound`);
    await play('LDDDD', mobile);
    await sleep(200);
    const drift = await evaluate(`document.querySelectorAll('.tl-label.drift').length`);
    check(drift === 1, `${label}: standing on the blue plate bends the past self's path (drift label shown)`);
    await shot(`${label}-07-push-drift`);
    if (mobile) await press('#btn-end', true); else await key('Enter');
    check(await waitFor(`!document.getElementById('ov-win').hidden`, 5000), `${label}: the past self reaches the exit and wins V`);
    await sleep(400);
    await shot(`${label}-08-push-win`);
    await press('[data-action=again]', mobile);
    await sleep(300);

    // ---- level XI (掩护): sentry forecast and a caught self
    await evaluate('__ce.start(10)');
    await sleep(500);
    await play('WWW', mobile);
    await shot(`${label}-09-cover-sentry`);
    await play('DDW', mobile);
    s = await state();
    check(s.present === 1, `${label}: getting caught ends the loop and rewinds (present=${s.present})`);
    await sleep(200);
    await shot(`${label}-10-cover-after-catch`);

    if (!mobile) {
      const cell = await center('.tl-num[data-col="6"]');
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cell[0], y: cell[1] + 30 });
      await sleep(250);
      check(await evaluate(`document.getElementById('preview-tag').classList.contains('show')`), `${label}: hovering a tick previews it`);
      await shot(`${label}-11-preview`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
      await sleep(150);
    }

    // ---- undo across the loop boundary
    await (mobile ? press('#btn-undo', true) : key('z'));
    await idle();
    s = await state();
    check(s.present === 0, `${label}: undo steps back into the previous loop (present=${s.present}, t=${s.t})`);

    await press('[data-action=help]', mobile);
    await sleep(400);
    check(await visible('#ov-help'), `${label}: help opens`);
    await shot(`${label}-12-help`);
    await (mobile ? press('#ov-help .btn.primary', true) : key('Escape'));
    await sleep(200);
    await press('#screen-play [data-action=settings]', mobile);
    await sleep(300);
    await shot(`${label}-13-settings`);
    await press('#ov-settings .btn.primary', mobile);

    // ---- reference demo plays and unlocks
    await evaluate('__ce.start(2)');
    await sleep(300);
    await evaluate(`document.querySelector('[data-action=tip]').click()`);
    await sleep(200);
    await press('#btn-demo', mobile);
    check(await waitFor(`/演示结束/.test(document.getElementById('banner-text').textContent)`, 20000), `${label}: the reference demo of III plays to a win`);
    await shot(`${label}-14-demo-done`);
    check(await evaluate(`JSON.parse(localStorage.getItem('clockwork-echoes:v1')).watched.three === true`), `${label}: watching the demo is saved`);

    await key('Escape');
    await sleep(500);
    await shot(`${label}-15-dial-progress`);
    const golds = await evaluate(`document.querySelectorAll('.hour.gold').length`);
    check(golds >= 3, `${label}: dial shows gold gears for cleared floors (${golds})`);
    if (!mobile) {
      // Every floor, start to finish, through real key presses.
      const sols = await evaluate('__ce.solutions');
      for (let i = 0; i < sols.length; i++) {
        await evaluate(`__ce.start(${i})`);
        await sleep(250);
        for (const loop of sols[i]) await play(loop, false);
        const won = await waitFor(`!document.getElementById('ov-win').hidden`, 5000);
        const st = await state();
        check(won && st.status === 'won', `desktop: floor ${i + 1} (${st.level}) won by its reference solution through the UI`);
        if (i === sols.length - 1) {
          await sleep(500);
          await shot(`${label}-16-finale-win`);
          check(/钟楼又走起来了/.test(await evaluate(`document.getElementById('win-h').textContent`)), 'desktop: the last floor shows the ending');
        }
        await key('Escape');
        await sleep(150);
      }
      await press('[data-action=levels]');
      await sleep(600);
      await shot(`${label}-17-dial-complete`);
      check(await evaluate(`document.querySelectorAll('.hour.gold').length`) === 12, 'desktop: all twelve gold gears on the dial');
    }
    check(errors.length === 0, `${label}: no console errors (${errors.join(' | ')})`);
    errors.length = 0;
  }
} catch (e) {
  failures.push(String(e?.stack ?? e));
  console.log('ERROR', e);
} finally {
  try { process.kill(-chrome.pid); } catch {}
  if (server) try { process.kill(-server.pid); } catch {}
}
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASS');
process.exit(failures.length ? 1 : 0);
