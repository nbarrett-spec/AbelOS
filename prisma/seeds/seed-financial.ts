import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const prisma = new PrismaClient();

interface FinancialFinding {
  id: string;
  category: string;
  source: string;
  title: string;
  content: string;
  tags: string[];
  confidence: number;
  data: Record<string, unknown>;
  related_ids: string[];
  created_at: string;
  accessed_count: number;
}

async function parseJsonlFile(filePath: string): Promise<FinancialFinding[]> {
  const findings: FinancialFinding[] = [];
  const fileStream = fs.createReadStream(filePath);

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (line.trim()) {
      try {
        const entry = JSON.parse(line);
        findings.push(entry);
      } catch (error) {
        console.error('Failed to parse JSON line:', line);
      }
    }
  }

  return findings;
}

async function seedFinancialData() {
  try {
    // Read financial findings
    const financialPath = path.resolve(
      __dirname,
      '../../../brain_export/all_findings_financial.jsonl'
    );

    if (!fs.existsSync(financialPath)) {
      console.error(`all_findings_financial.jsonl not found at ${financialPath}`);
      process.exit(1);
    }

    const findings = await parseJsonlFile(financialPath);

    // Parse AR total from findings (if available)
    let arTotal = 500000; // Default
    const arFinding = findings.find((f) => f.tags?.includes('ar'));
    if (
      arFinding &&
      arFinding.data?.record_count &&
      typeof arFinding.data.record_count === 'number'
    ) {
      // Estimate based on record count from AR report
      // 53 records suggests ~$500K-600K in AR
      arTotal = arFinding.data.record_count * 10000;
    }

    // Snapshot date: 2026-04-22
    const snapshotDate = new Date('2026-04-22T00:00:00Z');

    // Create baseline FinancialSnapshot
    const snapshot = await prisma.financialSnapshot.upsert({
      where: { snapshotDate },
      create: {
        snapshotDate,
        arTotal,
        apTotal: 0,
        dso: 35,
        revenueMonth: 0,
        openPOTotal: 0,
        overdueARPct: 0.15,
      },
      update: {
        arTotal,
        apTotal: 0,
        dso: 35,
        revenueMonth: 0,
        openPOTotal: 0,
        overdueARPct: 0.15,
      },
    });

    console.log(
      `✓ FinancialSnapshot (${snapshot.snapshotDate.toISOString()}): AR=$${snapshot.arTotal}, DSO=${snapshot.dso}`
    );

    // Define collection rules
    const collectionRules = [
      {
        name: 'Friendly Reminder',
        daysOverdue: 15,
        actionType: 'REMINDER',
        channel: 'EMAIL',
        templateBody:
          'Hi {{builderName}}, this is a friendly reminder that invoice {{invoiceNumber}} for {{amount}} was due on {{dueDate}}. Please let us know if you have any questions.',
      },
      {
        name: 'Past Due Notice',
        daysOverdue: 30,
        actionType: 'PAST_DUE',
        channel: 'EMAIL',
        templateBody:
          '{{builderName}}, invoice {{invoiceNumber}} for {{amount}} is now 30 days past due. Please arrange payment at your earliest convenience.',
      },
      {
        name: 'Final Notice',
        daysOverdue: 45,
        actionType: 'FINAL_NOTICE',
        channel: 'PHONE',
        templateBody:
          'This is a final notice regarding invoice {{invoiceNumber}}. Payment of {{amount}} is required within 5 business days to avoid account restrictions.',
      },
      {
        name: 'Account Hold',
        daysOverdue: 60,
        actionType: 'ACCOUNT_HOLD',
        channel: 'PHONE',
        templateBody:
          'Your account has been placed on hold due to invoice {{invoiceNumber}} being 60+ days overdue. Please contact Abel Lumber immediately to resolve.',
      },
    ];

    let rulesSeeded = 0;

    for (const rule of collectionRules) {
      await prisma.collectionRule.upsert({
        where: { name: rule.name },
        create: {
          name: rule.name,
          daysOverdue: rule.daysOverdue,
          actionType: rule.actionType,
          channel: rule.channel,
          templateBody: rule.templateBody,
          isActive: true,
        },
        update: {
          daysOverdue: rule.daysOverdue,
          actionType: rule.actionType,
          channel: rule.channel,
          templateBody: rule.templateBody,
          isActive: true,
        },
      });

      console.log(`✓ CollectionRule: ${rule.name} (${rule.daysOverdue}d)`);
      rulesSeeded++;
    }

    console.log(`\nSeeded 1 FinancialSnapshot and ${rulesSeeded} CollectionRules`);
  } catch (error) {
    console.error('Seeding error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

seedFinancialData();
