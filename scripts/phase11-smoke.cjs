const BASE = process.env.API_BASE ?? "http://localhost:4000/api/v1";

async function raw(path, { method = "GET", body, cookies = [] } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookies.length ? { Cookie: cookies.join("; ") } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  const setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  return { response, payload, cookies: [...cookies, ...setCookies.map((c) => c.split(";")[0])] };
}

async function request(path, options = {}) {
  const { response, payload, cookies } = await raw(path, options);
  if (!response.ok || !payload?.success) {
    throw new Error(`${options.method ?? "GET"} ${path} -> ${response.status} ${JSON.stringify(payload)}`);
  }
  return { data: payload.data, cookies };
}

async function main() {
  const suffix = Date.now().toString(36);
  const email = `phase11-auth-${suffix}@test.dev`;

  const reg = await request("/auth/register", { method: "POST", body: { email, password: "password123" } });
  console.log("REGISTER OK", reg.data.email);

  const me = await request("/users/me", { cookies: reg.cookies });
  console.log("ME OK", me.data.email);

  const expired = me.cookies.filter((c) => !c.startsWith("tf_access="));
  const retry = await raw("/users/me", { cookies: expired.map((c) => "tf_access=; " + c) });
  console.log("EXPIRED_ACCESS", retry.response.status, retry.payload?.error?.code);
  if (retry.response.status !== 401) throw new Error("expected 401 for missing access cookie");

  const refreshed = await raw("/auth/refresh", { method: "POST", cookies: reg.cookies });
  console.log("REFRESH", refreshed.response.status, refreshed.cookies.some((c) => c.startsWith("tf_access=")) ? "new-access" : "no-access");
  if (!refreshed.response.ok) throw new Error("refresh should succeed with valid refresh cookie");

  const afterRefresh = await request("/users/me", { cookies: refreshed.cookies });
  console.log("ME_AFTER_REFRESH OK", afterRefresh.data.email);

  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  const victim = await prisma.user.findUnique({ where: { email } });
  const beforeBanToken = reg.cookies.find((c) => c.startsWith("tf_access="));
  await prisma.user.update({ where: { id: victim.id }, data: { status: "BANNED", bannedAt: new Date(), banReason: "phase11" } });

  const bannedCall = await raw("/users/me", { cookies: [`tf_access=${beforeBanToken.split("=")[1]}`, ...reg.cookies.filter((c) => c.startsWith("tf_refresh="))] });
  console.log("BANNED_TOKEN", bannedCall.response.status, bannedCall.payload?.error?.code);
  if (bannedCall.response.status !== 401 || bannedCall.payload?.error?.code !== "USER_BANNED") {
    throw new Error("banned access token must return USER_BANNED");
  }
  const bannedRefresh = await raw("/auth/refresh", { method: "POST", cookies: reg.cookies });
  console.log("BANNED_REFRESH", bannedRefresh.response.status, bannedRefresh.payload?.error?.code);
  await prisma.user.update({ where: { id: victim.id }, data: { status: "ACTIVE", bannedAt: null, banReason: null } });
  await prisma.$disconnect();

  let throttled = false;
  for (let i = 0; i < 60; i += 1) {
    const attempt = await raw("/auth/login", { method: "POST", body: { email: "nobody@test.dev", password: "wrong1234" } });
    if (attempt.response.status === 429) {
      throttled = true;
      console.log("THROTTLE OK after", i + 1, "attempts");
      break;
    }
  }
  if (!throttled) throw new Error("expected 429 from auth throttle");

  await request("/reports", { method: "POST", body: { userId: victim.id, reason: "Spam" }, cookies: reg.cookies }).then(
    () => { throw new Error("self-report should fail"); },
    (error) => console.log("SELF_REPORT_BLOCKED", error.message.slice(0, 120)),
  );
}

main().catch((error) => {
  console.error("PHASE11_SMOKE_FAIL", error.message);
  process.exit(1);
});
