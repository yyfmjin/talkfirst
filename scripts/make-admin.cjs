const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

async function main() {
  const email = (process.argv[2] || "admin@talkfirst.dev").trim().toLowerCase();
  const password = process.argv[3] || "123456";
  const prisma = new PrismaClient();

  const adminsBefore = await prisma.user.findMany({
    where: { isAdmin: true },
    select: { email: true, nickname: true, status: true },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  console.log("ADMINS_BEFORE " + JSON.stringify(adminsBefore));

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      nickname: "Admin",
      birthDate: new Date("1990-01-01"),
      countryCode: "CN",
      emailVerified: true,
      status: "ACTIVE",
      isAdmin: true,
      bannedAt: null,
      banReason: null,
      lastActiveAt: new Date(),
    },
    create: {
      email,
      passwordHash,
      nickname: "Admin",
      birthDate: new Date("1990-01-01"),
      countryCode: "CN",
      emailVerified: true,
      status: "ACTIVE",
      isAdmin: true,
      lastActiveAt: new Date(),
    },
  });
  console.log("ADMIN_OK " + JSON.stringify({ email: user.email, isAdmin: user.isAdmin, status: user.status }));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("MAKE_ADMIN_FAIL", error.message);
  process.exit(1);
});
