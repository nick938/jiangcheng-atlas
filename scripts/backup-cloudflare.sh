#!/usr/bin/env bash
# D1 + R2 备份。只读远端，不修改任何云端数据。
#
# 用法：
#   bun run backup:remote                       # 备份到 backups/<UTC 时间戳>/
#   bash scripts/backup-cloudflare.sh <目录>     # 指定目录
#   BACKUP_AGE_RECIPIENT=age1... bun run backup:remote   # 同时产出 age 加密包（需已装 age）
#
# 产物：
#   <目录>/d1.sql              完整 D1 导出（含 users 表，等同敏感数据）
#   <目录>/r2/<object_key>     数据库引用的全部 R2 图片
#   <目录>/manifest.sha256     逐文件校验和（恢复前必须校验）
#   <目录>/backup-meta.txt     备份元信息
#   <目录>.tar.gz.age          仅当设置 BACKUP_AGE_RECIPIENT 且系统有 age 时生成
set -euo pipefail

# 备份内容含密码哈希与用户数据，目录必须只有当前用户可读
umask 077

backup_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_root="${1:-backups/${backup_stamp}}"
database_name="jiangcheng-atlas-db"
bucket_name="jiangcheng-atlas-media"
wrangler_log="/tmp/jiangcheng-atlas-backup-${backup_stamp}.log"
age_recipient="${BACKUP_AGE_RECIPIENT:-}"

if command -v shasum > /dev/null 2>&1; then
  sha256_cmd="shasum -a 256"
elif command -v sha256sum > /dev/null 2>&1; then
  sha256_cmd="sha256sum"
else
  printf '缺少 shasum 或 sha256sum，无法生成校验和。\n' >&2
  exit 1
fi

if ! command -v jq > /dev/null 2>&1; then
  printf '缺少 jq，请先安装（macOS: brew install jq）。\n' >&2
  exit 1
fi

if ! command -v bunx > /dev/null 2>&1; then
  printf '缺少 bunx，请先安装 Bun 并确保 PATH 正确。\n' >&2
  exit 1
fi

printf '检查 Wrangler 登录态...\n'
if ! WRANGLER_LOG_PATH="${wrangler_log}" bunx wrangler whoami > /dev/null 2>&1; then
  printf 'Wrangler 未登录或凭据失效，请先执行：bunx wrangler login\n' >&2
  exit 1
fi

mkdir -p "${backup_root}/r2"

printf '导出 D1（%s）...\n' "${database_name}"
WRANGLER_LOG_PATH="${wrangler_log}" bunx wrangler d1 export "${database_name}" \
  --remote --output "${backup_root}/d1.sql" --skip-confirmation

printf '枚举 R2 对象键...\n'
keys_json="$(WRANGLER_LOG_PATH="${wrangler_log}" bunx wrangler d1 execute "${database_name}" --remote --json \
  --command "SELECT object_key AS key FROM place_images WHERE object_key IS NOT NULL UNION SELECT image_key AS key FROM activities WHERE image_key IS NOT NULL")"

image_count=0
skipped_count=0
failed_count=0

while IFS= read -r object_key; do
  [ -n "${object_key}" ] || continue
  case "${object_key}" in
    /*|*..*|*//*)
      printf '跳过不安全的对象键：%s\n' "${object_key}" >&2
      skipped_count=$((skipped_count + 1))
      continue
      ;;
  esac
  destination="${backup_root}/r2/${object_key}"
  mkdir -p "$(dirname "${destination}")"
  if WRANGLER_LOG_PATH="${wrangler_log}" bunx wrangler r2 object get \
    "${bucket_name}/${object_key}" --remote --file "${destination}"; then
    image_count=$((image_count + 1))
  else
    printf '对象下载失败：%s\n' "${object_key}" >&2
    failed_count=$((failed_count + 1))
  fi
done < <(printf '%s' "${keys_json}" | jq -r '.[].results[]?.key')

printf '生成校验和清单...\n'
(
  cd "${backup_root}"
  find . -type f ! -name manifest.sha256 -print0 | sort -z | xargs -0 ${sha256_cmd} > manifest.sha256
)

{
  printf 'backup_stamp=%s\n' "${backup_stamp}"
  printf 'database=%s\n' "${database_name}"
  printf 'bucket=%s\n' "${bucket_name}"
  printf 'r2_objects=%s\n' "${image_count}"
  printf 'r2_skipped=%s\n' "${skipped_count}"
  printf 'r2_failed=%s\n' "${failed_count}"
  printf 'wrangler=%s\n' "$(bunx wrangler --version 2> /dev/null || printf 'unknown')"
} > "${backup_root}/backup-meta.txt"

if [ -n "${age_recipient}" ]; then
  if command -v age > /dev/null 2>&1; then
    printf '使用 age 生成加密包...\n'
    tar -czf - -C "$(dirname "${backup_root}")" "$(basename "${backup_root}")" \
      | age -r "${age_recipient}" -o "${backup_root}.tar.gz.age"
  else
    printf '已设置 BACKUP_AGE_RECIPIENT 但未找到 age，跳过加密（不要长期保留明文备份）。\n' >&2
  fi
fi

printf '\n备份完成：%s\n' "${backup_root}"
printf '明文目录含密码哈希与用户数据，请加密后复制到与 Cloudflare 账号隔离的位置再删除本机副本。\n'
printf '恢复流程见 OPERATIONS.md 的“备份与恢复”章节（scripts/restore-cloudflare.sh）。\n'

if [ "${failed_count}" -gt 0 ]; then
  printf '有 %s 个 R2 对象下载失败，备份不完整，请重跑。\n' "${failed_count}" >&2
  exit 1
fi
