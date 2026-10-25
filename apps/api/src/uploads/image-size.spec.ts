import { readImageSize } from "./image-size";

/**
 * 头像尺寸解析的三个格式（2026-10-25）。
 *
 * 这个函数是「合格真人头像」的第一道门槛，读错一个字节就会把合格头像挡在
 * 题库外（或把 200×200 的缩略图放进去）。所以三种格式各钉一个真实布局的
 * 最小头部，而不是只测 PNG。
 */
describe("readImageSize", () => {
  it("读 PNG 的 IHDR", () => {
    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png, 0);
    png.writeUInt32BE(13, 8); // chunk length
    png.write("IHDR", 12, "latin1");
    png.writeUInt32BE(1024, 16);
    png.writeUInt32BE(768, 20);
    expect(readImageSize(png)).toEqual({ width: 1024, height: 768 });
  });

  it("读 JPEG 的 SOF0 段", () => {
    const jpeg = Buffer.from([
      0xff, 0xd8, // SOI
      0xff, 0xc0, 0x00, 0x11, 0x08, // SOF0 + 段长 + 精度
      0x02, 0x58, // height = 600
      0x03, 0x20, // width = 800
      0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    ]);
    expect(readImageSize(jpeg)).toEqual({ width: 800, height: 600 });
  });

  it("读 WebP 的 VP8X 扩展头", () => {
    const webp = Buffer.alloc(30);
    webp.write("RIFF", 0, "latin1");
    webp.writeUInt32LE(22, 4);
    webp.write("WEBP", 8, "latin1");
    webp.write("VP8X", 12, "latin1");
    // 24 位小端，存的是「尺寸 − 1」。
    webp.writeUIntLE(511, 24, 3);
    webp.writeUIntLE(399, 27, 3);
    expect(readImageSize(webp)).toEqual({ width: 512, height: 400 });
  });

  it("不是这三种格式时返回 null（调用方按「尺寸未知」处理）", () => {
    expect(readImageSize(Buffer.from("not an image at all, just text" ))).toBeNull();
    expect(readImageSize(Buffer.alloc(4))).toBeNull();
  });
});
