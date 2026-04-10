import { prisma } from '@/lib/prisma';

async function seedCrewPortal() {
  console.log('Seeding crew portal test data...');

  try {
    // Create staff members
    const staffMembers = await Promise.all([
      prisma.staff.upsert({
        where: { email: 'driver1@abel.com' },
        update: {},
        create: {
          firstName: 'John',
          lastName: 'Driver',
          email: 'driver1@abel.com',
          passwordHash: 'hashed_password_here',
          role: 'DRIVER',
          department: 'DELIVERY',
          phone: '(555) 123-4567',
        },
      }),
      prisma.staff.upsert({
        where: { email: 'driver2@abel.com' },
        update: {},
        create: {
          firstName: 'Sarah',
          lastName: 'Delivery',
          email: 'driver2@abel.com',
          passwordHash: 'hashed_password_here',
          role: 'DRIVER',
          department: 'DELIVERY',
          phone: '(555) 234-5678',
        },
      }),
      prisma.staff.upsert({
        where: { email: 'installer1@abel.com' },
        update: {},
        create: {
          firstName: 'Mike',
          lastName: 'Install',
          email: 'installer1@abel.com',
          passwordHash: 'hashed_password_here',
          role: 'INSTALLER',
          department: 'INSTALLATION',
          phone: '(555) 345-6789',
        },
      }),
      prisma.staff.upsert({
        where: { email: 'installer2@abel.com' },
        update: {},
        create: {
          firstName: 'James',
          lastName: 'Carpenter',
          email: 'installer2@abel.com',
          passwordHash: 'hashed_password_here',
          role: 'INSTALLER',
          department: 'INSTALLATION',
          phone: '(555) 456-7890',
        },
      }),
    ]);

    console.log('Created staff members:', staffMembers.length);

    // Create delivery crew
    const deliveryCrew = await prisma.crew.upsert({
      where: { id: 'crew_delivery_1' },
      update: {},
      create: {
        id: 'crew_delivery_1',
        name: 'Delivery Team A',
        crewType: 'DELIVERY',
        vehiclePlate: 'ABL-DEL-01',
        active: true,
      },
    });

    // Create install crew
    const installCrew = await prisma.crew.upsert({
      where: { id: 'crew_install_1' },
      update: {},
      create: {
        id: 'crew_install_1',
        name: 'Install Crew - North',
        crewType: 'INSTALLATION',
        active: true,
      },
    });

    console.log('Created crews:', [deliveryCrew.name, installCrew.name]);

    // Add crew members
    await Promise.all([
      // Delivery crew members
      prisma.crewMember.upsert({
        where: { crewId_staffId: { crewId: 'crew_delivery_1', staffId: staffMembers[0].id } },
        update: {},
        create: {
          crewId: 'crew_delivery_1',
          staffId: staffMembers[0].id,
          role: 'Driver',
        },
      }),
      prisma.crewMember.upsert({
        where: { crewId_staffId: { crewId: 'crew_delivery_1', staffId: staffMembers[1].id } },
        update: {},
        create: {
          crewId: 'crew_delivery_1',
          staffId: staffMembers[1].id,
          role: 'Member',
        },
      }),
      // Install crew members
      prisma.crewMember.upsert({
        where: { crewId_staffId: { crewId: 'crew_install_1', staffId: staffMembers[2].id } },
        update: {},
        create: {
          crewId: 'crew_install_1',
          staffId: staffMembers[2].id,
          role: 'Lead',
        },
      }),
      prisma.crewMember.upsert({
        where: { crewId_staffId: { crewId: 'crew_install_1', staffId: staffMembers[3].id } },
        update: {},
        create: {
          crewId: 'crew_install_1',
          staffId: staffMembers[3].id,
          role: 'Member',
        },
      }),
    ]);

    console.log('Assigned crew members');

    // Create test job
    const testJob = await prisma.job.upsert({
      where: { jobNumber: 'JOB-2026-0142' },
      update: {},
      create: {
        jobNumber: 'JOB-2026-0142',
        builderName: 'Smith Construction Co',
        builderContact: '(555) 999-0001',
        community: 'Canyon Ridge Estates',
        lotBlock: 'Lot 14 Block 3',
        jobAddress: '1234 Main Street, Springfield, IL 62701',
        scopeType: 'DOORS_AND_TRIM',
        status: 'STAGED',
        loadConfirmed: true,
        scheduledDate: new Date(),
      },
    });

    console.log('Created job:', testJob.jobNumber);

    // Create material picks for the job
    const materialPicks = await Promise.all([
      prisma.materialPick.upsert({
        where: { id: 'pick_1' },
        update: {},
        create: {
          id: 'pick_1',
          jobId: testJob.id,
          sku: 'DOR-2068-2P-HC-LH',
          description: '2068 2-Panel Hollow Core Left Hand',
          quantity: 3,
          status: 'PENDING',
        },
      }),
      prisma.materialPick.upsert({
        where: { id: 'pick_2' },
        update: {},
        create: {
          id: 'pick_2',
          jobId: testJob.id,
          sku: 'DOR-3068-6P-SC-RH',
          description: '3068 6-Panel Shaker Solid Core Right Hand',
          quantity: 2,
          status: 'PENDING',
        },
      }),
      prisma.materialPick.upsert({
        where: { id: 'pick_3' },
        update: {},
        create: {
          id: 'pick_3',
          jobId: testJob.id,
          sku: 'TRIM-1X4-PINE-8FT',
          description: '1x4 Pine Trim 8ft',
          quantity: 12,
          status: 'PENDING',
        },
      }),
    ]);

    console.log('Created material picks:', materialPicks.length);

    // Create delivery
    const delivery = await prisma.delivery.upsert({
      where: { deliveryNumber: 'DEL-2026-0089' },
      update: {},
      create: {
        deliveryNumber: 'DEL-2026-0089',
        jobId: testJob.id,
        crewId: 'crew_delivery_1',
        address: '1234 Main Street, Springfield, IL 62701',
        status: 'SCHEDULED',
        routeOrder: 1,
      },
    });

    console.log('Created delivery:', delivery.deliveryNumber);

    // Create installation
    const installation = await prisma.installation.upsert({
      where: { installNumber: 'INS-2026-0063' },
      update: {},
      create: {
        installNumber: 'INS-2026-0063',
        jobId: testJob.id,
        crewId: 'crew_install_1',
        status: 'SCHEDULED',
        scopeNotes: 'Install all doors and trim. Use hinges from hardware box. Verify measurements before cutting.',
      },
    });

    console.log('Created installation:', installation.installNumber);

    // Create schedule entries for today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await Promise.all([
      prisma.scheduleEntry.upsert({
        where: { id: 'sched_delivery_1' },
        update: {},
        create: {
          id: 'sched_delivery_1',
          jobId: testJob.id,
          entryType: 'DELIVERY',
          title: 'Smith Construction - Door/Trim Delivery',
          scheduledDate: today,
          scheduledTime: '9:00 AM',
          crewId: 'crew_delivery_1',
          status: 'FIRM',
        },
      }),
      prisma.scheduleEntry.upsert({
        where: { id: 'sched_install_1' },
        update: {},
        create: {
          id: 'sched_install_1',
          jobId: testJob.id,
          entryType: 'INSTALLATION',
          title: 'Smith Construction - Installation',
          scheduledDate: new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000), // 2 days later
          scheduledTime: '8:00 AM',
          crewId: 'crew_install_1',
          status: 'FIRM',
        },
      }),
    ]);

    console.log('Created schedule entries');

    console.log('\n✅ Crew Portal seed data created successfully!');
    console.log('\nTest Login Credentials:');
    console.log('- Driver: driver1@abel.com (Crew: Delivery Team A)');
    console.log('- Installer: installer1@abel.com (Crew: Install Crew - North)');
    console.log('\nYou can now navigate to /crew to see the portal');
  } catch (error) {
    console.error('Error seeding crew portal:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

seedCrewPortal();
