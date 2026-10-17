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

# 每条用例都必须**先清掉 PORT**：hk_port 是 shell 函数，而「前置赋值 + 函数调用」
# 在不同 shell 下行为不一致 —— 某些实现会把 PORT 留在当前环境里，于是后面两条
# "应该回落到 .env / 默认值" 的用例全部读到 9999 而失败（2026-10-17 在服务器上实测到，
# 且当时汇总的 exit 0 让它完全没被发现）。这不是被测代码的问题，是**用例互相污染**。
t "PORT 环境变量优先" "9999" "$(PORT=9999 hk_port)"
unset PORT
printf 'PORT=4321\n' > "$TMPDIR_T/.env"
t "回落到 .env 里的 PORT" "4321" "$(APP_DIR="$TMPDIR_T" hk_port)"
unset PORT
printf 'OTHER=1\n' > "$TMPDIR_T/.env"
t "都没有时用 3210" "3210" "$(APP_DIR="$TMPDIR_T" hk_port)"
unset PORT

echo

echo "== hk_source_env：.env 里的 shell 元字符不再被求值 =="

# 真实事故（2026-10-17）：FEISHU_ADMINS 的值里有 `|`，被 shell 解析成管道，
# 每日备份静默中断两天 —— timer 显示跑过、实际零产出。值必须原样取，不能求值。
printf 'PLAIN=abc\n' > "$TMPDIR_T/meta.env"
( unset PLAIN; hk_source_env "$TMPDIR_T/meta.env" >/dev/null 2>&1; printf '%s' "${PLAIN:-}" ) > "$TMPDIR_T/out"
t "普通值原样读出" "abc" "$(cat "$TMPDIR_T/out")"

printf 'WITH_PIPE=a@b.com|c@d.com\n' > "$TMPDIR_T/meta.env"
( unset WITH_PIPE; hk_source_env "$TMPDIR_T/meta.env" >/dev/null 2>&1; printf '%s' "${WITH_PIPE:-}" ) > "$TMPDIR_T/out"
t "值里的竖线不被当管道（备份静默中断的真因）" "a@b.com|c@d.com" "$(cat "$TMPDIR_T/out")"

printf 'WITH_CMD=$(rm -rf /)\n' > "$TMPDIR_T/meta.env"
( unset WITH_CMD; hk_source_env "$TMPDIR_T/meta.env" >/dev/null 2>&1; printf '%s' "${WITH_CMD:-}" ) > "$TMPDIR_T/out"
t "值里的命令替换不被执行" '$(rm -rf /)' "$(cat "$TMPDIR_T/out")"

printf 'QUOTED="带引号的值"\n' > "$TMPDIR_T/meta.env"
( unset QUOTED; hk_source_env "$TMPDIR_T/meta.env" >/dev/null 2>&1; printf '%s' "${QUOTED:-}" ) > "$TMPDIR_T/out"
t "两端引号被剥掉" "带引号的值" "$(cat "$TMPDIR_T/out")"

printf 'WITH_EQ=a=b=c\n' > "$TMPDIR_T/meta.env"
( unset WITH_EQ; hk_source_env "$TMPDIR_T/meta.env" >/dev/null 2>&1; printf '%s' "${WITH_EQ:-}" ) > "$TMPDIR_T/out"
t "值里的等号只按第一个切分" "a=b=c" "$(cat "$TMPDIR_T/out")"

# 非 KEY=VALUE 的行必须**报错**，不能默默跳过 —— 跳过会让脚本带着半份配置运行
printf 'OK=1\n这不是赋值行\n' > "$TMPDIR_T/meta.env"
if ( unset OK; hk_source_env "$TMPDIR_T/meta.env" ) >/dev/null 2>&1; then
  t "非 KEY=VALUE 的行导致失败" 1 0
else
  t "非 KEY=VALUE 的行导致失败" 1 1
fi

printf '# 注释行\n\nREAL=7\n' > "$TMPDIR_T/meta.env"
( unset REAL; hk_source_env "$TMPDIR_T/meta.env" >/dev/null 2>&1; printf '%s' "${REAL:-}" ) > "$TMPDIR_T/out"
t "注释与空行被跳过" "7" "$(cat "$TMPDIR_T/out")"

# 汇总与退出码必须在**所有**用例之后。
# 原先它排在文件中段，后来追加的用例失败时完全不影响退出码 ——
# 实测把一个期望值改错，脚本照样 exit 0。自测"失败了没人看见"比没有自测更糟。
echo "自测：$pass 通过，$fail 失败"
[ "$fail" -eq 0 ] || exit 1
