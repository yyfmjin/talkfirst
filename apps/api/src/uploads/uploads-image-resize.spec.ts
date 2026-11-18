import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { UploadsService } from "./uploads.service";

/**
 * 图片上传前先缩（2026-11-18）。
 *
 * 起因是国内访问变慢：一张手机照片原样落盘是 1.8–2.5MB，而列表里的头像只显示
 * 40–72px —— 跨太平洋下载一张 2MB 的头像要好几秒，这比任何服务端调优都直观。
 *
 * 这几条断言盯的就是「别缩过头、也别白缩」：
 * - 大图必须真的变小、变到 512 以内；
 * - 本来就小的图不能因为转格式反而变大（那就退回原图）。
 */
describe("UploadsService.saveImage", () => {
  let dir: string;
  let service: UploadsService;
  const previousDir = process.env.UPLOAD_DIR;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "tf-uploads-"));
    process.env.UPLOAD_DIR = dir;
    service = new UploadsService();
  });

  afterAll(() => {
    if (previousDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousDir;
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * 噪声图：纯色图会被 JPEG 压到几十 KB，那样测不出「大」。
   * 随机会被压得差，才接近手机照片的体积量级。
   */
  async function noisyJpeg(size: number): Promise<Buffer> {
    const pixels = size * size * 3;
    const raw = Buffer.allocUnsafe(pixels);
    for (let i = 0; i < pixels; i += 1) raw[i] = Math.floor(Math.random() * 256);
    return sharp(raw, { raw: { width: size, height: size, channels: 3 } })
      .jpeg({ quality: 95 })
      .toBuffer();
  }

  function savedPath(url: string): string {
    const [, folder, name] = url.split("/").slice(-3);
    return join(dir, folder, name);
  }

  it("头像：大图缩到 512 以内，体积至少减半", async () => {
    const original = await noisyJpeg(1200);
    const url = await service.saveImage("avatars", original, "jpg");
    const saved = readFileSync(savedPath(url));
    const meta = await sharp(saved).metadata();

    expect(meta.width).toBeLessThanOrEqual(512);
    expect(meta.height).toBeLessThanOrEqual(512);
    expect(saved.length).toBeLessThan(original.length / 2);
  });

  it("动态图：长边 1600 封顶（比头像宽松，也不原样存）", async () => {
    const original = await noisyJpeg(2000);
    const url = await service.saveImage("moments", original, "jpg");
    const meta = await sharp(readFileSync(savedPath(url))).metadata();

    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(1600);
  });

  it("本来就小的图：不为了统一格式而变大，退回原图", async () => {
    const tiny = await sharp({
      create: { width: 48, height: 48, channels: 4, background: { r: 20, g: 120, b: 220, alpha: 1 } },
    })
      .png()
      .toBuffer();

    const url = await service.saveImage("avatars", tiny, "png");

    // 转 JPEG 不会更小 → 保留 png；关键是不能更大。
    expect(url.endsWith(".png")).toBe(true);
    expect(readFileSync(savedPath(url)).length).toBe(tiny.length);
  });
});
