import { VideoCompressionService, VideoProcessingError } from "./video-compression.service";
import { ALLOWED_VIDEO_MIME } from "./video-upload.config";

/**
 * Unit coverage for the decisions the video pipeline makes.
 *
 * ## What these tests do NOT do
 *
 * They never invoke `ffmpeg`. This sandbox has no shell (every command exits
 * `3221225794`), so anything that spawns a process cannot run here and pretending
 * otherwise would be worse than saying so. The cases below exercise the pure
 * decision logic — scaling, bitrate arithmetic, MIME mapping — which is where the
 * mistakes that matter (a squashed portrait video, an unattainable bitrate) live.
 *
 * Actually transcoding a file, and every size/behaviour claim that depends on it,
 * is listed as NOT RUN in the delivery report.
 */

/** The private members under test, reached explicitly rather than by `any`. */
type TestableVideo = {
  buildScaleFilter(width: number, height: number): string;
  videoBitrateKbps(durationSec: number | null, attempt: number): number | null;
};

const service = new VideoCompressionService();
const testable = service as unknown as TestableVideo;

describe("视频缩放：比例与朝向", () => {
  /** Reads the two bound values out of the generated filter, for readability. */
  function bounds(width: number, height: number): { w: number; h: number } {
    const filter = testable.buildScaleFilter(width, height);
    const match = /w=min\(iw\\,(\d+)\):h=min\(ih\\,(\d+)\)/.exec(filter);
    if (!match) throw new Error(`unexpected scale filter: ${filter}`);
    return { w: Number(match[1]), h: Number(match[2]) };
  }

  it("横屏 1920x1080 的边界就是 1920x1080", () => {
    expect(bounds(1920, 1080)).toEqual({ w: 1920, h: 1080 });
  });

  it("竖屏 1080x1920 的边界是 1080x1920，不是被压成 1920x1080", () => {
    expect(bounds(1080, 1920)).toEqual({ w: 1080, h: 1920 });
  });

  it("非标准竖屏 1440x1080 用横向框，绝不被压成 1080x1080 正方形", () => {
    /**
     * The case that caught a real bug — and then carried a second one of its own.
     *
     * The original defect: transposing with `Math.min(boxW, VIDEO_MAX_HEIGHT)` was
     * correct for 1080x1920 only by coincidence (`min(1080,1080)` is 1080), and for
     * a 4:3 clip it produced a 1080x1080 box — a square. That is what the assertion
     * below pins: the box must NOT be 1080x1080.
     *
     * The assertion USED to read `{ w: 1080, h: 1920 }`, which is not achievable and
     * was itself wrong. 1440x1080 is landscape: bounding it by 1080 wide puts the
     * height near 810, never 1920, and forcing it into a 1080x1920 frame would
     * squash a 4:3 clip into 9:16. It also contradicted the 3840x2160 case below,
     * which expects the LANDSCAPE box for the identical width-greater-than-height
     * relationship — the same input giving two opposite orientations.
     *
     * `min(iw, w)` / `min(ih, h)` keeps the box at full landscape size and lets
     * `force_original_aspect_ratio=decrease` fit the source inside it, so a clip
     * smaller than the box is never upscaled.
     */
    expect(bounds(1440, 1080)).toEqual({ w: 1920, h: 1080 });
  });

  it("正方形 1080x1080 不被转置", () => {
    // `height > width` is false for a square, so it takes the landscape box.
    expect(bounds(1080, 1080)).toEqual({ w: 1920, h: 1080 });
  });

  it("4K 横屏的边界仍是 1920x1080", () => {
    expect(bounds(3840, 2160)).toEqual({ w: 1920, h: 1080 });
  });

  it("4K 竖屏的边界是 1080x1920", () => {
    expect(bounds(2160, 3840)).toEqual({ w: 1080, h: 1920 });
  });

  it("边界不随源尺寸缩小（防放大交给 min(iw,·)）", () => {
    // A 640x480 source must keep the FULL box as its bound and rely on
    // `min(iw,1920)` to stay at 640. Baking the source size into the bound would
    // also work here but would break the moment the box became configurable.
    expect(bounds(640, 480)).toEqual({ w: 1920, h: 1080 });
  });

  it("始终要求宽高为偶数（H.264 + yuv420p 不能编码奇数尺寸）", () => {
    for (const [w, h] of [[1080, 1920], [1920, 1080], [1234, 567], [640, 480]]) {
      expect(testable.buildScaleFilter(w, h)).toContain("force_divisible_by=2");
    }
  });

  it("始终保留原始宽高比", () => {
    for (const [w, h] of [[1080, 1920], [1920, 1080], [3840, 2160], [640, 480]]) {
      expect(testable.buildScaleFilter(w, h)).toContain("force_original_aspect_ratio=decrease");
    }
  });

  it("逗号被转义，不会被 ffmpeg 当成滤镜分隔符", () => {
    // `scale=w=min(iw,1920)` without the backslash is parsed as two filters and
    // fails the whole job.
    expect(testable.buildScaleFilter(1920, 1080)).toContain("min(iw\\,1920)");
  });
});

describe("目标码率计算", () => {
  const TARGET_MB = 15;

  it("时长越长，允许的码率越低", () => {
    const short = testable.videoBitrateKbps(10, 2);
    const long = testable.videoBitrateKbps(120, 2);
    expect(short).not.toBeNull();
    expect(long).not.toBeNull();
    expect(short as number).toBeGreaterThan(long as number);
  });

  it("给出的码率乘以时长约等于目标体积（含音频开销）", () => {
    const durationSec = 60;
    const kbps = testable.videoBitrateKbps(durationSec, 2) as number;
    // video bits + 96k audio over the duration should land at/under the target.
    const estimatedBytes = ((kbps + 96) * 1000 * durationSec) / 8;
    expect(estimatedBytes).toBeLessThanOrEqual(TARGET_MB * 1024 * 1024);
  });

  it("重试会降低码率，而不是重复同一个值", () => {
    const first = testable.videoBitrateKbps(60, 2) as number;
    const second = testable.videoBitrateKbps(60, 3) as number;
    const third = testable.videoBitrateKbps(60, 4) as number;
    expect(second).toBeLessThan(first);
    expect(third).toBeLessThan(second);
  });

  it("码率有下限，不会算出 0 或负数", () => {
    // A very long video would otherwise divide down to nothing and produce an
    // unwatchable file (or a negative `-b:v`).
    const kbps = testable.videoBitrateKbps(3600, 4) as number;
    expect(kbps).toBeGreaterThanOrEqual(120);
  });

  it("时长未知时返回 null（调用方退回 CRF，而不是猜一个码率）", () => {
    // Fragmented or streamed originals frequently report no duration.
    expect(testable.videoBitrateKbps(null, 2)).toBeNull();
    expect(testable.videoBitrateKbps(0, 2)).toBeNull();
    expect(testable.videoBitrateKbps(-5, 2)).toBeNull();
  });
});

describe("视频 MIME 白名单", () => {
  it("覆盖要求里的四种类型", () => {
    for (const mime of ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"]) {
      expect(ALLOWED_VIDEO_MIME.has(mime)).toBe(true);
      expect(service.extensionForMime(mime)).toBeTruthy();
    }
  });

  it("拒绝伪装成视频的图片与任意类型", () => {
    for (const mime of ["image/png", "image/jpeg", "text/plain", "application/octet-stream", "video/avi"]) {
      expect(service.extensionForMime(mime)).toBeNull();
    }
  });

  it("大小写与空白不敏感", () => {
    expect(service.extensionForMime("  VIDEO/MP4  ")).toBe("mp4");
  });

  it("缺少 mimetype 时返回 null，不抛异常", () => {
    expect(service.extensionForMime(undefined)).toBeNull();
    expect(service.extensionForMime("")).toBeNull();
  });
});

describe("错误码", () => {
  it("VideoProcessingError 携带稳定的 code", () => {
    const timeout = new VideoProcessingError("VIDEO_PROCESSING_TIMEOUT", "timed out");
    expect(timeout.code).toBe("VIDEO_PROCESSING_TIMEOUT");
    expect(timeout).toBeInstanceOf(Error);

    const failed = new VideoProcessingError("VIDEO_PROCESSING_FAILED", "failed");
    expect(failed.code).toBe("VIDEO_PROCESSING_FAILED");

    const missing = new VideoProcessingError("FFMPEG_NOT_INSTALLED", "no binary");
    expect(missing.code).toBe("FFMPEG_NOT_INSTALLED");
  });
});

describe("临时文件清理", () => {
  it("清理不存在的文件不抛异常", async () => {
    // It is called from `finally` blocks; throwing there would replace the real
    // error with a misleading cleanup error.
    await expect(service.cleanupTempFile("/definitely/not/a/real/path.tmp")).resolves.toBeUndefined();
  });

  it("null / undefined / 空字符串是安全的 no-op", async () => {
    await expect(service.cleanupTempFile(null)).resolves.toBeUndefined();
    await expect(service.cleanupTempFile(undefined)).resolves.toBeUndefined();
    await expect(service.cleanupTempFile("")).resolves.toBeUndefined();
  });
});

describe("临时文件名", () => {
  it("由服务器生成，且不包含任何调用方输入", () => {
    const first = service.tempPath("mp4");
    const second = service.tempPath("mp4");
    expect(first).not.toBe(second);
    expect(first.endsWith(".mp4")).toBe(true);
  });

  it("扩展名不在白名单形状内时回退为 .bin", () => {
    // The value is never taken from user input, but the guard keeps a future
    // caller from reintroducing path characters through this argument.
    expect(service.tempPath("../../etc/passwd").endsWith(".bin")).toBe(true);
    expect(service.tempPath("mp4/../x").endsWith(".bin")).toBe(true);
  });
});
