#!/bin/sh
# common.sh 自测 —— 针对本项目踩过的那类"静默失败"逐条验证。
#
# 为什么这些用例值得存在：被修掉的缺陷全是"脚本退出 0 但结论是错的"，
# 它们不会让任何测试变红，只会让合规文档变成纸面承诺。所以这里**必须**断言退出码，
# 而不只是打印一行结果。
#
# 用法：sh deploy/lib/common-selftest.sh
set -u

SELF_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source-path=SCRIPTDIR
# shellcheck source=common.sh
. "$SELF_DIR/common.sh"

pass=0
fail=0
t() {
  # $1 名称，$2 期望的"通过/失败"，$3 实际结果（1/0）
  if [ "$2" = "$3" ]; then
    printf '  ok   %s\n' "$1"
    pass=$((pass + 1))
  else
    printf '  FAIL %s（期望 %s，实际 %s）\n' "$1" "$2" "$3"
    fail=$((fail + 1))
  fi
}

TMPDIR_T="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_T"' EXIT
export APP_DIR="$TMPDIR_T"
export HK_LOG="$TMPDIR_T/test.log"
APP_DIR="$TMPDIR_T" hk_init selftest >/dev/null

echo "== hk_check 计数（这是被修掉的核心缺陷）=="

# 1) 全通过 -> 0
HK_CHECK_TOTAL=0; HK_CHECK_FAILED=0
hk_check 1 "a" >/dev/null
hk_check 1 "b" >/dev/null
t "两项都通过时 HK_CHECK_FAILED=0" "0" "$HK_CHECK_FAILED"
t "总数计到 2" "2" "$HK_CHECK_TOTAL"

# 2) 有失败 -> 计数不为 0（**原来的管道子 shell 写法会丢这个 1**）
HK_CHECK_TOTAL=0; HK_CHECK_FAILED=0
hk_check 1 "a" >/dev/null
hk_check 0 "b" >/dev/null
hk_check 1 "c" >/dev/null
t "一项失败时 HK_CHECK_FAILED=1" "1" "$HK_CHECK_FAILED"

# 3) 关键回归：hk_check 在 **管道子 shell** 里调用时，计数不会回流 ——
#    这正是 integrity-check.sh 原缺陷的形状。断言它确实丢，
#    以此说明"判定必须在主 shell 里"不是风格偏好而是必需。
HK_CHECK_TOTAL=0; HK_CHECK_FAILED=0
printf 'x\n' | while read -r _; do hk_check 0 "in-subshell" >/dev/null 2>&1; done
t "管道子 shell 内调用不会污染主 shell 计数（所以判定不能写在管道里）" "0" "$HK_CHECK_FAILED"

echo "== hk_finish 退出码 =="

# 4) 通过 -> 0，状态文件写 OK
HK_CHECK_TOTAL=0; HK_CHECK_FAILED=0
hk_check 1 "fine" >/dev/null
APP_DIR="$TMPDIR_T" hk_finish "t" "b" "$TMPDIR_T/s1" >/dev/null 2>&1
rc=$?
t "全通过时返回 0" "0" "$rc"
t "状态文件为 OK" "OK" "$(cat "$TMPDIR_T/s1" 2>/dev/null)"

# 5) 失败 -> 非 0（原来是恒 0），状态文件写 ALERT
HK_CHECK_TOTAL=0; HK_CHECK_FAILED=0
hk_check 0 "broken" >/dev/null
APP_DIR="$TMPDIR_T" hk_finish "t" "b" "$TMPDIR_T/s2" >/dev/null 2>&1
rc=$?
t "有失败项时返回非 0" "1" "$rc"
t "状态文件为 ALERT" "ALERT" "$(cat "$TMPDIR_T/s2" 2>/dev/null)"

echo "== verify_checksum =="

printf 'hello\n' > "$TMPDIR_T/f"
sha256sum "$TMPDIR_T/f" > "$TMPDIR_T/f.sha256"
verify_checksum "$TMPDIR_T/f" >/dev/null 2>&1
t "校验和匹配 -> 0" "0" "$?"
printf 'tampered\n' > "$TMPDIR_T/f"
verify_checksum "$TMPDIR_T/f" >/dev/null 2>&1
t "内容被改动 -> 非 0" "1" "$?"
rm -f "$TMPDIR_T/f.sha256"
verify_checksum "$TMPDIR_T/f" >/dev/null 2>&1
t "缺 .sha256 文件 -> 非 0" "1" "$?"

echo "== hk_ping 未配置时降级 =="

unset HEALTHCHECK_PING_URL
hk_ping ok >/dev/null 2>&1
t "未配置时返回 0 且不报错" "0" "$?"

echo "== hk_port =="

PORT=9999 hk_port >/dev/null
t "PORT 环境变量优先" "9999" "$(PORT=9999 hk_port)"
printf 'PORT=4321\n' > "$TMPDIR_T/.env"
t "回落到 .env 里的 PORT" "4321" "$(APP_DIR="$TMPDIR_T" hk_port)"
printf 'OTHER=1\n' > "$TMPDIR_T/.env"
t "都没有时用 3210" "3210" "$(APP_DIR="$TMPDIR_T" hk_port)"

echo
echo "自测：$pass 通过，$fail 失败"
[ "$fail" -eq 0 ] || exit 1
