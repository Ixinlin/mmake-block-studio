/* ============================================================
 * run-tests.js —— 依次跑全部 test-r*.js，汇总结果
 *
 *   node tools/run-tests.js          跑全部
 *   node tools/run-tests.js r50      只跑 test-r50.js
 * ============================================================ */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const only = process.argv[2];

const files = fs.readdirSync(ROOT)
  .filter(f => /^test-r\d+b?\.js$/.test(f))
  .filter(f => !only || f.indexOf('test-' + only) === 0)
  .sort((a, b) => {
    const na = parseInt(a.replace(/\D/g, ''), 10);
    const nb = parseInt(b.replace(/\D/g, ''), 10);
    return na - nb || a.localeCompare(b);
  });

if (!files.length) {
  console.error('没找到匹配的测试文件');
  process.exit(1);
}

let pass = 0, fail = 0;
const failed = [];
console.log('共 ' + files.length + ' 个测试文件\n');

files.forEach(function (f) {
  process.stdout.write('▶ ' + f + ' … ');
  let out = '';
  let ok = true;
  try {
    out = execFileSync(process.execPath, [path.join(ROOT, f)], {
      cwd: ROOT, encoding: 'utf8', timeout: 400000, stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (e) {
    ok = false;
    out = String((e.stdout || '') + (e.stderr || ''));
  }
  const m = out.match(/通过\s*(\d+)\s*项，失败\s*(\d+)\s*项/);
  if (m) {
    pass += parseInt(m[1], 10);
    fail += parseInt(m[2], 10);
    if (parseInt(m[2], 10) > 0) { ok = false; }
  }
  if (ok && m) {
    console.log('✅ ' + m[1] + ' 项');
  } else {
    console.log('❌');
    failed.push({ file: f, out: out });
  }
});

if (failed.length) {
  console.log('\n' + '='.repeat(56));
  failed.forEach(function (x) {
    console.log('\n--- ' + x.file + ' ---');
    console.log(x.out.split('\n').filter(l => l.indexOf('✗') >= 0 || /error|Error|失败/.test(l))
      .slice(0, 8).join('\n'));
  });
}

console.log('\n' + '='.repeat(56));
console.log('合计：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('文件：' + (files.length - failed.length) + ' / ' + files.length + ' 全部通过');
console.log('='.repeat(56));
process.exit(failed.length ? 1 : 0);
