import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Where uploaded files live. The ONE place this is resolved.
 *
 * FIX (audit P004): the directory used to be derived from `process.cwd()` alone,
 * and `docker-compose.yml` mounted no volume there, so every avatar, chat image
 * and moment video disappeared when the API container was recreated while the
 * database kept pointing at the dead URLs.
 *
 * It previously existed TWICE — once here as `main.ts`'s local `uploadRoot()` and
 * once as `UploadsService`'s private method — kept in step by a comment asking
 * future editors to keep them in step. That is exactly the arrangement the P004
 * fix was meant to remove, so it is now a single exported function.
 *
 * `UPLOAD_DIR` is an absolute path in production (a Docker volume at /app/uploads,
 * or a PM2/pm2-managed directory on the Ubuntu host).
 */
export function uploadRoot(): string {
  const configured = process.env.UPLOAD_DIR?.trim();
  if (configured) return configured;
  return join(process.cwd(), ".local-data", "uploads");
}

/**
 * Scratch space for in-flight video processing.
 *
 * Deliberately OUTSIDE `uploadRoot()`, and that separation is load-bearing:
 * `uploadRoot()` is mounted for static serving at `/uploads/`, so anything written
 * there is publicly readable the moment it lands. A half-processed 90 MB original,
 * or a partial output from a killed ffmpeg, must never be reachable over HTTP.
 *
 * Follows the same `UPLOAD_DIR` convention: when an absolute upload directory is
 * configured, temp lives beside it rather than in the process working directory,
 * which in the container is not a mounted volume and would fill the image layer.
 */
export function videoTempRoot(): string {
  const configured = process.env.VIDEO_TEMP_DIR?.trim();
  if (configured) return configured;

  const uploadDir = process.env.UPLOAD_DIR?.trim();
  if (uploadDir) return join(uploadDir, "..", "temp");

  return join(process.cwd(), ".local-data", "temp");
}

/** Creates a directory if absent and returns it, so callers can chain. */
export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}
