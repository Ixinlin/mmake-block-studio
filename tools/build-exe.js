/* ============================================================
 * build-exe.js —— 把网页版打包成 Windows 单文件 exe
 *
 *   node tools/build-exe.js
 *
 * 流程：
 *   1. 先跑 build-publish.js 生成干净的 publish/（已抹掉内置 API 凭据）
 *   2. 生成一次性的 256 位资源密钥 → tools/exe/_buildkey.py（混淆存放）
 *   3. 跑 pack-web.js 把 publish/ 加密成 build/web.pak
 *   4. 用 PyInstaller 把 launcher.py + web.pak 打成一个 exe（带图标、版本信息）
 *   5. 产物放到 dist/Mmake.exe
 *
 * 为什么要一个"解密释放 + 调系统浏览器"的壳，而不是 Electron：
 *   上传程序用 WebSerial，只有 Chromium 内核 + 安全上下文才支持；
 *   Edge/Chrome 打开 file:// 页面时 isSecureContext=true、navigator.serial 可用，
 *   localStorage 也正常，所以本地释放 + 系统浏览器 = 行为和在线版完全一致，
 *   还省掉 100MB+ 的浏览器内核。
 *
 * 关于"加密"能做到哪一步：
 *   网页是纯前端，代码必然要送到用户机器上。这里做的是**资源包加密**：
 *   用 7-Zip 打开 exe 只能看到 web.pak 的乱码，拿不到 html/js/css 明文。
 *   密钥在 exe 里混淆存放，挡得住"顺手拷走源码"，挡不住专业逆向 ——
 *   真正的保护请靠开源协议和版权声明。
 * ============================================================ */
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUB = path.join(ROOT, 'publish');
const DIST = path.join(ROOT, 'dist');
const BUILD = path.join(ROOT, 'build');
const EXE_DIR = path.join(ROOT, 'tools', 'exe');
const PAK = path.join(BUILD, 'web.pak');
const KEYFILE = path.join(EXE_DIR, '_buildkey.py');
const ICON = path.join(EXE_DIR, 'Mmake.ico');
const VERSION_TPL = path.join(EXE_DIR, 'version-info.txt');

const APP_VERSION = '1.0.3.0';      // exe 属性里显示的版本
const APP_VERSION_TUPLE = '1, 0, 3, 0';

function run(cmd, args, opts) {
  console.log('  $ ' + [cmd].concat(args).join(' '));
  execFileSync(cmd, args, Object.assign({ stdio: 'inherit', cwd: ROOT }, opts || {}));
}

/* ------------------------------------------- ① 生成干净的 publish/ */
console.log('① 生成发布目录 …');
run(process.execPath, [path.join(ROOT, 'tools', 'build-publish.js')]);
if (!fs.existsSync(path.join(PUB, 'index.html'))) {
  console.error('❌ publish/index.html 不存在，构建中止');
  process.exit(1);
}

/* ------------------------------------------- ② 生成一次性资源密钥 */
console.log('\n② 生成资源密钥 …');
const key = crypto.randomBytes(32);          // AES-256 同级的 256 位密钥
const pad1 = crypto.randomBytes(32);
const pad2 = crypto.randomBytes(32);
const xor = (a, b) => Buffer.from(a.map((v, i) => v ^ b[i]));
fs.writeFileSync(KEYFILE, `# -*- coding: utf-8 -*-
"""资源密钥（自动生成，每次打包都换一把，别手工改、别提交到仓库）

三段分片异或还原出真正的 256 位密钥：
    key = A ^ B ^ C
打包机上也只存混淆后的分片，plain 密钥不落盘。
"""
_A = "${xor(key, pad1).toString('base64')}"
_B = "${xor(pad1, pad2).toString('base64')}"
_C = "${pad2.toString('base64')}"


def unwrap_key():
    import base64
    a = base64.b64decode(_A)
    b = base64.b64decode(_B)
    c = base64.b64decode(_C)
    return bytes(x ^ y ^ z for x, y, z in zip(a, b, c))
`);
console.log('   ✅ tools/exe/_buildkey.py（256 位，三段分片混淆）');

/* ------------------------------------------- ③ 加密打包网页资源 */
console.log('\n③ 加密打包网页资源 …');
run(process.execPath, [path.join(ROOT, 'tools', 'pack-web.js'),
  '--key-hex=' + key.toString('hex')]);
if (!fs.existsSync(PAK)) {
  console.error('❌ 未生成 build/web.pak，构建中止');
  process.exit(1);
}

/* ------------------------------------------- ④ 准备版本资源与图标 */
console.log('\n④ 准备图标与版本信息 …');
if (!fs.existsSync(ICON)) {
  console.error('❌ 缺少图标 tools/exe/Mmake.ico，请先跑 node tools/make-icon.js');
  process.exit(1);
}
const verFile = path.join(BUILD, 'version-info.txt');
fs.mkdirSync(BUILD, { recursive: true });
fs.writeFileSync(verFile,
  fs.readFileSync(VERSION_TPL, 'utf8')
    .replace(/\{\{VERSION_TUPLE\}\}/g, APP_VERSION_TUPLE)
    .replace(/\{\{VERSION\}\}/g, APP_VERSION)
    .split('\n').filter((l) => !l.trim().startsWith('#')).join('\n'));
console.log('   ✅ 图标 tools/exe/Mmake.ico');
console.log('   ✅ 版本资源 v' + APP_VERSION);

/* ------------------------------------------- ⑤ PyInstaller 打包 */
console.log('\n⑤ PyInstaller 打包 …');
const sep = ';';   // Windows 下 --add-data 用分号
const args = [
  '-m', 'PyInstaller',
  '--noconfirm',
  '--clean',
  '--onefile',
  '--windowed',                       // 不弹黑色控制台
  '--name', 'Mmake',
  '--icon', ICON,
  '--version-file', verFile,
  '--paths', EXE_DIR,                 // 让 pakcrypto / _buildkey 能被找到
  '--distpath', DIST,
  '--workpath', BUILD,
  '--specpath', BUILD,
  '--add-data', PAK + sep + '.',
  path.join(EXE_DIR, 'launcher.py')
];
run(process.env.PYTHON || 'python', args);

const exe = path.join(DIST, 'Mmake.exe');
if (fs.existsSync(exe)) {
  const mb = (fs.statSync(exe).size / 1048576).toFixed(1);
  console.log('\n✅ 打包完成：dist/Mmake.exe（' + mb + ' MB）');
  console.log('   双击即可运行：解密内置资源 → 用 Edge/Chrome 打开');
  console.log('   资源已加密，用 7-Zip 打开 exe 只能看到乱码');
} else {
  console.error('\n❌ 未找到 dist/Mmake.exe，请检查上面的 PyInstaller 输出');
  process.exit(1);
}
