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

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function main() {
  const suffix = Date.now().toString(36);
  const alice = await request("/auth/register", {
    method: "POST",
    body: { email: `phase14-alice-${suffix}@test.dev`, password: "password123" },
  });
  await request("/users/me", {
    method: "PATCH",
    body: { nickname: "Phase14 Alice", birthDate: "2000-01-01", countryCode: "CN" },
    cookies: alice.cookies,
  });
  const bob = await request("/auth/register", {
    method: "POST",
    body: { email: `phase14-bob-${suffix}@test.dev`, password: "password123" },
  });
  const bobProfile = await request("/users/me", {
    method: "PATCH",
    body: { nickname: "Phase14 Bob", birthDate: "1999-05-05", countryCode: "US" },
    cookies: bob.cookies,
  });

  const avatar = await request("/uploads/avatar", {
    method: "POST",
    body: { image: TINY_PNG },
    cookies: alice.cookies,
  });
  console.log("AVATAR_UPLOAD OK", avatar.data.avatarUrl);

  const sent = await request("/connections/requests", {
    method: "POST",
    body: { receiverId: bobProfile.data.id, message: "phase14 hello" },
    cookies: alice.cookies,
  });
  await request(`/connections/requests/${sent.data.id}/respond`, {
    method: "POST",
    body: { action: "accept" },
    cookies: bob.cookies,
  });
  const conversations = await request("/conversations", { cookies: alice.cookies });
  const conversationId = conversations.data[0].id;
  console.log("SETUP OK", conversationId);

  const rest = await request(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: { content: "Let's practice languages together." },
    cookies: alice.cookies,
  });

  const first = await request(`/messages/${rest.data.id}/translate`, {
    method: "POST",
    body: { targetLang: "zh" },
    cookies: bob.cookies,
  });
  console.log("TRANSLATE_1", first.data.provider, "cached=", first.data.cached, first.data.text.slice(0, 20));

  const second = await request(`/messages/${rest.data.id}/translate`, {
    method: "POST",
    body: { targetLang: "zh" },
    cookies: bob.cookies,
  });
  console.log("TRANSLATE_2 cached=", second.data.cached);
  if (!second.data.cached) throw new Error("second translate should hit cache");

  const image = await request("/uploads/message-image", {
    method: "POST",
    body: { image: TINY_PNG },
    cookies: alice.cookies,
  });
  console.log("IMAGE_UPLOAD OK", image.data.imageUrl);

  const imageMsg = await request(`/conversations/${conversationId}/messages/image`, {
    method: "POST",
    body: { imageUrl: image.data.imageUrl },
    cookies: alice.cookies,
  });
  console.log("IMAGE_MSG OK", imageMsg.data.type);

  const history = await request(`/conversations/${conversationId}/messages?limit=20`, {
    cookies: bob.cookies,
  });
  console.log("HISTORY_HAS_IMAGE", history.data.items.some((item) => item.type === "IMAGE"));
}

main().catch((error) => {
  console.error("PHASE14_SMOKE_FAIL", error.message);
  process.exit(1);
});
