-- P0-02 — the account name used to sign in, alongside the e-mail address.
--
-- Three steps, in this order, because the final column is NOT NULL + UNIQUE:
--   1. add it nullable
--   2. backfill every existing row with a generated value
--   3. tighten to NOT NULL and add the unique index
--
-- Step 2 is the reason this migration cannot just be `ADD COLUMN ... UNIQUE`:
-- the accounts that already exist were never asked for a name, and the product
-- decision is to give them a generated one rather than to leave them without.
--
-- The generator is REPRODUCED here rather than imported. A migration is frozen
-- the moment it is applied — it may not reference application code, because that
-- code keeps changing while this file must keep producing the same result on a
-- database restored from an old backup. It must therefore stay in step with
-- `apps/api/src/common/username.ts` by hand:
--
--   alphabet  : 23456789abcdefghjkmnpqrstuvwxyz  (31 symbols: no 0/1/l/i/o,
--               because a handle gets read aloud and typed by hand)
--   length    : 10  (~4.9e14 combinations)
--   reserved  : the RESERVED_SUBSTRINGS list from that module
--
-- The reserved check is not paranoia: a generated handle must not be able to
-- come out as something a member would be embarrassed by or that reads as an
-- operator account.
ALTER TABLE "User" ADD COLUMN "username" VARCHAR(30);

DO $$
DECLARE
  alphabet CONSTANT text := '23456789abcdefghjkmnpqrstuvwxyz';
  reserved CONSTANT text[] := ARRAY[
    'admin', 'administrator', 'moderator', 'sysadmin', 'superuser', 'superadmin',
    'official', 'support', 'staff', 'root', 'talkfirst', 'webmaster',
    'postmaster', 'hostmaster', 'noreply', 'no-reply', 'abuse', 'security'
  ];
  target    RECORD;
  candidate text;
  taken     boolean;
  blocked   boolean;
  token     text;
  i         integer;
BEGIN
  FOR target IN SELECT "id" FROM "User" ORDER BY "createdAt", "id" LOOP
    -- Retry until the candidate is free AND not reserved. The unique index does
    -- not exist yet, so uniqueness is checked by hand; the loop terminates with
    -- probability 1 and in practice after one attempt.
    LOOP
      candidate := '';
      FOR i IN 1..10 LOOP
        candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
      END LOOP;

      SELECT EXISTS (SELECT 1 FROM "User" WHERE "username" = candidate) INTO taken;

      blocked := false;
      FOREACH token IN ARRAY reserved LOOP
        IF position(token in candidate) > 0 THEN
          blocked := true;
        END IF;
      END LOOP;

      EXIT WHEN NOT taken AND NOT blocked;
    END LOOP;

    UPDATE "User" SET "username" = candidate WHERE "id" = target."id";
  END LOOP;
END $$;

ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;

-- Name matches what Prisma generates for `@unique` on the field, so a later
-- `prisma migrate dev` sees no drift.
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
