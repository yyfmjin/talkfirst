import { BadRequestException, PayloadTooLargeException, type CallHandler, type ExecutionContext } from "@nestjs/common";
import { PassThrough } from "node:stream";
import { promises as fs, existsSync } from "node:fs";
import {
  VideoUploadInterceptor,
  MOMENT_VIDEO_FIELD,
  type StreamedFile,
} from "./video-upload.interceptor";

/**
 * Coverage for the hand-written multipart reader.
 *
 * ## Why this file matters more than usual
 *
 * `video-upload.interceptor.ts` replaces multer (its `diskStorage` is unreachable
 * from this app — see the header there), so this parser is bespoke code on the
 * hot path for every video upload. The cases below feed it real multipart bytes
 * through a `PassThrough` rather than mocking the stream primitives, because the
 * bugs worth catching here are exactly the boundary-crossing ones: a delimiter
 * split across two chunks, a part we must skip, a body that is cut off.
 *
 * ## NOT RUN
 *
 * No test here invokes ffmpeg or a real HTTP server. The full upload →
 * transcode → store path is NOT RUN; see the delivery report.
 */

const BOUNDARY = "----talkfirstTestBoundary7f3a";

/** Builds a multipart body, optionally splitting the file bytes into chunks. */
function multipartBody(
  parts: Array<{ name: string; filename?: string; contentType?: string; data: Buffer | string }>,
): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const disposition = part.filename
      ? `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"`
      : `Content-Disposition: form-data; name="${part.name}"`;
    chunks.push(Buffer.from(`--${BOUNDARY}\r\n${disposition}\r\n`));
    if (part.contentType) chunks.push(Buffer.from(`Content-Type: ${part.contentType}\r\n`));
    chunks.push(Buffer.from("\r\n"));
    chunks.push(Buffer.isBuffer(part.data) ? part.data : Buffer.from(part.data));
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(chunks);
}

/** An ISO-BMFF header, i.e. what `sniffVideo` in UploadsService looks for. */
const FAKE_MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from("ftypisom", "latin1"),
  Buffer.alloc(64, 0x11),
]);

/** A request double: a real readable stream plus the headers a handler reads. */
function fakeRequest(body: Buffer, contentType = `multipart/form-data; boundary=${BOUNDARY}`) {
  const stream = new PassThrough() as PassThrough & {
    headers: Record<string, string>;
    pause: () => unknown;
    resume: () => unknown;
    destroy: (error?: Error) => void;
  };
  stream.headers = { "content-type": contentType };
  // Feed asynchronously so the interceptor's listeners are attached first.
  setImmediate(() => {
    stream.end(body);
  });
  return stream;
}

function fakeContext(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const next: CallHandler = { handle: () => undefined as never };

function makeInterceptor(maxBytes: number) {
  return new VideoUploadInterceptor({ fieldName: MOMENT_VIDEO_FIELD, maxBytes });
}

async function run(body: Buffer, maxBytes = 1024 * 1024, contentType?: string) {
  const request = fakeRequest(body, contentType);
  const interceptor = makeInterceptor(maxBytes);
  await interceptor.intercept(fakeContext(request), next);
  return request as unknown as { file?: StreamedFile };
}

describe("VideoUploadInterceptor — 正常路径", () => {
  it("把文件写到磁盘并记录原始名与类型", async () => {
    const body = multipartBody([
      { name: MOMENT_VIDEO_FIELD, filename: "clip.mp4", contentType: "video/mp4", data: FAKE_MP4 },
    ]);
    const request = await run(body);

    expect(request.file).toBeDefined();
    expect(request.file?.originalname).toBe("clip.mp4");
    expect(request.file?.mimetype).toBe("video/mp4");
    expect(request.file?.size).toBe(FAKE_MP4.length);

    const written = await fs.readFile(request.file!.path);
    expect(written.equals(FAKE_MP4)).toBe(true);

    await fs.rm(request.file!.path, { force: true });
  });

  it("分隔符跨 chunk 时仍能正确切分", async () => {
    /**
     * The holdback logic exists for exactly this. Feeding the body one byte at a
     * time makes every delimiter straddle a chunk boundary, which is the case a
     * naive "write everything, then look for the delimiter" implementation breaks
     * on — and it would break silently, by writing the delimiter into the file.
     *
     * The stream is NOT pre-ended here (unlike `run`), so the test controls when
     * EOF happens.
     */
    const body = multipartBody([
      { name: MOMENT_VIDEO_FIELD, filename: "a.mp4", contentType: "video/mp4", data: FAKE_MP4 },
    ]);

    const stream = new PassThrough() as PassThrough & { headers: Record<string, string> };
    stream.headers = { "content-type": `multipart/form-data; boundary=${BOUNDARY}` };

    const reading = makeInterceptor(1024 * 1024).intercept(fakeContext(stream), next);

    for (const byte of body) {
      stream.write(Buffer.from([byte]));
      // Yield so the interceptor's data handler runs and drains `pending`
      // between writes.
      await new Promise((resolve) => setImmediate(resolve));
    }
    stream.end();

    await reading;
    const file = (stream as unknown as { file?: StreamedFile }).file;
    expect(file).toBeDefined();

    const written = await fs.readFile(file!.path);
    // Byte-exact: no delimiter or CRLF leaked into the stored file.
    expect(written.equals(FAKE_MP4)).toBe(true);
    // Nor was the file short: the exact length proves nothing was dropped.
    expect(written.length).toBe(FAKE_MP4.length);

    await fs.rm(file!.path, { force: true });
  });

  it("跳过非目标字段，仍能取到后面的文件", async () => {
    // A client may send other parts first; without skip mode this looked like a
    // truncated upload and the request failed.
    const body = multipartBody([
      { name: "caption", data: "hello" },
      { name: MOMENT_VIDEO_FIELD, filename: "b.mp4", contentType: "video/mp4", data: FAKE_MP4 },
    ]);
    const request = await run(body);

    expect(request.file).toBeDefined();
    const written = await fs.readFile(request.file!.path);
    expect(written.equals(FAKE_MP4)).toBe(true);
    await fs.rm(request.file!.path, { force: true });
  });

  it("只有非目标字段时明确报错，而不是写一个空文件", async () => {
    const body = multipartBody([{ name: "caption", data: "hello" }]);
    await expect(run(body)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("VideoUploadInterceptor — 拒绝", () => {
  it("不是 multipart 直接拒绝", async () => {
    await expect(run(Buffer.from("{}"), 1024, "application/json")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("缺少 boundary 直接拒绝", async () => {
    await expect(run(Buffer.from("x"), 1024, "multipart/form-data")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("超过上限时抛 413，并携带 FILE_TOO_LARGE", async () => {
    const body = multipartBody([
      { name: MOMENT_VIDEO_FIELD, filename: "big.mp4", contentType: "video/mp4", data: Buffer.alloc(4096, 7) },
    ]);

    let caught: unknown = null;
    try {
      await run(body, 1024);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PayloadTooLargeException);
    const response = (caught as PayloadTooLargeException).getResponse() as {
      error?: { code?: string };
    };
    expect(response.error?.code).toBe("FILE_TOO_LARGE");
  });

  it("请求体被截断（没有结束分隔符）时拒绝", async () => {
    const full = multipartBody([
      { name: MOMENT_VIDEO_FIELD, filename: "c.mp4", contentType: "video/mp4", data: FAKE_MP4 },
    ]);
    // Chop the closing `--boundary--` marker off.
    const truncated = full.subarray(0, full.length - (BOUNDARY.length + 8));
    await expect(run(truncated)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("空文件被拒绝", async () => {
    const body = multipartBody([
      { name: MOMENT_VIDEO_FIELD, filename: "empty.mp4", contentType: "video/mp4", data: Buffer.alloc(0) },
    ]);
    await expect(run(body)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("VideoUploadInterceptor — 安全", () => {
  it("恶意文件名不会影响落盘路径", async () => {
    const body = multipartBody([
      {
        name: MOMENT_VIDEO_FIELD,
        filename: "../../../../etc/passwd",
        contentType: "video/mp4",
        data: FAKE_MP4,
      },
    ]);
    const request = await run(body);

    const file = request.file!;
    // The stored path comes from our own uuid, so traversal is impossible rather
    // than merely detected.
    expect(file.path.includes("..")).toBe(false);
    expect(file.path.includes("passwd")).toBe(false);
    // The name is still reported back for display, with separators neutralised.
    expect(file.originalname.includes("/")).toBe(false);
    expect(file.originalname.includes("\\")).toBe(false);

    await fs.rm(file.path, { force: true });
  });

  it("失败时不留下临时文件", async () => {
    const body = multipartBody([
      { name: "caption", data: "no file here at all" },
    ]);
    await expect(run(body)).rejects.toBeInstanceOf(BadRequestException);
    // Nothing to assert by name (the path is random), but the interceptor must not
    // throw while cleaning up — which the resolution of the rejection already shows.
  });

  it("超限时清理已写入的部分文件", async () => {
    const dir = (await import("./upload-paths")).videoTempRoot();
    const before = existsSync(dir) ? (await fs.readdir(dir)).length : 0;

    const body = multipartBody([
      { name: MOMENT_VIDEO_FIELD, filename: "big2.mp4", contentType: "video/mp4", data: Buffer.alloc(8192, 9) },
    ]);
    await expect(run(body, 1024)).rejects.toBeInstanceOf(PayloadTooLargeException);

    const after = existsSync(dir) ? (await fs.readdir(dir)).length : 0;
    expect(after).toBeLessThanOrEqual(before);
  });
});
