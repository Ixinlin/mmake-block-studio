/* ============================================================
 * make-icon.js —— 由原始 logo 生成「圆角透明 PNG」+「多尺寸 ICO」
 *
 *   node tools/make-icon.js [原始图路径]
 *
 * 产出：
 *   docs/logo/Mmake.png   圆角 + 透明背景（入库，README 与发布页引用它）
 *   dist/Mmake.png        同上，作为打包产物留一份
 *   tools/exe/Mmake.ico   Windows 图标（16/24/32/48/64/128/256 全尺寸）
 *
 * 素材来源：docs/logo/Mmake-source.png（原始方图，入库）
 *
 * 为什么用无头浏览器做图像处理：
 *   本机 pip 装不了 Pillow，但仓库里已有 Playwright + Chromium，
 *   canvas 的 ImageData 足够完成「泛洪去白底 + 圆角遮罩 + 缩放」。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SRC = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'docs', 'logo', 'Mmake-source.png');
const OUT_PNG = path.join(ROOT, 'docs', 'logo', 'Mmake.png');
const OUT_ICO = path.join(ROOT, 'tools', 'exe', 'Mmake.ico');

const MASTER = 512;                    // 圆角 PNG 输出尺寸
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const RADIUS_RATIO = 0.22;             // 圆角半径 = 尺寸 * 22%
const PADDING = 0.07;                  // 内容留白，避免文字贴到圆角边缘

function fail(msg) { console.error('❌ ' + msg); process.exit(1); }

/* --------------------------------------------------- 浏览器内图像处理 */
async function processInBrowser(pngBuf) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<canvas id="c"></canvas>');

  const result = await page.evaluate(async ({ dataUrl, master, sizes, ratio, padding }) => {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res; img.onerror = rej; img.src = dataUrl;
    });

    /* ---- 1. 铺到画布上（居中留白，别让文字贴边） ---- */
    const c = document.getElementById('c');
    c.width = c.height = master;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    const inner = Math.round(master * (1 - padding * 2));
    const off = Math.round(master * padding);
    ctx.drawImage(img, off, off, inner, inner);
    const id = ctx.getImageData(0, 0, master, master);
    const px = id.data;
    const N = master;
    const at = (x, y) => (y * N + x) * 4;

    /* ---- 2. 泛洪去白底：只清掉「与四边相连」的近白像素 ---- */
    // 直接按阈值清会连芯片里的白色字母 "M" 一起吃掉，
    // 所以只从「已经透明的区域」出发做连通扩散，内部白色区域保持不动。
    // 注意不能只从画布四边起种子：logo 居中留白后，四边本身就是透明的，
    // 必须把画布上所有透明像素都当作种子，才能顺着白底扩散进去。
    const WHITE = 244;
    const isWhite = (i) =>
      px[i] >= WHITE && px[i + 1] >= WHITE && px[i + 2] >= WHITE && px[i + 3] > 8;

    // 扩散的可通行条件 = 「已透明」或「近白」；只有这样才能从透明区走进白底。
    // 用两条 Int32Array 当栈（512×512 逐像素，数组套数组会很吃内存）。
    const seen = new Uint8Array(N * N);
    let sp = 0;
    const sx = new Int32Array(N * N + 4);
    const sy = new Int32Array(N * N + 4);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (px[at(x, y) + 3] === 0) {
          const idx = y * N + x;
          seen[idx] = 1;
          sx[sp] = x; sy[sp] = y; sp++;
        }
      }
    }
    while (sp > 0) {
      sp--;
      const x = sx[sp], y = sy[sp];
      const i = at(x, y);
      const transparent = px[i + 3] === 0;
      if (!transparent) {
        if (!isWhite(i)) continue;
        px[i + 3] = 0;                                // 白底 → 透明
      }
      const nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      for (let k = 0; k < 4; k++) {
        const nx = nb[k][0], ny = nb[k][1];
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const nidx = ny * N + nx;
        if (seen[nidx]) continue;
        const ni = nidx * 4;
        if (px[ni + 3] !== 0 && !isWhite(ni)) continue;   // 撞到实体图形，止步
        seen[nidx] = 1;
        sx[sp] = nx; sy[sp] = ny; sp++;
      }
    }

    /* ---- 3. 去白边：给「挨着透明区」的浅色像素压 alpha，去掉一圈白晕 ---- */
    const FRINGE = 3;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = at(x, y);
        if (px[i + 3] === 0) continue;
        let nearTransparent = false;
        for (let dy = -FRINGE; dy <= FRINGE && !nearTransparent; dy++) {
          for (let dx = -FRINGE; dx <= FRINGE; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
            if (px[at(nx, ny) + 3] === 0) { nearTransparent = true; break; }
          }
        }
        if (!nearTransparent) continue;
        const mn = Math.min(px[i], px[i + 1], px[i + 2]);
        if (mn > 200) {
          const k = Math.max(0, Math.min(1, (255 - mn) / 40));   // 越白越透明
          px[i + 3] = Math.round(px[i + 3] * k);
        }
      }
    }

    /* ---- 4. 圆角遮罩 ---- */
    const r = master * ratio;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        // 判断当前像素是否落在圆角外的角落里
        const dx = Math.min(x, N - 1 - x), dy = Math.min(y, N - 1 - y);
        let inside = true;
        if (dx < r && dy < r) {
          const cx = r, cy = r;
          const dist = Math.hypot(cx - dx, cy - dy);
          inside = dist <= r;
        }
        if (!inside) { px[at(x, y) + 3] = 0; continue; }
      }
    }
    ctx.putImageData(id, 0, 0);

    /* ---- 5. 导出主图与各尺寸 ---- */
    const out = { master: c.toDataURL('image/png') };
    for (const s of sizes) {
      const t = document.createElement('canvas');
      t.width = t.height = s;
      const tc = t.getContext('2d');
      tc.imageSmoothingEnabled = true;
      tc.imageSmoothingQuality = 'high';
      tc.drawImage(c, 0, 0, s, s);
      out[s] = t.toDataURL('image/png');
    }

    /* ---- 6. 灰底预览图（便于肉眼确认透明区与圆角） ---- */
    const pv = document.createElement('canvas');
    pv.width = pv.height = master;
    const pc = pv.getContext('2d');
    pc.fillStyle = '#c9ced6';
    pc.fillRect(0, 0, master, master);
    pc.drawImage(c, 0, 0);
    out.preview = pv.toDataURL('image/png');
    return out;
  }, {
    dataUrl: 'data:image/png;base64,' + pngBuf.toString('base64'),
    master: MASTER, sizes: ICO_SIZES, ratio: RADIUS_RATIO, padding: PADDING,
  });

  await browser.close();
  return result;
}

/* ------------------------------------------------------------ 拼 ICO */
function buildIco(entries) {
  // ICONDIR(6) + ICONDIRENTRY(16*n) + 各尺寸 PNG 数据
  // Windows Vista 起支持直接内嵌 PNG，无需 BMP + AND 掩码
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);                 // reserved
  head.writeUInt16LE(1, 2);                 // type: 1 = icon
  head.writeUInt16LE(entries.length, 4);    // count

  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir[o] = e.size >= 256 ? 0 : e.size;      // 宽（256 记作 0）
    dir[o + 1] = e.size >= 256 ? 0 : e.size;  // 高
    dir[o + 2] = 0;                           // 调色板色数
    dir[o + 3] = 0;                           // reserved
    dir.writeUInt16LE(1, o + 4);              // color planes
    dir.writeUInt16LE(32, o + 6);             // bpp
    dir.writeUInt32LE(e.buf.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.buf.length;
  });

  return Buffer.concat([head, dir].concat(entries.map((e) => e.buf)));
}

(async () => {
  if (!fs.existsSync(SRC)) fail('找不到原始 logo：' + SRC);
  console.log('① 原始 logo：' + path.relative(ROOT, SRC));

  console.log('② 圆角 / 去白底 / 生成各尺寸 …');
  const out = await processInBrowser(fs.readFileSync(SRC));
  const toBuf = (d) => Buffer.from(d.slice(d.indexOf(',') + 1), 'base64');

  fs.mkdirSync(path.dirname(OUT_PNG), { recursive: true });
  fs.writeFileSync(OUT_PNG, toBuf(out.master));
  console.log('   ✅ docs/logo/Mmake.png（' + MASTER + '×' + MASTER + '，圆角透明）');

  // 打包产物目录里也放一份，方便直接拿去用
  const distPng = path.join(ROOT, 'dist', 'Mmake.png');
  fs.mkdirSync(path.dirname(distPng), { recursive: true });
  fs.writeFileSync(distPng, toBuf(out.master));
  console.log('   ✅ dist/Mmake.png（同上，产物副本）');

  const ico = buildIco(ICO_SIZES.map((s) => ({ size: s, buf: toBuf(out[s]) })));
  fs.mkdirSync(path.dirname(OUT_ICO), { recursive: true });
  fs.writeFileSync(OUT_ICO, ico);
  console.log('   ✅ tools/exe/Mmake.ico（' + ICO_SIZES.join('/') + '，'
    + (ico.length / 1024).toFixed(0) + ' KB）');

  const preview = path.join(ROOT, 'build', 'logo-preview.png');
  fs.mkdirSync(path.dirname(preview), { recursive: true });
  fs.writeFileSync(preview, toBuf(out.preview));
  console.log('   ✅ build/logo-preview.png（灰底预览，供人工核对）');

  console.log('\n完成。');
})().catch((e) => { console.error(e); process.exit(1); });
