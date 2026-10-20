import { conversationIdFromNotification } from "./MessagesScreen";

/**
 * 通知 → 会话的跳转靠这段解析。
 *
 * 服务端把通知负载存成一段 JSON 字符串（`Notification.data`），里面**不一定**有
 * `conversationId`：动态点赞、收到花这些通知就没有会话可去。之前点通知只标已读，
 * 现在点得动了 —— 那就必须保证「解析不出来」时什么都不做，而不是抛异常把整个
 * 通知列表打崩（那个异常会被 ErrorBoundary 接住，用户看到的是整页错误）。
 */
describe("conversationIdFromNotification", () => {
  it("正常负载取出会话 id", () => {
    expect(
      conversationIdFromNotification(JSON.stringify({ type: "MESSAGE", conversationId: "c-1" })),
    ).toBe("c-1");
  });

  it("没有 conversationId 的通知返回 null（动态点赞这类）", () => {
    expect(conversationIdFromNotification(JSON.stringify({ momentId: "m-1" }))).toBeNull();
  });

  it("data 为空返回 null", () => {
    expect(conversationIdFromNotification(null)).toBeNull();
    expect(conversationIdFromNotification("")).toBeNull();
  });

  it("坏 JSON 不会抛异常，只返回 null", () => {
    expect(() => conversationIdFromNotification("{not json")).not.toThrow();
    expect(conversationIdFromNotification("{not json")).toBeNull();
  });

  it("空字符串的会话 id 视为没有", () => {
    expect(conversationIdFromNotification(JSON.stringify({ conversationId: "" }))).toBeNull();
  });
});
