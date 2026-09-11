# engscan · 纸质书英语拍照点读

拍下书页 → 识别重点单词和例句 → 点一下就读出来。

## 一、怎么用（三种方式，按需选）

### 方式 1：电脑上双击启动（推荐日常用）

**双击 `start.bat`** —— 会自己起服务、自己开浏览器，不用敲任何命令。

> 关掉那个黑窗口就停止服务。

首次使用需要装依赖（只一次）：在这个文件夹里右键 → 在终端中打开 → 输入 `npm install`。

### 方式 2：手机当 App 用（PWA）

手机和电脑连**同一个 WiFi**，用手机浏览器打开启动时打印的那个地址：

```
手机打开（连同一个 WiFi）:
             http://10.241.158.65:4173
```

装到桌面：手机浏览器菜单 → **「添加到主屏幕」** → 以后点图标就能直接进。

> 注意：局域网是 http，浏览器不允许装真正的 PWA（需要 HTTPS），但「添加到主屏幕」的快捷方式功能完全一样。
> 想要能在任何网络下用（不限于家里 WiFi），见方式 3。

### 方式 3：云端 API（不开电脑也能用）

页面右上角 **设置 → 云端 API**，填三样：服务商、接口地址、Key。

填完点「测试连接」确认通了，之后：

- **手机在外面也能用**（不依赖电脑开机、不依赖同一 WiFi）
- 识别走云端多模态模型，手机上直接出结果
- 例句还能一键翻译成中文

内置了常用服务商预设，选一下自动填好地址：

| 服务商 | 接口地址 |
|---|---|
| 阿里百炼 · 通用 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| 阿里 Token Plan · 北京 | `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` |
| 阿里 Token Plan · 新加坡 | `https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1` |
| 小米 MiMo · 官方 | `https://api.xiaomimimo.com/v1` |
| 小米 Token Plan · 国内 / 新加坡 | `https://token-plan-cn.xiaomimimo.com/v1` 等 |

**Key 只说一遍：** 只存在你这台设备的浏览器里（localStorage），直接发给服务商，不经过任何第三方服务器，也不会写进代码仓库。手机和电脑的配置**互不同步**，各填一次。

## 二、两种识别引擎

| | 本地 OCR | 云端多模态 |
|---|---|---|
| 花钱 | 免费 | 按量计费 |
| 速度 | 约 2 秒 | 5–20 秒 |
| 条件 | 电脑开着 | 任何能上网的设备 |
| 隐私 | 图片不出局域网 | 图片发给服务商 |
| 音标 | 书页原文，不准的标 `?` | 模型给的标准 IPA |

「自动」模式下：能连上电脑就用本地（免费快），连不上就用云端。也可以在设置里手动锁定。

## 三、使用步骤

1. 点「拍照识别」→ 调用相机（拍清楚、光线足、正对书页，识别率最高）
2. 点「开始识别」
3. 结果分两块：**重点单词**（音标 + 释义）和 **例句**
4. 圆形按钮 = 朗读；文字可直接点着改
5. 单词卡上的「＋」= 收藏进生词本
6. 生词本支持 Leitner 间隔复习（1/2/4/8/16 天）和导出 CSV（Anki 可用）

## 四、发布到 GitHub Pages（手机在外面也能用）

`public/` 目录是**纯静态**的，可以直接托管到 GitHub Pages。

一条命令搞定（脚本会自动建仓库、推源码、推静态站、开 Pages）：

```bash
bash tools/publish.sh <你的GitHub用户名> engscan
```

**跑之前需要两个前置条件：**

1. **代理已开启** —— 本机 GitHub 直连不通（实测 `github.com → 000`，`npmjs.org → 200`）
2. **已登录 GitHub** —— 执行一次 `gh auth login`

脚本内置安全闸：提交前会检查 `.env` 是否混入，发现就中止。

发布后：

- 源码仓库 `https://github.com/<用户名>/engscan`
- **在线地址 `https://<用户名>.github.io/engscan/`** ← 手机打开这个

部署到 HTTPS 之后，手机上就是**真正的 PWA**：可以正常安装到主屏、离线打开外壳。

> 静态托管没有 OCR 后端，所以线上版**只能走云端引擎**。页面会自动探测并切换，不需要改任何配置。

### 不想等/连不上 GitHub 时的替代

- **单文件版 `engscan.html`** 直接发微信到手机，用手机浏览器打开，一样能用云端识别
- 局域网内手机连电脑：双击 `start.bat`，用打印的局域网地址访问

## 五、结构

```
start.bat             双击启动（Windows）
engscan.html          单文件版（构建产物，零依赖双击即用）
server.js             Node 后端：静态托管 + /api/local-scan（本地 OCR）+ /api/scan（云端备用）
public/
  index.html          页面
  style.css
  app.js              引擎调度、拍照压缩、渲染、朗读、云端配置
  vocab.js            生词本数据层（IndexedDB + Leitner + CSV）
  vocab-ui.js         生词本界面
  sw.js               Service Worker（离线外壳）
  manifest.webmanifest
  icon-*.png          PWA 图标
tools/
  publish.sh          一键发布到 GitHub Pages
  make-icons.py       重新生成图标
  make-standalone.js  打包成单文件 HTML
  pwa-check.js        CDP 自动检测 PWA 能力
  file-check.js       检测单文件版在 file:// 下的表现
  cloud-e2e.js        云端直连端到端测试
  local-translate-check.js  本地模式 + 翻译 + 生词本联动测试
  mock-api.js         本地假 API（仅供测试）
.env                  服务端配置（不进版本库）
```

## 六、已知限制

- 印刷体识别好；**手写、花体、暗光、大角度斜拍**准确率明显下降
- 音标是 OCR 软肋：本地模式下带 `?` 的是书页原样，别全信
- 局域网模式下手机和电脑必须同 WiFi，换网络后 IP 会变
- 手机填的云端 Key 存在手机浏览器的本地存储里；清浏览器数据会丢，要重填
- 云端引擎要求所选**模型支持图片输入**（纯文本模型只能做例句翻译）
