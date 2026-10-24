#!/usr/bin/env python3
"""检查 AAB/APK 里的 64 位原生库是否按 16 KB 页对齐。

为什么需要：Google Play 要求面向 Android 15+ 的应用，其 64 位 .so 的
PT_LOAD 段必须按 16 KB（0x4000）对齐，否则在 16 KB 页大小的设备上直接装不上。
Expo SDK 52（RN 0.76）的预编译库是 4 KB 对齐 —— 这个脚本就是当初发现问题的工具。

用法：
    python scripts/check-16kb.py D:/Android/play/talkfirst-0.1.4.aab
    python scripts/check-16kb.py app.apk --quiet

退出码：0 = 全部合规；1 = 存在 4 KB 对齐（或文件读不出来）。
"""
from __future__ import annotations

import io
import struct
import sys
import zipfile

try:  # Windows 控制台默认 GBK，打印 ✗ 会直接抛 UnicodeEncodeError
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

PT_LOAD = 1
PAGE_16K = 0x4000


def load_aligns(blob: bytes) -> list[int] | None:
    """返回 ELF64 各 PT_LOAD 段的 p_align；不是 ELF64 就返回 None。"""
    if len(blob) < 64 or blob[:4] != b"\x7fELF" or blob[4] != 2:
        return None
    e_phoff = struct.unpack("<Q", blob[0x20:0x28])[0]
    e_phentsize = struct.unpack("<H", blob[0x36:0x38])[0]
    e_phnum = struct.unpack("<H", blob[0x38:0x3A])[0]
    out = []
    for i in range(e_phnum):
        off = e_phoff + i * e_phentsize
        if off + 56 > len(blob):
            break
        if struct.unpack("<I", blob[off:off + 4])[0] == PT_LOAD:
            out.append(struct.unpack("<Q", blob[off + 48:off + 56])[0])
    return out


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    path = sys.argv[1]
    quiet = "--quiet" in sys.argv

    bad: list[tuple[str, list[int]]] = []
    ok = 0
    skipped = 0

    with zipfile.ZipFile(path) as zf:
        names = [n for n in zf.namelist() if n.endswith(".so") and ("/lib/" in n or n.startswith("lib/"))]
        for name in names:
            aligns = load_aligns(zf.read(name))
            if not aligns:
                skipped += 1
                continue
            if all(a >= PAGE_16K for a in aligns):
                ok += 1
            else:
                bad.append((name.split("lib/")[-1], aligns))

    print(f"扫描 {len(names)} 个 .so：16 KB 合规 {ok}，4 KB 对齐 {len(bad)}，跳过 {skipped}")
    for name, aligns in bad[:20]:
        print(f"  [x] {name}: {[hex(a) for a in aligns]}")
    if len(bad) > 20:
        print(f"  … 还有 {len(bad) - 20} 个")

    if bad:
        print("\n结论：未通过 16 KB 对齐检查。需要升级 Expo SDK（53+ 的 RN 0.79+ 起预编译库已对齐）。")
        return 1
    if not quiet:
        print("\n结论：通过。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
