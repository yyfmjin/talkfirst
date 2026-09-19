const BASE = process.env.API_BASE ?? "http://localhost:4000/api/v1";

async function request(path, { method = "GET", body, cookies = [] } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookies.length ? { Cookie: cookies.join("; ") } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  const setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  if (!response.ok || !payload?.success) {
    throw new Error(`${method} ${path} -> ${response.status} ${JSON.stringify(payload)}`);
  }
  return { data: payload.data, cookies: [...cookies, ...setCookies.map((c) => c.split(";")[0])] };
}

async function main() {
  const suffix = Date.now().toString(36);
  const alice = await request("/auth/register", {
    method: "POST",
    body: { email: `phase12-alice-${suffix}@test.dev`, password: "password123" },
  });
  await request("/users/me", {
    method: "PATCH",
    body: { nickname: "Phase12 Alice", birthDate: "2000-01-01", countryCode: "CN" },
    cookies: alice.cookies,
  });
  const bob = await request("/auth/register", {
    method: "POST",
    body: { email: `phase12-bob-${suffix}@test.dev`, password: "password123" },
  });
  const bobProfile = await request("/users/me", {
    method: "PATCH",
    body: { nickname: "Phase12 Bob", birthDate: "1999-05-05", countryCode: "US" },
    cookies: bob.cookies,
  });

  const sent = await request("/connections/requests", {
    method: "POST",
    body: { receiverId: bobProfile.data.id, message: "phase12 hello" },
    cookies: alice.cookies,
  });
  console.log("SENT OK", sent.data.id);

  const sentList = await request("/connections/requests/sent", { cookies: alice.cookies });
  console.log("SENT_LIST OK", sentList.data.length);

  const cancelled = await request(`/connections/requests/${sent.data.id}`, {
    method: "DELETE",
    cookies: alice.cookies,
  });
  console.log("CANCEL OK", cancelled.data.cancelled);

  const resent = await request("/connections/requests", {
    method: "POST",
    body: { receiverId: bobProfile.data.id, message: "phase12 hello again" },
    cookies: alice.cookies,
  });
  await request(`/connections/requests/${resent.data.id}/respond`, {
    method: "POST",
    body: { action: "accept" },
    cookies: bob.cookies,
  });
  const conversationId = resent.data.id
    ? (await request("/conversations", { cookies: alice.cookies })).data[0].id
    : null;
  console.log("ACCEPT OK conversation=", conversationId);

  const rest = await request(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: { content: "phase12 first message" },
    cookies: alice.cookies,
  });
  console.log("REST_MSG OK", rest.data.id);

  const notices = await request("/notifications", { cookies: bob.cookies });
  console.log("NOTICES OK unread=", notices.data.unread, "items=", notices.data.items.length);

  const conversations = await request("/conversations", { cookies: bob.cookies });
  console.log("UNREAD OK", conversations.data[0]?.unreadCount);

  const deleted = await request(`/messages/${rest.data.id}`, {
    method: "DELETE",
    cookies: alice.cookies,
  });
  console.log("DELETE OK", deleted.data.deleted);

  const history = await request(`/conversations/${conversationId}/messages?limit=20`, {
    cookies: alice.cookies,
  });
  console.log("HISTORY_HIDES_DELETED", !history.data.items.some((item) => item.id === rest.data.id));

  const blocked = await request("/blocks", {
    method: "POST",
    body: { userId: bobProfile.data.id, hideHistory: "true" },
    cookies: alice.cookies,
  });
  console.log("BLOCK_HIDE OK", blocked.data.blocked, blocked.data.hiddenMessages);

  const afterBlock = await request("/conversations", { cookies: alice.cookies });
  const visibleMessages = afterBlock.data.flatMap((conversation) =>
    conversation.lastMessage ? [conversation.lastMessage.id] : [],
  );
  console.log("HISTORY_EMPTY_AFTER_HIDE", visibleMessages.length === 0);
}

main().catch((error) => {
  console.error("PHASE12_SMOKE_FAIL", error.message);
  process.exit(1);
});
