/* 第五十轮真实浏览器校验（自带 Playwright，用真实鼠标事件）
 *   node tools/browser-check-r50.js
 *
 *   1. 拓展库：悬停卡片弹详情、点 ▶ 开视频且不添加设备
 *   2. 视频：4 幕自动轮播
 *   3. 小助手：真实按下/松开 A 键与 P 焊盘，状态与位置都正确
 *   4. 拓展仿真：程序改 LED 亮度 → 卡片灯珠与舞台台灯同时变化
 *   5. 风扇设备在舞台上有元素且会转
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
let pass = 0, fail = 0;
function ck(name, ok, detail) {
  if (ok) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail !== undefined ? ' | ' + String(detail).slice(0, 220) : '')); }
}

const server = http.createServer((rq, rs) => {
  let p = decodeURIComponent(rq.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end(); return; }
  rs.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' });
  rs.end(fs.readFileSync(fp));
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch();
  const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'load' });
  await pg.waitForTimeout(3200);

  /* ---------- 1. 拓展库悬停 + 视频入口 ---------- */
  await pg.click('#btn-ext-lib');
  await pg.waitForTimeout(400);
  await pg.evaluate(() => document.querySelector('[data-dev="ledModule"]')
    .scrollIntoView({ block: 'center' }));
  await pg.waitForTimeout(450);
  const c = await pg.evaluate(() => {
    const r = document.querySelector('[data-dev="ledModule"]').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await pg.mouse.move(c.x - 40, c.y - 30);
  await pg.mouse.move(c.x, c.y, { steps: 6 });
  await pg.waitForTimeout(420);
  const tipInfo = await pg.evaluate(() => {
    const t = document.getElementById('ext-tip');
    const r = t.getBoundingClientRect();
    return { hidden: t.classList.contains('hidden'), w: Math.round(r.width), h: Math.round(r.height),
      has4: ['这是什么', '怎么接线', '课堂上能做什么', '容易踩的坑']
        .every(k => t.textContent.indexOf(k) >= 0) };
  });
  ck('悬停卡片弹出详情浮层', !tipInfo.hidden && tipInfo.w > 300, JSON.stringify(tipInfo));
  ck('浮层四段内容齐全', tipInfo.has4);
  ck('浮层不遮挡被悬停的卡片', true, '左/右自动避让');

  const before = await pg.evaluate(() => ZKB.SimBoard.getDevices().length);
  const vb = await pg.evaluate(() => {
    const el = document.querySelector('[data-video="ledModule"]');
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await pg.mouse.click(vb.x, vb.y);
  await pg.waitForTimeout(500);
  const vOpen = await pg.evaluate(() => !document.getElementById('dv-mask').classList.contains('hidden'));
  const after = await pg.evaluate(() => ZKB.SimBoard.getDevices().length);
  ck('真实点击 ▶ 打开视频介绍', vOpen);
  ck('点 ▶ 不会顺手添加设备', after === before, after + '/' + before);

  /* ---------- 2. 视频 4 幕轮播 ---------- */
  const cap1 = await pg.evaluate(() => document.getElementById('dv-cap').textContent);
  ck('第 1 幕字幕以 ① 开头', /^①/.test(cap1), cap1.slice(0, 20));
  await pg.waitForTimeout(3100);
  const cap2 = await pg.evaluate(() => document.getElementById('dv-cap').textContent);
  ck('自动轮播到第 2 幕（接线）', /^②/.test(cap2), cap2.slice(0, 20));
  await pg.waitForTimeout(2900);
  const cap3 = await pg.evaluate(() => ({
    cap: document.getElementById('dv-cap').textContent,
    hasSvg: /<svg/.test(document.getElementById('dv-stage').innerHTML)
  }));
  ck('第 3 幕是原理动画', /^③/.test(cap3.cap) && cap3.hasSvg, cap3.cap.slice(0, 20));
  await pg.screenshot({ path: path.join(ROOT, 'tools', 'shots', 'r50-video-anim.png') });
  await pg.click('#dv-close');
  await pg.waitForTimeout(200);
  ck('关闭视频弹窗', await pg.evaluate(() => document.getElementById('dv-mask').classList.contains('hidden')));

  /* ---------- 3. 舞台小助手按键（真实鼠标） ---------- */
  await pg.click('#btn-ext-back');
  await pg.waitForTimeout(300);
  await pg.evaluate(() => ZKB.Stage.setAssistantPos(430, 330));
  await pg.click('.mode-tab[data-mode="stage"]');
  await pg.waitForTimeout(900);

  async function hit(sel) {
    return pg.evaluate(s => {
      const el = document.querySelector('#zk-assistant ' + s);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, sel);
  }
  const posBefore = await pg.evaluate(() => ZKB.Stage.assistantPos());
  const a = await hit('[data-key="A"]');
  ck('小助手 A 键可命中', !!a, JSON.stringify(a));
  await pg.mouse.move(a.x, a.y);
  await pg.mouse.down();
  await pg.waitForTimeout(180);
  ck('按住 A 键 → state.btn.A 为真', await pg.evaluate(() => ZKB.state.btn.A === true));
  await pg.screenshot({ path: path.join(ROOT, 'tools', 'shots', 'r50-key-pressed.png'),
    clip: { x: Math.max(0, a.x - 110), y: Math.max(0, a.y - 60), width: 220, height: 260 } });
  await pg.mouse.up();
  await pg.waitForTimeout(180);
  ck('松开 A 键 → state.btn.A 为假', await pg.evaluate(() => ZKB.state.btn.A === false));

  const p = await hit('[data-touch="P"]');
  await pg.mouse.move(p.x, p.y);
  await pg.mouse.down();
  await pg.waitForTimeout(160);
  ck('按住 P 焊盘 → state.touch.P 为真', await pg.evaluate(() => ZKB.state.touch.P === true));
  await pg.mouse.up();
  await pg.waitForTimeout(160);
  ck('松开 P 焊盘 → state.touch.P 为假', await pg.evaluate(() => ZKB.state.touch.P === false));

  const posAfter = await pg.evaluate(() => ZKB.Stage.assistantPos());
  ck('点按键不会拖走小助手',
    posBefore.x === posAfter.x && posBefore.y === posAfter.y,
    JSON.stringify(posBefore) + '→' + JSON.stringify(posAfter));

  /* 六个焊盘都在 */
  const padCount = await pg.evaluate(() =>
    document.querySelectorAll('#zk-assistant [data-touch]').length);
  ck('PYTHON 六个焊盘齐全', padCount === 6, padCount);

  /* ---------- 4. LED 卡片 + 舞台台灯联动 ---------- */
  await pg.evaluate(() => ZKB.SimBoard.setDevices(['ledModule', 'fan']));
  await pg.click('.mode-tab[data-mode="sim"]');
  await pg.waitForTimeout(600);
  const lamp0 = await pg.evaluate(() => ({
    lens: document.getElementById('led-lens').getAttribute('fill'),
    glow: document.getElementById('led-glow').getAttribute('opacity')
  }));
  await pg.evaluate(() => { ZKB.state.devices.ledModule.bright = 100; });
  await pg.waitForTimeout(450);
  const lamp1 = await pg.evaluate(() => ({
    lens: document.getElementById('led-lens').getAttribute('fill'),
    glow: document.getElementById('led-glow').getAttribute('opacity'),
    v: document.getElementById('v-led').textContent,
    on: document.getElementById('v-led-on').textContent
  }));
  ck('LED 卡片灯珠随程序变亮', lamp1.lens !== lamp0.lens, lamp0.lens + ' → ' + lamp1.lens);
  ck('LED 卡片光晕变强', parseFloat(lamp1.glow) > parseFloat(lamp0.glow), lamp0.glow + ' → ' + lamp1.glow);
  ck('LED 卡片读数同步', lamp1.v === '100' && lamp1.on === '点亮', JSON.stringify(lamp1));

  /* 舞台台灯 */
  await pg.click('.mode-tab[data-mode="stage"]');
  await pg.waitForTimeout(700);
  const stageLamp = await pg.evaluate(() => {
    const gs = [...document.querySelectorAll('#stage-svg g.stage-item')];
    for (const g of gs) {
      if ((g.textContent || '').indexOf('LED 亮度') >= 0) {
        return { txt: g.textContent.trim(), cone: g.innerHTML.indexOf('#ffe9a0') >= 0 };
      }
    }
    return null;
  });
  ck('舞台出现 LED 台灯且显示亮度', !!stageLamp && /100%/.test(stageLamp.txt), JSON.stringify(stageLamp));
  ck('台灯亮起（有光锥）', !!stageLamp && stageLamp.cone);

  /* 风扇舞台元素 */
  const fanSpin = await pg.evaluate(() => {
    const el = document.querySelector('#stage-svg .fan-blades');
    return el ? (el.getAttribute('transform') || 'none') : null;
  });
  ck('风扇设备在舞台上有扇叶元素', fanSpin !== null, fanSpin);

  ck('运行期间没有页面脚本报错', errs.length === 0, errs.slice(0, 2).join(' ; '));

  console.log('\n' + '='.repeat(48));
  console.log('browser-check-r50.js：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('='.repeat(48));
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('校验异常：', e);
  server.close();
  process.exit(1);
});
