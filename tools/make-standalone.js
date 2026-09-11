// 把 public/ 打包成单文件 HTML：零依赖、双击即用、可直接发到手机上打开
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const OUT = path.join(__dirname, '..', 'engscan.html');

const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');
const b64 = (f) => fs.readFileSync(path.join(PUB, f)).toString('base64');

// 防止内联脚本里出现 </script> 提前结束标签
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');

let html = read('index.html');

// 1. 内联样式
html = html.replace(
  /<link rel="stylesheet" href="\.\/style\.css">/,
  () => '<style>\n' + read('style.css') + '\n</style>'
);

// 2. 图标内联成 data URI（file:// 下相对路径也能用，但内联更稳、单文件更彻底）
html = html.replace(
  /<link rel="icon" href="\.\/icon-192\.png">/,
  () => '<link rel="icon" href="data:image/png;base64,' + b64('icon-192.png') + '">'
);
html = html.replace(
  /<link rel="apple-touch-icon" href="\.\/apple-touch-icon\.png">/,
  () => '<link rel="apple-touch-icon" href="data:image/png;base64,' + b64('apple-touch-icon.png') + '">'
);

// 3. 单文件模式下没有 manifest / sw（file:// 不支持），摘掉引用并禁用注册
html = html.replace(/<link rel="manifest" href="\.\/manifest\.webmanifest">\n?/, '');

// 4. 内联三个脚本
html = html.replace(
  /<script src="\.\/vocab\.js"><\/script>\s*<script src="\.\/app\.js"><\/script>\s*<script src="\.\/vocab-ui\.js"><\/script>/,
  () =>
    '<script>\n' + safe(read('vocab.js')) + '\n</script>\n' +
    '<script>\n' + safe(read('app.js')) + '\n</script>\n' +
    '<script>\n' + safe(read('vocab-ui.js')) + '\n</script>'
);

// 5. 标题里加个标记，便于区分
html = html.replace('<title>拍照点读</title>', '<title>拍照点读 · 单文件版</title>');

fs.writeFileSync(OUT, html, 'utf8');
console.log('已生成', OUT, (fs.statSync(OUT).size / 1024).toFixed(1) + ' KB');
