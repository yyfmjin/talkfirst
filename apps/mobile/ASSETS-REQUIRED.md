# mobile 静态资源（2026-10-06 已补齐）

`app.json` 里声明的三个 PNG **已经在仓库里**。这份文件原先写的是「必须由人补进来」，
现在改成：它们是什么、怎么重新生成、以及什么时候该换成设计稿。

| 文件 | `app.json` 中的键 | 尺寸 / 要求 | 当前状态 |
| --- | --- | --- | --- |
| `assets/icon.png` | `expo.icon` | 1024 × 1024，**不透明** | ✅ RGB，无 alpha（iOS 不接受透明） |
| `assets/adaptive-icon.png` | `expo.android.adaptiveIcon.foregroundImage` | 1024 × 1024，**带透明通道** | ✅ RGBA，图形半对角线 337.4 ≤ 安全区 338 |
| `assets/splash.png` | `expo.splash.image` | 1284 × 2778 | ✅ RGB |

## 图形语言（为什么长这样）

一个白色对话气泡，里面三个「正在输入」的点 —— 对应产品名 **TalkFirst**（先聊起来）。
三个点是**镂空**的：在实底图标上它们露出底色，在自适应图标前景层上是真透明，
由 Android 用 `app.json` 的 `backgroundColor` 合成。

只用两个值，都来自设计体系 `apps/web/src/design/tokens.ts`：

- `brand-500` = `#3B82F6`（底色；`app.json` 的背景色已从旧品牌紫 `#6B7CFF` 对齐到它）
- 白 = `neutral-0`

（`#6B7CFF` 是 Phase B 之前的旧品牌紫，成员端的 `HEX_MIGRATION` 里写着它应映射到 `brand-500`。）

## 重新生成

```bash
python scripts/generate-mobile-assets.py
```

脚本用 4 倍超采样后 LANCZOS 降采样，输出到 `apps/mobile/assets/`。
它**不覆盖 `app.json`**，只写这三张图。

## 什么时候该换成设计稿

现在是**按设计体系生成的可用版本**：尺寸、透明通道、安全区都符合 Expo/Android 的要求，
可以直接 prebuild / EAS 出包。等你有正式设计稿（或想让品牌图形换个形态）时，直接替换这三张同名 PNG 即可，
不需要改 `app.json`。

替换后建议照旧跑一次配置校验：

```bash
cd apps/mobile && npx expo config --type public
```

## 备注（原先就记着的，未改动）

- SDK 52 起官方更推荐用 `expo-splash-screen` 插件替代顶层的 `expo.splash` 键。
  本文件仍使用顶层 `splash`（SDK 52 依旧支持），因为 `expo-splash-screen` 并未安装在本工作区。
  若迁移到插件写法，请先安装依赖，并同时删除 `expo.splash` 键，避免两处配置互相覆盖。
- `assets/` 目录未被 `.gitignore` 忽略，所以这三张图会正常入库。
