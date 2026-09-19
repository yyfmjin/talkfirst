import { normalizeUploadUrl } from "./upload-url";

describe("normalizeUploadUrl avatar contract", () => {
  it("accepts production https avatar URLs unchanged", () => {
    const url = "https://cdn.example.com/avatars/user-1.png";
    expect(normalizeUploadUrl(url)).toBe(url);
  });

  it("rejects data URLs and non-http schemes", () => {
    expect(normalizeUploadUrl("data:image/png;base64,abcd")).toBeNull();
    expect(normalizeUploadUrl("ftp://example.com/a.png")).toBeNull();
    expect(normalizeUploadUrl("")).toBeNull();
    expect(normalizeUploadUrl(undefined)).toBeNull();
  });

  it("keeps dev localhost uploads readable in non-production", () => {
    const url = "http://localhost:4000/uploads/avatars/a.png";
    expect(normalizeUploadUrl(url)).toBe(url);
  });

  it("rejects localhost uploads in production", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(normalizeUploadUrl("http://localhost:4000/uploads/avatars/a.png")).toBeNull();
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
