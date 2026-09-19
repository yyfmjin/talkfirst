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

async function expectFail(promise, label) {
  try {
    await promise;
  } catch (error) {
    console.log(`${label} BLOCKED_AS_EXPECTED`, error.message.slice(0, 160));
    return;
  }
  throw new Error(`${label} should have been blocked`);
}

async function main() {
  const suffix = Date.now().toString(36);
  const alice = await request("/auth/register", {
    method: "POST",
    body: { email: `phase8-alice-${suffix}@test.dev`, password: "password123" },
  });
  await request("/users/me", {
    method: "PATCH",
    body: { nickname: "SafeAlice", birthDate: "2000-01-01", countryCode: "CN" },
    cookies: alice.cookies,
  });
  const bob = await request("/auth/register", {
    method: "POST",
    body: { email: `phase8-bob-${suffix}@test.dev`, password: "password123" },
  });
  const bobProfile = await request("/users/me", {
    method: "PATCH",
    body: { nickname: "SafeBob", birthDate: "1999-05-05", countryCode: "US" },
    cookies: bob.cookies,
  });
  console.log("USERS OK");

  const scanClean = await request("/messages/safety-scan", {
    method: "POST",
    body: { content: "Hello, let's practice languages this weekend." },
    cookies: alice.cookies,
  });
  console.log("SCAN_CLEAN", scanClean.data.level, scanClean.data.warning ?? "no-warning");

  const scanLink = await request("/messages/safety-scan", {
    method: "POST",
    body: { content: "Join my telegram group https://example.com/gift now" },
    cookies: alice.cookies,
  });
  console.log("SCAN_LINK", scanLink.data.level, scanLink.data.warning?.slice(0, 40), JSON.stringify(scanLink.data.links));

  const scanContact = await request("/messages/safety-scan", {
    method: "POST",
    body: { content: "My telegram is @secret_account_123" },
    cookies: alice.cookies,
  });
  console.log("SCAN_CONTACT", scanContact.data.level, scanContact.data.hasContactLeak);

  const sent = await request("/connections/requests", {
    method: "POST",
    body: { receiverId: bobProfile.data.id, message: "socket safety hello" },
    cookies: alice.cookies,
  });
  const accepted = await request(`/connections/requests/${sent.data.id}/respond`, {
    method: "POST",
    body: { action: "accept" },
    cookies: bob.cookies,
  });
  const conversationId = accepted.data.connection.conversationId;
  console.log("CONNECTION OK", conversationId);

  const spam = await request(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: { content: "Earn money fast with crypto investment, click this link https://spam.example/claim" },
    cookies: alice.cookies,
  });
  console.log("SPAM_SENT_BUT_FLAGGED", spam.data.id);

  const reports = await request("/reports/mine", { cookies: alice.cookies });
  console.log("AUTO_REPORT OK", reports.data.length, reports.data[0]?.reason);

  await request("/reports", {
    method: "POST",
    body: { userId: bobProfile.data.id, reason: "Spam", description: "phase8 manual report" },
    cookies: alice.cookies,
  });
  const afterManual = await request("/reports/mine", { cookies: alice.cookies });
  console.log("MANUAL_REPORT OK", afterManual.data.length);

  await request("/blocks", { method: "POST", body: { userId: bobProfile.data.id }, cookies: alice.cookies });
  const blocks = await request("/blocks", { cookies: alice.cookies });
  console.log("BLOCK OK", blocks.data.length, blocks.data[0]?.blocked?.nickname);

  await expectFail(
    request(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: { content: "hello after block" },
      cookies: alice.cookies,
    }),
    "CHAT_AFTER_BLOCK",
  );

  await request(`/blocks/${bobProfile.data.id}`, { method: "DELETE", cookies: alice.cookies });
  const afterUnblock = await request("/blocks", { cookies: alice.cookies });
  console.log("UNBLOCK OK", afterUnblock.data.length);
}

main().catch((error) => {
  console.error("PHASE8_SMOKE_FAIL", error.message);
  process.exit(1);
});
