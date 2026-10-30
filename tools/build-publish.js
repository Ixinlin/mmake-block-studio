/* ============================================================
 * build-publish.js —— 生成可公开发布的静态站点（publish/）
 *
 *   node tools/build-publish.js
 *
 * 只拷贝运行时真正需要的文件，并**抹掉内置的讯飞 API 凭据**：
 *   开发目录里 js/xfyun.js 带着作者本人的讯飞密钥，
 *   直接公开 = 把账号额度白送出去。
 *   发布版里留空，学生用自己的密钥在「⚙ AI 设置」里填（存 localStorage），
 *   不填也不影响其他所有功能。
 *
 * 不拷贝：参考资料/、积木规范/、node_modules/、tests、tools、*.md 等。
 * ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'publish');

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}
function copyFile(rel) {
  const src = path.join(ROOT, rel);
  const dst = path.join(OUT, rel);
  if (!fs.existsSync(src)) { console.log('  ⚠ 缺少 ' + rel); return; }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}
function copyDir(rel, filter) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) return;
  fs.readdirSync(src).forEach(function (name) {
    const sub = path.join(rel, name);
    const st = fs.statSync(path.join(ROOT, sub));
    if (st.isDirectory()) copyDir(sub, filter);
    else if (!filter || filter(sub)) copyFile(sub);
  });
}

console.log('清理 ' + path.relative(ROOT, OUT) + ' …');
rmrf(OUT);
fs.mkdirSync(OUT, { recursive: true });

/* ---------- 1. 入口与静态资源 ---------- */
copyFile('index.html');
copyDir('css');
copyDir('js', f => f.endsWith('.js'));

/* ---------- 2. Blockly 运行时（只拷用到的 5 个脚本 + 消息 + 媒体） ---------- */
['vendor/blockly/blockly_compressed.js',
  'vendor/blockly/blocks_compressed.js',
  'vendor/blockly/javascript_compressed.js',
  'vendor/blockly/python_compressed.js',
  'vendor/blockly/msg/zh-hans.js'
].forEach(copyFile);
copyDir('vendor/blockly/media');

/* ---------- 3. 抹掉内置凭据 ---------- */
const xf = path.join(OUT, 'js/xfyun.js');
if (fs.existsSync(xf)) {
  let s = fs.readFileSync(xf, 'utf8');
  const before = s;
  s = s.replace(/(var DEFAULT_CREDS = \{)[\s\S]*?\n  \};/, function () {
    return 'var DEFAULT_CREDS = {\n' +
      '    /* 公开发布版：内置凭据已移除。\n' +
      '       请在「⚙ AI 设置」里填自己的讯飞 appId / apiKey / apiSecret，\n' +
      '       保存后写在浏览器 localStorage 里，不会随文件泄露。 */\n' +
      "    appId: '',\n" +
      "    speech: { apiKey: '', apiSecret: '' },\n" +
      "    text: { apiKey: '', apiSecret: '' },\n" +
      "    image: { apiKey: '', apiSecret: '' }\n" +
      '  };';
  });
  if (s === before) console.log('  ⚠ 没匹配到 DEFAULT_CREDS，请手工检查 js/xfyun.js');
  fs.writeFileSync(xf, s, 'utf8');
}

/* ---------- 4. 教材示例：发布版换成空壳 ----------
   第四十九轮加进来的教材（湘科版）示例，第五十一轮已按要求隐藏入口。
   这些示例里有教材自己的样例 WiFi 名/密码与局域网 IP（SIoT 服务器），
   放在公开站点上既没用（入口已隐藏）又会被安全扫描判为敏感内容。
   发布版用一个空壳替换：不注册任何示例数据，renderTextbookMenu 直接 return，
   页面不会 404，也不会泄漏样例凭据。
   原件仍在开发目录 js/textbook-examples.js，要恢复教材功能时改回来即可。 */
fs.writeFileSync(path.join(OUT, 'js/textbook-examples.js'),
  '/* 公开发布版：教材（湘科版）示例入口已隐藏，示例数据不随发布版分发。 */\n',
  'utf8');

/* ---------- 5. 安全自检：发布目录里不许残留任何密钥 ----------
   ⚠ 这里**不写死**具体密钥：脚本本身也会进开源仓库，
     把密钥列进来等于换个地方泄露。
     改为运行时从源文件里把 DEFAULT_CREDS 的字符串抽出来，
     再回头查发布目录里有没有残留。 */
const SECRETS = (function () {
  const src = path.join(ROOT, 'js/xfyun.js');
  if (!fs.existsSync(src)) return [];
  const m = fs.readFileSync(src, 'utf8').match(/var DEFAULT_CREDS = \{[\s\S]*?\n  \};/);
  if (!m) return [];
  const vals = (m[0].match(/'([^']{6,})'/g) || []).map(q => q.slice(1, -1));
  return Array.from(new Set(vals));
})();
let leak = [];
function scan(rel) {
  const full = path.join(OUT, rel);
  const st = fs.statSync(full);
  if (st.isDirectory()) {
    fs.readdirSync(full).forEach(n => scan(path.join(rel, n)));
    return;
  }
  if (!/\.(html|js|css|json|md|txt|mxml)$/i.test(rel)) return;
  const s = fs.readFileSync(full, 'utf8');
  SECRETS.forEach(k => { if (s.indexOf(k) >= 0) leak.push(rel + ' ← ' + k.slice(0, 8)); });
}
fs.readdirSync(OUT).forEach(n => scan(n));

/* ---------- 6. 统计 ---------- */
let files = 0, bytes = 0;
(function walk(rel) {
  fs.readdirSync(path.join(OUT, rel)).forEach(function (n) {
    const sub = path.join(rel, n);
    const st = fs.statSync(path.join(OUT, sub));
    if (st.isDirectory()) walk(sub);
    else { files++; bytes += st.size; }
  });
})('.');

console.log('\n✅ publish/ 生成完成：' + files + ' 个文件，' + (bytes / 1048576).toFixed(2) + ' MB');
if (leak.length) {
  console.error('❌ 仍检测到凭据残留：\n  ' + leak.join('\n  '));
  process.exit(1);
}
console.log('✅ 凭据自检通过：发布目录无任何密钥残留');
