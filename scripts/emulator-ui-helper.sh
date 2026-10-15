#!/usr/bin/env bash
# 模拟器 UI 交互助手：按「界面上的文字」定位元素，而不是写死坐标。
# 用法：
#   bash /tmp/uihelper.sh dump            # 抓取并打印可读节点
#   bash /tmp/uihelper.sh find "登录"      # 打印匹配节点的中心坐标
#   bash /tmp/uihelper.sh tap "登录"       # 点第一个匹配节点
#   bash /tmp/uihelper.sh tapxy 500 1200  # 按坐标点
#   bash /tmp/uihelper.sh back            # 按系统返回键
#   bash /tmp/uihelper.sh text "abc"      # 输入文本（当前焦点）
#   bash /tmp/uihelper.sh focus <x> <y>   # 点一下（常用于聚焦输入框）
set -uo pipefail
export ANDROID_HOME='D:\Android\sdk'
export PATH="/d/Android/jdk17/bin:/d/Android/sdk/platform-tools:$PATH"
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"

DUMP=/tmp/kun-ui.xml

dump_raw() {
  adb shell uiautomator dump /sdcard/kun-ui.xml >/dev/null 2>&1
  adb pull /sdcard/kun-ui.xml "$DUMP" >/dev/null 2>&1
}

list_nodes() {
  python - "$DUMP" <<'PY'
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
    if len(nums) == 4:
        cx, cy = (nums[0] + nums[2]) // 2, (nums[1] + nums[3]) // 2
    else:
        cx = cy = -1
    print(f"{cx:>5},{cy:>5}  click={clickable:<5} {cls.split('.')[-1]:<16} text={text!r} desc={desc!r}")
PY
}

find_node() {
  python - "$DUMP" "$1" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding='utf-8', errors='replace').read()
needle = sys.argv[2]
found = []
for m in re.finditer(r'<node[^>]*>', xml):
    node = m.group(0)
    def attr(name):
        a = re.search(rf'{name}="([^"]*)"', node)
        return a.group(1) if a else ''
    text, desc, bounds = attr('text'), attr('content-desc'), attr('bounds')
    if needle in text or needle in desc:
        nums = [int(n) for n in re.findall(r'\d+', bounds)]
        if len(nums) == 4:
            found.append(((nums[0] + nums[2]) // 2, (nums[1] + nums[3]) // 2))
print(found[0][0], found[0][1]) if found else print("")
PY
}

case "${1:-}" in
  dump)
    dump_raw; list_nodes ;;
  find)
    dump_raw; find_node "$2" ;;
  tap)
    dump_raw; xy=$(find_node "$2")
    if [ -z "$xy" ]; then echo "NO_MATCH:$2"; exit 1; fi
    echo "tap $2 -> $xy"; adb shell input tap $xy ;;
  tapxy)
    adb shell input tap "$2" "$3" ;;
  back)
    adb shell input keyevent 4 ;;
  text)
    adb shell input text "$2" ;;
  focus)
    adb shell input tap "$2" "$3"; sleep 1 ;;
  focused)
    adb shell dumpsys window 2>/dev/null | grep -E "mCurrentFocus" | head -1 ;;
  pid)
    adb shell pidof com.talkfirst.app ;;
  *)
    echo "用法见脚本头部" ;;
esac
