/* 第五十二轮真实浏览器校验（有布局才有意义）
 *   node tools/browser-check-r52.js
 *
 * 验的是"尺寸与对齐"这类 jsdom 量不出来的东西：
 *   · 窄卡片两列等宽、同一行等高
 *   · 宽卡片跨满两列
 *   · 卡片高度落在合理区间（不再出现 240px 的窄条）
 *   · 画面 + 读数真的左右并排（不是叠在一起）
 *   · 卡片内容不横向溢出
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
let pass = 0, fail = 0;
function ck(name, ok, detail) {
  if (ok) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail !== undefined ? ' | ' + String(detail).slice(0, 260) : '')); }
}

const WIDE = ['ledModule', 'relay', 'pir', 'fan', 'angle', 'tracker', 'powerMeter', 'gravity',
  'car', 'rgbStrip', 'traceCar', 'remote', 'weather', 'camera'];
const NARROW = ['dht', 'ultrasonic', 'lightExt', 'soil', 'pm25', 'baro', 'button',
  'irTx', 'irRx', 'mp3', 'motor', 'servo', 'ir', 'heater', 'pump', 'color'];

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
  await pg.waitForTimeout(3000);
  await pg.click('.mode-tab[data-mode="sim"]');
  await pg.waitForTimeout(400);

  await pg.evaluate(list => {
    ZKB.SimBoard.setDevices(list);
  }, NARROW.concat(WIDE).filter((v, i, a) => a.indexOf(v) === i));
  await pg.waitForTimeout(700);

  const m = await pg.evaluate(() => {
    const host = document.getElementById('sim-devices');
    const cols = getComputedStyle(host).gridTemplateColumns.split(' ').map(parseFloat);
    const rect = e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const cards = {};
    host.querySelectorAll('.dev-card').forEach(function (c) {
      const id = c.getAttribute('data-dev');
      const body = c.querySelector('.card-body');
      cards[id] = {
        r: rect(c),
        wide: c.classList.contains('wide'),
        overflow: c.scrollWidth - c.clientWidth,
        bodyOverflow: body ? body.scrollWidth - body.clientWidth : 0
      };
    });
    const led = document.getElementById('card-ledModule');
    const sim = led.querySelector('.led-sim');
    const col = led.querySelector('.ctrl-col');
    return {
      cols: cols, hostW: Math.round(host.getBoundingClientRect().width),
      cards: cards,
      ledSideBySide: !!(sim && col) && rect(col).x >= rect(sim).x + rect(sim).w - 2
    };
  });

  ck('卡片区是两列', m.cols.length === 2, JSON.stringify(m.cols));
  const halfW = m.cols[0];

  /* ---------- 1. 宽度档位 ---------- */
  const wideBad = WIDE.filter(id => m.cards[id] && !m.cards[id].wide);
  ck('宽卡片类名正确', wideBad.length === 0, wideBad.join(' '));
  const narrowBad = NARROW.filter(id => m.cards[id] && m.cards[id].wide);
  ck('窄卡片类名正确', narrowBad.length === 0, narrowBad.join(' '));

  const narrowSizeBad = NARROW.filter(id => m.cards[id] &&
    Math.abs(m.cards[id].r.w - halfW) > 3).map(id => id + '=' + m.cards[id].r.w);
  ck('窄卡片宽度 = 列宽（' + Math.round(halfW) + 'px）', narrowSizeBad.length === 0, narrowSizeBad.join(' '));

  const wideSizeBad = WIDE.filter(id => m.cards[id] &&
    Math.abs(m.cards[id].r.w - m.hostW) > 3).map(id => id + '=' + m.cards[id].r.w);
  ck('宽卡片铺满两列（' + m.hostW + 'px）', wideSizeBad.length === 0, wideSizeBad.join(' '));

  /* ---------- 2. 同一行等高 ---------- */
  /* 按 y 分组：同一行的卡片高度必须一致 */
  const rows = {};
  Object.keys(m.cards).forEach(function (id) {
    const y = m.cards[id].r.y;
    (rows[y] = rows[y] || []).push({ id: id, h: m.cards[id].r.h });
  });
  const rowBad = [];
  Object.keys(rows).forEach(function (y) {
    const hs = rows[y].map(c => c.h);
    if (Math.max.apply(null, hs) - Math.min.apply(null, hs) > 1) {
      rowBad.push('y=' + y + ' → ' + rows[y].map(c => c.id + ':' + c.h).join(', '));
    }
  });
  ck('同一行的卡片等高（差 ≤1px）', rowBad.length === 0, rowBad.slice(0, 3).join(' ; '));

  /* ---------- 3. 高度落在合理区间 ----------
     ⚠ car / weather / camera 是内容型大卡片（地图、天气六宫格、摄像头三面板），
       本来就该高，不能拿执行器卡片的尺度去卡它们，这里分开看。 */
  const HEAVY = ['car', 'weather', 'camera'];
  /* 本轮新增的 8 个执行器宽卡片 */
  const ACT = WIDE.filter(id => HEAVY.indexOf(id) < 0 && id !== 'rgbStrip' && id !== 'traceCar' && id !== 'remote');
  const actHs = ACT.filter(id => m.cards[id]).map(id => m.cards[id].r.h);
  ck('执行器宽卡片高度 ≤ 200（原来 LED 单列 240）',
    Math.max.apply(null, actHs) <= 200,
    ACT.map((id, i) => id + '=' + actHs[i]).join(' '));
  ck('执行器宽卡片高度集中在 130~200',
    Math.min.apply(null, actHs) >= 125,
    'min=' + Math.min.apply(null, actHs));
  const narrowHs = NARROW.filter(id => m.cards[id]).map(id => m.cards[id].r.h);
  ck('窄卡片高度统一', Math.max.apply(null, narrowHs) - Math.min.apply(null, narrowHs) <= 1,
    'min=' + Math.min.apply(null, narrowHs) + ' max=' + Math.max.apply(null, narrowHs));
  const heavyHs = HEAVY.filter(id => m.cards[id]).map(id => id + '=' + m.cards[id].r.h);
  console.log('  窄卡片高 ' + narrowHs[0] + 'px；执行器宽卡 ' + actHs.join('/') +
    '；内容型大卡 ' + heavyHs.join(' '));

  /* ---------- 4. 画面与读数并排 ---------- */
  ck('LED 卡片：画面在左、读数在右（并排而非堆叠）', m.ledSideBySide);

  /* ---------- 5. 不横向溢出 ---------- */
  const of1 = Object.keys(m.cards).filter(id => m.cards[id].overflow > 1).map(id => id + '+' + m.cards[id].overflow);
  ck('卡片本身无横向溢出', of1.length === 0, of1.join(' '));
  const of2 = Object.keys(m.cards).filter(id => m.cards[id].bodyOverflow > 1).map(id => id + '+' + m.cards[id].bodyOverflow);
  ck('卡片内容区无横向溢出', of2.length === 0, of2.join(' '));

  /* ---------- 6. 截图存档 ---------- */
  const H = Math.min(3400, 2700);
  await pg.setViewportSize({ width: 560, height: H });
  await pg.evaluate(() => {
    const h = document.getElementById('sim-devices');
    h.style.position = 'fixed';
    h.style.left = '0'; h.style.top = '0'; h.style.margin = '0';
    h.style.width = '460px'; h.style.background = '#eef3f8';
    h.style.zIndex = '99999'; h.style.overflow = 'visible';
    h.style.padding = '10px'; h.style.paddingBottom = '10px';
    document.body.style.overflow = 'hidden';
  });
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: path.join(ROOT, 'tools/shots/r52-final.png'),
    clip: { x: 0, y: 0, width: 480, height: H } });

  ck('运行期间无页面脚本报错', errs.length === 0, errs.slice(0, 2).join(' ; '));

  console.log('\n' + '='.repeat(48));
  console.log('browser-check-r52.js：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('='.repeat(48));
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('校验异常：', e);
  server.close();
  process.exit(1);
});
