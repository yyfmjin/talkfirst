#!/usr/bin/env bash
# 模拟器 UI 交互助手：按「界面上的文字」定位元素，而不是写死坐标。
#
# 路径注意：adb.exe 与 Windows 版 Python 都按 Windows 规则解析路径，
# 所以这里一律用 `D:/Android/kun-ui.xml` 这种形式，不用 /tmp（Git Bash 的 /tmp
# 与 Windows 的 \tmp 不是同一个地方，两边会对不上）。
#
# 用法：
#   bash scripts/emulator-ui-helper.sh dump        # 列出可读节点与中心坐标
#   bash scripts/emulator-ui-helper.sh inputs      # 只看输入框（内容/是否聚焦）
#   bash scripts/emulator-ui-helper.sh tap "登录"   # 点第一个匹配节点
#   bash scripts/emulator-ui-helper.sh tapxy 540 1209
#   bash scripts/emulator-ui-helper.sh back        # 系统返回键
#   bash scripts/emulator-ui-helper.sh text "abc"  # 向当前焦点输入文本
#   bash scripts/emulator-ui-helper.sh pid
#   bash scripts/emulator-ui-helper.sh focus       # 看当前焦点窗口
set -uo pipefail
export ANDROID_HOME='D:\Android\sdk'
export PATH="/d/Android/jdk17/bin:/d/Android/sdk/platform-tools:$PATH"
# 不让 Git Bash 把 /sdcard/... 改写成 Windows 路径（adb.exe 自己要这个原始路径）。
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"

DUMP_WIN="D:/Android/kun-ui.xml"
# 与 DUMP_WIN 保持**同一个字符串**：bash 的 test/-s 与 Windows 版 Python 都按
# Windows 规则解析它，两边才会指向同一个文件。
DUMP_LOCAL="D:/Android/kun-ui.xml"

dump_raw() {
  # uiautomator 偶尔报 "could not get idle state"（界面正在动）—— 重试几次就好了。
  # 每次都先删掉本地旧文件：否则上一轮的 dump 会让重试逻辑直接返回**过期界面**。
  rm -f "$DUMP_LOCAL"
  for _ in 1 2 3 4; do
    adb shell uiautomator dump /sdcard/kun-ui.xml >/dev/null 2>&1
    adb pull /sdcard/kun-ui.xml "$DUMP_WIN" >/dev/null 2>&1
    if [ -s "$DUMP_LOCAL" ]; then return 0; fi
    sleep 2
  done
  echo "DUMP_FAILED" >&2
  return 1
}

list_nodes() {
  python - "$DUMP_LOCAL" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding='utf-8', errors='replace').read()
for m in re.finditer(r'<node[^>]*>', xml):
    node = m.group(0)
    def attr(name):
        a = re.search(rf'{name}="([^"]*)"', node)
        return a.group(1) if a else ''
    text, desc, cls, bounds, clickable = attr('text'), attr('content-desc'), attr('class'), attr('bounds'), attr('clickable')
    if not (text or desc):
        continue
    nums = [int(n) for n in re.findall(r'\d+', bounds)]
    cx, cy = ((nums[0] + nums[2]) // 2, (nums[1] + nums[3]) // 2) if len(nums) == 4 else (-1, -1)
    print(f"{cx:>5},{cy:>5}  click={clickable:<5} {cls.split('.')[-1]:<16} text={text!r} desc={desc!r}")
PY
}

list_inputs() {
  python - "$DUMP_LOCAL" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding='utf-8', errors='replace').read()
for m in re.finditer(r'<node[^>]*>', xml):
    node = m.group(0)
    def attr(name):
        a = re.search(rf'{name}="([^"]*)"', node)
        return a.group(1) if a else ''
    if attr('class').endswith('EditText'):
        print('EditText', attr('bounds'), 'text=', repr(attr('text')), 'focused=', attr('focused'))
PY
}

find_node() {
  python - "$DUMP_LOCAL" "$1" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding='utf-8', errors='replace').read()
needle = sys.argv[2]
for m in re.finditer(r'<node[^>]*>', xml):
    node = m.group(0)
    def attr(name):
        a = re.search(rf'{name}="([^"]*)"', node)
        return a.group(1) if a else ''
    if needle in attr('text') or needle in attr('content-desc'):
        nums = [int(n) for n in re.findall(r'\d+', attr('bounds'))]
        if len(nums) == 4:
            print((nums[0] + nums[2]) // 2, (nums[1] + nums[3]) // 2)
            break
PY
}

case "${1:-}" in
  dump)   dump_raw; list_nodes ;;
  inputs) dump_raw; list_inputs ;;
  find)   dump_raw; find_node "$2" ;;
  tap)
    dump_raw
    xy=$(find_node "$2")
    if [ -z "$xy" ]; then echo "NO_MATCH:$2"; exit 1; fi
    echo "tap '$2' -> $xy"
    adb shell input tap $xy ;;
  tapxy)  adb shell input tap "$2" "$3" ;;
  back)   adb shell input keyevent 4 ;;
  text)   adb shell input text "$2" ;;
  pid)    adb shell pidof com.talkfirst.app ;;
  focus)  adb shell dumpsys window | grep -E "mCurrentFocus" | head -1 ;;
  *)      echo "用法见脚本头部" ;;
esac
