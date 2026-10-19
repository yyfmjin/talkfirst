#!/usr/bin/env python3
"""扫一遍 web 端还有哪些**写死在代码里的中文**。

为什么要单独写一个：之前的扫描只看「引号里的字符串」，漏掉了 JSX 文本节点
（`<p>还没有视频</p>` 这种），于是报了「只剩 2 个」却实际还有十几处。
这个脚本两类都看，并跳过注释（行注释、块注释、JSX 注释）。

用法：
    python scripts/i18n-scan.py            # 打印 + 写 i18n-leftovers.txt
    python scripts/i18n-scan.py --web-only
退出码：0 = 只剩允许的例外；1 = 还有待办（方便以后接 CI）。
"""
import io
import os
import re
import sys

CJK = "[" + chr(0x4E00) + "-" + chr(0x9FFF) + "]"
ROOT = os.path.join("apps", "web", "src")

# 有意保留的中文：词典文件本身、内容标签、语言自称。
ALLOWED_FILES = {
    "lib/i18n/dictionary.ts",
    "lib/i18n/locales.ts",
    # 接口错误码的 zh/en 两套文案，本身就是词典（Record<Locale, ...>）。
    "lib/errors.ts",
    # 根布局的 metadata 是**中文站**的标题/描述；`app/en/layout.tsx` 另有一份英文的。
    "app/layout.tsx",
}
ALLOWED_SNIPPETS = [
    '"旅行"', '"美食"', '"音乐"', '"游戏"', '"摄影"', '"电影"', '"学习"', '"运动"',  # HOT_TOPICS：对外展示的话题
    '"中文"',  # 语言自称，英文界面也应显示「中文」
]

QUOTED = re.compile('"[^"]*' + CJK + '[^"]*"|`[^`]*' + CJK + '[^`]*`')
JSX_TEXT = re.compile(">[^<>{}]*" + CJK + "[^<>{}]*<")
BARE_TEXT = re.compile("^\\s*" + CJK + "[^<>{}]*$")


def scan(path):
    """返回 [(lineno, snippet)]，跳过注释。"""
    text = io.open(path, encoding="utf-8").read()
    lines = text.split("\n")
    hits = []
    in_block = False
    in_jsx_comment = False
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if in_jsx_comment:
            if "*/}" in line:
                in_jsx_comment = False
            continue
        if in_block:
            if "*/" in line:
                in_block = False
            continue
        if "{/*" in line and "*/}" not in line:
            in_jsx_comment = True
            continue
        if stripped.startswith(("#", "//")):
            continue
        if stripped.startswith("/*") or stripped.startswith("/**") or stripped.startswith("*"):
            if "*/" not in line:
                in_block = True
            continue

        # 去掉同一行里完整的 `{/* … */}` / `/* … */}` 注释段，再匹配。
        code = re.sub(r"\{/\*.*?\*/\}", "", line)
        code = re.sub(r"/\*.*?\*/", "", code)
        for match in QUOTED.findall(code):
            if any(skip in match for skip in ("className", "getBy", 'aria-label="')):
                continue
            hits.append((i, match))
        if not line.lstrip().startswith(("import", "export const metadata", "//")):
            for match in JSX_TEXT.findall(code):
                hits.append((i, match.strip()))
            if BARE_TEXT.match(code):
                hits.append((i, code.strip()))
    return hits


def main():
    web_only = "--web-only" in sys.argv
    report = []
    todo = 0
    for dirpath, _, files in os.walk(ROOT):
        for name in sorted(files):
            if not name.endswith((".ts", ".tsx")) or name.endswith((".test.ts", ".test.tsx")):
                continue
            path = os.path.join(dirpath, name).replace(os.sep, "/")
            rel = path[len(ROOT) + 1 :]
            if "/lib/i18n/" in path or rel in ALLOWED_FILES:
                continue
            hits = [(ln, s) for ln, s in scan(path) if s not in ALLOWED_SNIPPETS and s.strip('"`') not in {x.strip('"') for x in ALLOWED_SNIPPETS}]
            if not hits:
                continue
            todo += len(hits)
            report.append(rel + "  (" + str(len(hits)) + ")")
            for ln, s in hits:
                report.append("    " + str(ln) + ": " + s[:70])

    io.open("i18n-leftovers.txt", "w", encoding="utf-8", newline="\n").write("\n".join(report) + "\n")
    print("剩余待办:", todo, "处 → i18n-leftovers.txt")
    return 1 if todo else 0


if __name__ == "__main__":
    sys.exit(main())
