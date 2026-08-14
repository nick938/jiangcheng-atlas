#!/usr/bin/env bash
set -euo pipefail

backup_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_root="${1:-backups/${backup_stamp}}"
database_name="jiangcheng-atlas-db"
bucket_name="jiangcheng-atlas-media"
wrangler_log="/tmp/jiangcheng-atlas-backup-${backup_stamp}.log"

mkdir -p "${backup_root}/r2"
WRANGLER_LOG_PATH="${wrangler_log}" bunx wrangler d1 export "${database_name}" --remote --output "${backup_root}/d1.sql" --skip-confirmation

keys_json="$(WRANGLER_LOG_PATH="${wrangler_log}" bunx wrangler d1 execute "${database_name}" --remote --json --command "SELECT object_key AS key FROM place_images WHERE object_key IS NOT NULL UNION SELECT image_key AS key FROM activities WHERE image_key IS NOT NULL")"
printf '%s' "${keys_json}" | jq -r '.[].results[]?.key' | while IFS= read -r object_key; do
  case "${object_key}" in
    ""|/*|*..*) printf '跳过不安全的对象键：%s\n' "${object_key}" >&2; continue ;;
  esac
  destination="${backup_root}/r2/${object_key}"
  mkdir -p "$(dirname "${destination}")"
  WRANGLER_LOG_PATH="${wrangler_log}" bunx wrangler r2 object get "${bucket_name}/${object_key}" --remote --file "${destination}"
done

printf '备份完成：%s\n' "${backup_root}"
printf '请将该目录加密后复制到与 Cloudflare 账号隔离的位置。\n'
