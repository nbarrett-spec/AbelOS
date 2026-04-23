import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface SeedStep {
  step: number;
  name: string;
  filename: string;
  dependencies: number[];
}

// Define seed order and dependencies
const SEED_STEPS: SeedStep[] = [
  {
    step: 1,
    name: 'Builders',
    filename: 'seed-builders.ts',
    dependencies: [],
  },
  {
    step: 2,
    name: 'Products',
    filename: 'seed-products.ts',
    dependencies: [],
  },
  {
    step: 3,
    name: 'Vendors',
    filename: 'seed-vendors.ts',
    dependencies: [],
  },
  {
    step: 4,
    name: 'Staff + Crews + CrewMembers',
    filename: 'seed-staff.ts',
    dependencies: [],
  },
  {
    step: 5,
    name: 'Inventory',
    filename: 'seed-inventory.ts',
    dependencies: [2], // depends on Products
  },
  {
    step: 6,
    name: 'Vendor Products',
    filename: 'seed-vendor-products.ts',
    dependencies: [2, 3], // depends on Products, Vendors
  },
  {
    step: 7,
    name: 'Builder Pricing',
    filename: 'seed-builder-pricing.ts',
    dependencies: [1, 2], // depends on Builders, Products
  },
  {
    step: 8,
    name: 'Deals',
    filename: 'seed-deals.ts',
    dependencies: [4], // depends on Staff
  },
  {
    step: 9,
    name: 'Financial Snapshot + Collection Rules',
    filename: 'seed-financial.ts',
    dependencies: [],
  },
];

interface StepResult {
  step: number;
  name: string;
  status: 'success' | 'skipped' | 'failed';
  duration: number;
  recordsAffected?: number;
  error?: string;
}

const results: StepResult[] = [];
let skipMode = false;

/**
 * Check if a file exists
 */
function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/**
 * Run a single seed step
 */
async function runSeedStep(
  step: SeedStep,
  seedDir: string,
  dryRun: boolean
): Promise<StepResult> {
  const startTime = Date.now();
  const seedPath = path.join(seedDir, step.filename);

  // Check if file exists
  if (!fileExists(seedPath)) {
    console.warn(`  ⚠️  Step ${step.step}: ${step.filename} not found (skipped)`);
    return {
      step: step.step,
      name: step.name,
      status: 'skipped',
      duration: 0,
      error: 'File not found',
    };
  }

  if (dryRun) {
    console.log(`  [DRY RUN] Would execute: ${step.filename}`);
    return {
      step: step.step,
      name: step.name,
      status: 'success',
      duration: Date.now() - startTime,
    };
  }

  try {
    // Execute the seed script using ts-node
    const command = `npx tsx "${seedPath}"`;
    console.log(`  Executing: ${command}`);

    const output = execSync(command, {
      cwd: path.dirname(seedDir),
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    const duration = Date.now() - startTime;
    console.log(output);

    return {
      step: step.step,
      name: step.name,
      status: 'success',
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);

    return {
      step: step.step,
      name: step.name,
      status: 'failed',
      duration,
      error: errorMsg,
    };
  }
}

/**
 * Print results table
 */
function printResultsTable(results: StepResult[]): void {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                      SEED RUN SUMMARY                          ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log('║ Step │ Status   │ Name                          │ Duration    ║');
  console.log('╠══════╪══════════╪═══════════════════════════════╪═════════════╣');

  let successCount = 0;
  let failureCount = 0;
  let skipCount = 0;
  let totalDuration = 0;

  for (const result of results) {
    const statusIcon =
      result.status === 'success'
        ? '✓'
        : result.status === 'failed'
          ? '✗'
          : '○';
    const statusStr = result.status.padEnd(8);
    const nameStr = result.name.substring(0, 28).padEnd(29);
    const durationStr = `${(result.duration / 1000).toFixed(2)}s`.padEnd(12);

    console.log(
      `║ ${String(result.step).padEnd(4)} │ ${statusIcon} ${statusStr}│ ${nameStr}│ ${durationStr}║`
    );

    if (result.status === 'success') successCount++;
    if (result.status === 'failed') failureCount++;
    if (result.status === 'skipped') skipCount++;
    totalDuration += result.duration;
  }

  console.log('╠══════╪══════════╪═══════════════════════════════╪═════════════╣');
  console.log(
    `║ Total: ${successCount} success, ${failureCount} failed, ${skipCount} skipped${' '.repeat(24 - String(successCount + failureCount + skipCount).length)} ${(totalDuration / 1000).toFixed(2)}s      ║`
  );
  console.log('╚════════════════════════════════════════════════════════════════╝');

  if (failureCount > 0) {
    console.log('\n❌ Failures:');
    for (const result of results) {
      if (result.status === 'failed') {
        console.log(`   Step ${result.step} (${result.name}): ${result.error}`);
      }
    }
  }
}

/**
 * Main runner
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let stepFilter: number | null = null;
  let dryRun = false;
  let selectedStep: number | null = null;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--step') {
      selectedStep = parseInt(args[i + 1], 10);
      if (isNaN(selectedStep) || selectedStep < 1 || selectedStep > SEED_STEPS.length) {
        console.error(
          `Invalid step number: ${args[i + 1]}. Must be 1-${SEED_STEPS.length}`
        );
        process.exit(1);
      }
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  // Determine which steps to run
  let stepsToRun = SEED_STEPS;
  if (selectedStep) {
    stepsToRun = SEED_STEPS.filter((s) => s.step === selectedStep);
    if (stepsToRun.length === 0) {
      console.error(`Step ${selectedStep} not found.`);
      process.exit(1);
    }
  }

  // Validate DATABASE_URL
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable not set.');
    process.exit(1);
  }

  const seedDir = __dirname;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                  Abel OS Seed Runner');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Database: ${process.env.DATABASE_URL.substring(0, 50)}...`);
  console.log(`Dry run:  ${dryRun ? 'YES' : 'NO'}`);
  console.log(
    `Steps:    ${stepsToRun.length === SEED_STEPS.length ? 'All (1-9)' : `Single (${selectedStep})`}`
  );
  console.log('───────────────────────────────────────────────────────────────\n');

  // Run seeds
  for (const step of stepsToRun) {
    // Check if dependencies are met
    const unmetDeps = step.dependencies.filter((dep) => {
      const depResult = results.find((r) => r.step === dep);
      return depResult && depResult.status !== 'success';
    });

    if (unmetDeps.length > 0) {
      console.log(
        `\n❌ Step ${step.step}: ${step.name} (dependencies not met: steps ${unmetDeps.join(', ')})`
      );
      results.push({
        step: step.step,
        name: step.name,
        status: 'failed',
        duration: 0,
        error: `Unmet dependencies: steps ${unmetDeps.join(', ')}`,
      });
      continue;
    }

    console.log(`\nStep ${step.step}/${stepsToRun.length}: ${step.name}...`);
    const result = await runSeedStep(step, seedDir, dryRun);
    results.push(result);

    // If not dry-run and step failed, ask whether to continue
    if (!dryRun && result.status === 'failed') {
      console.error(`\n⚠️  Step ${step.step} failed with error:\n${result.error}`);

      if (selectedStep === null) {
        // Only prompt if running all steps
        const answer = await promptUser(
          'Continue with remaining steps? (y/n): '
        );
        if (answer.toLowerCase() !== 'y') {
          console.log('\nAborted.');
          printResultsTable(results);
          process.exit(1);
        }
      } else {
        // Single step mode - just exit
        console.log('\nAborting.');
        printResultsTable(results);
        process.exit(1);
      }
    }
  }

  // Print summary
  printResultsTable(results);

  // Exit with error if any failed
  const failedCount = results.filter((r) => r.status === 'failed').length;
  if (failedCount > 0) {
    process.exit(1);
  }
}

/**
 * Print help
 */
function printHelp(): void {
  console.log(`
Abel OS Seed Runner

Usage:
  npx ts-node run-all-seeds.ts [options]

Options:
  --step N       Run only step N (1-9)
  --dry-run      Show what would be done without touching the DB
  --help, -h     Show this message

Examples:
  # Run all seeds in order
  npx ts-node run-all-seeds.ts

  # Run only step 1 (Builders)
  npx ts-node run-all-seeds.ts --step 1

  # Dry run - see what would execute
  npx ts-node run-all-seeds.ts --dry-run

Seed Order:
  1. Builders
  2. Products
  3. Vendors
  4. Staff + Crews + CrewMembers
  5. Inventory (depends on #2)
  6. Vendor Products (depends on #2, #3)
  7. Builder Pricing (depends on #1, #2)
  8. Deals (depends on #4)
  9. Financial Snapshot + Collection Rules

Set DATABASE_URL environment variable before running.
`);
}

/**
 * Prompt user for input (simple implementation using sync stdin)
 */
function promptUser(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);

    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (chunk) => {
      data += chunk;
      process.stdin.pause();
      resolve(data.trim());
    });
    process.stdin.resume();
  });
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
