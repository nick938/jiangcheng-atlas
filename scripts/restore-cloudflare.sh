#!/usr/bin/env bash
# 从备份目录恢复 D1 / R2。默认只写临时库，任何针对生产资源的写操作都必须显式 --confirm。
#
# 用法：
#   bash scripts/restore-cloudflare.sh --dir backups/20260814T031248Z
#       → 只校验 manifest，并把 d1.sql 导入自动创建的临时库（不对生产库写入）
#   bash scripts/restore-cloudflare.sh --dir <备份目录> --prod --confirm
#       → 导入生产库 jiangcheng-atlas-db（危险，务必先做临时库演练）
#   bash scripts/restore-cloudflare.sh --dir <备份目录> --r2 --confirm
#       → 按 manifest 校验后，把 r2/ 下对象逐个写回生产桶
#   bash scripts/restore-cloudflare.sh --dir <备份目录> --dry-run
#       → 只打印将要执行的命令，不执行
set -euo pipefail

umask 077

prod_database="jiangcheng-atlas-db"
bucket_name="jiangcheng-atlas-media"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"

backup_dir=""
target_db=""
restore_r2=0
confirmed=0
dry_run=0
is_prod=0

usage() {
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dir)
      backup_dir="${2:-}"
      shift 2
      ;;
    --target-db)
      target_db="${2:-}"
      shift 2
      ;;
    --prod)
      target_db="${prod_database}"
      is_prod=1
      shift
      ;;
    --r2)
      restore_r2=1
      shift
      ;;
    --confirm)
      confirmed=1
      shift
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      printf '未知参数：%s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "${backup_dir}" ]; then
  printf '缺少 --dir 参数。\n\n' >&2
  usage >&2
  exit 2
fi

if [ ! -d "${backup_dir}" ]; then
  printf '备份目录不存在：%s\n' "${backup_dir}" >&2
  exit 1
fi

if [ ! -f "${backup_dir}/d1.sql" ]; then
  printf '备份目录缺少 d1.sql：%s\n' "${backup_dir}" >&2
  exit 1
fi

if [ ! -f "${backup_dir}/manifest.sha256" ]; then
  printf '备份目录缺少 manifest.sha256，无法校验完整性，拒绝继续。\n' >&2
  exit 1
fi

if [ "${is_prod}" -eq 1 ] && [ "${confirmed}" -ne 1 ]; then
  printf '拒绝对生产库 %s 执行恢复：必须显式加 --confirm（建议先不带 --prod 跑一次临时库演练）。\n' "${prod_database}" >&2
  exit 1
fi

if [ "${restore_r2}" -eq 1 ] && [ "${confirmed}" -ne 1 ]; then
  printf '拒绝写回生产桶 %s：必须显式加 --confirm。\n' "${bucket_name}" >&2
  exit 1
fi

if command -v shasum > /dev/null 2>&1; then
  sha256_check="shasum -a 256 -c"
elif command -v sha256sum > /dev/null 2>&1; then
  sha256_check="sha256sum -c"
else
  printf '缺少 shasum 或 sha256sum，无法校验备份。\n' >&2
  exit 1
fi

printf '== 1/3 校验备份完整性 ==\n'
( cd "${backup_dir}" && ${sha256_check} manifest.sha256 > /dev/null )
file_count="$(find "${backup_dir}" -type f | wc -l | tr -d ' ')"
printf '校验通过：%s 个文件。\n' "${file_count}"
[ -f "${backup_dir}/backup-meta.txt" ] && sed 's/^/  /' "${backup_dir}/backup-meta.txt"

if [ -z "${target_db}" ]; then
  target_db="jiangcheng-atlas-restore-${stamp}"
  printf '未指定 --target-db，使用临时库：%s\n' "${target_db}"
fi

run() {
  if [ "${dry_run}" -eq 1 ]; then
    printf '  [dry-run] %s\n' "$*"
    return 0
  fi
  printf '  $ %s\n' "$*"
  WRANGLER_LOG_PATH="/tmp/jiangcheng-atlas-restore-${stamp}.log" "$@"
}

printf '== 2/3 导入 D1 → %s ==\n' "${target_db}"
if [ "${target_db}" != "${prod_database}" ]; then
  if ! bunx wrangler d1 info "${target_db}" > /dev/null 2>&1; then
    printf '临时库不存在，先创建（可用 wrangler d1 delete 清理）。\n'
    run bunx wrangler d1 create "${target_db}"
  fi
else
  printf '⚠️  即将写入生产库，请确认已完成临时库演练。\n'
fi
run bunx wrangler d1 execute "${target_db}" --remote --yes --file "${backup_dir}/d1.sql"

if [ "${target_db}" != "${prod_database}" ]; then
  printf '建议校验：bunx wrangler d1 execute %s --remote --command "SELECT COUNT(*) FROM places"\n' "${target_db}"
fi

printf '== 3/3 图片 ==\n'
if [ "${restore_r2}" -ne 1 ]; then
  printf '未指定 --r2，跳过 R2 恢复。需要时执行：\n'
  printf '  bash scripts/restore-cloudflare.sh --dir %s --r2 --confirm\n' "${backup_dir}"
elif [ "${dry_run}" -eq 1 ]; then
  run bunx wrangler r2 object put "${bucket_name}/<key>" --remote --file "<备份目录>/r2/<key>"
else
  restored=0
  while IFS= read -r -d '' object_file; do
    object_key="${object_file#"${backup_dir}"/r2/}"
    run bunx wrangler r2 object put "${bucket_name}/${object_key}" --remote --file "${object_file}"
    restored=$((restored + 1))
  done < <(find "${backup_dir}/r2" -type f -print0)
  printf '已恢复 %s 个对象到 %s。\n' "${restored}" "${bucket_name}"
fi

printf '\n恢复流程结束。生产恢复后请执行：\n'
printf '  bash scripts/smoke.sh   # 或 BASE_URL=https://atlas.sololeveling.top bash scripts/smoke.sh\n'
