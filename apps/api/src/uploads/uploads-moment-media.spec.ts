import { ForbiddenException } from "@nestjs/common";
import { UploadsController } from "./uploads.controller";
import { UploadsService } from "./uploads.service";

/**
 * PC-3.6 — the composer's media endpoint.
 *
 * One field carries either kind, so the contract these tests pin is the routing
 * order: an image data URL becomes a `kind: "image"` result, a video data URL
 * becomes `kind: "video"`, and anything else is refused without stating why.
 * Both kinds go through the same allow-list plus magic-byte sniff the avatar and
 * chat endpoints already use.
 */

/** A real 1×1 PNG — the sniff checks the 8-byte signature. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

/** ISO base media (`ftyp` at offset 4): mp4 and mov share this container. */
const MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from("ftypisom", "latin1"),
  Buffer.from([0x00, 0x00, 0x02, 0x00]),
  Buffer.from("isomiso2", "latin1"),
]);

/** Matroska / WebM: the EBML magic `1A 45 DF A3`. */
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(16, 0x42)]);

const pngUrl = `data:image/png;base64,${PNG_BASE64}`;
const mp4Url = `data:video/mp4;base64,${MP4.toString("base64")}`;
const webmUrl = `data:video/webm;base64,${WEBM.toString("base64")}`;

describe("UploadsService video data URLs", () => {
  const service = new UploadsService();

  it("允许的 mime 列表包含 mp4 / webm / quicktime", () => {
    expect(service.allowedVideoMime()).toEqual(
      expect.arrayContaining(["video/mp4", "video/webm", "video/quicktime"]),
    );
  });

  it("解析合法 mp4 / webm", () => {
    expect(service.parseVideoDataUrl(mp4Url)).toMatchObject({ mime: "video/mp4", ext: "mp4" });
    expect(service.parseVideoDataUrl(webmUrl)).toMatchObject({ mime: "video/webm", ext: "webm" });
  });

  it("拒绝：图片被当成视频 / 未允许的 mime / 非 base64", () => {
    expect(service.parseVideoDataUrl(pngUrl)).toBeNull();
    expect(service.parseVideoDataUrl("data:video/avi;base64,AAAA")).toBeNull();
    expect(service.parseVideoDataUrl("data:video/mp4;base64,!!!!")).toBeNull();
    expect(service.parseVideoDataUrl("")).toBeNull();
  });

  it("拒绝：mime 正确但内容不是 ISO-BMFF / EBML（防伪装）", () => {
    const fake = `data:video/mp4;base64,${Buffer.from("this is not a video at all").toString("base64")}`;
    expect(service.parseVideoDataUrl(fake)).toBeNull();
  });

  it("拒绝：长度不足 12 字节", () => {
    const tiny = `data:video/mp4;base64,${Buffer.from([0, 0, 0, 0]).toString("base64")}`;
    expect(service.parseVideoDataUrl(tiny)).toBeNull();
  });

  it("拒绝：超过视频大小上限", () => {
    const spy = jest.spyOn(service, "maxVideoBytes").mockReturnValue(12);
    try {
      expect(service.parseVideoDataUrl(mp4Url)).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("图片与视频的解析互不通用", () => {
    expect(service.parseDataUrl(mp4Url)).toBeNull();
    expect(service.parseDataUrl(pngUrl)).toMatchObject({ mime: "image/png", ext: "png" });
  });
});

describe("UploadsController.uploadMomentMedia routing", () => {
  function makeController() {
    const saveLocal = jest.fn((kind: string, buffer: Buffer, ext: string) => `http://localhost:4000/uploads/${kind}/x.${ext}`);
    const uploads = Object.create(UploadsService.prototype) as UploadsService;
    uploads.parseDataUrl = jest.fn((input: string) => {
      const match = /^data:(image\/png);base64,([A-Za-z0-9+/=]+)$/.exec(input);
      return match ? { mime: "image/png", ext: "png", buffer: Buffer.from(match[2], "base64") } : null;
    });
    uploads.parseVideoDataUrl = jest.fn((input: string) => {
      const match = /^data:(video\/mp4);base64,([A-Za-z0-9+/=]+)$/.exec(input);
      return match ? { mime: "video/mp4", ext: "mp4", buffer: Buffer.from(match[2], "base64") } : null;
    });
    uploads.saveLocal = saveLocal as never;
    /**
     * The third dependency is `VideoCompressionService`, added when the video
     * pipeline landed. This spec drives the moment-media (image/video routing)
     * path only, so stubs are enough — but the argument must be passed, because a
     * two-argument call no longer matches the constructor and fails `tsc`.
     */
    const controller = new UploadsController(uploads, {} as never, {} as never);
    return { controller, saveLocal };
  }

  it("图片 -> kind=image，存到 moments 目录", async () => {
    const { controller, saveLocal } = makeController();
    const result = await controller.uploadMomentMedia({ media: pngUrl });
    expect(result).toMatchObject({ success: true, data: { kind: "image", mime: "image/png" } });
    expect(saveLocal).toHaveBeenCalledWith("moments", expect.any(Buffer), "png");
  });

  it("视频 -> kind=video", async () => {
    const { controller, saveLocal } = makeController();
    const result = await controller.uploadMomentMedia({ media: mp4Url });
    expect(result).toMatchObject({ success: true, data: { kind: "video", mime: "video/mp4" } });
    expect(saveLocal).toHaveBeenCalledWith("moments", expect.any(Buffer), "mp4");
  });

  it("无效媒体 -> 403 INVALID_MEDIA（不透露具体原因）", async () => {
    const { controller, saveLocal } = makeController();
    await expect(controller.uploadMomentMedia({ media: "data:application/pdf;base64,AAAA" })).rejects.toMatchObject({
      response: { error: { code: "INVALID_MEDIA" } },
    });
    expect(saveLocal).not.toHaveBeenCalled();
  });

  it("请求体超长 -> 403 MEDIA_TOO_LARGE，且不解析", async () => {
    const { controller } = makeController();
    const huge = "x".repeat(7_000_001);
    await expect(controller.uploadMomentMedia({ media: huge })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
