/**
 * App 端设计 token —— 与仓库根 `DESIGN.md` 的 7 级字号、圆角档位一一对应。
 *
 * 为什么这里只有数字、没有整套 TextStyle：
 * 这一轮迁移的目标是「换掉裸数字、不动像素」。如果把 lineHeight / fontWeight
 * 一起塞进 token，每一处引用都会顺带改行高与字重，全站版式会同时漂移，就没法
 * 一屏一屏核对了。字号与行高的配对规则写在 DESIGN.md，需要整组排版时按那里取值。
 *
 * 新代码不允许再写 `fontSize: 13` / `borderRadius: 14` 这类裸数字：要么用这里的
 * 档位，要么先把它补进 DESIGN.md 再补进这里。
 */

/** 字号档位（DESIGN.md「字号（7 级）」）。 */
export const sizes = {
  display: 28,
  title: 22,
  heading: 17,
  body: 15,
  ui: 14,
  caption: 12,
  overline: 11,
} as const;

/** 圆角档位（DESIGN.md「圆角（5 档）」）。`frame` 只给设备外框用。
 * 命名用 `radii`（不是 radius）：Avatar 这类组件内部有同名的局部常量 `radius`，
 * 同名导入会被局部变量遮蔽，编译器不报错但取到的是数字。 */
export const radii = {
  control: 18,
  row: 20,
  card: 24,
  sheet: 28,
  frame: 32,
  pill: 999,
} as const;
