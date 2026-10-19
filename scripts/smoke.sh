#!/usr/bin/env bash
# 生产/预览冒烟测试：不修改任何数据，只读校验关键路由、SEO 与安全响应头。
#
# 用法：
#   BASE_URL=http://127.0.0.1:8787 bash scripts/smoke.sh
#   MEDIA_KEY=places/<placeId>/<uuid>.jpg bash scripts/smoke.sh   # 可选，校验 Worker /media 回退
#   MEDIA_KEY=... MEDIA_CDN_BASE=https://media.atlas.sololeveling.top bash scripts/smoke.sh  # 顺带校验 CDN 直出
#   SMOKE_SKIP=/community bash scripts/smoke.sh                   # 本地调试时临时跳过（CI 不要用）
#
# 环境变量：
#   BASE_URL           默认 http://127.0.0.1:8787
#   MEDIA_KEY          可选，R2 中真实存在的对象键；为空则跳过图片检查
#   MEDIA_CDN_BASE     可选，R2 自定义域基地址；与 MEDIA_KEY 同时设置时额外校验 CDN 直出与边缘缓存
#   SMOKE_SKIP         逗号/空格分隔的要跳过的路径列表
#   SMOKE_WAIT_SECONDS 启动等待秒数，默认 60（CI 起 preview 后无需自己 sleep）
#   SMOKE_TIMEOUT      单次请求超时秒数，默认 15
set -uo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8787}"
MEDIA_KEY="${MEDIA_KEY:-}"
MEDIA_CDN_BASE="${MEDIA_CDN_BASE:-}"
SMOKE_SKIP="${SMOKE_SKIP:-}"
SMOKE_WAIT_SECONDS="${SMOKE_WAIT_SECONDS:-60}"
SMOKE_TIMEOUT="${SMOKE_TIMEOUT:-15}"

pass=0
fail=0
tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT

skip_list=",${SMOKE_SKIP// /,},"

should_skip() {
  case "${skip_list}" in
    *",$1,"*) return 0 ;;
    *) return 1 ;;
  esac
}

ok() {
  printf '  ✓ %s\n' "$1"
  pass=$((pass + 1))
}

bad() {
  printf '  ✗ %s\n' "$1" >&2
  fail=$((fail + 1))
}

# 打印失败现场：状态码、响应头、响应体片段
dump() {
  local path="$1" extra="${2:-}"
  printf '    --- %s%s ---\n' "${BASE_URL}" "${path}" >&2
  [ -n "${extra}" ] && printf '    %s\n' "${extra}" >&2
  [ -s "${tmp}/status" ] && printf '    status: %s\n' "$(cat "${tmp}/status")" >&2
  if [ -s "${tmp}/headers" ]; then
    sed -n '1,25p' "${tmp}/headers" | sed 's/^/    /' >&2
  fi
  if [ -s "${tmp}/body" ]; then
    printf '    body: %s\n' "$(head -c 400 "${tmp}/body" | tr '\n' ' ')" >&2
  fi
  printf '    ------------------------------\n' >&2
}

fetch() {
  local path="$1" url
  # 绝对 URL（例如 CDN 自定义域）直接使用，其余拼到 BASE_URL 之后
  case "${path}" in
    http://*|https://*) url="${path}" ;;
    *) url="${BASE_URL}${path}" ;;
  esac
  : > "${tmp}/body"
  : > "${tmp}/headers"
  curl -sS --max-time "${SMOKE_TIMEOUT}" -D "${tmp}/headers" -o "${tmp}/body" \
    -w '%{http_code}' "${url}" > "${tmp}/status" 2> "${tmp}/curl.err" || true
  if [ ! -s "${tmp}/status" ]; then
    printf '000' > "${tmp}/status"
  fi
}

expect_status() {
  local path="$1" want="$2" got
  got="$(cat "${tmp}/status")"
  if [ "${got}" = "${want}" ]; then
    ok "GET ${path} → ${got}"
  else
    bad "GET ${path} → ${got}（期望 ${want}）"
    dump "${path}"
    return 1
  fi
}

expect_body() {
  local path="$1" needle="$2"
  if grep -qF -- "${needle}" "${tmp}/body"; then
    ok "${path} 响应体包含 ${needle}"
  else
    bad "${path} 响应体缺少 ${needle}"
    dump "${path}"
    return 1
  fi
}

expect_header() {
  local path="$1" header="$2" want="$3" got
  got="$(grep -i "^${header}:" "${tmp}/headers" | head -1 | sed "s/^[^:]*:[[:space:]]*//" | tr -d '\r')"
  if [ -z "${got}" ]; then
    bad "${path} 缺少响应头 ${header}"
    dump "${path}"
    return 1
  fi
  case "${got}" in
    *"${want}"*)
      ok "${path} ${header}: ${got}"
      ;;
    *)
      bad "${path} ${header} 不符合预期（期望包含 ${want}，实际 ${got}）"
      dump "${path}"
      return 1
      ;;
  esac
}

check_page() {
  local path="$1"
  if should_skip "${path}"; then
    printf '  - 跳过 %s（SMOKE_SKIP）\n' "${path}"
    return 0
  fi
  fetch "${path}"
  expect_status "${path}" 200 || return 0
  expect_body "${path}" "$2" || true
}

printf '冒烟测试目标：%s\n' "${BASE_URL}"

printf '等待 /api/health 就绪（最多 %s 秒）...\n' "${SMOKE_WAIT_SECONDS}"
deadline=$(( $(date +%s) + SMOKE_WAIT_SECONDS ))
ready=0
while :; do
  if curl -fsS --max-time 5 "${BASE_URL}/api/health" > /dev/null 2>&1; then
    ready=1
    break
  fi
  if [ "$(date +%s)" -ge "${deadline}" ]; then
    break
  fi
  sleep 2
done
if [ "${ready}" != "1" ]; then
  bad "服务在 ${SMOKE_WAIT_SECONDS}s 内未就绪：${BASE_URL}/api/health"
  fail=$((fail + 1))
  printf '冒烟失败：%s 不可用\n' "${BASE_URL}" >&2
  exit 1
fi

printf '\n[1/4] 健康检查与 API\n'
fetch "/api/health"
expect_status "/api/health" 200 || true
expect_body "/api/health" '"status":"ok"' || true

fetch "/api/places"
expect_status "/api/places" 200 || true

printf '\n[2/4] 页面\n'
check_page "/" "江城图志"
check_page "/place/east-lake" "东湖"
check_page "/community" "社区"

printf '\n[3/4] SEO\n'
check_page "/sitemap.xml" "<urlset"
check_page "/robots.txt" "sitemap"

printf '\n[4/4] 安全响应头与图片\n'
fetch "/"
expect_header "/" "x-content-type-options" "nosniff" || true
expect_header "/" "referrer-policy" "strict-origin-when-cross-origin" || true
expect_header "/" "content-security-policy-report-only" "default-src" || true

if [ -n "${MEDIA_KEY}" ]; then
  fetch "/media/${MEDIA_KEY}"
  expect_status "/media/${MEDIA_KEY}" 200 || true
  expect_header "/media/${MEDIA_KEY}" "cache-control" "max-age" || true
else
  printf '  - 跳过 /media 检查（未设置 MEDIA_KEY）\n'
fi

if [ -n "${MEDIA_KEY}" ] && [ -n "${MEDIA_CDN_BASE}" ]; then
  cdn_url="${MEDIA_CDN_BASE%/}/${MEDIA_KEY}"
  fetch "${cdn_url}"
  expect_status "${cdn_url}" 200 || true
  expect_header "${cdn_url}" "content-type" "image/" || true
  expect_header "${cdn_url}" "cache-control" "immutable" || true
elif [ -n "${MEDIA_CDN_BASE}" ]; then
  printf '  - 跳过 CDN 检查（未设置 MEDIA_KEY）\n'
fi

printf '\n结果：%s 项通过，%s 项失败\n' "${pass}" "${fail}"
if [ "${fail}" -gt 0 ]; then
  exit 1
fi
