import { Injectable } from "@nestjs/common";
import { createHmac, randomBytes } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { normalizeUploadUrl } from "./upload-url";

const ALLOWED_MIME = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

const DATA_URL_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

@Injectable()
export class UploadsService {
  maxBytes() {
    return 5 * 1024 * 1024;
  }

  allowedMime() {
    return [...ALLOWED_MIME.keys()];
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

  saveLocal(kind: "avatars" | "messages", buffer: Buffer, ext: string) {
    const dir = join(process.cwd(), ".local-data", "uploads", kind);
    mkdirSync(dir, { recursive: true });
    const name = `${Date.now()}-${randomBytes(8).toString("hex")}.${ext}`;
    writeFileSync(join(dir, name), buffer);
    const publicBase =
      process.env.PUBLIC_UPLOAD_BASE_URL ??
      process.env.LOCAL_UPLOAD_BASE_URL ??
      "http://localhost:4000/uploads";
    return `${publicBase.replace(/\/$/, "")}/${kind}/${name}`;
  }

  uploadDir() {
    const dir = join(process.cwd(), ".local-data", "uploads");
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  normalizeUploadUrl(raw: unknown) {
    return normalizeUploadUrl(raw);
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
