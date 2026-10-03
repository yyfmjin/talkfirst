import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Throttle } from "@nestjs/throttler";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";
import { ValidationPipe } from "../common/validation.pipe";
import { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "./uploads.service";
import {
  momentVideoUploadOptions,
  VideoUploadInterceptor,
  type StreamedFile,
} from "./video-upload.interceptor";
import { VideoCompressionService, VideoProcessingError } from "./video-compression.service";
import { TARGET_VIDEO_BYTES } from "./video-upload.config";

class PresignDto {
  @IsIn(["image/jpeg", "image/png", "image/webp"])
  mime!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  filename?: string;
}

class AvatarUploadDto {
  @IsString()
  image!: string;
}

class MessageImageDto {
  @IsString()
  image!: string;
}

/**
 * PC-3.6 — the moment composer picks a file straight off the device, so the
 * same two checks the avatar/chat endpoints run (mime allow-list plus a magic
 * byte sniff) now cover video too. One field carries either kind; the service
 * tries image first and falls back to video.
 */
class MomentMediaDto {
  @IsString()
  media!: string;
}

@Controller("uploads")
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(
    private readonly uploads: UploadsService,
    private readonly prisma: PrismaService,
    private readonly video: VideoCompressionService,
  ) {}

  @Post("presign")
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  presign(@Body(new ValidationPipe()) dto: PresignDto) {
    const presigned = this.uploads.presign(dto.filename ?? "upload", dto.mime);
    if (!presigned) {
      throw new ForbiddenException({
        success: false,
        error: { code: "STORAGE_NOT_CONFIGURED", message: "Object storage is not configured" },
      });
    }
    return { success: true as const, data: presigned };
  }

  @Post("avatar")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async uploadAvatar(
    @CurrentUser() user: AuthUser,
    @Body(new ValidationPipe()) dto: AvatarUploadDto,
  ) {
    if (dto.image.length > 7_000_000) {
      throw new ForbiddenException({
        success: false,
        error: { code: "IMAGE_TOO_LARGE", message: "Image is too large (max 5MB)" },
      });
    }
    const parsed = dto.image.startsWith("data:")
      ? this.uploads.parseDataUrl(dto.image)
      : null;
    const url = !parsed ? this.uploads.normalizeUploadUrl(dto.image) : null;
    if (!parsed && !url) {
      throw new ForbiddenException({
        success: false,
        error: { code: "INVALID_IMAGE", message: "Image must be an image URL or base64 data URL" },
      });
    }
    const avatarUrl = parsed
      ? this.uploads.saveLocal("avatars", parsed.buffer, parsed.ext)
      : (url as string);
    const normalized = this.uploads.normalizeUploadUrl(avatarUrl);
    if (!normalized) {
      throw new ForbiddenException({
        success: false,
        error: { code: "INVALID_IMAGE", message: "Image must be an image URL or base64 data URL" },
      });
    }
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl: normalized },
    });
    return { success: true as const, data: { avatarUrl: updated.avatarUrl } };
  }

  @Post("message-image")
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async uploadMessageImage(
    @Body(new ValidationPipe()) dto: MessageImageDto,
  ) {
    if (dto.image.length > 7_000_000) {
      throw new ForbiddenException({
        success: false,
        error: { code: "IMAGE_TOO_LARGE", message: "Image is too large (max 5MB)" },
      });
    }
    const parsed = this.uploads.parseDataUrl(dto.image);
    if (!parsed) {
      throw new ForbiddenException({
        success: false,
        error: { code: "INVALID_IMAGE", message: "Image must be a jpeg/png/webp data URL" },
      });
    }
    const imageUrl = this.uploads.saveLocal("messages", parsed.buffer, parsed.ext);
    return { success: true as const, data: { imageUrl, mime: parsed.mime } };
  }

  @Post("moment-media")
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async uploadMomentMedia(@Body(new ValidationPipe()) dto: MomentMediaDto) {
    if (dto.media.length > 7_000_000) {
      throw new ForbiddenException({
        success: false,
        error: { code: "MEDIA_TOO_LARGE", message: "Media is too large (max 5MB)" },
      });
    }
    const image = this.uploads.parseDataUrl(dto.media);
    if (image) {
      const url = this.uploads.saveLocal("moments", image.buffer, image.ext);
      return { success: true as const, data: { url, mime: image.mime, kind: "image" as const } };
    }
    const video = this.uploads.parseVideoDataUrl(dto.media);
    if (video) {
      const url = this.uploads.saveLocal("moments", video.buffer, video.ext);
      return { success: true as const, data: { url, mime: video.mime, kind: "video" as const } };
    }
    throw new ForbiddenException({
      success: false,
      error: {
        code: "INVALID_MEDIA",
        message: "Media must be a jpeg/png/webp image or an mp4/webm/mov video data URL",
      },
    });
  }

  /**
   * Accepts a large original video as `multipart/form-data`, transcodes it with
   * ffmpeg, and returns the URL of the compressed result.
   *
   * ## Why this is a separate route from `moment-media`
   *
   * `moment-media` carries a base64 data URL inside a JSON body. That transport
   * cannot hold a 90 MB video — base64 inflates it to ~120 MB and
   * `express.json({ limit: "8mb" })` rejects the request long before any of this
   * code runs. Rather than rewrite the JSON endpoint (which would change image
   * upload behaviour and break `uploads-moment-media.spec.ts`), video got its own
   * multipart route. Images are untouched and still use `moment-media`.
   *
   * ## Ordering, and why nothing is written before the transcode succeeds
   *
   * The original lands in a temp directory (never in the static `/uploads` mount,
   * so a partial upload is not publicly readable). Only a successful transcode is
   * copied into `moments/`. On any failure the temp file and any partial output
   * are removed in `finally`, so the server never accumulates original video, and
   * because the URL is only returned on success the client never creates a moment
   * pointing at a file that does not exist.
   *
   * Response shape matches the existing media endpoint (`url` / `mime` / `kind`)
   * with size and dimensions added. `videoUrl` in the database is unchanged.
   */
  @Post("moment-video")
  @UseInterceptors(new VideoUploadInterceptor(momentVideoUploadOptions()))
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async uploadMomentVideo(@Req() request: { file?: StreamedFile }) {
    const file = request.file;
    if (!file) {
      throw new BadRequestException({
        success: false,
        error: { code: "INVALID_MEDIA", message: "No video file was uploaded" },
      });
    }

    /**
     * MIME is the FIRST gate and the weakest: a client controls this header. The
     * container sniff and then ffprobe are what actually decide, in that order —
     * cheap checks first, since ffprobe on a 90 MB file is not free.
     */
    const declaredExt = this.video.extensionForMime(file.mimetype);
    if (!declaredExt) {
      await this.video.cleanupTempFile(file.path);
      throw new BadRequestException({
        success: false,
        error: {
          code: "INVALID_MEDIA",
          message: "Video must be mp4, mov, webm or m4v",
        },
      });
    }

    let compressedPath: string | null = null;
    try {
      const compressed = await this.video.compressVideo(file.path, "mp4");
      compressedPath = compressed.path;

      const url = this.uploads.storeProcessedVideo(compressed.path, "mp4");

      return {
        success: true as const,
        data: {
          url,
          mime: "video/mp4",
          mimeType: "video/mp4",
          kind: "video" as const,
          size: compressed.size,
          durationSec: compressed.output.durationSec === null
            ? null
            : Math.round(compressed.output.durationSec),
          width: compressed.output.width,
          height: compressed.output.height,
          /** Surfaced for the client's own messaging; not a failure signal. */
          targetBytes: TARGET_VIDEO_BYTES,
          attempts: compressed.attempts,
        },
      };
    } catch (error) {
      if (error instanceof VideoProcessingError) {
        /**
         * The message is a fixed string chosen here. ffmpeg's stderr — which
         * carries absolute server paths and encoder internals — was already
         * logged by the service and is deliberately NOT forwarded.
         */
        const isTimeout = error.code === "VIDEO_PROCESSING_TIMEOUT";
        const isMissingBinary = error.code === "FFMPEG_NOT_INSTALLED";
        throw new BadRequestException({
          success: false,
          error: {
            code: error.code,
            message: isMissingBinary
              ? "视频处理服务暂时不可用，请联系管理员"
              : isTimeout
                ? "视频处理超时，请换一个更短或更小的视频"
                : "视频处理失败，请重新上传",
          },
        });
      }
      throw error;
    } finally {
      /**
       * Both files go, unconditionally, on every path — success, processing
       * failure, timeout, or a throw from the store step. `basename` is used in
       * the log so a server path never reaches a log aggregator verbatim.
       */
      await this.video.cleanupTempFile(file.path);
      await this.video.cleanupTempFile(compressedPath);
    }
  }
}
