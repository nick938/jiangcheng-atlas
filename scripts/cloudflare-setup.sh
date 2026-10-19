#!/usr/bin/env bash
# 江城图志 · Cloudflare 上线前预检 / 执行脚本
#
# 用法：
#   bash scripts/cloudflare-setup.sh                 # 只读预检（不修改任何线上资源）
#   bash scripts/cloudflare-setup.sh --backup        # 预检 + 先做一次 D1/R2 备份（推荐在迁移前）
#   bash scripts/cloudflare-setup.sh --apply         # 预检通过后：建 R2 缓存桶 + 跑远程迁移
#   bash scripts/cloudflare-setup.sh --apply --deploy # 再执行一次生产部署（bun run deploy）
#
# 前置：
#   - 已登录：wrangler login（交互式）或设置 CLOUDFLARE_API_TOKEN（建议权限：
#     Workers Scripts:Edit、D1:Edit、R2:Edit、Account Settings:Read）
#   - 本机有 jq（备份脚本需要）
#
# 说明：
#   - 脚本不会读取也不会打印任何 secret 的值，只校验名字是否存在。
#   - --apply 的迁移包含 0011（社区帖子表）与 0012（revalidations 表），
#     其中 0011 会重建 community_reports / user_notifications 两张表（SQLite 扩容 CHECK 的唯一办法），
#     已在本地用真实数据验证过数据保留，但生产执行前建议先 --backup。

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DB_NAME="jiangcheng-atlas-db"
CACHE_BUCKET="jiangcheng-atlas-next-cache"
# 关键 secret：缺失会导致登录/后台不可用，--apply 会中止
REQUIRED_SECRETS=(ADMIN_PASSWORD ADMIN_SESSION_SECRET USER_AUTH_SECRET)
# 可选 secret：微信登录没配置时功能自动降级，只提示不阻塞
OPTIONAL_SECRETS=(WECHAT_APP_ID WECHAT_APP_SECRET)

APPLY=0
DEPLOY=0
BACKUP=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --deploy) APPLY=1; DEPLOY=1 ;;
    --backup) BACKUP=1 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "未知参数：${arg}（可用：--apply / --deploy / --backup）" >&2; exit 2 ;;
  esac
done

if ! command -v bunx >/dev/null 2>&1; then
  echo "找不到 bunx：请把 bun 加入 PATH（本机可用 export PATH=\"$HOME/.bun/bin:$PATH\"）" >&2
  exit 1
fi

step() { printf '\n=== %s ===\n' "$1"; }
wrangler() { bunx wrangler "$@"; }

step "1/6 登录状态"
if ! wrangler whoami >/tmp/cf-whoami.txt 2>&1; then
  cat /tmp/cf-whoami.txt >&2
  echo "未登录或 token 已过期：请先执行 bunx wrangler login，或设置 CLOUDFLARE_API_TOKEN。" >&2
  exit 1
fi
grep -E "Account Name|Account ID|associated with the email" /tmp/cf-whoami.txt || cat /tmp/cf-whoami.txt

step "2/6 D1 待应用迁移"
wrangler d1 migrations list "$DB_NAME" --remote

step "3/6 R2 缓存桶（${CACHE_BUCKET}）"
if wrangler r2 bucket list 2>/dev/null | grep -q "name: *$CACHE_BUCKET"; then
  echo "已存在：$CACHE_BUCKET"
  BUCKET_MISSING=0
else
  echo "缺失：$CACHE_BUCKET"
  BUCKET_MISSING=1
fi

step "4/6 Secrets 名称校验（不显示值）"
SECRET_JSON="$(wrangler secret list 2>/dev/null || echo '[]')"
missing=()
for name in "${REQUIRED_SECRETS[@]}"; do
  if printf '%s' "$SECRET_JSON" | grep -q "\"name\": *\"$name\""; then
    echo "  ✓ ${name}（必需）"
  else
    echo "  ✗ ${name}（必需，缺失）"
    missing+=("$name")
  fi
done
for name in "${OPTIONAL_SECRETS[@]}"; do
  if printf '%s' "$SECRET_JSON" | grep -q "\"name\": *\"$name\""; then
    echo "  ✓ ${name}（可选）"
  else
    echo "  - ${name}（可选，未配置：微信登录会显示“等待开放平台配置”）"
  fi
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo
  echo "缺失的 secret 需要用下面的命令逐个设置（值由你输入，不会进入仓库）："
  for name in "${missing[@]}"; do echo "  bunx wrangler secret put $name"; done
fi

step "5/6 计划"
echo "  缓存桶：$([ "$BUCKET_MISSING" = 1 ] && echo '需要创建' || echo '已就绪')"
echo "  远程迁移：待应用条目见上方第 2 步列表（本次应包含 0011、0012）"
echo "  备份：$([ "$BACKUP" = 1 ] && echo '会先执行' || echo '未开启（可加 --backup）')"
echo "  部署：$([ "$DEPLOY" = 1 ] && echo '会执行 bun run deploy' || echo '不执行')"

if [ "$APPLY" = 0 ]; then
  echo
  echo "只读预检完成。确认无误后执行：bash scripts/cloudflare-setup.sh --backup --apply"
  exit 0
fi

if [ "${#missing[@]}" -gt 0 ]; then
  echo
  echo "存在缺失的 secret，先按上面的命令补齐再执行 --apply。已中止。" >&2
  exit 1
fi

if [ "$BACKUP" = 1 ]; then
  step "6/6 备份"
  bash scripts/backup-cloudflare.sh
else
  step "6/6 变更"
fi

if [ "$BUCKET_MISSING" = 1 ]; then
  echo "创建 R2 桶：$CACHE_BUCKET"
  wrangler r2 bucket create "$CACHE_BUCKET"
else
  echo "跳过创建（已存在）"
fi

echo "应用远程 D1 迁移（0011 社区帖子、0012 revalidations）"
bun run db:migrate:remote

if [ "$DEPLOY" = 1 ]; then
  echo "生产部署：bun run deploy"
  bun run deploy
else
  echo
  echo "已完成建桶与迁移（未部署）。部署命令：bun run deploy"
  echo "部署后建议验证："
  echo "  BASE_URL=https://atlas.sololeveling.top bash scripts/smoke.sh"
  echo "  curl -sf https://atlas.sololeveling.top/api/health"
  echo "  curl -sI https://atlas.sololeveling.top/place/east-lake | grep -i cache-control"
fi
