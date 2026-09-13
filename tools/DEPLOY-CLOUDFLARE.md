# 部署到 Cloudflare Pages（私人仓库 + 免费 HTTPS）

> 目标：手机扫开一个 HTTPS 链接就能用，源码留在私人仓库不外泄。
> 前提状态：**已完成** —— 代码已推到私人仓库 `https://github.com/Finn-jiejie/engscan`（分支 `main`）。
> 你要做的：在浏览器里点几下把它接到 Cloudflare。

---

## 为什么不用 GitHub Pages

实测证据（GitHub 服务器原话）：

```
POST /repos/Finn-jiejie/engscan/pages
→ HTTP 422
{"message":"Your current plan does not support GitHub Pages for this repository."}
```

GitHub Pages 的支持矩阵：

| 账号 | 私有仓库能当 Pages 源？ |
|---|---|
| **Free（个人）** | ❌ 不能 |
| Pro（$4/月） | ✅ 能，但**发出来的站点仍是公开的** |
| Team / Enterprise | ✅ 能 |

两个坑：① 免费账号**必须 public** 才能用 Pages；② 就算升级到 Pro，私有仓库发的站点**依然是公开的**，想站点也私有得上 Enterprise Cloud 组织。

Cloudflare Pages 没这个限制：**私有仓库直接支持**，免费计划**无限带宽**，自带 HTTPS。

---

## 开始之前

你需要一个 Cloudflare 账号。**没有的话先注册**：

1. 打开 <https://dash.cloudflare.com/sign-up>
2. 填邮箱 + 密码 → 收邮件点验证链接
3. 注册完不需要买任何东西，也不需要绑卡。免费计划足够。

> 如果已有账号，直接登录 <https://dash.cloudflare.com>

---

## 步骤 1 · 进入 Workers & Pages

登录后，在左侧菜单找 **Workers & Pages**（如果侧栏是收起的，先点左上角展开）。

找不到就退回到账号首页，在列表里找 **Workers & Pages** 这一项点进去。

---

## 步骤 2 · 新建 Pages 应用

在 Workers & Pages 页面：

1. 点 **Create application**（创建应用）
2. 切到 **Pages** 标签（它和 Workers 是两个标签，别点错）
3. 点 **Connect to Git**（连接到 Git）

> 别选 "Direct Upload" —— 官方说明：**Git 集成后不能改回 Direct Upload**。我们要的是每次 push 自动部署，所以必须选 Connect to Git。

---

## 步骤 3 · 授权 GitHub 并选仓库

1. 点 **GitHub** 图标，会跳转到 GitHub 授权页
2. GitHub 上点 **Authorize Cloudflare Pages**
   - 若提示选择仓库范围，选 **Only select repositories** → 勾选 **`engscan`**
   - （想让以后其他项目也能自动部署，就选 All repositories。随你。）
3. 回到 Cloudflare，在仓库列表里选中 **`Finn-jiejie/engscan`**
4. 点 **Install & Authorize** → **Begin setup**

> ⚠️ 私有仓库会出现在列表里，这是正常的（Cloudflare 官方支持私有仓库）。

---

## 步骤 4 · 配置构建（关键，照抄）

这一步填错会出现「部署成功但页面空白」，所以逐字对照：

| 字段 | 填什么 | 说明 |
|---|---|---|
| **Project name** | `engscan` | 决定网址 `engscan.pages.dev`。若提示被占用，改成 `engscan-finn` 之类 |
| **Production branch** | `main` | 下拉里选。我们已 push 过，能选到 |
| **Framework preset** | `None` | 纯静态，无框架 |
| **Build command** | **（留空，什么都别填）** | 官方原文：不需要构建步骤就留空 |
| **Build output directory** | `public` | ⚠️ **最重要的一项**。静态文件都在仓库的 `public/` 目录里 |
| **Root directory (advanced)** | **（留空）** | 仓库根目录就是项目根目录，不是 monorepo |

**Environment variables（环境变量）：不用填。** 这个应用是纯前端，API key 存在你自己手机浏览器的 localStorage 里，不经过服务器。

---

## 步骤 5 · 部署

点 **Save and Deploy**。

Cloudflare 会拉取仓库 → 上传 `public/` 内容 → 给出一个地址：

```
https://engscan.pages.dev
```

（项目名被占用时会是你填的那个名字）

看到 **Success** 就好了，大约 30 秒到 1 分钟。

---

## 步骤 6 · 手机验证

1. 手机浏览器打开 `https://engscan.pages.dev`
2. 应该看到拍照点读的界面
3. **添加到主屏幕**（iOS Safari：分享 → 添加到主屏幕；Android Chrome：菜单 → 安装应用）
4. 打开后进设置页，填你的云端 API（小米 MiMo / 阿里百炼），就能拍照翻译了

> 手机上会用**云端引擎**（页面探测不到本地 OCR 服务，自动切换）。云端引擎是在你手机浏览器里**直连**厂商 API 的，key 不出手机。

---

## 以后改了代码怎么更新

改完代码，在项目目录跑一条命令：

```bash
bash tools/push.sh "改了什么的说明"
```

推上去后 Cloudflare 会**自动**重新部署，约 1 分钟生效。手机上刷新即可。

> 为什么不用直接 `git push`：本机环境下 GitHub 的 TLS 证书校验会失败（报 `unable to get local issuer certificate`）——这是**证书链问题，不是网络不通**。`push.sh` 已经带好开关绕开，用 gh 的 token 认证，且不会改动你的全局 git 配置。

---

## 常见问题

**Q：部署 Success 但页面是空白的？**
A：99% 是 `Build output directory` 没填对。回项目 **Settings → Build configuration**，确认填的是 `public`（小写，无斜杠）。

**Q：想用自己的域名？**
A：项目 **Settings → Custom domains → Set up a custom domain**，按提示在域名商加一条 CNAME。免费的。

**Q：私有仓库的代码会被公开吗？**
A：不会。Cloudflare 只把 `public/` 里的**静态文件**发到 CDN —— 而这些文件本来就是给浏览器看的。仓库源码（`server.js`、`tools/`、`.gitignore` 排除的 `.env`）不会外泄。

**Q：以后写进代码里的密钥会不会漏？**
A：会。所以密钥永远只放在浏览器 localStorage 里手填，**不写进代码**。`tools/push.sh` 每次推送前会检查 `.env` 有没有被误纳入版本控制，发现就中止。

**Q：Cloudflare 会不会也限制国内访问？**
A：`*.pages.dev` 在国内访问**不稳定**（Cloudflare 的边缘节点在国内会被干扰）。如果发现手机上打不开，两个办法：① 在你的 Cloudflare 里给项目绑定自有域名（有时反而更稳）；② 继续用已经验证可用的 WorkBuddy 发布地址 `https://db6fe25b82fc4bd5bea477229619d830.app.workbuddy.host`。

---

## 当前两条通道对照

| 通道 | 地址 | 状态 | 用途 |
|---|---|---|---|
| WorkBuddy 发布 | `https://db6fe25b82fc4bd5bea477229619d830.app.workbuddy.host` | ✅ 已实测 200 | 立即可用的手机入口 |
| Cloudflare Pages | `https://engscan.pages.dev` | ⏳ 待你在浏览器里接 | 长期方案，源码私人、自动部署 |

来源仓库：<https://github.com/Finn-jiejie/engscan>（private）
