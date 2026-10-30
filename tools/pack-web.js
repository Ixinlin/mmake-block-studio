/* ============================================================
 * pack-web.js —— 把 publish/ 打包成一个加密资源包 build/web.pak
 *
 *   node tools/pack-web.js --key-hex=<64位十六进制>
 *
 * 为什么要加密：
 *   网页版是纯前端，源码必然要送到用户机器上。但"用 PyInstaller 打个包"
 *   等于把整套 html/js/css 明文塞进 exe，任何人用 7-Zip 打开就能整包拷走。
 *   加密后：7-Zip 只能看到一堆乱码，必须运行程序才能拿到资源。
 *
 * 加密方式（只用标准库，Python 侧零依赖即可解密）：
 *   keystream = SHAKE256(key ‖ nonce)      —— NIST SP 800-185 的可扩展输出函数
 *   ciphertext = plaintext XOR keystream   —— 标准流加密
 *   明文里另附 SHA-256 摘要，解密后校验，防止资源被改动
 *
 *   ⚠️ 说明白一点：密钥就藏在 exe 里，这只是**混淆/防随手拷走**，
 *      挡不住专业逆向。真正要防的源码，请走开源协议 + 版权声明。
 *
 * 包格式：
 *   ┌ 明文头 ─────────────────────────────┐
 *   │ 'MMAKEPAK'  8B  magic               │
 *   │ ver         1B  = 1                 │
 *   │ nonce      16B  每次构建随机         │
 *   ├── 以下全部 XOR 密钥流 ───────────────┤
 *   │ 'MMPKDAT'   8B  解密成功标志         │
 *   │ digest     32B  sha256(后面全部明文) │
 *   │ json_len    4B  LE                  │
 *   │ manifest    json_len B              │
 *   │ data        各文件原始字节拼接        │
 *   └────────────────────────────────────┘
 * ============================================================ */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUB = path.join(ROOT, 'publish');
const OUT = path.join(ROOT, 'build', 'web.pak');

const MAGIC_HDR = Buffer.from('MMAKEPAK', 'ascii');   // 8 字节，明文
const MAGIC_DAT = Buffer.from('MMPKDAT1', 'ascii');   // 8 字节，密文内

function arg(name, dflt) {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : dflt;
}

function walk(dir, base, out) {
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    const rel = base ? base + '/' + name : name;
    if (fs.statSync(p).isDirectory()) walk(p, rel, out);
    else out.push(rel);
  }
  return out;
}

function main() {
  const keyHex = arg('key-hex');
  if (!keyHex || !/^[0-9a-f]{64}$/i.test(keyHex)) {
    console.error('❌ 需要 --key-hex=<64位十六进制密钥>，由 build-exe.js 自动生成');
    process.exit(1);
  }
  const key = Buffer.from(keyHex, 'hex');
  const nonce = crypto.randomBytes(16);

  if (!fs.existsSync(path.join(PUB, 'index.html'))) {
    console.error('❌ publish/index.html 不存在，请先跑 tools/build-publish.js');
    process.exit(1);
  }

  /* ---- 1. 收集文件，拼 manifest + data ---- */
  const files = walk(PUB, '', []);
  const chunks = [];
  const entries = [];
  let offset = 0;
  for (const rel of files) {
    const buf = fs.readFileSync(path.join(PUB, rel));
    entries.push({ p: rel.split(path.sep).join('/'), o: offset, l: buf.length });
    chunks.push(buf);
    offset += buf.length;
  }
  console.log('   文件 %d 个，共 %s 字节', entries.length, offset.toLocaleString());

  const manifest = JSON.stringify({ files: entries });
  const jsonBuf = Buffer.from(manifest, 'utf8');
  const dataBuf = Buffer.concat(chunks);

  const jsonLen = Buffer.alloc(4);
  jsonLen.writeUInt32LE(jsonBuf.length, 0);

  /* ---- 2. 明文 = 标志 + 摘要 + manifest + data ---- */
  const body = Buffer.concat([jsonLen, jsonBuf, dataBuf]);
  const digest = crypto.createHash('sha256').update(body).digest();
  const plaintext = Buffer.concat([MAGIC_DAT, digest, body]);

  /* ---- 3. 流加密 ---- */
  const ks = crypto.createHash('shake256', { outputLength: plaintext.length });
  ks.update(Buffer.concat([key, nonce]));
  const stream = ks.digest();
  const cipher = Buffer.allocUnsafe(plaintext.length);
  for (let i = 0; i < plaintext.length; i++) cipher[i] = plaintext[i] ^ stream[i];

  /* ---- 4. 落盘 ---- */
  const ver = Buffer.from([1]);
  const pak = Buffer.concat([MAGIC_HDR, ver, nonce, cipher]);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, pak);

  console.log('   ✅ build/web.pak（%s 字节，密钥流 %s 字节）',
    pak.length.toLocaleString(), stream.length.toLocaleString());

  /* ---- 5. 自检：立刻解回来比对，防止加解密算法写歪 ---- */
  const check = crypto.createHash('shake256', { outputLength: cipher.length });
  check.update(Buffer.concat([key, nonce]));
  const back = Buffer.allocUnsafe(cipher.length);
  const ks2 = check.digest();
  for (let i = 0; i < cipher.length; i++) back[i] = cipher[i] ^ ks2[i];
  if (!back.equals(plaintext)) {
    console.error('❌ 自检失败：解回来的内容和原文不一致');
    process.exit(1);
  }
  console.log('   ✅ 加解密自检通过');
}

main();
