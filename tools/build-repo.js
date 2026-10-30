/* ============================================================
 * build-repo.js —— 生成可直接开源的干净仓库目录
 *
 *   node tools/build-repo.js              # → gitee-repo/
 *   node tools/build-repo.js github-repo  # → github-repo/
 *
 * 与 build-publish.js 的区别：
 *   publish/    = 只要网页本身（用于在线托管 / 打进 exe）
 *   gitee-repo/ = 网页 + 构建脚本 + 测试 + README/LICENSE，用作开源仓库根目录
 *
 * 两者共用的安全处理：
 *   · 抹掉 js/xfyun.js 里内置的讯飞 API 凭据
 *   · 把 js/textbook-examples.js 换成空壳（教材入口已隐藏，
 *     且该文件含教材样例的 WiFi 名/密码与局域网 IP，不适合公开分发）
 *   · 不包含 参考资料/、积木规范/、node_modules/
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, process.argv[2] || 'gitee-repo');
const PUB = path.join(ROOT, 'publish');

/* 依赖 参考资料/ 的测试，开源仓库里跑不了，不带 */
const SKIP_TESTS = ['test-r45.js', 'test-r49.js'];

function run(cmd, args, opts) {
  execFileSync(cmd, args, Object.assign({ stdio: 'inherit', cwd: ROOT }, opts || {}));
}
function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}
function copyDir(src, dst, filter) {
  if (!fs.existsSync(src)) return;
  fs.readdirSync(src).forEach(function (n) {
    const s = path.join(src, n), d = path.join(dst, n);
    const st = fs.statSync(s);
    if (st.isDirectory()) copyDir(s, d, filter);
    else if (!filter || filter(n)) copyFile(s, d);
  });
}

console.log('① 先生成发布用的干净网页 …');
if (!fs.existsSync(path.join(PUB, 'index.html'))) run(process.execPath, [path.join(__dirname, 'build-publish.js')]);

console.log('\n② 清理 ' + path.basename(OUT) + '/ …');
/* ⚠ 保留 .git：目标目录本身就是一个 git 仓库，
   整目录删掉会把提交历史一起清空（第一次就踩了这个坑）。
   只清内容，不动 .git。 */
if (fs.existsSync(OUT)) {
  fs.readdirSync(OUT).forEach(function (n) {
    if (n === '.git') return;
    fs.rmSync(path.join(OUT, n), { recursive: true, force: true });
  });
}
fs.mkdirSync(OUT, { recursive: true });

console.log('③ 拷贝网页运行时 …');
copyDir(PUB, OUT);

console.log('④ 拷贝构建脚本与测试 …');
copyFile(path.join(ROOT, 'tools/build-publish.js'), path.join(OUT, 'tools/build-publish.js'));
copyFile(path.join(ROOT, 'tools/build-exe.js'), path.join(OUT, 'tools/build-exe.js'));
copyFile(path.join(ROOT, 'tools/build-repo.js'), path.join(OUT, 'tools/build-repo.js'));
copyFile(path.join(ROOT, 'tools/pack-web.js'), path.join(OUT, 'tools/pack-web.js'));
copyFile(path.join(ROOT, 'tools/make-icon.js'), path.join(OUT, 'tools/make-icon.js'));
copyFile(path.join(ROOT, 'tools/png-info.py'), path.join(OUT, 'tools/png-info.py'));
copyFile(path.join(ROOT, 'tools/exe/launcher.py'), path.join(OUT, 'tools/exe/launcher.py'));
copyFile(path.join(ROOT, 'tools/exe/pakcrypto.py'), path.join(OUT, 'tools/exe/pakcrypto.py'));
copyFile(path.join(ROOT, 'tools/exe/version-info.txt'), path.join(OUT, 'tools/exe/version-info.txt'));
/* ⚠ 不拷贝 tools/exe/_buildkey.py：那是打包时生成的一次性密钥 */

console.log('   logo 素材 …');
copyFile(path.join(ROOT, 'docs/logo/Mmake-source.png'), path.join(OUT, 'docs/logo/Mmake-source.png'));
copyFile(path.join(ROOT, 'docs/logo/Mmake.png'), path.join(OUT, 'docs/logo/Mmake.png'));
/* 真实浏览器校验（可选，需要 npx playwright install chromium） */
['browser-check-r50.js', 'browser-check-r52.js'].forEach(function (f) {
  const src = path.join(ROOT, 'tools', f);
  if (fs.existsSync(src)) copyFile(src, path.join(OUT, 'tools', f));
});
/* 一键跑全部测试 */
copyFile(path.join(ROOT, 'tools/run-tests.js'), path.join(OUT, 'tools/run-tests.js'));

console.log('   文档与仓库元数据 …');
const TPL = path.join(ROOT, 'docs/repo-templates');
['README.md', 'LICENSE', '.gitignore', '.gitattributes', 'package.json'].forEach(function (f) {
  const src = path.join(TPL, f);
  if (!fs.existsSync(src)) { console.warn('   ⚠ 缺少模板 ' + f); return; }
  copyFile(src, path.join(OUT, f));
});

const tests = fs.readdirSync(ROOT).filter(f => /^test-r\d+b?\.js$/.test(f) && SKIP_TESTS.indexOf(f) < 0);
tests.forEach(f => copyFile(path.join(ROOT, f), path.join(OUT, f)));
console.log('   测试 ' + tests.length + ' 个，跳过 ' + SKIP_TESTS.join(' / '));

/* ---------- 校验 ----------
   ⚠ 不把密钥写死在这里：本脚本自己也会进开源仓库。
   运行时从源文件里抽出 DEFAULT_CREDS 的字符串，再查产物里有没有残留。 */
const SECRETS = (function () {
  const src = path.join(ROOT, 'js/xfyun.js');
  if (!fs.existsSync(src)) return [];
  const m = fs.readFileSync(src, 'utf8').match(/var DEFAULT_CREDS = \{[\s\S]*?\n  \};/);
  if (!m) return [];
  return Array.from(new Set((m[0].match(/'([^']{6,})'/g) || []).map(q => q.slice(1, -1))));
})();
let leak = [];
(function scan(rel) {
  const full = path.join(OUT, rel);
  if (fs.statSync(full).isDirectory()) {
    fs.readdirSync(full).forEach(n => scan(path.join(rel, n)));
    return;
  }
  if (!/\.(html|js|css|json|md|txt|py)$/i.test(rel)) return;
  const s = fs.readFileSync(full, 'utf8');
  SECRETS.forEach(k => { if (s.indexOf(k) >= 0) leak.push(rel); });
})('.');

let files = 0, bytes = 0;
(function walk(rel) {
  fs.readdirSync(path.join(OUT, rel)).forEach(function (n) {
    if (n === '.git') return;      /* 别把 git 对象算进源码体积 */
    const sub = path.join(rel, n);
    const st = fs.statSync(path.join(OUT, sub));
    if (st.isDirectory()) walk(sub);
    else { files++; bytes += st.size; }
  });
})('.');

console.log('\n✅ ' + path.basename(OUT) + '/ 生成完成：' + files + ' 个文件，' + (bytes / 1048576).toFixed(2) + ' MB');
if (leak.length) {
  console.error('❌ 凭据残留：' + leak.join(', '));
  process.exit(1);
}
console.log('✅ 凭据自检通过');
