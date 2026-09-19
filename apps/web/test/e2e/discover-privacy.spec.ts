import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginAndLand } from "../fixtures/browser";
import { ALICE_BIO, ALICE_NICKNAME, EMAILS, seed } from "../fixtures/profile";

/**
 * Discovery must obey the same visibility rules as the profile card.
 *
 * Discovery reads the `User` row directly, so a field set to "仅自己可见" or
 * "仅好友可见" used to reach every stranger's recommendation card. The page
 * itself only renders what `GET /discover/recommendations` sends, so the
 * assertion is made on the real response the browser received rather than on
 * the DOM: a hidden value that the card merely did not happen to display would
 * still be a leak.
 */

const prisma = new PrismaClient();

test.beforeEach(async () => {
  await seed(prisma);
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("陌生人的 Discover 卡片不含 CONNECTIONS / PRIVATE 字段", async ({ page }) => {
  const alice = await prisma.user.findUnique({
    where: { email: EMAILS.alice },
    select: { id: true },
  });
  if (!alice) throw new Error(`fixture account missing: ${EMAILS.alice}`);
  // The seed already gives Alice a CONNECTIONS bio and a PRIVATE city; `city` is
  // not part of the card, so `interests` is made PRIVATE here to put a governed
  // field that Discovery *does* return on the PRIVATE tier as well.
  await prisma.profileFieldVisibility.create({
    data: { userId: alice.id, fieldKey: "interests", visibility: "PRIVATE" },
  });

  const recommendations = page.waitForResponse(
    (response) => response.url().includes("/discover/recommendations") && response.status() === 200,
  );
  // Carol is a stranger to Alice: no connection and no block in either direction.
  await loginAndLand(page, EMAILS.carol);

  const payload = (await (await recommendations).json()) as {
    data: { items: Array<Record<string, unknown>> };
  };
  const items = payload.data.items;
  const card = items.find((item) => item.id === alice.id);

  expect(
    card,
    `Alice must be a candidate for Carol (ids: ${items.map((item) => item.id).join(",")})`,
  ).toBeTruthy();

  // CONNECTIONS tier withheld, and not merely moved to another field.
  expect(card?.bio).toBeNull();
  expect(JSON.stringify(payload)).not.toContain(ALICE_BIO);

  // PRIVATE tier withheld, as an empty list rather than a missing key.
  expect(card?.interests).toEqual([]);

  // PUBLIC fields still arrive, so the two checks above are redaction rather
  // than an empty response.
  expect(card?.nickname).toBe(ALICE_NICKNAME);
  expect(card?.age).not.toBeNull();
  expect((card?.languages as unknown[]).length).toBe(2);

  // Discovery has never carried these fields, and must not start to.
  for (const item of items) {
    expect(Object.keys(item)).not.toContain("city");
    expect(Object.keys(item)).not.toContain("region");
    expect(Object.keys(item)).not.toContain("gender");
  }
});
