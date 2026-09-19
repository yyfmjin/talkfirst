async function main() {
  const base = "http://localhost:4000/api/v1";
  const loginRes = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@talkfirst.dev", password: "123456" }),
  });
  const loginPayload = await loginRes.json().catch(() => null);
  console.log("LOGIN", loginRes.status, JSON.stringify(loginPayload).slice(0, 200));
  if (!loginRes.ok) throw new Error("login failed");
  const cookies = loginRes.headers.getSetCookie().map((c) => c.split(";")[0]);

  const meRes = await fetch(`${base}/admin/me`, { headers: { Cookie: cookies.join("; ") } });
  const mePayload = await meRes.json().catch(() => null);
  console.log("ADMIN_ME", meRes.status, JSON.stringify(mePayload).slice(0, 200));
  if (!meRes.ok || !mePayload?.data?.isAdmin) throw new Error("not admin");

  const dashRes = await fetch(`${base}/admin/dashboard`, { headers: { Cookie: cookies.join("; ") } });
  const dashPayload = await dashRes.json().catch(() => null);
  console.log("DASHBOARD", dashRes.status, JSON.stringify(dashPayload?.data));
}

main().catch((error) => {
  console.error("VERIFY_ADMIN_FAIL", error.message);
  process.exit(1);
});
