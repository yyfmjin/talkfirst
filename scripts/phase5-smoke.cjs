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
  const aliceEmail = `phase5-alice-${suffix}@test.dev`;
  const bobEmail = `phase5-bob-${suffix}@test.dev`;

  const aliceReg = await request("/auth/register", {
    method: "POST",
    body: { email: aliceEmail, password: "password123" },
  });
  await request("/users/me", {
    method: "PATCH",
    body: { nickname: "PhaseAlice", birthDate: "2000-01-01", countryCode: "CN" },
    cookies: aliceReg.cookies,
  });
  const alice = { cookies: aliceReg.cookies };

  const bobReg = await request("/auth/register", {
    method: "POST",
    body: { email: bobEmail, password: "password123" },
  });
  await request("/users/me", {
    method: "PATCH",
    body: { nickname: "PhaseBob", birthDate: "1999-05-05", countryCode: "US" },
    cookies: bobReg.cookies,
  });
  const bob = { cookies: bobReg.cookies };
  console.log("USERS OK", aliceEmail, bobEmail);

  const templates = await request("/connections/templates");
  console.log("TEMPLATES OK", templates.data.length);

  const me = await request("/users/me", { cookies: alice.cookies });
  void me;
  const bobProfile = await request("/users/me", { cookies: bob.cookies });

  const sent = await request("/connections/requests", {
    method: "POST",
    body: { receiverId: bobProfile.data.id, message: "🎮 We both like gaming.", templateId: "gaming" },
    cookies: alice.cookies,
  });
  console.log("SEND OK", sent.data.id, sent.data.status);

  const incoming = await request("/connections/requests/incoming", { cookies: bob.cookies });
  console.log("INCOMING OK", incoming.data.length);

  const accepted = await request(`/connections/requests/${sent.data.id}/respond`, {
    method: "POST",
    body: { action: "accept" },
    cookies: bob.cookies,
  });
  console.log("ACCEPT OK connection=", accepted.data.connection.id, "conversation=", accepted.data.connection.conversationId);

  const conversationId = accepted.data.connection.conversationId;
  const posted = await request(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: { content: "Hello from Phase 5 smoke test" },
    cookies: alice.cookies,
  });
  console.log("MESSAGE OK", posted.data.id);

  const history = await request(`/conversations/${conversationId}/messages?limit=20`, {
    cookies: bob.cookies,
  });
  console.log("HISTORY OK", history.data.items.length, "messages");

  const conversations = await request("/conversations", { cookies: bob.cookies });
  console.log("CONVERSATIONS OK", conversations.data.length);

  const connections = await request("/connections", { cookies: alice.cookies });
  console.log("CONNECTIONS OK", connections.data.length, "peer=", connections.data[0]?.peer?.nickname);

  const duplicate = await request("/connections/requests", {
    method: "POST",
    body: { receiverId: bobProfile.data.id, message: "again" },
    cookies: alice.cookies,
  }).then(
    () => "DUPLICATE_UNEXPECTED_PASS",
    (error) => `DUPLICATE_BLOCKED ${error.message.slice(0, 120)}`,
  );
  console.log(duplicate);
}

main().catch((error) => {
  console.error("PHASE5_SMOKE_FAIL", error.message);
  process.exit(1);
});
