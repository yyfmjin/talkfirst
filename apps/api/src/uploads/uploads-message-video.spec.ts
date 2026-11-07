import { UploadsController } from "./uploads.controller";
import { UploadsService } from "./uploads.service";
import type { StreamedFile } from "./video-upload.interceptor";

/**
 * 视频落盘目录的路由。
 *
 * 为什么值得单独测：`moment-video` 和 `message-video` 共用同一套校验与转码
 * （`processVideo`），唯一的分歧就是落哪个目录。目录错了不会报错，只会让两类文件
 * 混在一起 —— 以后按用途清理时就只能靠猜。所以这里把「哪条路由去哪个目录」钉住。
 */
describe("UploadsController video routing", () => {
  const file: StreamedFile = {
    path: "/tmp/upload-123",
    originalname: "clip.mp4",
    mimetype: "video/mp4",
    size: 1024,
  };

  function makeController() {
    const storeProcessedVideo = jest.fn(
      (_path: string, _ext: string, folder: string) => `http://localhost:4000/uploads/${folder}/x.mp4`,
    );
    const uploads = Object.create(UploadsService.prototype) as UploadsService;
    uploads.storeProcessedVideo = storeProcessedVideo as never;

    const video = {
      extensionForMime: jest.fn(() => "mp4"),
      compressVideo: jest.fn(async () => ({
        path: "/tmp/compressed.mp4",
        size: 512,
        attempts: 1,
        output: { durationSec: 3, width: 640, height: 360 },
      })),
      cleanupTempFile: jest.fn(async () => undefined),
    };

    const controller = new UploadsController(uploads, {} as never, video as never);
    return { controller, storeProcessedVideo, video };
  }

  it("聊天视频 -> 落到 messages 目录", async () => {
    const { controller, storeProcessedVideo } = makeController();
    const result = await controller.uploadMessageVideo({ file });

    expect(result).toMatchObject({ success: true, data: { kind: "video", mime: "video/mp4" } });
    expect(storeProcessedVideo).toHaveBeenCalledWith("/tmp/compressed.mp4", "mp4", "messages");
  });

  it("动态视频仍然落到 moments 目录（回归保护）", async () => {
    const { controller, storeProcessedVideo } = makeController();
    const result = await controller.uploadMomentVideo({ file });

    expect(result).toMatchObject({ success: true, data: { kind: "video" } });
    expect(storeProcessedVideo).toHaveBeenCalledWith("/tmp/compressed.mp4", "mp4", "moments");
  });

  it("无论成功失败，临时文件都会被清理", async () => {
    const { controller, video } = makeController();
    video.compressVideo.mockRejectedValueOnce(new Error("ffmpeg exploded"));

    await expect(controller.uploadMessageVideo({ file })).rejects.toThrow("ffmpeg exploded");

    expect(video.cleanupTempFile).toHaveBeenCalledWith(file.path);
    expect(video.cleanupTempFile).toHaveBeenCalledWith(null);
  });

  it("没有文件 -> 400 INVALID_MEDIA", async () => {
    const { controller } = makeController();
    await expect(controller.uploadMessageVideo({})).rejects.toMatchObject({
      response: { error: { code: "INVALID_MEDIA" } },
    });
  });
});
