import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const prisma = new PrismaClient();

interface Opportunity {
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

async function parseJsonlFile(filePath: string): Promise<Opportunity[]> {
  const opportunities: Opportunity[] = [];
  const fileStream = fs.createReadStream(filePath);

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (line.trim()) {
      try {
        const entry = JSON.parse(line);
        opportunities.push(entry);
      } catch (error) {
        console.error('Failed to parse JSON line:', line);
      }
    }
  }

  return opportunities;
}

function extractCompanyName(title: string): string {
  // Parse titles like "Bloomfield Homes — Active Prospect"
  // Extract the company name before the em-dash or arrow
  const parts = title.split(/[—\-–]/);
  if (parts.length > 0) {
    return parts[0].trim();
  }
  return title.trim();
}

function generateDealNumber(index: number): string {
  const padded = String(index).padStart(4, '0');
  return `DEAL-2026-${padded}`;
}

async function seedDeals() {
  try {
    // Read opportunities from JSONL file
    const opportunitiesPath = path.resolve(
      __dirname,
      '../../../brain_export/opportunities.jsonl'
    );

    if (!fs.existsSync(opportunitiesPath)) {
      console.error(`opportunities.jsonl not found at ${opportunitiesPath}`);
      process.exit(1);
    }

    const opportunities = await parseJsonlFile(opportunitiesPath);

    // Filter for builder-related opportunities (exclude delivery, sourcing, etc.)
    const builderOpportunities = opportunities.filter(
      (opp) =>
        !opp.tags.includes('delivery') &&
        !opp.tags.includes('sourcing') &&
        !opp.tags.includes('alibaba') &&
        opp.title !== 'Delivery Outsourcing Evaluation' &&
        opp.title !== 'Non-China Sourcing / Alibaba Research'
    );

    // Find Dalton Whatley (Business Development Manager)
    const dalton = await prisma.staff.findUnique({
      where: { email: 'dalton@abellumber.com' },
    });

    if (!dalton) {
      console.error('Dalton Whatley not found in Staff table');
      process.exit(1);
    }

    // Upsert deals
    let seededCount = 0;

    for (let i = 0; i < builderOpportunities.length; i++) {
      const opp = builderOpportunities[i];
      const companyName = extractCompanyName(opp.title);
      const dealNumber = generateDealNumber(i + 1);

      // Calculate expected close date (90 days from now)
      const expectedCloseDate = new Date();
      expectedCloseDate.setDate(expectedCloseDate.getDate() + 90);

      const deal = await prisma.deal.upsert({
        where: { dealNumber },
        create: {
          dealNumber,
          companyName,
          contactName: '', // Will be filled in separately
          stage: 'PROSPECT',
          source: 'OUTBOUND',
          probability: 20,
          ownerId: dalton.id,
          expectedCloseDate,
          description: opp.content,
          notes: `Grade: ${opp.data?.grade || 'unknown'}, Stage: ${opp.data?.stage || 'unknown'}`,
        },
        update: {
          // Only update if already exists
          description: opp.content,
          notes: `Grade: ${opp.data?.grade || 'unknown'}, Stage: ${opp.data?.stage || 'unknown'}`,
        },
      });

      console.log(`✓ ${deal.dealNumber}: ${deal.companyName}`);
      seededCount++;
    }

    console.log(`\nSeeded ${seededCount} deals`);
  } catch (error) {
    console.error('Seeding error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

seedDeals();
