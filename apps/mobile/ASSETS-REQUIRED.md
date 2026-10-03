# 缺失的静态资源（构建前必须补齐）

`app.json` 现在已经把 Expo 约定路径全部配好，但 `apps/mobile/assets/` 目录**不存在**。
下面三个 PNG 必须由人（设计师 / 设计稿导出）补进仓库：

| 文件 | `app.json` 中的键 | 建议尺寸 | 说明 |
| --- | --- | --- | --- |
| `assets/icon.png` | `expo.icon` | 1024 × 1024 px，正方形，PNG，**不要透明** | iOS 与 Android 共用；Expo 会自动生成各密度图标。 |
| `assets/adaptive-icon.png` | `expo.android.adaptiveIcon.foregroundImage` | 1024 × 1024 px，PNG，**带透明通道** | Android 自适应图标前景层。 |
| `assets/splash.png` | `expo.splash.image` | 1284 × 2778 px（或同等比例，长边 ≤ 1284），PNG | 启动图，居中显示（`resizeMode: "contain"`）。 |

## 为什么这件事必须在构建前完成

`app.json` 里的路径只是**字符串**：Expo 配置阶段不会校验文件是否存在，所以
`npm run build`（`expo export`）可以正常通过，而 `expo run:android` /
`expo run:ios` / `eas build` 会在预构建（prebuild）时因为找不到文件而失败，
或打出没有图标/启动图的包。这正是"配置完整"和"构建可用"之间的差别。

## 补齐方式

```bash
# 目录不存在，需要新建
mkdir apps/mobile/assets
# 然后把三个 PNG 放进去，文件名必须与上表完全一致（大小写敏感）
```

放好之后无需改动 `app.json`。可用下面的命令确认配置确实能读到资源：

```bash
npx expo config --type public   # 在 apps/mobile 目录下执行
```

## 备注（未改动，供后续决策）

- SDK 52 起官方更推荐用 `expo-splash-screen` 插件替代顶层的 `expo.splash` 键。
  本文件仍使用顶层 `splash`（SDK 52 依旧支持），因为 `expo-splash-screen`
  并未安装在本工作区。若迁移到插件写法，请先安装依赖，并同时删除这里的
  `expo.splash` 键，避免两处配置互相覆盖。
- `assets/` 目录未被 `.gitignore` 忽略，因此补进来的图片会正常入库。
