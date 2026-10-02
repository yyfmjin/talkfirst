import { MomentsService } from "./moments.service";

/**
 * PC-3.6 — the composer publishes a photo or a clip on its own.
 *
 * `publish()` used to treat an empty body as `EMPTY_CONTENT` before it ever
 * looked at the media, so a member who attached a picture and left the caption
 * blank could not post. These tests pin the new rule: the body, the images and
 * the clip are each sufficient on their own, and the same URL validation that
 * guarded images still trims what reaches the database.
 */

type Created = {
  id: string;
  userId: string;
  platform: string;
  platformName: string;
  content: string;
  images: string[];
  videoUrl: string | null;
  tags: string[];
  source: string;
  createdAt: Date;
};

function makeService(scanBlocked = false) {
  const create = jest.fn(async (args: { data: Omit<Created, "id" | "createdAt"> }) => ({
    id: "m-new",
    createdAt: new Date("2026-10-02T00:00:00.000Z"),
    ...args.data,
  }));
  const service = new MomentsService(
    { moment: { create } } as never,
    { scanText: () => ({ blocked: scanBlocked }) } as never,
    { notify: jest.fn() } as never,
  );
  return { service, create };
}

async function expectEmptyContent(service: MomentsService, input: Parameters<MomentsService["publish"]>[1]) {
  await expect(service.publish("u1", input)).rejects.toMatchObject({ code: "EMPTY_CONTENT" });
}

describe("MomentsService.publish media-only posts", () => {
  it("空内容且无媒体 -> EMPTY_CONTENT", async () => {
    const { service, create } = makeService();
    await expectEmptyContent(service, { content: "   " });
    expect(create).not.toHaveBeenCalled();
  });

  it("只有图片、没有文字 -> 成功，content 为空字符串", async () => {
    const { service, create } = makeService();
    const result = await service.publish("u1", {
      content: "",
      images: ["https://cdn.example.com/a.png"],
    });
    expect(result.content).toBe("");
    expect(result.images).toEqual(["https://cdn.example.com/a.png"]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("只有视频、没有文字 -> 成功", async () => {
    const { service } = makeService();
    const result = await service.publish("u1", {
      content: "",
      videoUrl: "https://cdn.example.com/a.mp4",
    });
    expect(result.content).toBe("");
    expect(result.videoUrl).toBe("https://cdn.example.com/a.mp4");
  });

  it("既无有效媒体也无文字（非法 URL 被过滤）-> EMPTY_CONTENT", async () => {
    const { service, create } = makeService();
    await expectEmptyContent(service, { content: "", images: ["not-a-url", "data:image/png;base64,xx"] });
    await expectEmptyContent(service, { content: "", videoUrl: "ftp://example.com/a.mp4" });
    expect(create).not.toHaveBeenCalled();
  });

  it("图片最多保留 9 张，视频 URL 非法时为 null", async () => {
    const { service } = makeService();
    const images = Array.from({ length: 12 }, (_, index) => `https://cdn.example.com/${index}.png`);
    const result = await service.publish("u1", { content: "", images, videoUrl: "javascript:alert(1)" });
    expect(result.images).toHaveLength(9);
    expect(result.videoUrl).toBeNull();
  });

  it("内容被 trim 并截断到 2000 字", async () => {
    const { service } = makeService();
    const result = await service.publish("u1", { content: `  ${"x".repeat(2500)}  ` });
    expect(result.content).toHaveLength(2000);
  });

  it("话题被规范化（去 #、trim、小写、去空、最多 10 个）", async () => {
    const { service } = makeService();
    const result = await service.publish("u1", {
      content: "hello",
      tags: ["#Travel", "  MUSIC  ", "#", ...Array.from({ length: 12 }, (_, i) => `t${i}`)],
    });
    // No de-duplication here: the composer's toggle cannot add a tag twice, and
    // the endpoint has never collapsed repeats.
    expect(result.tags).toEqual(["travel", "music", "t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7"]);
  });

  it("命中风控举报词 -> CONTENT_BLOCKED", async () => {
    const { service, create } = makeService(true);
    await expect(service.publish("u1", { content: "blocked" })).rejects.toMatchObject({
      code: "CONTENT_BLOCKED",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("风控异常时按不拦截处理（与既有行为一致）", async () => {
    const create = jest.fn(async (args: { data: { content: string } }) => ({
      id: "m-new",
      createdAt: new Date(),
      userId: "u1",
      platform: "TALKFIRST",
      platformName: "TalkFirst",
      images: [],
      videoUrl: null,
      tags: [],
      source: "USER",
      ...args.data,
    }));
    const service = new MomentsService(
      { moment: { create } } as never,
      {
        scanText: () => {
          throw new Error("scanner down");
        },
      } as never,
      { notify: jest.fn() } as never,
    );
    await expect(service.publish("u1", { content: "still posts" })).resolves.toMatchObject({
      content: "still posts",
    });
  });
});
