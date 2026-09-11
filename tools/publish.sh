#!/usr/bin/env bash
# 一条命令把 engscan 发布到 GitHub Pages
#
# 用法：  bash tools/publish.sh <GitHub用户名> [仓库名]
# 例：    bash tools/publish.sh Finn-jiejie engscan
#
# 前置条件（两个，缺一不可）：
#   1. 代理已开启（GitHub 直连不通）
#   2. 已登录 GitHub：gh auth login
#
# 发布后：
#   源码仓库  https://github.com/<用户名>/<仓库名>
#   在线地址  https://<用户名>.github.io/<仓库名>/   ← 手机打开这个

set -euo pipefail

USER_NAME="${1:-}"
REPO="${2:-engscan}"
BRANCH_MAIN="main"
BRANCH_PAGES="gh-pages"

if [ -z "$USER_NAME" ]; then
  echo "用法: bash tools/publish.sh <GitHub用户名> [仓库名]"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REMOTE_HTTPS="https://github.com/$USER_NAME/$REPO.git"
PAGES_URL="https://$USER_NAME.github.io/$REPO/"

# ---------- 前置检查 ----------

echo "==> 检查 GitHub 连通性"
if ! curl -s -o /dev/null -m 10 --noproxy '*' https://github.com; then
  echo "[X] 连不上 GitHub。请先开启代理，再重新运行。"
  echo "    （本机历史上 GitHub 直连被墙，需走代理）"
  exit 1
fi

echo "==> 检查 gh 登录状态"
if ! gh auth status >/dev/null 2>&1; then
  echo "[X] 未登录 GitHub。请先运行： gh auth login"
  exit 1
fi

# 若仓库不存在则创建（公开仓库，Pages 才能免费开放）
echo "==> 确认仓库存在"
if ! gh repo view "$USER_NAME/$REPO" >/dev/null 2>&1; then
  echo "    仓库不存在，创建中…"
  gh repo create "$USER_NAME/$REPO" --public \
    --description "纸质书英语拍照点读：本地 OCR + 云端直连，可安装 PWA" \
    --disable-wiki
fi

# ---------- 安全闸：绝不提交密钥 ----------

SENSITIVE="$(git -C "$ROOT" ls-files | grep -E '(^|/)(\.env|\.env\..*)$' || true)"
if [ -n "$SENSITIVE" ]; then
  echo "[X] 待提交文件里出现 .env，已中止："
  echo "$SENSITIVE"
  exit 1
fi
echo "==> 密钥自检通过（无 .env 入库）"

# ---------- 推送源码到 main ----------

echo "==> 推送源码 → $BRANCH_MAIN"
git branch -M "$BRANCH_MAIN" 2>/dev/null || true
git remote remove origin 2>/dev/null || true
git remote add origin "$REMOTE_HTTPS"
git push -u origin "$BRANCH_MAIN" --force

# ---------- 用 worktree 推送静态站到 gh-pages（不动源码树） ----------

echo "==> 构建静态站 → $BRANCH_PAGES"
WT="$(mktemp -d)"
git worktree add -q --detach "$WT"
cleanup() { git worktree remove --force "$WT" 2>/dev/null || true; rm -rf "$WT" 2>/dev/null || true; }
trap cleanup EXIT

rm -rf "${WT:?}"/*
cp -r "$ROOT/public"/. "$WT/"
touch "$WT/.nojekyll"

cd "$WT"
git checkout -q --orphan "$BRANCH_PAGES.tmp" 2>/dev/null || git checkout -q --orphan "${BRANCH_PAGES}-$(date +%s)"
git add -A
git -c user.name="Finn-jiejie" -c user.email="2741169289@qq.com" \
  commit -q -m "deploy: $(date '+%Y-%m-%d %H:%M:%S')"
git branch -M "$BRANCH_PAGES"
git push -f origin "$BRANCH_PAGES"

cd "$ROOT"
cleanup
trap - EXIT

# ---------- 开启 Pages ----------

echo "==> 配置 GitHub Pages"
gh api -X POST "repos/$USER_NAME/$REPO/pages" \
  -f "source[branch]=$BRANCH_PAGES" -f "source[path]=/" >/dev/null 2>&1 \
  && echo "    Pages 已开启" \
  || gh api -X PUT "repos/$USER_NAME/$REPO/pages" \
       -f "source[branch]=$BRANCH_PAGES" -f "source[path]=/" >/dev/null 2>&1 \
       && echo "    Pages 已更新" \
       || echo "    （Pages 可能已配置，或需手动去 Settings → Pages 选 $BRANCH_PAGES 分支）"

echo
echo "=========================================="
echo "  源码仓库: https://github.com/$USER_NAME/$REPO"
echo "  在线地址: $PAGES_URL"
echo "  （首次部署需等 1–2 分钟生效）"
echo "=========================================="
