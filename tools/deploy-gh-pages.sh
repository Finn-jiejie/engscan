#!/usr/bin/env bash
# 把 public/ 发布到 GitHub Pages（gh-pages 分支）
#
# 用法：  bash tools/deploy-gh-pages.sh <你的GitHub用户名> [仓库名]
# 例：    bash tools/deploy-gh-pages.sh Finn-jiejie engscan
#
# 前置：本机已登录 GitHub（git push 时能通过凭据验证）
# 发布后访问： https://<用户名>.github.io/<仓库名>/

set -euo pipefail

USER_NAME="${1:-}"
REPO="${2:-engscan}"

if [ -z "$USER_NAME" ]; then
  echo "用法: bash tools/deploy-gh-pages.sh <GitHub用户名> [仓库名]"
  echo "例:   bash tools/deploy-gh-pages.sh Finn-jiejie engscan"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUB="$ROOT/public"
REMOTE="https://github.com/$USER_NAME/$REPO.git"

echo "==> 发布目录: $PUB"
echo "==> 目标仓库: $REMOTE"
echo "==> 发布地址: https://$USER_NAME.github.io/$REPO/"
echo

# 安全闸：绝不能把 .env / 密钥 / 依赖目录推上去
if [ -f "$PUB/.env" ]; then
  echo "[X] public/ 里出现了 .env，停止发布。密钥绝不能进版本库。"
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> 复制静态文件到临时目录"
cp -r "$PUB"/. "$TMP/"

# 静态托管没有 OCR 后端，加个 .nojekyll 让 Pages 不做 Jekyll 处理
touch "$TMP/.nojekyll"

cd "$TMP"
git init -q
git checkout -q -b gh-pages
git add -A
git -c user.name="engscan-deploy" -c user.email="deploy@local" commit -q -m "deploy: $(date '+%Y-%m-%d %H:%M:%S')"

# 敏感文件自检（发布前最后一道闸）
if git ls-files | grep -qE '(^|/)(\.env|\.env\..*)$'; then
  echo "[X] 暂存区里发现了 .env，已中止。"
  exit 1
fi
echo "==> 待发布文件："
git ls-files | sed 's/^/    /'

echo
echo "==> 推送到 $REMOTE (gh-pages)"
git remote add origin "$REMOTE"
git push -f origin gh-pages

echo
echo "完成。若这是首次推送，去仓库 Settings → Pages 把 Source 设为 'gh-pages' 分支即可。"
echo "地址： https://$USER_NAME.github.io/$REPO/"
