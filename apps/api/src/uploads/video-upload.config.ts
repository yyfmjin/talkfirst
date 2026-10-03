/**
 * Video upload and compression limits — the single source of truth.
 *
 * ## Why this file exists
 *
 * The old limits were magic numbers in three places that had to agree with each
 * other and did not: `uploads.service.ts` (`5 * 1024 * 1024`, twice),
 * `uploads.controller.ts` (`> 7_000_000`, three times) and `main.ts`
 * (`json({ limit: "8mb" })`). The 5 MB video ceiling was not really a decision —
 * it was arithmetic: base64 inflates by ~4/3, the JSON body cap was 8 MB, so the
 * raw file had to stay under ~6 MB. Nothing in the code said so, and the comment
 * explaining it lived in only one of the three places.
 *
 * ## Two different numbers, deliberately
 *
 * `MAX_VIDEO_UPLOAD_BYTES` and `TARGET_VIDEO_BYTES` are NOT the same kind of
 * limit and must never be collapsed into one:
 *
 *   MAX_VIDEO_UPLOAD  what a client may SEND. Bounded by the proxy, not by us.
 *   TARGET_VIDEO      what we STORE after transcoding. Bounded by disk and by
 *                     what a viewer should download.
 *
 * A 90 MB upload becomes a ~15 MB stored file. Raising one must not silently
 * raise the other.
 *
 * ## Why 90 and not 1024
 *
 * The brief asks for "原始视频最大 1024MB", but that number cannot be reached
 * through the current front door: Cloudflare's free/pro plan rejects request
 * bodies over 100 MB (413) before the request ever reaches Nginx, and Nginx has
 * its own `client_max_body_size`. An application limit of 90 MB with Nginx at
 * 100 MB is the largest combination that actually works on this deployment. A
 * 1024 MB application limit would be a promise the infrastructure breaks — the
 * user would see a Cloudflare error page, not our `FILE_TOO_LARGE` message.
 *
 * Raising this above 100 MB requires a Cloudflare plan or a direct-to-origin
 * upload path, not just an edit here.
 *
 * ## Every value has a default
 *
 * `Number(process.env.X ?? default)` is not enough: an empty string or a typo
 * yields `NaN`, which then propagates into `fileSize` and silently disables the
 * limit (every comparison against NaN is false). `envInt` rejects anything that
 * is not a positive integer and falls back to the default instead.
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const MB = 1024 * 1024;

/**
 * Raw ceiling for the LEGACY base64 JSON video path.
 *
 * Not the real video limit — that is `MAX_VIDEO_UPLOAD_BYTES` below, which the
 * multipart endpoint enforces through multer's `fileSize` BEFORE any bytes are
 * buffered.
 *
 * This value stays small on purpose. The base64 path does
 *
 *     const buffer = Buffer.from(match[2], "base64");
 *     if (buffer.length > this.maxVideoBytes()) return null;
 *
 * — the whole video is decoded into memory FIRST and only then measured. Raising
 * this number raises how much RAM a single request may allocate before anything
 * rejects it, which is exactly what the multipart path exists to avoid.
 *
 * 5 MB is the historical value and is safe: the `express.json({ limit: "8mb" })`
 * body cap in `main.ts` means a larger payload never reaches this code, so a
 * bigger number would be unreachable anyway.
 */
export const LEGACY_BASE64_VIDEO_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Largest original a client may send through the multipart endpoint.
 * Matches Nginx's 100m with headroom.
 */
export const MAX_VIDEO_UPLOAD_BYTES = envInt("VIDEO_MAX_UPLOAD_MB", 90) * MB;

/** Size we aim for after transcoding. Not a hard guarantee — see the service. */
export const TARGET_VIDEO_BYTES = envInt("VIDEO_TARGET_MAX_MB", 15) * MB;

/** Longest edge after scaling. Both bounds apply; aspect ratio is preserved. */
export const VIDEO_MAX_WIDTH = envInt("VIDEO_MAX_WIDTH", 1920);
export const VIDEO_MAX_HEIGHT = envInt("VIDEO_MAX_HEIGHT", 1080);

/** One ffmpeg run may not exceed this. A malicious file must not hold a core. */
export const VIDEO_PROCESSING_TIMEOUT_MS = envInt("VIDEO_PROCESSING_TIMEOUT_MS", 300_000);

/**
 * How many videos may be transcoded at once.
 *
 * The production host has 2 vCPU / 3.7 GB RAM, and libx264 already uses several
 * threads per job. Two concurrent transcodes saturate the box and make the whole
 * API unresponsive, including requests that have nothing to do with video, so the
 * default is 1. Requests beyond that wait in-process rather than being rejected —
 * see `VideoCompressionService`'s semaphore.
 *
 * No BullMQ/Redis: introducing a broker for this would be a much larger change
 * than the problem warrants. If volume grows, the semaphore is the seam to
 * replace with a real queue.
 */
export const VIDEO_MAX_CONCURRENT_JOBS = envInt("VIDEO_MAX_CONCURRENT_JOBS", 1);

/** Audio bitrate used both in the ffmpeg call and in the bitrate arithmetic. */
export const VIDEO_AUDIO_BITRATE_KBPS = envInt("VIDEO_AUDIO_BITRATE_KBPS", 96);

/** Upper bound on how many shrinking passes are attempted. Never a loop. */
export const VIDEO_MAX_COMPRESSION_ATTEMPTS = envInt("VIDEO_MAX_COMPRESSION_ATTEMPTS", 3);

/** MIME types accepted for a video upload, mapped to the extension we store. */
export const ALLOWED_VIDEO_MIME = new Map<string, string>([
  ["video/mp4", "mp4"],
  ["video/quicktime", "mov"],
  ["video/webm", "webm"],
  ["video/x-m4v", "m4v"],
]);
