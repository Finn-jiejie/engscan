#!/usr/bin/env bash
# 一条命令把改动推到 GitHub 私人仓库 → Cloudflare Pages 会自动重新部署
#
# 用法：  bash tools/push.sh "提交说明"
# 例：    bash tools/push.sh "fix: 修好词库翻页"
# 不带说明时自动用时间戳。
#
# 为什么需要这个脚本，而不直接 git push：
#   本机环境下 GitHub 的 TLS 证书校验会失败（报 unable to get local issuer certificate），
#   这是证书链问题，不是网络不通。脚本自动带上两个开关绕开：
#     GIT_SSL_NO_VERIFY=1                     → 跳过证书校验
#     -c credential.helper='!gh auth ...'     → 用 gh 的 token 认证（不改你的全局 git 配置）
#
# 安全闸：推之前会检查 .env 有没有被误纳入版本控制，有就直接中止。

set -euo pipefail

# 沙箱环境 PATH 可能被污染，补一下（路径不存在也无害）
export PATH="/usr/bin:/bin:/mingw64/bin:$PATH"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MSG="${1:-}"
[ -z "$MSG" ] && MSG="chore: 更新 $(date '+%Y-%m-%d %H:%M')"

BRANCH="main"

# ---------- 前置检查 ----------
if ! command -v gh >/dev/null 2>&1; then
  echo "[X] 找不到 gh（GitHub CLI）。请先安装：https://cli.github.com/"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "[X] 未登录 GitHub。请先运行： gh auth login"
  exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "[X] 没有配置 origin 远端。"
  echo "    请先运行： git remote add origin https://github.com/<用户名>/engscan.git"
  exit 1
fi

# ---------- 安全闸：绝不提交密钥 ----------
TRACKED_ENV="$(git ls-files | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$' || true)"
if [ -n "$TRACKED_ENV" ]; then
  echo "[X] 检测到密钥文件已被 git 跟踪，已中止推送："
  echo "$TRACKED_ENV" | sed 's/^/      /'
  echo "    修复： git rm --cached <文件>  然后确认 .gitignore 含 .env"
  exit 1
fi
echo "==> 密钥自检通过（.env 未入库）"

# ---------- 提交 ----------
echo "==> 提交改动"
git add -A
if git diff --cached --quiet; then
  echo "    没有新改动，跳过提交"
else
  git -c user.name="$(git config user.name || echo Finn)" \
      -c user.email="$(git config user.email || echo Finn@local)" \
      commit -m "$MSG"
fi

# ---------- 推送 ----------
echo "==> 推送到 origin/$BRANCH"
env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
  GIT_SSL_NO_VERIFY=1 \
  git -c credential.helper= -c credential.helper='!gh auth git-credential' \
  push origin "$BRANCH"

echo
echo "==> 推送完成"
echo "    Cloudflare Pages 会自动检测到新提交并重新部署（约 1 分钟）"
git log --oneline -1
