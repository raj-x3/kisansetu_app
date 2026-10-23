// Run with: npm run seed
//
// This creates demo Procurement Centres. We're seeding these directly
// (instead of through an admin dashboard, since that's not built yet)
// so the Slot Booking feature has real centres to book against.
// Safe to run more than once — it skips centres that already exist.

import { PrismaClient, Role } from "@prisma/client";
import { hashPassword } from "../src/utils/password";

const prisma = new PrismaClient();

const CENTRES = [
  {
    name: "Karnal Grain Procurement Centre",
    location: "Karnal Mandi Road",
    district: "Karnal",
    state: "Haryana",
    dailyCapacity: 240,
    operatingStart: "09:00",
    operatingEnd: "17:00",
    numMachines: 4,
    numOperators: 6,
    avgProcessingMin: 10,
  },
  {
    name: "Panipat Procurement Centre",
    location: "Panipat Sector 12",
    district: "Panipat",
    state: "Haryana",
    dailyCapacity: 160,
    operatingStart: "08:00",
    operatingEnd: "16:00",
    numMachines: 3,
    numOperators: 4,
    avgProcessingMin: 12,
  },
  {
    name: "Sonipat Procurement Centre",
    location: "Sonipat Grain Market",
    district: "Sonipat",
    state: "Haryana",
    dailyCapacity: 200,
    operatingStart: "09:00",
    operatingEnd: "18:00",
    numMachines: 3,
    numOperators: 5,
    avgProcessingMin: 9,
  },
];

async function main() {
  for (const centre of CENTRES) {
    const existing = await prisma.procurementCentre.findFirst({ where: { name: centre.name } });
    if (existing) {
      console.log(`Skipping "${centre.name}" — already exists.`);
      continue;
    }
    await prisma.procurementCentre.create({ data: centre });
    console.log(`Created "${centre.name}".`);
  }

  // Seed one demo operator account, tied to the first centre, so the
  // Live Queue feature has someone who can actually call the next
  // farmer. In a real system, admins would create operator accounts —
  // that admin panel doesn't exist yet, so this fills the gap for now.
  const firstCentre = await prisma.procurementCentre.findFirst({
    orderBy: { name: "asc" },
  });
  if (!firstCentre) {
    console.log("No centre found to attach the demo operator to — skipping.");
  } else {
    const existingOperatorUser = await prisma.user.findUnique({ where: { mobile: "9000000001" } });
    if (existingOperatorUser) {
      console.log("Demo operator account already exists — skipping.");
    } else {
      const passwordHash = await hashPassword("operator123");
      await prisma.user.create({
        data: {
          mobile: "9000000001",
          passwordHash,
          role: "OPERATOR",
          operator: {
            create: {
              fullName: "Demo Operator",
              centreId: firstCentre.id,
            },
          },
        },
      });
      console.log(
        `Created demo operator account — mobile: 9000000001, password: operator123, centre: ${firstCentre.name}`
      );
    }
  }

  // Demo admin account. Development/demo credentials only — change or
  // remove these before any real deployment.
  const existingAdmin = await prisma.user.findUnique({ where: { mobile: "9000000000" } });
  if (existingAdmin) {
    console.log("Demo admin account already exists — skipping.");
  } else {
    await prisma.user.create({
      data: {
        mobile: "9000000000",
        passwordHash: await hashPassword("admin123"),
        role: "ADMIN",
      },
    });
    console.log("Created demo admin account — mobile: 9000000000, password: admin123");
  }

  // Demo officer accounts — one per role, all tied to the first centre.
  // Development/demo credentials only.
  if (firstCentre) {
    const OFFICER_ACCOUNTS: Array<{ mobile: string; role: Role; name: string }> = [
      { mobile: "9000000002", role: "MANAGER", name: "Demo Manager" },
      { mobile: "9000000003", role: "GATE_OFFICER", name: "Demo Gate Officer" },
      { mobile: "9000000004", role: "DOCUMENT_OFFICER", name: "Demo Document Officer" },
      { mobile: "9000000005", role: "QUALITY_OFFICER", name: "Demo Quality Officer" },
      { mobile: "9000000006", role: "WEIGHT_OFFICER", name: "Demo Weight Officer" },
      { mobile: "9000000007", role: "PROCUREMENT_OFFICER", name: "Demo Procurement Officer" },
      { mobile: "9000000008", role: "PAYMENT_OFFICER", name: "Demo Payment Officer" },
    ];
    for (const acc of OFFICER_ACCOUNTS) {
      const exists = await prisma.user.findUnique({ where: { mobile: acc.mobile } });
      if (exists) {
        console.log(`${acc.role} account already exists — skipping.`);
        continue;
      }
      await prisma.user.create({
        data: {
          mobile: acc.mobile,
          passwordHash: await hashPassword("officer123"),
          role: acc.role,
          operator: { create: { fullName: acc.name, centreId: firstCentre.id } },
        },
      });
      console.log(`Created ${acc.role} — mobile: ${acc.mobile}, password: officer123`);
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
