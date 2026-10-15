# Play 商店素材

这里的图都是**可复现的产物**，不是手工摆出来的：`make-assets.py` 一次生成图标与横幅，
截图来自模拟器上真实跑的 App。

| 文件 | 用途 | 规格 | 怎么来的 |
|---|---|---|---|
| `icon-512.png` | 商店页图标 | 512×512、32 位 PNG | `make-assets.py`（App 图标等比缩放） |
| `feature-graphic-1024x500.png` | 商店页顶部横幅 | 1024×500、24 位 PNG（**无 alpha**） | `make-assets.py` |
| `screenshot-1-login.png` | 应用截图 | 1080×2400（模拟器原始分辨率） | 模拟器 `adb exec-out screencap` |
| `screenshot-2-register.png` | 应用截图（含注册同意闸门） | 同上 | 同上 |

重新生成图标与横幅：

```bash
python docs/play-assets/make-assets.py
```

## 截图为什么是这两张

Play 要求**至少 2 张**手机截图，并且截图必须来自真实运行的 App。目前仓库里没有演示账号，
模拟器（全新安装）只能停在登录页 —— 所以第一张是登录页，第二张是**注册页**（正好能看到
这次为了上架加的同意闸门：勾选框 +《用户协议》《隐私政策》）。

要更漂亮的商店图，等控台上「内部测试」时用你给的**审核账号**登录真机/模拟器，
再补拍发现、动态、消息三屏即可；命令一样：

```bash
export ANDROID_HOME='D:\Android\sdk'
"$ANDROID_HOME/platform-tools/adb.exe" exec-out screencap -p > docs/play-assets/screenshot-3-discover.png
```

## 截图规格备注

Play 只对尺寸有硬要求（每边 320–3840 px、等宽高比 16:9 或 9:16 二选一并保持一致）。
1080×2400 是 9:19.5，**不满足 9:16**，上传时控制台会要求裁剪或接受较短的一边 ——
如果被拦，用同一批脚本按 1080×1920 裁一次（上部对齐）再传：

```bash
python - <<'PY'
from PIL import Image
for name in ("screenshot-1-login", "screenshot-2-register"):
    im = Image.open(f"docs/play-assets/{name}.png")
    im.crop((0, 0, 1080, 1920)).save(f"docs/play-assets/{name}-9x16.png")
PY
```
