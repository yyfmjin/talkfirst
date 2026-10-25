/**
 * 从图片头读宽高（2026-10-25）。
 *
 * 为什么不用 sharp：它在本仓库只是 Next 的传递依赖，API 直接 import 一个没在
 * package.json 里声明的包，哪天 Next 换版本就会在运行时炸。而这里只需要宽高，
 * 三种格式的文件头里都写着，读几十个字节就够，没有解码成本。
 *
 * 只覆盖上传白名单里的三种（jpeg / png / webp）—— 与 `ALLOWED_MIME` 一致。
 * 读不出来返回 null，调用方按「尺寸未知」处理（猜猜看的资格会因此不通过）。
 */
export type ImageSize = { width: number; height: number };

export function readImageSize(buffer: Buffer): ImageSize | null {
  // 只要求够读前 8 个字节：最短的 JPEG 段头不到 24 字节，一概按 24 卡会把它们误判为 null。
  if (!buffer || buffer.length < 8) return null;

  // PNG：IHDR 紧跟在 8 字节签名 + 4 字节长度 + 4 字节类型之后。
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  // JPEG：扫描段，遇到 SOF 系列里的任一帧头即可读出尺寸。
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      // SOF0–SOF15，排除 DHT(C4) / JPG(C8) / DAC(CC) 这三个非 SOF 的码。
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) return null;
      offset += 2 + length;
    }
    return null;
  }

  // WebP：RIFF 容器，尺寸在三种子块里各有一种编码。
  if (buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP") {
    const chunk = buffer.subarray(12, 16).toString("latin1");
    if (chunk === "VP8 " && buffer.length >= 30) {
      return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === "VP8L" && buffer.length >= 25) {
      const bits = buffer.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X" && buffer.length >= 30) {
      return {
        width: 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)),
        height: 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)),
      };
    }
  }

  return null;
}
