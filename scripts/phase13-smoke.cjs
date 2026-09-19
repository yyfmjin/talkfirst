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
    body: { email: `phase13-admin-${suffix}@test.dev`, password: "password123" },
  });
  const userReg = await request("/auth/register", {
    method: "POST",
    body: { email: `phase13-user-${suffix}@test.dev`, password: "password123" },
  });

  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  await prisma.user.update({
    where: { email: `phase13-admin-${suffix}@test.dev` },
    data: { isAdmin: true, nickname: "Phase13 Admin", birthDate: new Date("1990-01-01") },
  });
  await prisma.user.update({
    where: { email: `phase13-user-${suffix}@test.dev` },
    data: { nickname: "Phase13 User", birthDate: new Date("2000-01-01") },
  });

  const me = await request("/admin/me", { cookies: adminReg.cookies });
  console.log("ADMIN_ME OK", me.data.isAdmin, me.data.status);

  await request("/admin/users/nonexistent", { cookies: userReg.cookies }).then(
    () => { throw new Error("non-admin should be blocked"); },
    (error) => console.log("NON_ADMIN_BLOCKED", error.message.slice(0, 100)),
  );

  const paged = await request("/admin/users?q=phase13&page=1&pageSize=5", { cookies: adminReg.cookies });
  console.log("PAGED_USERS OK total=", paged.data.total, "items=", paged.data.items.length);

  const target = paged.data.items.find((item) => item.email.includes("phase13-user"));
  const banned = await request(`/admin/users/${target.id}/status`, {
    method: "POST",
    body: { action: "ban", reason: "phase13 console smoke" },
    cookies: adminReg.cookies,
  });
  console.log("BAN OK", banned.data.status);

  const noted = await request(`/admin/users/${target.id}/notes`, {
    method: "POST",
    body: { body: "phase13 standalone console note" },
    cookies: adminReg.cookies,
  });
  console.log("NOTE OK", noted.data.id);

  const dashboard = await request("/admin/dashboard", { cookies: adminReg.cookies });
  console.log("DASHBOARD OK admins=", dashboard.data.admins, "banned=", dashboard.data.banned);

  const audit = await request("/admin/audit?page=1&pageSize=5", { cookies: adminReg.cookies });
  console.log("AUDIT OK total=", audit.data.total, "latest=", audit.data.items[0]?.action);

  await prisma.$disconnect();
  if (!audit.data.items.some((item) => item.action === "user.ban")) {
    throw new Error("audit log missing user.ban");
  }
}

main().catch((error) => {
  console.error("PHASE13_SMOKE_FAIL", error.message);
  process.exit(1);
});
