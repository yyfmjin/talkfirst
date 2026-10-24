import { Injectable } from "@nestjs/common";
import { createHmac, randomBytes, randomUUID } from "crypto";
import { copyFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { normalizeUploadUrl } from "./upload-url";
import { uploadRoot as sharedUploadRoot } from "./upload-paths";
import { LEGACY_BASE64_VIDEO_MAX_BYTES } from "./video-upload.config";

const ALLOWED_MIME = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

/**
 * PC-3.6 — the composer publishes a moment's media through the existing local
 * upload path, so the same two checks the avatar/chat endpoints use (mime
 * allow-list plus a magic-byte sniff) apply to video as well. `video/quicktime`
 * shares the ISO-BMFF container with mp4, so one sniffer covers both.
 */
const ALLOWED_VIDEO_MIME = new Map([
  ["video/mp4", "mp4"],
  ["video/webm", "webm"],
  ["video/quicktime", "mov"],
]);

const DATA_URL_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
const VIDEO_DATA_URL_PATTERN = /^data:(video\/(?:mp4|webm|quicktime));base64,([A-Za-z0-9+/=]+)$/;

/**
 * 语音动态（2026-10-24）。
 *
 * 录音由 App 端录完直接转 data URL 上传 —— 一段 60 秒的 AAC/m4a 大约 500KB–1MB，
 * base64 膨胀 4/3 后仍在 `express.json({ limit: "8mb" })` 之内，所以不需要像视频那样
 * 另开一趟 multipart。客户端按 6MB 原始大小先拦一次，服务端这里是权威。
 */
const ALLOWED_AUDIO_MIME = new Map([
  ["audio/mp4", "m4a"],
  ["audio/m4a", "m4a"],
  ["audio/x-m4a", "m4a"],
  ["audio/aac", "aac"],
  ["audio/mpeg", "mp3"],
  ["audio/ogg", "ogg"],
  ["audio/webm", "weba"],
]);

const AUDIO_DATA_URL_PATTERN = /^data:(audio\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/;
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

/** Where a locally stored file may live; one directory per use case. */
export type UploadKind = "avatars" | "messages" | "moments";

@Injectable()
export class UploadsService {
  maxBytes() {
    return 5 * 1024 * 1024;
  }

  /**
   * Raw ceiling for a base64 video data URL — the LEGACY path only.
   *
   * See `LEGACY_BASE64_VIDEO_MAX_BYTES` for why this stays at 5 MB while the real
   * upload limit is 90 MB. The method NAME is kept deliberately:
   * `uploads-moment-media.spec.ts` stubs `maxVideoBytes` to drive its size-limit
   * cases, so renaming it would break a test unrelated to this change.
   */
  maxVideoBytes() {
    return LEGACY_BASE64_VIDEO_MAX_BYTES;
  }

  allowedMime() {
    return [...ALLOWED_MIME.keys()];
  }

  allowedVideoMime() {
    return [...ALLOWED_VIDEO_MIME.keys()];
  }

  parseDataUrl(input: string) {
    const match = DATA_URL_PATTERN.exec(input ?? "");
    if (!match) return null;
    const mime = match[1];
    const ext = ALLOWED_MIME.get(mime);
    if (!ext) return null;
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length === 0 || buffer.length > this.maxBytes()) return null;
    if (!this.sniffImage(buffer, mime)) return null;
    return { mime, ext, buffer };
  }

  parseVideoDataUrl(input: string) {
    const match = VIDEO_DATA_URL_PATTERN.exec(input ?? "");
    if (!match) return null;
    const mime = match[1];
    const ext = ALLOWED_VIDEO_MIME.get(mime);
    if (!ext) return null;
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length === 0 || buffer.length > this.maxVideoBytes()) return null;
    if (!this.sniffVideo(buffer)) return null;
    return { mime, ext, buffer };
  }

  maxAudioBytes() {
    return MAX_AUDIO_BYTES;
  }

  allowedAudioMime() {
    return [...ALLOWED_AUDIO_MIME.keys()];
  }

  /**
   * 语音动态的 data URL → 文件。
   *
   * 与图片/视频同一套规矩：mime 白名单 + 魔数校验，两者都过才落盘。
   * 只靠 mime 不够：客户端可以把任意文件标成 `audio/mpeg`。
   */
  parseAudioDataUrl(input: string) {
    const match = AUDIO_DATA_URL_PATTERN.exec(input ?? "");
    if (!match) return null;
    const mime = match[1];
    const ext = ALLOWED_AUDIO_MIME.get(mime);
    if (!ext) return null;
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length === 0 || buffer.length > this.maxAudioBytes()) return null;
    if (!this.sniffAudio(buffer)) return null;
    return { mime, ext, buffer };
  }

  presign(filename: string, mime: string) {
    const endpoint = process.env.STORAGE_ENDPOINT;
    const bucket = process.env.STORAGE_BUCKET ?? "talkfirst";
    const secret = process.env.STORAGE_SECRET_KEY;
    if (!endpoint || !secret || !ALLOWED_MIME.has(mime)) return null;
    const ext = ALLOWED_MIME.get(mime);
    const key = `uploads/${new Date().toISOString().slice(0, 10)}/${randomBytes(12).toString("hex")}.${ext}`;
    const expires = Date.now() + 10 * 60 * 1000;
    const signature = createHmac("sha256", secret).update(`${key}:${mime}:${expires}`).digest("hex");
    const base = endpoint.replace(/\/$/, "");
    return {
      key,
      mime,
      maxBytes: this.maxBytes(),
      uploadUrl: `${base}/${bucket}/${key}?expires=${expires}&signature=${signature}`,
      publicUrl: `${base}/${bucket}/${key}`,
      expiresAt: new Date(expires).toISOString(),
    };
  }

  /**
   * Where local uploads live on disk — resolves through the shared helper so the
   * static mount in `main.ts` and this writer cannot disagree (audit P004).
   */
  private uploadRoot(): string {
    return sharedUploadRoot();
  }

  /**
   * Moves an already-transcoded video out of the temp directory and into the
   * public `moments/` directory, returning the URL to store on the moment.
   *
   * ## The file name is server-generated, always
   *
   * `randomUUID()` — never the client's filename, never anything the client sent.
   * That is what makes path traversal and file overwriting structurally impossible
   * rather than merely checked for: there is no user-controlled component in this
   * path at all.
   *
   * ## Why `copyFileSync` and not `renameSync`
   *
   * They are frequently on different filesystems — temp is deliberately outside
   * the static root — and `rename` across devices throws `EXDEV`. `copyFile` then
   * leaves the source for the caller's `finally` to remove, which keeps ONE
   * cleanup path instead of two.
   *
   * ## Backward compatibility
   *
   * The stored URL keeps the same shape as every other moment upload
   * (`/uploads/moments/<name>`), and the moment row keeps writing the same
   * `videoUrl` column. Existing rows and existing files are untouched.
   */
  storeProcessedVideo(tempPath: string, ext = "mp4"): string {
    const dir = join(this.uploadRoot(), "moments");
    mkdirSync(dir, { recursive: true });

    const safeExt = /^[a-z0-9]{1,5}$/.test(ext) ? ext : "mp4";
    const name = `${randomUUID()}.${safeExt}`;
    copyFileSync(tempPath, join(dir, name));

    return `${this.publicBase()}/moments/${name}`;
  }

  private publicBase(): string {
    return (
      process.env.PUBLIC_UPLOAD_BASE_URL ??
      process.env.LOCAL_UPLOAD_BASE_URL ??
      "http://localhost:4000/uploads"
    ).replace(/\/$/, "");
  }

  saveLocal(kind: UploadKind, buffer: Buffer, ext: string) {
    const dir = join(this.uploadRoot(), kind);
    mkdirSync(dir, { recursive: true });
    const name = `${Date.now()}-${randomBytes(8).toString("hex")}.${ext}`;
    writeFileSync(join(dir, name), buffer);
    return `${this.publicBase()}/${kind}/${name}`;
  }

  uploadDir() {
    const dir = this.uploadRoot();
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  normalizeUploadUrl(raw: unknown) {
    return normalizeUploadUrl(raw);
  }

  /**
   * mp4 and mov are both ISO base media files, whose first box is `ftyp` at
   * offset 4. WebM is Matroska, which starts with the EBML magic `1A 45 DF A3`.
   */
  private sniffVideo(buffer: Buffer) {
    if (buffer.length < 12) return false;
    if (buffer.subarray(4, 8).toString("latin1") === "ftyp") return true;
    return buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
  }

  /**
   * 音频魔数：
   *   m4a/aac(mp4 容器)  ISO-BMFF，偏移 4 处是 `ftyp`（与 mp4/mov 同容器）
   *   mp3               `ID3` 标签头，或直接以帧同步字 0xFF 0xEx/0xFx 开头
   *   ogg               `OggS`
   *   webm              EBML 魔数 1A 45 DF A3
   */
  private sniffAudio(buffer: Buffer) {
    if (buffer.length < 12) return false;
    if (buffer.subarray(4, 8).toString("latin1") === "ftyp") return true;
    if (buffer.subarray(0, 3).toString("latin1") === "ID3") return true;
    if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return true;
    if (buffer.subarray(0, 4).toString("latin1") === "OggS") return true;
    return buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
  }

  private sniffImage(buffer: Buffer, mime: string) {
    if (mime === "image/png") {
      return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    }
    if (mime === "image/jpeg") {
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
    }
    if (mime === "image/webp") {
      return buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
    }
    return false;
  }
}
