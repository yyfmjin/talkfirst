import { NextResponse } from "next/server";
import { ANDROID_APK_URL } from "@/lib/downloads";

/**
 * 固定下载入口：`/download/android` → 当前最新版的 APK。
 *
 * ## 为什么用 302 而不是自己托管文件
 *
 * 安装包放在 Expo 的 CDN 上（EAS 产物），源站没必要为它占几十兆磁盘、也不该让
 * Cloudflare 去缓存一个每次构建都变的二进制文件。这里只做一件事：把"固定链接"
 * 翻译成"当前那一版"，地址存在 `lib/downloads.ts` 一个地方。
 *
 * ## 还没出包时
 *
 * 返回 **503 + 一句人话**，而不是 302 到空地址（那会变成浏览器里一个莫名其妙的错误页）。
 * 官网的按钮在同一个条件下显示为「生成中」并禁用，两处判断的是同一个常量。
 *
 * ## 曾经踩过的坑（2026-10-10）
 *
 * 本路由原本写成 `dynamic = "force-static"`（强制静态预渲染）—— 但它返回的是 302 跳转、
 * 响应体是**空的**，Next 在试图缓存它时算出 `size 0`，于是不停报
 * `LRUCache: calculateSize returned 0, but size must be > 0`，`talkfirst-web` 因此
 * 重启了几百次。运营方反馈的「网站打不开」正是这一类：进程反复重启，负载下就更明显。
 *
 * 现在改成 **动态**：跳转地址本来就该是「问一次、答一次」，不该被预渲染或缓存。
 * 顺带也省掉了「跑完 `npm run sync:apk` 还得重新部署一次」这个步骤。
 */
export const dynamic = "force-dynamic";

export function GET() {
  if (!ANDROID_APK_URL) {
    return NextResponse.json(
      { error: "还没有可下载的 Android 安装包。" },
      { status: 503 },
    );
  }

  return NextResponse.redirect(ANDROID_APK_URL, 302);
}
