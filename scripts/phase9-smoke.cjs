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
    body: { email: `phase9-alice-${suffix}@test.dev`, password: "password123" },
  });
  await request("/users/me", {
    method: "PATCH",
    body: { nickname: "TranslateAlice", birthDate: "2000-01-01", countryCode: "CN" },
    cookies: alice.cookies,
  });
  const bob = await request("/auth/register", {
    method: "POST",
    body: { email: `phase9-bob-${suffix}@test.dev`, password: "password123" },
  });
  const bobProfile = await request("/users/me", {
    method: "PATCH",
    body: { nickname: "TranslateBob", birthDate: "1999-05-05", countryCode: "US" },
    cookies: bob.cookies,
  });

  const sent = await request("/connections/requests", {
    method: "POST",
    body: { receiverId: bobProfile.data.id, message: "translate hello" },
    cookies: alice.cookies,
  });
  const accepted = await request(`/connections/requests/${sent.data.id}/respond`, {
    method: "POST",
    body: { action: "accept" },
    cookies: bob.cookies,
  });
  const conversationId = accepted.data.connection.conversationId;
  const posted = await request(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: { content: "Let's practice languages together." },
    cookies: alice.cookies,
  });

  const languages = await request("/translate/languages", { cookies: alice.cookies });
  console.log("LANGUAGES OK", languages.data.length);

  const translated = await request(`/messages/${posted.data.id}/translate`, {
    method: "POST",
    body: { targetLang: "zh" },
    cookies: bob.cookies,
  });
  console.log("TRANSLATE OK", translated.data.sourceLang, "->", translated.data.targetLang, JSON.stringify(translated.data.text).slice(0, 80));
  if (!translated.data.text) throw new Error("empty translation");
}

main().catch((error) => {
  console.error("PHASE9_SMOKE_FAIL", error.message);
  process.exit(1);
});
