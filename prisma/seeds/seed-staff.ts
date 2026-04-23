import { PrismaClient, StaffRole, Department, CrewType } from "@prisma/client";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();

interface TeamMember {
  Employee: string;
  Title: string;
  "Email ": string; // Note: key has trailing space
  "Phone Number": string;
}

interface BoltEmployee {
  name: string;
  first_name: string;
  last_name: string;
  role: string;
  status: string;
  bolt_id: string;
}

interface CrewData {
  crew_name: string;
  members: string[];
  crew_type?: string;
}

function splitName(
  fullName: string
): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0];
  const lastName = parts.slice(1).join(" ");
  return { firstName, lastName: lastName || firstName };
}

// Hard-coded leadership overrides
const leadershipOverrides: Record<
  string,
  {
    role: StaffRole;
    department: Department;
    salary?: number;
    title?: string;
  }
> = {
  "nate@abellumber.com": {
    role: StaffRole.ADMIN,
    department: Department.EXECUTIVE,
    salary: undefined,
    title: "Owner / GM",
  },
  "josh@abellumber.com": {
    role: StaffRole.SALES_REP,
    department: Department.SALES,
    salary: 165000,
    title: "Sales",
  },
  "c.vinson@abellumber.com": {
    role: StaffRole.ADMIN,
    department: Department.OPERATIONS,
    salary: 125000,
    title: "COO",
  },
  "dawn@abellumber.com": {
    role: StaffRole.ACCOUNTING,
    department: Department.ACCOUNTING,
    salary: 90000,
    title: "Accounting Manager",
  },
  "dalton@abellumber.com": {
    role: StaffRole.SALES_REP,
    department: Department.SALES,
    salary: 100000,
    title: "Business Development Manager",
  },
  "sean@abellumber.com": {
    role: StaffRole.MANAGER,
    department: Department.OPERATIONS,
    salary: 70000,
    title: "Customer Experience Manager",
  },
  "chad@abellumber.com": {
    role: StaffRole.PROJECT_MANAGER,
    department: Department.OPERATIONS,
  },
  "brittney@abellumber.com": {
    role: StaffRole.PROJECT_MANAGER,
    department: Department.OPERATIONS,
  },
  "thomas@abellumber.com": {
    role: StaffRole.PROJECT_MANAGER,
    department: Department.OPERATIONS,
  },
  "ben@abellumber.com": {
    role: StaffRole.PROJECT_MANAGER,
    department: Department.OPERATIONS,
  },
  "lisa@abellumber.com": {
    role: StaffRole.ESTIMATOR,
    department: Department.ESTIMATING,
  },
  "jordyn@abellumber.com": {
    role: StaffRole.MANAGER,
    department: Department.LOGISTICS,
    title: "Delivery Logistical Supervisor",
  },
  // Drivers
  "austin@abellumber.com": {
    role: StaffRole.DRIVER,
    department: Department.LOGISTICS,
  },
  "aaron@abellumber.com": {
    role: StaffRole.DRIVER,
    department: Department.LOGISTICS,
  },
  "jack@abellumber.com": {
    role: StaffRole.DRIVER,
    department: Department.LOGISTICS,
  },
  "wyatt@abellumber.com": {
    role: StaffRole.DRIVER,
    department: Department.LOGISTICS,
  },
  "noah@abellumber.com": {
    role: StaffRole.DRIVER,
    department: Department.LOGISTICS,
  },
  // Production crew
  "tiffany@abellumber.com": {
    role: StaffRole.WAREHOUSE_TECH,
    department: Department.PRODUCTION,
  },
  "gunner@abellumber.com": {
    role: StaffRole.WAREHOUSE_TECH,
    department: Department.PRODUCTION,
  },
  "julio@abellumber.com": {
    role: StaffRole.WAREHOUSE_TECH,
    department: Department.PRODUCTION,
  },
  "marcus@abellumber.com": {
    role: StaffRole.WAREHOUSE_TECH,
    department: Department.PRODUCTION,
  },
  "cody@abellumber.com": {
    role: StaffRole.WAREHOUSE_TECH,
    department: Department.PRODUCTION,
  },
};

async function seedStaff() {
  console.log("Starting Staff, Crew, and CrewMember seeding...");

  // Read system_learnings_team.jsonl
  const teamFilePath = path.resolve(
    "../brain_export/system_learnings_team.jsonl"
  );
  const teamFileContent = fs.readFileSync(teamFilePath, "utf-8");
  const teamLines = teamFileContent
    .split("\n")
    .filter((line) => line.trim().length > 0);

  // Map of email -> staff record
  const staffMap = new Map<string, { id: string; firstName: string; lastName: string }>();

  // First pass: Create all staff
  let staffCount = 0;
  for (const line of teamLines) {
    try {
      const entry = JSON.parse(line);
      const data = entry.data as TeamMember;

      if (!data.Employee || !data["Email "]) {
        continue;
      }

      const email = data["Email "].trim();
      const { firstName, lastName } = splitName(data.Employee);
      const phone = data["Phone Number"] ? data["Phone Number"].trim() : null;

      // Check for leadership override
      const override = leadershipOverrides[email];
      const role = override?.role || StaffRole.PROJECT_MANAGER;
      const department = override?.department || Department.OPERATIONS;
      const title = override?.title || data.Title;
      const salary = override?.salary ?? undefined;

      const staff = await prisma.staff.upsert({
        where: { email },
        update: {
          firstName,
          lastName,
          phone: phone || undefined,
          title,
          role,
          department,
          salary,
        },
        create: {
          firstName,
          lastName,
          email,
          phone: phone || undefined,
          title,
          role,
          department,
          salary,
          passwordHash: "placeholder-hash", // Placeholder, they'll use invite flow
          active: true,
        },
      });

      staffMap.set(email, {
        id: staff.id,
        firstName: staff.firstName,
        lastName: staff.lastName,
      });
      staffCount++;
    } catch (error) {
      // Skip malformed lines
      continue;
    }
  }

  console.log(`Seeded ${staffCount} staff members`);

  // Second pass: Set up manager hierarchy
  let hierarchyCount = 0;

  // Nate is the root (no manager)
  const nateStaff = staffMap.get("n.barrett@abellumber.com");

  // Clint reports to Nate
  const clintStaff = staffMap.get("c.vinson@abellumber.com");
  if (clintStaff && nateStaff) {
    await prisma.staff.update({
      where: { id: clintStaff.id },
      data: { managerId: nateStaff.id },
    });
    hierarchyCount++;
  }

  // Jordyn (Delivery Logistical Supervisor) reports to Clint
  const jordynStaff = staffMap.get("jordyn@abellumber.com");
  if (jordynStaff && clintStaff) {
    await prisma.staff.update({
      where: { id: jordynStaff.id },
      data: { managerId: clintStaff.id },
    });
    hierarchyCount++;
  }

  // PMs report to Nate (except drivers report to Jordyn, production reports to Clint)
  const pmEmails = [
    "chad@abellumber.com",
    "brittney@abellumber.com",
    "thomas@abellumber.com",
    "ben@abellumber.com",
    "lisa@abellumber.com",
    "sean@abellumber.com",
    "dalton@abellumber.com",
    "dawn@abellumber.com",
    "josh@abellumber.com",
  ];

  for (const pmEmail of pmEmails) {
    const pmStaff = staffMap.get(pmEmail);
    if (pmStaff && nateStaff) {
      await prisma.staff.update({
        where: { id: pmStaff.id },
        data: { managerId: nateStaff.id },
      });
      hierarchyCount++;
    }
  }

  // Drivers report to Jordyn
  const driverEmails = [
    "austin@abellumber.com",
    "aaron@abellumber.com",
    "jack@abellumber.com",
    "wyatt@abellumber.com",
    "noah@abellumber.com",
  ];

  for (const driverEmail of driverEmails) {
    const driverStaff = staffMap.get(driverEmail);
    if (driverStaff && jordynStaff) {
      await prisma.staff.update({
        where: { id: driverStaff.id },
        data: { managerId: jordynStaff.id },
      });
      hierarchyCount++;
    }
  }

  // Production crew reports to Clint
  const productionEmails = [
    "tiffany@abellumber.com",
    "gunner@abellumber.com",
    "julio@abellumber.com",
    "marcus@abellumber.com",
    "cody@abellumber.com",
  ];

  for (const prodEmail of productionEmails) {
    const prodStaff = staffMap.get(prodEmail);
    if (prodStaff && clintStaff) {
      await prisma.staff.update({
        where: { id: prodStaff.id },
        data: { managerId: clintStaff.id },
      });
      hierarchyCount++;
    }
  }

  console.log(`Set up ${hierarchyCount} manager relationships`);

  // Seed Crews and CrewMembers from system_learnings_bolt.jsonl
  const boltFilePath = path.resolve(
    "../brain_export/system_learnings_bolt.jsonl"
  );
  const boltFileContent = fs.readFileSync(boltFilePath, "utf-8");
  const boltLines = boltFileContent
    .split("\n")
    .filter((line) => line.trim().length > 0);

  // Parse crew data from bolt entries
  const crewsMap = new Map<string, CrewData>();

  for (const line of boltLines) {
    try {
      const entry = JSON.parse(line);

      // Look for entries with crew-related data
      if (entry.tags && Array.isArray(entry.tags)) {
        if (
          entry.tags.includes("crew") ||
          entry.content?.toLowerCase().includes("crew")
        ) {
          // Could be crew data, but we need to identify crews from employee data
          // For now, we'll build crews manually based on the known structure
          continue;
        }
      }
    } catch (error) {
      continue;
    }
  }

  // Create crews based on known crew structure
  // From the CLAUDE.md: drivers and production crew are organized in crews

  let crewCount = 0;
  let crewMemberCount = 0;

  // Delivery crews - group drivers
  const deliveryCrewA = await prisma.crew.create({
    data: {
      name: "Delivery Team A",
      crewType: CrewType.DELIVERY,
      active: true,
    },
  });
  crewCount++;

  // Add delivery drivers to Delivery Team A
  const deliveryDrivers = [
    "austin@abellumber.com",
    "aaron@abellumber.com",
    "jack@abellumber.com",
    "wyatt@abellumber.com",
  ];

  for (const driverEmail of deliveryDrivers) {
    const driverStaff = staffMap.get(driverEmail);
    if (driverStaff) {
      await prisma.crewMember.create({
        data: {
          crewId: deliveryCrewA.id,
          staffId: driverStaff.id,
          role: "Driver",
        },
      });
      crewMemberCount++;
    }
  }

  // Production crew
  const productionCrew = await prisma.crew.create({
    data: {
      name: "Production Crew",
      crewType: CrewType.INSTALLATION,
      active: true,
    },
  });
  crewCount++;

  const prodEmails = [
    "tiffany@abellumber.com",
    "gunner@abellumber.com",
    "julio@abellumber.com",
    "marcus@abellumber.com",
    "cody@abellumber.com",
  ];

  for (const prodEmail of prodEmails) {
    const prodStaff = staffMap.get(prodEmail);
    if (prodStaff) {
      await prisma.crewMember.create({
        data: {
          crewId: productionCrew.id,
          staffId: prodStaff.id,
          role: "Member",
        },
      });
      crewMemberCount++;
    }
  }

  // Special crew: Noah Ridge (another driver who may form his own crew)
  const noahStaff = staffMap.get("noah@abellumber.com");
  if (noahStaff) {
    const deliveryCrewB = await prisma.crew.create({
      data: {
        name: "Delivery Team B",
        crewType: CrewType.DELIVERY,
        active: true,
      },
    });
    crewCount++;

    await prisma.crewMember.create({
      data: {
        crewId: deliveryCrewB.id,
        staffId: noahStaff.id,
        role: "Driver",
      },
    });
    crewMemberCount++;
  }

  console.log(`Seeded ${crewCount} crews with ${crewMemberCount} members`);

  console.log("\nSeeding complete!");
  console.log(`- ${staffCount} staff members`);
  console.log(`- ${crewCount} crews`);
  console.log(`- ${crewMemberCount} crew members`);
}

seedStaff()
  .catch((error) => {
    console.error("Seed error:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
