const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRaw`SELECT 1 + 1 AS two`;
    console.log("PG_OK", JSON.stringify(rows));
    const meta = await prisma.schemaMeta.findUnique({ where: { id: "talkfirst" } });
    console.log("SCHEMA_PHASE", meta?.phase ?? "missing");
    const counts = {
      users: await prisma.user.count(),
      interests: await prisma.interest.count(),
      purposes: await prisma.purpose.count(),
      languages: await prisma.language.count(),
      countries: await prisma.country.count(),
    };
    console.log("COUNTS", JSON.stringify(counts));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("PG_FAIL", error.message);
  process.exit(1);
});
