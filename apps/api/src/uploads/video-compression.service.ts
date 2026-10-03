import { Injectable, Logger } from "@nestjs/common";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, join } from "node:path";
import { ensureDir, videoTempRoot } from "./upload-paths";
import {
  ALLOWED_VIDEO_MIME,
  TARGET_VIDEO_BYTES,
  VIDEO_AUDIO_BITRATE_KBPS,
  VIDEO_MAX_COMPRESSION_ATTEMPTS,
  VIDEO_MAX_CONCURRENT_JOBS,
  VIDEO_MAX_HEIGHT,
  VIDEO_MAX_WIDTH,
  VIDEO_PROCESSING_TIMEOUT_MS,
} from "./video-upload.config";

/** What ffprobe tells us about a file. Unknown fields are `null`, never guessed. */
export type VideoMetadata = {
  durationSec: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  bitrate: number | null;
  hasAudio: boolean;
};

export type CompressResult = {
  path: string;
  size: number;
  attempts: number;
  /** Metadata of the FINAL file, not the original. */
  output: VideoMetadata;
};

/** Thrown for every failure this service can produce, before it becomes an HTTP error. */
export class VideoProcessingError extends Error {
  constructor(
    readonly code: "VIDEO_PROCESSING_FAILED" | "VIDEO_PROCESSING_TIMEOUT" | "FFMPEG_NOT_INSTALLED",
    message: string,
  ) {
    super(message);
    this.name = "VideoProcessingError";
  }
}

/**
 * Bounded concurrency for transcoding, shared by the whole process.
 *
 * Module-level on purpose: the limit is a property of the MACHINE (2 vCPU /
 * 3.7 GB), not of whichever module happened to instantiate the service. NestJS
 * would create one instance per importing module, and per-instance counters would
 * let N modules run N transcodes against the same two cores.
 */
let activeJobs = 0;
const waiting: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (activeJobs < VIDEO_MAX_CONCURRENT_JOBS) {
    activeJobs += 1;
    return;
  }
  // FIFO: a waiter is resumed by whoever releases, and takes the slot directly.
  await new Promise<void>((resolve) => waiting.push(resolve));
}

function releaseSlot(): void {
  const next = waiting.shift();
  if (next) {
    // Hand the slot over without decrementing — this keeps `activeJobs` accurate
    // when several jobs finish at once.
    next();
    return;
  }
  activeJobs -= 1;
}

/**
 * Video transcoding, built on the system `ffmpeg`/`ffprobe` binaries.
 *
 * ## Why `spawn` and never `exec`
 *
 * `exec` runs the command through a shell, so any part of the string that came
 * from a user — a filename, a mime type — is a command-injection vector. `spawn`
 * with an argument ARRAY passes each value as its own `argv` entry and never
 * involves a shell, so `; rm -rf /` in a filename is an argument, not a command.
 * Every call in this file uses the array form.
 *
 * ## Why not `fluent-ffmpeg`
 *
 * It would add a dependency for what is one `spawn` and one JSON parse. It also
 * ships a bundled binary path that does not match a system install, which is a
 * class of production bug this deployment does not need.
 */
@Injectable()
export class VideoCompressionService {
  private readonly logger = new Logger(VideoCompressionService.name);
  private available: boolean | null = null;

  /**
   * Checks that `ffmpeg` and `ffprobe` are runnable.
   *
   * Called at boot so a missing binary is reported at deploy time. Without it the
   * failure surfaces only when the first user uploads a video, as a generic
   * processing error that says nothing about the real cause.
   */
  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    const results = await Promise.all([this.probeBinary("ffmpeg"), this.probeBinary("ffprobe")]);
    this.available = results.every(Boolean);
    return this.available;
  }

  private probeBinary(binary: "ffmpeg" | "ffprobe"): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(binary, ["-version"], { stdio: "ignore" });
      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));
    });
  }

  /** Creates a unique scratch path. Never derived from user input. */
  tempPath(ext: string): string {
    const dir = ensureDir(videoTempRoot());
    const safeExt = /^[a-z0-9]{1,5}$/.test(ext) ? ext : "bin";
    return join(dir, `${randomUUID()}.${safeExt}`);
  }

  extensionForMime(mime: string | undefined): string | null {
    if (!mime) return null;
    return ALLOWED_VIDEO_MIME.get(mime.trim().toLowerCase()) ?? null;
  }

  /**
   * Removes a temporary file, ignoring the case where it is already gone.
   *
   * Never throws: it is called from `finally` blocks, where a throwing cleanup
   * would replace the real error with a misleading one.
   */
  async cleanupTempFile(filePath: string | undefined | null): Promise<void> {
    if (!filePath) return;
    try {
      await fs.rm(filePath, { force: true });
    } catch (error) {
      this.logger.warn(`Could not remove temp file ${basename(filePath)}: ${(error as Error).message}`);
    }
  }

  /** `ffprobe -print_format json` — the authoritative read on what a file really is. */
  async getVideoMetadata(filePath: string): Promise<VideoMetadata> {
    const stdout = await this.run(
      "ffprobe",
      [
        "-v", "error",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        filePath,
      ],
      30_000,
    );

    let parsed: {
      format?: { duration?: string; bit_rate?: string };
      streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>;
    };
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new VideoProcessingError("VIDEO_PROCESSING_FAILED", "ffprobe returned unreadable output");
    }

    const streams = parsed.streams ?? [];
    const video = streams.find((s) => s.codec_type === "video");
    const audio = streams.find((s) => s.codec_type === "audio");

    const duration = Number(parsed.format?.duration);
    const bitrate = Number(parsed.format?.bit_rate);

    return {
      durationSec: Number.isFinite(duration) && duration > 0 ? duration : null,
      width: typeof video?.width === "number" ? video.width : null,
      height: typeof video?.height === "number" ? video.height : null,
      videoCodec: video?.codec_name ?? null,
      audioCodec: audio?.codec_name ?? null,
      bitrate: Number.isFinite(bitrate) && bitrate > 0 ? bitrate : null,
      hasAudio: Boolean(audio),
    };
  }

  /**
   * Transcodes to MP4/H.264/AAC, scaling into the configured box while preserving
   * aspect ratio, then shrinks further if the result is still over target.
   *
   * The caller owns both files: `inputPath` is NOT deleted here, because the
   * caller's `finally` is the single place that must clean up regardless of how
   * this function exits.
   */
  async compressVideo(inputPath: string, outputExt = "mp4"): Promise<CompressResult> {
    await acquireSlot();
    try {
      return await this.compressWithSlot(inputPath, outputExt);
    } finally {
      releaseSlot();
    }
  }

  private async compressWithSlot(inputPath: string, outputExt: string): Promise<CompressResult> {
    if (!(await this.isAvailable())) {
      throw new VideoProcessingError("FFMPEG_NOT_INSTALLED", "ffmpeg/ffprobe are not available on this host");
    }

    const source = await this.getVideoMetadata(inputPath);
    if (!source.videoCodec || !source.width || !source.height) {
      // Not decodable as video. Reachable even after a MIME and magic-byte check,
      // because `ftyp` only proves "some ISO base media file".
      throw new VideoProcessingError("VIDEO_PROCESSING_FAILED", "file contains no decodable video stream");
    }

    const scaleFilter = this.buildScaleFilter(source.width, source.height);
    const outputPath = this.tempPath(outputExt);

    let attempts = 0;
    let result: { path: string; size: number; metadata: VideoMetadata } | null = null;

    for (let attempt = 1; attempt <= VIDEO_MAX_COMPRESSION_ATTEMPTS; attempt += 1) {
      attempts = attempt;
      const target = this.outputPathForAttempt(outputPath, attempt);
      const pass = await this.runFfmpegPass(inputPath, target, source, scaleFilter, attempt);

      const stat = await fs.stat(pass).catch(() => null);
      if (!stat || stat.size === 0) {
        await this.cleanupTempFile(pass);
        throw new VideoProcessingError("VIDEO_PROCESSING_FAILED", "ffmpeg produced no output");
      }

      // A previous, larger attempt is discarded so only the winner is left behind.
      if (result && result.path !== pass) await this.cleanupTempFile(result.path);

      result = { path: pass, size: stat.size, metadata: await this.getVideoMetadata(pass).catch(() => source) };

      if (stat.size <= TARGET_VIDEO_BYTES) break;

      this.logger.warn(
        `Video still ${(stat.size / 1024 / 1024).toFixed(1)}MB after attempt ${attempt} ` +
          `(target ${(TARGET_VIDEO_BYTES / 1024 / 1024).toFixed(0)}MB); retrying with a lower bitrate`,
      );
    }

    if (!result) {
      throw new VideoProcessingError("VIDEO_PROCESSING_FAILED", "video compression produced no usable output");
    }

    return { path: result.path, size: result.size, attempts, output: result.metadata };
  }

  private outputPathForAttempt(base: string, attempt: number): string {
    return attempt === 1 ? base : base.replace(/(\.[a-z0-9]+)$/, `-${attempt}$1`);
  }

  /**
   * `scale` that never upscales, never distorts, and never emits an odd dimension.
   *
   * `force_original_aspect_ratio=decrease` makes the scale fit INSIDE the box, so
   * a 1080x1920 portrait clip becomes 608x1080 rather than being squashed into
   * 1920x1080. `force_divisible_by=2` matters because H.264 with `yuv420p` cannot
   * encode odd width/height, and ffmpeg fails the whole job if it is handed one.
   *
   * `min(iw, W)` is what prevents upscaling: a 640x480 source stays 640x480
   * instead of being blown up to 1920x1080 and costing bytes for no detail.
   */
  private buildScaleFilter(width: number, height: number): string {
    const portrait = height > width;

    /**
     * A PORTRAIT video is bounded by 1080x1920, not 1920x1080 — the configured
     * box describes a landscape frame, so it is transposed for a portrait source.
     *
     * Two earlier attempts got this wrong in ways worth recording, because both
     * looked right in a passing test:
     *
     *   1. Clamping width and height against the same 1920/1080 pair squashed
     *      1080x1920 into 1080x1080.
     *   2. Transposing with `Math.min(boxW, VIDEO_MAX_HEIGHT)` happened to be
     *      CORRECT for 1080x1920 (min(1080,1080) is 1080) and wrong for anything
     *      else — a 1440x1080 clip yielded a 1080x1080 square. A test built only
     *      on 1080x1920 would have missed it, which is why the spec cases below
     *      include a portrait shape that is NOT the common phone ratio.
     *
     * The bounds are now taken straight from the configured box: a portrait source
     * fits inside (maxHeight x maxWidth), a landscape or square source inside
     * (maxWidth x maxHeight). `force_original_aspect_ratio=decrease` then fits the
     * real frame inside whichever box applies.
     */
    const boxW = portrait ? VIDEO_MAX_HEIGHT : VIDEO_MAX_WIDTH;
    const boxH = portrait ? VIDEO_MAX_WIDTH : VIDEO_MAX_HEIGHT;

    // `min(iw, …)`/`min(ih, …)` is what prevents upscaling: a 640x480 source stays
    // 640x480 rather than being blown up to fill the box.
    return (
      `scale=w=min(iw\\,${boxW}):h=min(ih\\,${boxH})` +
      `:force_original_aspect_ratio=decrease` +
      `:force_divisible_by=2`
    );
  }

  private async runFfmpegPass(
    inputPath: string,
    outputPath: string,
    source: VideoMetadata,
    scaleFilter: string,
    attempt: number,
  ): Promise<string> {
    const args = ["-y", "-i", inputPath, "-vf", scaleFilter];

    if (attempt === 1) {
      // CRF first: it is quality-targeted and needs no knowledge of duration,
      // which matters because a container duration can be wrong or absent
      // (`durationSec === null`) on fragmented or streamed originals.
      args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "28");
    } else {
      // Later passes are SIZE-targeted: a bitrate derived from the real duration.
      // Without a duration there is nothing to divide by, so CRF is used again
      // with a higher number rather than guessing a bitrate.
      const bitrateKbps = this.videoBitrateKbps(source.durationSec, attempt);
      if (bitrateKbps === null) {
        args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", String(28 + attempt * 3));
      } else {
        args.push(
          "-c:v", "libx264",
          "-preset", "veryfast",
          "-b:v", `${bitrateKbps}k`,
          // maxrate/bufsize give the rate control room for the peaky bitrate of a
          // variable-frame-rate phone recording; without them a 15MB target can
          // still overshoot badly on motion-heavy footage.
          "-maxrate", `${Math.round(bitrateKbps * 1.5)}k`,
          "-bufsize", `${bitrateKbps * 2}k`,
        );
      }
    }

    args.push("-pix_fmt", "yuv420p");

    if (source.hasAudio) {
      args.push("-c:a", "aac", "-b:a", `${VIDEO_AUDIO_BITRATE_KBPS}k`);
    } else {
      // Explicitly drop audio: some inputs carry a data/subtitle stream that
      // `-c:a aac` would try to encode and fail on.
      args.push("-an");
    }

    // Lets a browser start playing before the whole file is downloaded.
    args.push("-movflags", "+faststart", outputPath);

    await this.run("ffmpeg", args, VIDEO_PROCESSING_TIMEOUT_MS);
    return outputPath;
  }

  /**
   * Video bitrate that should land the file near `TARGET_VIDEO_BYTES`.
   *
   *   (target bytes * 8) / duration = total kbps available
   *   minus the audio track = video kbps
   *
   * A 5% container/muxing allowance is subtracted because MP4 overhead is real
   * and the target is a ceiling, not an average. Each retry takes 70% of the
   * previous figure so attempts converge instead of repeating.
   */
  private videoBitrateKbps(durationSec: number | null, attempt: number): number | null {
    if (!durationSec || durationSec <= 0) return null;

    const totalKbps = (TARGET_VIDEO_BYTES * 8) / durationSec / 1000;
    const usable = totalKbps * 0.95 - VIDEO_AUDIO_BITRATE_KBPS;
    /**
     * A non-positive figure is CLAMPED to the floor below, not turned into `null`.
     *
     * A long clip can legitimately have less budget than its own audio track — an
     * hour against a 15MB target leaves ~35 kbps in total, minus 96k of audio. The
     * earlier `if (usable <= 0) return null` treated that as "duration unusable",
     * which is the same answer this function gives when the duration is UNKNOWN,
     * and the caller responds to `null` by falling back to CRF. So a long video
     * silently took the no-bitrate path on every retry, and `Math.max` never got a
     * chance to apply its 120 kbps floor.
     *
     * `Number.isFinite` still guards a genuinely broken duration (NaN/Infinity),
     * where there is no meaningful number to clamp.
     */
    if (!Number.isFinite(usable)) return null;

    const shrinking = Math.pow(0.7, attempt - 2);
    const kbps = Math.max(120, Math.round(usable * shrinking));
    return kbps;
  }

  /**
   * Runs a binary and resolves its stdout, or throws a `VideoProcessingError`.
   *
   * The timeout uses `spawn`'s own `signal` option rather than a manual
   * `child.kill()`, so the process tree is torn down by Node itself and there is
   * no window where a timed-out ffmpeg keeps holding a core.
   */
  private run(binary: string, args: string[], timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const child = spawn(binary, args, { signal: controller.signal });
      let stdout = "";
      // ffmpeg is extremely chatty on stderr; only the tail is kept for the log
      // so a long job cannot grow this string without bound.
      let stderrTail = "";

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-4000);
      });

      child.on("error", (error: Error) => {
        clearTimeout(timer);
        if ((error as NodeJS.ErrnoException).name === "AbortError") {
          reject(new VideoProcessingError("VIDEO_PROCESSING_TIMEOUT", "video processing timed out"));
          return;
        }
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new VideoProcessingError("FFMPEG_NOT_INSTALLED", `${binary} was not found`));
          return;
        }
        reject(new VideoProcessingError("VIDEO_PROCESSING_FAILED", `${binary} could not be started`));
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve(stdout);
          return;
        }
        if (controller.signal.aborted) {
          reject(new VideoProcessingError("VIDEO_PROCESSING_TIMEOUT", "video processing timed out"));
          return;
        }
        /**
         * The ffmpeg stderr goes to the SERVER LOG and nowhere else. It contains
         * absolute paths and encoder internals, both of which are exactly what the
         * API must not hand back to a client.
         */
        this.logger.error(`${binary} exited with code ${code}: ${stderrTail}`);
        reject(new VideoProcessingError("VIDEO_PROCESSING_FAILED", `${binary} failed`));
      });
    });
  }
}
