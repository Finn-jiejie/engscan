// 发布前盖章：给 index.html 里的 js/css 引用加内容哈希
// 目的：绕开 CDN 按 URL 缓存导致「改了代码线上还是旧版」的问题
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUB = path.join(__dirname, '..', 'public');
const IDX = path.join(PUB, 'index.html');
const ASSETS = ['style.css', 'vocab.js', 'app.js', 'vocab-ui.js'];

const hashOf = (f) =>
  crypto.createHash('md5').update(fs.readFileSync(path.join(PUB, f))).digest('hex').slice(0, 8);

let html = fs.readFileSync(IDX, 'utf8');
const stamps = [];

for (const a of ASSETS) {
  const v = hashOf(a);
  const esc = a.replace(/\./g, '\\.');
  // 先去掉可能存在的旧版本参数，再统一盖上新哈希
  html = html.replace(new RegExp(`\\./${esc}(\\?v=[a-f0-9]+)?`, 'g'), `./${a}?v=${v}`);
  stamps.push(`${a}?v=${v}`);
}

fs.writeFileSync(IDX, html, 'utf8');
console.log('已盖章:');
stamps.forEach((s) => console.log('  ' + s));
