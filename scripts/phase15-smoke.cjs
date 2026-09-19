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
    body: { email: `phase15-alice-${suffix}@test.dev`, password: "password123" },
  });
  await request("/users/me", {
    method: "PATCH",
    body: { nickname: "Phase15 Alice", birthDate: "2000-01-01", countryCode: "CN" },
    cookies: alice.cookies,
  });
  const bob = await request("/auth/register", {
    method: "POST",
    body: { email: `phase15-bob-${suffix}@test.dev`, password: "password123" },
  });
  const bobProfile = await request("/users/me", {
    method: "PATCH",
    body: { nickname: "Phase15 Bob", birthDate: "1999-05-05", countryCode: "JP" },
    cookies: bob.cookies,
  });

  const platforms = await request("/moments/platforms", { cookies: alice.cookies });
  console.log("PLATFORMS OK", platforms.data.length);

  const bind = await request("/moments/bindings", {
    method: "POST",
    body: { platform: "INSTAGRAM", handle: "@alice.travel", displayName: "Alice" },
    cookies: bob.cookies,
  });
  console.log("BIND OK", bind.data.platform, bind.data.handle);

  const feed = await request("/moments/feed?tab=recommend&limit=20", { cookies: alice.cookies });
  console.log("FEED OK items=", feed.data.items.length, "platforms=", [...new Set(feed.data.items.map((i) => i.platform))].join(","));

  const profile = await request(`/moments/user/${bobProfile.data.id}`, { cookies: alice.cookies });
  console.log("PROFILE OK author=", profile.data.author.nickname, "items=", profile.data.items.length);

  const target = feed.data.items[0] ?? profile.data.items[0];
  if (!target) throw new Error("no moments seeded");

  const liked = await request(`/moments/${target.id}/like`, { method: "POST", cookies: alice.cookies });
  console.log("LIKE OK liked=", liked.data.liked);

  const commented = await request(`/moments/${target.id}/comments`, {
    method: "POST",
    body: { content: "Wow! This is so beautiful! Which place is this?" },
    cookies: alice.cookies,
  });
  console.log("COMMENT OK", commented.data.id);

  const comments = await request(`/moments/${target.id}/comments`, { cookies: alice.cookies });
  console.log("COMMENTS OK count=", comments.data.length);

  const setting = await request("/moments/settings", {
    method: "PATCH",
    body: { syncEnabled: true, visibleTo: "everyone", filterSensitive: true, showPhotos: true, showVideos: true, showReels: true },
    cookies: bob.cookies,
  });
  console.log("SETTING OK sync=", setting.data.syncEnabled, "visible=", setting.data.visibleTo);

  const following = await request("/moments/feed?tab=following&limit=20", { cookies: alice.cookies });
  console.log("FOLLOWING_EMPTY_OK items=", following.data.items.length);

  const published = await request("/moments", {
    method: "POST",
    body: { content: "Hello from TalkFirst moments", tags: ["travel", "tokyo"] },
    cookies: bob.cookies,
  });
  console.log("PUBLISH OK", published.data.id, published.data.platform);

  const mine = await request("/moments/feed?tab=mine&limit=20", { cookies: bob.cookies });
  console.log("MINE OK items=", mine.data.items.length);
  if (!mine.data.items.some((item) => item.id === published.data.id)) {
    throw new Error("published moment missing from mine feed");
  }

  const removed = await request(`/moments/${published.data.id}`, {
    method: "DELETE",
    cookies: bob.cookies,
  });
  console.log("DELETE OK", removed.data.deleted);
}

main().catch((error) => {
  console.error("PHASE15_SMOKE_FAIL", error.message);
  process.exit(1);
});
