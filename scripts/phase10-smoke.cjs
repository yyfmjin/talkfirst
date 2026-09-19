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
  const adminReg = await request("/auth/register", {
    method: "POST",
    body: { email: `phase10-admin-${suffix}@test.dev`, password: "password123" },
  });
  await request("/users/me", {
    method: "PATCH",
    body: { nickname: "Admin", birthDate: "1990-01-01", countryCode: "CN" },
    cookies: adminReg.cookies,
  });

  const badReg = await request("/auth/register", {
    method: "POST",
    body: { email: `phase10-user-${suffix}@test.dev`, password: "password123" },
  });
  const badProfile = await request("/users/me", {
    method: "PATCH",
    body: { nickname: "BadUser", birthDate: "2000-01-01", countryCode: "US" },
    cookies: badReg.cookies,
  });

  const forbidden = await request("/admin/dashboard", { cookies: badReg.cookies }).then(
    () => "UNEXPECTED_PASS",
    (error) => `FORBIDDEN_OK ${error.message.slice(0, 80)}`,
  );
  console.log(forbidden);

  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  const adminMe = await prisma.user.findUnique({ where: { email: `phase10-admin-${suffix}@test.dev` } });
  await prisma.user.update({ where: { id: adminMe.id }, data: { isAdmin: true } });
  await prisma.$disconnect();
  console.log("ADMIN_GRANTED");

  const dashboard = await request("/admin/dashboard", { cookies: adminReg.cookies });
  console.log("DASHBOARD OK", JSON.stringify(dashboard.data));

  const users = await request(`/admin/users?q=phase10-user-${suffix}`, { cookies: adminReg.cookies });
  console.log("SEARCH OK", users.data.length, users.data[0]?.email);

  const banned = await request(`/admin/users/${badProfile.data.id}/status`, {
    method: "POST",
    body: { action: "ban", reason: "phase10 smoke spam" },
    cookies: adminReg.cookies,
  });
  console.log("BAN OK", banned.data.status, banned.data.bannedAt ? "has-time" : "no-time");

  const unbanned = await request(`/admin/users/${badProfile.data.id}/status`, {
    method: "POST",
    body: { action: "activate" },
    cookies: adminReg.cookies,
  });
  console.log("UNBAN OK", unbanned.data.status);

  const note = await request(`/admin/users/${badProfile.data.id}/notes`, {
    method: "POST",
    body: { body: "phase10 operator note" },
    cookies: adminReg.cookies,
  });
  console.log("NOTE OK", note.data.id);

  const reports = await request("/admin/reports?status=OPEN", { cookies: adminReg.cookies });
  console.log("REPORTS OK", reports.data.length);
}

main().catch((error) => {
  console.error("PHASE10_SMOKE_FAIL", error.message);
  process.exit(1);
});
