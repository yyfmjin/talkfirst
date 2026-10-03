import { Logger, Module, type OnModuleInit } from "@nestjs/common";
import { UploadsController } from "./uploads.controller";
import { UploadsService } from "./uploads.service";
import { VideoCompressionService } from "./video-compression.service";
import { UsersModule } from "../users/users.module";
import { isProductionDeployment } from "../common/security-config";

@Module({
  imports: [UsersModule],
  controllers: [UploadsController],
  providers: [UploadsService, VideoCompressionService],
  exports: [UploadsService, VideoCompressionService],
})
export class UploadsModule implements OnModuleInit {
  private readonly logger = new Logger(UploadsModule.name);

  constructor(private readonly video: VideoCompressionService) {}

  /**
   * Reports a missing `ffmpeg`/`ffprobe` at BOOT, not at first upload.
   *
   * Without this, a host that never had ffmpeg installed looks perfectly healthy
   * until a user tries to publish a video, at which point they get a generic
   * "video processing failed" and nobody learns the real cause from the user's
   * report. This turns it into a line in the startup log.
   *
   * It does NOT refuse to boot, in either environment, and that is a deliberate
   * reversal of the obvious design:
   *
   *   - In production, refusing to boot over a missing binary takes down auth,
   *     chat and the feed — everything that has nothing to do with video —
   *     because ONE feature is unavailable. A degraded feature is a far smaller
   *     incident than a dead API, and the log line plus the
   *     `FFMPEG_NOT_INSTALLED` error the endpoint already returns are enough for
   *     an operator to act on.
   *   - In development, most machines have no ffmpeg, and the existing comment in
   *     the brief asks for exactly this: the project must still start.
   *
   * Logged at `error` level in production so it survives a log-level filter, and
   * at `warn` elsewhere so a developer is not alarmed by their own laptop.
   */
  async onModuleInit(): Promise<void> {
    const available = await this.video.isAvailable();
    if (available) {
      this.logger.log("ffmpeg/ffprobe detected — video uploads will be transcoded");
      return;
    }

    const message =
      "FFmpeg is required for video processing: neither `ffmpeg` nor `ffprobe` could be run. " +
      "Video uploads will fail with FFMPEG_NOT_INSTALLED until it is installed " +
      "(Ubuntu: `sudo apt-get install -y ffmpeg`).";

    if (isProductionDeployment()) {
      this.logger.error(message);
    } else {
      this.logger.warn(`${message} (development: video uploads are expected to fail)`);
    }
  }
}
