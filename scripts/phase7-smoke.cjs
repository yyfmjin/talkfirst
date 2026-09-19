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
  const aliceReg = await request("/auth/register", {
    method: "POST",
    body: { email: `phase7-alice-${suffix}@test.dev`, password: "password123" },
  });
  await request("/users/me", {
    method: "PATCH",
    body: { nickname: "ExchangeAlice", birthDate: "2000-01-01", countryCode: "CN" },
    cookies: aliceReg.cookies,
  });

  const bobReg = await request("/auth/register", {
    method: "POST",
    body: { email: `phase7-bob-${suffix}@test.dev`, password: "password123" },
  });
  const bobProfile = await request("/users/me", {
    method: "PATCH",
    body: { nickname: "ExchangeBob", birthDate: "1999-05-05", countryCode: "US" },
    cookies: bobReg.cookies,
  });

  for (const [cookies, platform, handle] of [
    [aliceReg.cookies, "INSTAGRAM", "@exchange_alice"],
    [aliceReg.cookies, "TELEGRAM", "@exchange_alice"],
    [bobReg.cookies, "INSTAGRAM", "@exchange_bob"],
    [bobReg.cookies, "TELEGRAM", "@exchange_bob"],
  ]) {
    await request("/users/me/social-accounts", {
      method: "PUT",
      body: { platform, handle },
      cookies,
    });
  }
  console.log("ACCOUNTS OK both users bound Instagram+Telegram");

  const sent = await request("/connections/requests", {
    method: "POST",
    body: { receiverId: bobProfile.data.id, message: "phase7 hello" },
    cookies: aliceReg.cookies,
  });
  const accepted = await request(`/connections/requests/${sent.data.id}/respond`, {
    method: "POST",
    body: { action: "accept" },
    cookies: bobReg.cookies,
  });
  const conversationId = accepted.data.connection.conversationId;
  console.log("CONNECTION OK conversation=", conversationId);

  const early = await request(`/conversations/${conversationId}/exchange`, {
    cookies: aliceReg.cookies,
  });
  console.log("ELIGIBILITY_BEFORE", early.data.messageCount, "/", early.data.requiredMessages, "eligible=", early.data.eligible);

  for (let i = 0; i < 5; i += 1) {
    await request(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: { content: `phase7 chat ${i + 1}` },
      cookies: i % 2 === 0 ? aliceReg.cookies : bobReg.cookies,
    });
  }
  const eligible = await request(`/conversations/${conversationId}/exchange`, {
    cookies: aliceReg.cookies,
  });
  console.log("ELIGIBILITY_AFTER", eligible.data.messageCount, "/", eligible.data.requiredMessages, "eligible=", eligible.data.eligible);
  if (!eligible.data.eligible) throw new Error("exchange should be eligible after 5 messages");

  const exchange = await request(`/conversations/${conversationId}/exchange`, {
    method: "POST",
    body: { platforms: ["INSTAGRAM", "TELEGRAM"], message: "let's keep in touch" },
    cookies: aliceReg.cookies,
  });
  console.log("REQUEST OK", exchange.data.id, exchange.data.status);

  const responded = await request(`/exchange/${exchange.data.id}/respond`, {
    method: "POST",
    body: { action: "accept" },
    cookies: bobReg.cookies,
  });
  console.log("ACCEPT OK", responded.data.exchange.status, "shared=", responded.data.shared.length);

  const contacts = await request(`/conversations/${conversationId}/exchange/contacts`, {
    cookies: aliceReg.cookies,
  });
  console.log("CONTACTS OK exchanged=", contacts.data.exchanged, "count=", contacts.data.contacts.length);
  if (!contacts.data.exchanged || contacts.data.contacts.length !== 4) {
    throw new Error(`expected 4 shared contacts, got ${JSON.stringify(contacts.data)}`);
  }

  const connections = await request("/connections", { cookies: aliceReg.cookies });
  console.log("CONNECTIONS OK exchange=", connections.data[0]?.exchange?.status);
}

main().catch((error) => {
  console.error("PHASE7_SMOKE_FAIL", error.message);
  process.exit(1);
});
