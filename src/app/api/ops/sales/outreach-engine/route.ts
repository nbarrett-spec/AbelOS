export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import crypto from 'crypto'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// OUTREACH SEQUENCE AUTOMATION ENGINE
// ──────────────────────────────────────────────────────────────────────────
// Powerful automated outreach system supporting:
// - Fully automated (AI agent sends on schedule)
// - Semi-automated (AI drafts, human reviews and sends)
// - Multi-channel (email, calls, SMS)
// - Template library and AI generation
// ──────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────
// TABLE INITIALIZATION
// ──────────────────────────────────────────────────────────────────────────

async function ensureTables() {
  // OutreachSequence: Master sequence configurations
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "OutreachSequence" (
      "id" TEXT PRIMARY KEY,
      "name" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "mode" TEXT NOT NULL CHECK ("mode" IN ('AUTO', 'SEMI_AUTO')),
      "stepCount" INT DEFAULT 0,
      "active" BOOLEAN DEFAULT true,
      "createdBy" TEXT NOT NULL,
      "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `)
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "idx_outreach_sequence_active" ON "OutreachSequence"("active")`
  )
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "idx_outreach_sequence_type" ON "OutreachSequence"("type")`
  )

  // OutreachStep: Individual steps in a sequence
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "OutreachStep" (
      "id" TEXT PRIMARY KEY,
      "sequenceId" TEXT NOT NULL,
      "stepNumber" INT NOT NULL,
      "delayDays" INT NOT NULL,
      "channel" TEXT NOT NULL CHECK ("channel" IN ('EMAIL', 'CALL_TASK', 'SMS')),
      "subject" TEXT,
      "bodyTemplate" TEXT NOT NULL,
      "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      FOREIGN KEY ("sequenceId") REFERENCES "OutreachSequence"("id") ON DELETE CASCADE
    )
  `)
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "idx_outreach_step_sequence" ON "OutreachStep"("sequenceId")`
  )

  // OutreachEnrollment: Prospect enrollment in sequences
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "OutreachEnrollment" (
      "id" TEXT PRIMARY KEY,
      "sequenceId" TEXT NOT NULL,
      "prospectId" TEXT,
      "email" TEXT NOT NULL,
      "companyName" TEXT NOT NULL,
      "contactName" TEXT NOT NULL,
      "currentStep" INT DEFAULT 0,
      "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE', 'PAUSED', 'COMPLETED', 'REPLIED', 'CONVERTED')),
      "enrolledAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      "completedAt" TIMESTAMP WITH TIME ZONE,
      "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      FOREIGN KEY ("sequenceId") REFERENCES "OutreachSequence"("id") ON DELETE CASCADE
    )
  `)
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "idx_outreach_enrollment_sequence" ON "OutreachEnrollment"("sequenceId")`
  )
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "idx_outreach_enrollment_status" ON "OutreachEnrollment"("status")`
  )
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "idx_outreach_enrollment_email" ON "OutreachEnrollment"("email")`
  )

  // OutreachEnrollmentStep: Individual step execution tracking
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "OutreachEnrollmentStep" (
      "id" TEXT PRIMARY KEY,
      "enrollmentId" TEXT NOT NULL,
      "stepId" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'AWAITING_REVIEW', 'SENT', 'SKIPPED')),
      "scheduledAt" TIMESTAMP WITH TIME ZONE NOT NULL,
      "sentAt" TIMESTAMP WITH TIME ZONE,
      "openedAt" TIMESTAMP WITH TIME ZONE,
      "repliedAt" TIMESTAMP WITH TIME ZONE,
      "editedSubject" TEXT,
      "editedBody" TEXT,
      "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      FOREIGN KEY ("enrollmentId") REFERENCES "OutreachEnrollment"("id") ON DELETE CASCADE,
      FOREIGN KEY ("stepId") REFERENCES "OutreachStep"("id") ON DELETE CASCADE
    )
  `)
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "idx_enrollment_step_enrollment" ON "OutreachEnrollmentStep"("enrollmentId")`
  )
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "idx_enrollment_step_status" ON "OutreachEnrollmentStep"("status")`
  )
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "idx_enrollment_step_scheduled" ON "OutreachEnrollmentStep"("scheduledAt")`
  )

  // OutreachTemplate: Email template library
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "OutreachTemplate" (
      "id" TEXT PRIMARY KEY,
      "templateType" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "subject" TEXT NOT NULL,
      "body" TEXT NOT NULL,
      "category" TEXT,
      "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `)
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "idx_outreach_template_type" ON "OutreachTemplate"("templateType")`
  )

  // Seed default templates if not exists
  const templateCount: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS count FROM "OutreachTemplate"`
  )
  if ((templateCount[0]?.count || 0) === 0) {
    await seedDefaultTemplates()
  }
}

// ──────────────────────────────────────────────────────────────────────────
// TEMPLATE SEEDING
// ──────────────────────────────────────────────────────────────────────────

async function seedDefaultTemplates() {
  const templates = [
    {
      templateType: 'COLD_INTRO_1',
      name: 'Quick question about your door sourcing',
      subject: 'Quick question about your door sourcing',
      body: `Hi {{contactName}},

I was researching {{companyName}} and noticed you source a lot of doors. I wanted to reach out because we work with builders like you on a regular basis.

Quick question: are you currently satisfied with your door supplier, or open to exploring alternatives that could save you time and money?

Looking forward to hearing from you.

Best,
{{repName}}`,
      category: 'COLD_OUTREACH',
    },
    {
      templateType: 'COLD_INTRO_2',
      name: 'How [competitor pain point] is costing you money',
      subject: 'How your current door supplier may be costing you',
      body: `Hi {{contactName}},

Working with builders across your region, we've noticed that most struggle with:
- Long lead times on specialty doors
- Inconsistent pricing across orders
- Poor support when things go wrong mid-project

At Abel Lumber, we've solved these for 100+ builders. We maintain local inventory, lock in pricing with volume discounts, and have a dedicated team ready when you need us.

Would a 15-minute call to discuss how we could help {{companyName}} make sense?

Best,
{{repName}}`,
      category: 'COLD_OUTREACH',
    },
    {
      templateType: 'COLD_INTRO_3',
      name: 'Final thought — your door supply chain',
      subject: 'Final thought on your door supply chain',
      body: `Hi {{contactName}},

This is my last attempt to reach you — I promise!

The reason I've been persistent: we've worked with builders in your market, and every single one told us the same thing: their door supplier was their biggest headache.

We fixed that for them. And I think we could for {{companyName}} too.

If you're even slightly curious, let's grab 15 minutes. If not, no worries — I'll stop bothering you!

Best,
{{repName}}`,
      category: 'COLD_OUTREACH',
    },
    {
      templateType: 'WARM_FOLLOW_UP_1',
      name: 'Great meeting you at [event/site]',
      subject: 'Great meeting you at {{eventName}}',
      body: `Hi {{contactName}},

Really enjoyed meeting you at {{eventName}}. Thanks for taking the time to chat about {{companyName}}'s upcoming projects.

As I mentioned, we'd love to help you source those doors more efficiently. I'm following up with a few resources that might be helpful:

[Include specific resources based on conversation]

Let me know if any of this resonates, and let's set up a brief call to discuss next steps.

Best,
{{repName}}`,
      category: 'FOLLOW_UP',
    },
    {
      templateType: 'QUOTE_CHASE_1',
      name: 'Your Abel Lumber quote is waiting',
      subject: 'Your quote is ready — {{companyName}}',
      body: `Hi {{contactName}},

Following up on the quote we sent over for your door order. I wanted to make sure it landed safely and answer any questions you might have.

Here's what we're offering:
- [Key pricing/terms]
- Fast turnaround: [timeline]
- Our support team is here for you

Ready to move forward? Just let me know and I'll get your order locked in.

Best,
{{repName}}`,
      category: 'SALES',
    },
    {
      templateType: 'QUOTE_CHASE_2',
      name: 'Lock in pricing before [date]',
      subject: 'Last chance to lock in this pricing — {{companyName}}',
      body: `Hi {{contactName}},

Quick heads up: the pricing on your quote expires {{expirationDate}}.

After that date, we may need to adjust based on material costs. So if you want to move forward at the rate we quoted, now's the time.

Just hit reply or call me directly at [phone] and we'll get started.

Best,
{{repName}}`,
      category: 'SALES',
    },
    {
      templateType: 'WIN_BACK_1',
      name: 'We miss working with [company]',
      subject: 'We miss working with {{companyName}}',
      body: `Hi {{contactName}},

It's been a while since we've worked together on {{companyName}}'s projects. I wanted to reach out because we've made some significant improvements:

- Better inventory availability
- Faster delivery times
- New specialty door options

Would love to grab 15 minutes to catch up and see if there's an opportunity to work together again.

Best,
{{repName}}`,
      category: 'WIN_BACK',
    },
    {
      templateType: 'NEW_BUILDER_WELCOME_1',
      name: 'Welcome to Abel Lumber - here is what happens next',
      subject: 'Welcome to Abel Lumber, {{contactName}}!',
      body: `Hi {{contactName}},

Welcome to Abel Lumber! We're thrilled to have {{companyName}} as a partner.

Here's what happens next:
1. Your account manager (that's me!) will reach out this week to confirm your setup
2. We'll get you connected to our ordering portal
3. I'll walk you through our best pricing and options for your typical projects

In the meantime, here's a quick resource on how to maximize your account: [link]

Looking forward to supporting your projects!

Best,
{{repName}}`,
      category: 'ONBOARDING',
    },
    {
      templateType: 'NEW_BUILDER_WELCOME_2',
      name: 'Your first order: how to get the best pricing',
      subject: 'Your first order with Abel Lumber — best pricing',
      body: `Hi {{contactName}},

As you're preparing your first order with us, I wanted to share a quick tip: volume discounts kick in at certain thresholds.

For {{companyName}}, based on your typical order size, here are the tiers that apply:
[Show relevant pricing tiers]

Let me know your planned order size and I can lock in the best rate for you.

Best,
{{repName}}`,
      category: 'ONBOARDING',
    },
  ]

  for (const template of templates) {
    const id = crypto.randomUUID()
    await prisma.$executeRawUnsafe(
      `INSERT INTO "OutreachTemplate" ("id", "templateType", "name", "subject", "body", "category", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      id,
      template.templateType,
      template.name,
      template.subject,
      template.body,
      template.category
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// REPORT HANDLERS
// ──────────────────────────────────────────────────────────────────────────

async function getSequences() {
  const sequences: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      s."id",
      s."name",
      s."type"::text AS "type",
      s."mode"::text AS "mode",
      s."active",
      s."stepCount",
      s."createdBy",
      s."createdAt",
      COUNT(e."id")::int AS "totalEnrolled",
      COUNT(CASE WHEN e."status"::text = 'ACTIVE' THEN 1 END)::int AS "activeEnrollments",
      COUNT(CASE WHEN e."status"::text = 'REPLIED' THEN 1 END)::int AS "repliedCount",
      COUNT(CASE WHEN e."status"::text = 'CONVERTED' THEN 1 END)::int AS "convertedCount"
    FROM "OutreachSequence" s
    LEFT JOIN "OutreachEnrollment" e ON e."sequenceId" = s."id"
    GROUP BY s."id", s."name", s."type", s."mode", s."active", s."stepCount", s."createdBy", s."createdAt"
    ORDER BY s."createdAt" DESC
  `)
  return sequences
}

async function getQueue() {
  const pending: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      es."id" AS "enrollmentStepId",
      e."id" AS "enrollmentId",
      s."id" AS "sequenceId",
      s."name" AS "sequenceName",
      s."type"::text AS "sequenceType",
      s."mode"::text AS "sequenceMode",
      e."email",
      e."contactName",
      e."companyName",
      st."subject",
      st."bodyTemplate",
      st."channel"::text AS "channel",
      e."currentStep",
      st."stepNumber",
      es."scheduledAt",
      es."status"::text AS "status"
    FROM "OutreachEnrollmentStep" es
    JOIN "OutreachEnrollment" e ON e."id" = es."enrollmentId"
    JOIN "OutreachSequence" s ON s."id" = e."sequenceId"
    JOIN "OutreachStep" st ON st."id" = es."stepId"
    WHERE es."status"::text = 'PENDING'
      AND es."scheduledAt" <= NOW()
      AND e."status"::text = 'ACTIVE'
      AND s."active" = true
    ORDER BY es."scheduledAt" ASC
    LIMIT 100
  `)
  return pending
}

async function getPerformance() {
  const perf: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      s."id",
      s."name",
      s."type"::text AS "type",
      COUNT(DISTINCT e."id")::int AS "totalEnrolled",
      COUNT(DISTINCT CASE WHEN es."sentAt" IS NOT NULL THEN e."id" END)::int AS "sent",
      COUNT(DISTINCT CASE WHEN es."openedAt" IS NOT NULL THEN e."id" END)::int AS "opened",
      COUNT(DISTINCT CASE WHEN es."repliedAt" IS NOT NULL THEN e."id" END)::int AS "replied",
      COUNT(DISTINCT CASE WHEN e."status"::text = 'CONVERTED' THEN e."id" END)::int AS "converted",
      ROUND(
        100.0 * COUNT(DISTINCT CASE WHEN es."openedAt" IS NOT NULL THEN e."id" END) /
        NULLIF(COUNT(DISTINCT CASE WHEN es."sentAt" IS NOT NULL THEN e."id" END), 0),
        2
      )::float AS "openRate",
      ROUND(
        100.0 * COUNT(DISTINCT CASE WHEN es."repliedAt" IS NOT NULL THEN e."id" END) /
        NULLIF(COUNT(DISTINCT CASE WHEN es."sentAt" IS NOT NULL THEN e."id" END), 0),
        2
      )::float AS "replyRate",
      ROUND(
        100.0 * COUNT(DISTINCT CASE WHEN e."status"::text = 'CONVERTED' THEN e."id" END) /
        NULLIF(COUNT(DISTINCT e."id"), 0),
        2
      )::float AS "conversionRate"
    FROM "OutreachSequence" s
    LEFT JOIN "OutreachEnrollment" e ON e."sequenceId" = s."id"
    LEFT JOIN "OutreachEnrollmentStep" es ON es."enrollmentId" = e."id"
    GROUP BY s."id", s."name", s."type"
    ORDER BY s."createdAt" DESC
  `)
  return perf
}

async function getTemplates() {
  const templates: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      "id",
      "templateType",
      "name",
      "subject",
      "body",
      "category",
      "createdAt"
    FROM "OutreachTemplate"
    ORDER BY "category" ASC, "name" ASC
  `)
  return templates
}

async function getProspectPipeline() {
  const pipeline: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      e."status"::text AS "stage",
      COUNT(DISTINCT e."id")::int AS "prospectCount",
      COUNT(DISTINCT CASE WHEN es."sentAt" IS NOT NULL THEN es."id" END)::int AS "totalTouchpoints",
      ROUND(
        AVG(COUNT(DISTINCT CASE WHEN es."sentAt" IS NOT NULL THEN es."id" END))::float,
        2
      )::float AS "avgTouchpointsPerProspect"
    FROM "OutreachEnrollment" e
    LEFT JOIN "OutreachEnrollmentStep" es ON es."enrollmentId" = e."id"
    GROUP BY e."status"
    ORDER BY CASE
      WHEN e."status"::text = 'ACTIVE' THEN 1
      WHEN e."status"::text = 'REPLIED' THEN 2
      WHEN e."status"::text = 'CONVERTED' THEN 3
      WHEN e."status"::text = 'PAUSED' THEN 4
      WHEN e."status"::text = 'COMPLETED' THEN 5
      ELSE 6
    END
  `)
  return pipeline
}

// ──────────────────────────────────────────────────────────────────────────
// ACTION HANDLERS
// ──────────────────────────────────────────────────────────────────────────

async function createSequence(data: any, staffId: string) {
  const { name, type, mode, steps } = data

  if (!name || !type || !mode || !Array.isArray(steps) || steps.length === 0) {
    throw new Error('Invalid sequence data: name, type, mode, and steps required')
  }

  const sequenceId = crypto.randomUUID()

  // Create sequence
  await prisma.$executeRawUnsafe(
    `INSERT INTO "OutreachSequence" ("id", "name", "type", "mode", "stepCount", "active", "createdBy", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, true, $6, NOW(), NOW())`,
    sequenceId,
    name,
    type,
    mode,
    steps.length,
    staffId
  )

  // Create steps
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const stepId = crypto.randomUUID()
    await prisma.$executeRawUnsafe(
      `INSERT INTO "OutreachStep" ("id", "sequenceId", "stepNumber", "delayDays", "channel", "subject", "bodyTemplate", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      stepId,
      sequenceId,
      i + 1,
      step.delayDays,
      step.channel,
      step.subject || '',
      step.bodyTemplate
    )
  }

  return { sequenceId, message: 'Sequence created successfully' }
}

async function enrollProspect(data: any) {
  const { sequenceId, prospectId, email, companyName, contactName } = data

  if (!sequenceId || !email || !companyName || !contactName) {
    throw new Error('sequenceId, email, companyName, and contactName required')
  }

  // Check if already enrolled
  const existing: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "OutreachEnrollment" WHERE "sequenceId" = $1 AND "email" = $2`,
    sequenceId,
    email
  )

  if (existing.length > 0) {
    throw new Error('Prospect already enrolled in this sequence')
  }

  const enrollmentId = crypto.randomUUID()

  // Create enrollment
  await prisma.$executeRawUnsafe(
    `INSERT INTO "OutreachEnrollment" ("id", "sequenceId", "prospectId", "email", "companyName", "contactName", "currentStep", "status", "enrolledAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, 0, 'ACTIVE', NOW(), NOW())`,
    enrollmentId,
    sequenceId,
    prospectId || null,
    email,
    companyName,
    contactName
  )

  // Get first step and schedule it
  const firstStep: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "OutreachStep" WHERE "sequenceId" = $1 AND "stepNumber" = 1 LIMIT 1`,
    sequenceId
  )

  if (firstStep.length > 0) {
    const stepId = firstStep[0].id
    const enrollmentStepId = crypto.randomUUID()

    // Schedule for NOW (immediate)
    await prisma.$executeRawUnsafe(
      `INSERT INTO "OutreachEnrollmentStep" ("id", "enrollmentId", "stepId", "status", "scheduledAt", "createdAt")
       VALUES ($1, $2, $3, 'PENDING', NOW(), NOW())`,
      enrollmentStepId,
      enrollmentId,
      stepId
    )
  }

  return { enrollmentId, message: 'Prospect enrolled successfully' }
}

async function processQueue() {
  // Get all pending items due
  const queue: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      es."id" AS "enrollmentStepId",
      e."id" AS "enrollmentId",
      s."mode"::text AS "mode",
      st."channel"::text AS "channel"
    FROM "OutreachEnrollmentStep" es
    JOIN "OutreachEnrollment" e ON e."id" = es."enrollmentId"
    JOIN "OutreachSequence" s ON s."id" = e."sequenceId"
    JOIN "OutreachStep" st ON st."id" = es."stepId"
    WHERE es."status"::text = 'PENDING'
      AND es."scheduledAt" <= NOW()
      AND e."status"::text = 'ACTIVE'
      AND s."active" = true
    ORDER BY es."scheduledAt" ASC
  `)

  let processed = 0
  let awaitingReview = 0

  for (const item of queue) {
    if (item.mode === 'AUTO') {
      // Send email directly
      await prisma.$executeRawUnsafe(
        `UPDATE "OutreachEnrollmentStep"
         SET "status" = 'SENT', "sentAt" = NOW()
         WHERE "id" = $1`,
        item.enrollmentStepId
      )
      processed++

      // Schedule next step if exists
      const nextStep: any[] = await prisma.$queryRawUnsafe(`
        SELECT e."id", e."sequenceId", st."stepNumber", st."id" AS "stepId"
        FROM "OutreachEnrollment" e
        JOIN "OutreachStep" st ON st."sequenceId" = e."sequenceId"
        JOIN "OutreachEnrollmentStep" es ON es."enrollmentId" = e."id" AND es."stepId" = st."id"
        WHERE e."id" = $1 AND st."stepNumber" > (
          SELECT MAX("stepNumber") FROM "OutreachStep" WHERE "sequenceId" = e."sequenceId" AND "id" IN (
            SELECT "stepId" FROM "OutreachEnrollmentStep" WHERE "enrollmentId" = e."id" AND "status"::text = 'SENT'
          )
        )
        LIMIT 1
      `, item.enrollmentId)

      if (nextStep.length > 0) {
        const delay: any[] = await prisma.$queryRawUnsafe(
          `SELECT "delayDays" FROM "OutreachStep" WHERE "id" = $1`,
          nextStep[0].stepId
        )

        if (delay.length > 0) {
          const scheduledTime = new Date()
          scheduledTime.setDate(scheduledTime.getDate() + delay[0].delayDays)

          const enrollmentStepId = crypto.randomUUID()
          await prisma.$executeRawUnsafe(
            `INSERT INTO "OutreachEnrollmentStep" ("id", "enrollmentId", "stepId", "status", "scheduledAt", "createdAt")
             VALUES ($1, $2, $3, 'PENDING', $4, NOW())`,
            enrollmentStepId,
            item.enrollmentId,
            nextStep[0].stepId,
            scheduledTime.toISOString()
          )
        }
      }
    } else if (item.mode === 'SEMI_AUTO') {
      // Mark as awaiting review
      await prisma.$executeRawUnsafe(
        `UPDATE "OutreachEnrollmentStep"
         SET "status" = 'AWAITING_REVIEW'
         WHERE "id" = $1`,
        item.enrollmentStepId
      )
      awaitingReview++
    }
  }

  return { processed, awaitingReview, totalProcessed: processed + awaitingReview }
}

async function approveSend(data: any) {
  const { enrollmentStepId, editedSubject, editedBody } = data

  if (!enrollmentStepId) {
    throw new Error('enrollmentStepId required')
  }

  // Update with edits if provided
  if (editedSubject || editedBody) {
    await prisma.$executeRawUnsafe(
      `UPDATE "OutreachEnrollmentStep"
       SET "status" = 'SENT', "sentAt" = NOW(), "editedSubject" = $1, "editedBody" = $2
       WHERE "id" = $3`,
      editedSubject || null,
      editedBody || null,
      enrollmentStepId
    )
  } else {
    await prisma.$executeRawUnsafe(
      `UPDATE "OutreachEnrollmentStep"
       SET "status" = 'SENT', "sentAt" = NOW()
       WHERE "id" = $1`,
      enrollmentStepId
    )
  }

  // Schedule next step
  const enrollmentStep: any[] = await prisma.$queryRawUnsafe(
    `SELECT "enrollmentId", "stepId" FROM "OutreachEnrollmentStep" WHERE "id" = $1`,
    enrollmentStepId
  )

  if (enrollmentStep.length > 0) {
    const { enrollmentId, stepId } = enrollmentStep[0]

    // Get next step
    const currentStepNum: any[] = await prisma.$queryRawUnsafe(
      `SELECT "stepNumber" FROM "OutreachStep" WHERE "id" = $1`,
      stepId
    )

    if (currentStepNum.length > 0) {
      const nextStep: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id", "delayDays" FROM "OutreachStep" WHERE "sequenceId" = (
          SELECT "sequenceId" FROM "OutreachStep" WHERE "id" = $1
        ) AND "stepNumber" = $2`,
        stepId,
        (currentStepNum[0].stepNumber || 0) + 1
      )

      if (nextStep.length > 0) {
        const scheduledTime = new Date()
        scheduledTime.setDate(scheduledTime.getDate() + (nextStep[0].delayDays || 0))

        const nextEnrollmentStepId = crypto.randomUUID()
        await prisma.$executeRawUnsafe(
          `INSERT INTO "OutreachEnrollmentStep" ("id", "enrollmentId", "stepId", "status", "scheduledAt", "createdAt")
           VALUES ($1, $2, $3, 'PENDING', $4, NOW())`,
          nextEnrollmentStepId,
          enrollmentId,
          nextStep[0].id,
          scheduledTime.toISOString()
        )
      } else {
        // No more steps, mark enrollment as completed
        await prisma.$executeRawUnsafe(
          `UPDATE "OutreachEnrollment"
           SET "status" = 'COMPLETED', "completedAt" = NOW(), "updatedAt" = NOW()
           WHERE "id" = $1`,
          enrollmentId
        )
      }
    }
  }

  return { message: 'Email approved and sent successfully' }
}

async function markReplied(data: any) {
  const { enrollmentId } = data

  if (!enrollmentId) {
    throw new Error('enrollmentId required')
  }

  // Mark enrollment as replied and stop sequence
  await prisma.$executeRawUnsafe(
    `UPDATE "OutreachEnrollment"
     SET "status" = 'REPLIED', "updatedAt" = NOW()
     WHERE "id" = $1`,
    enrollmentId
  )

  // Mark any pending steps as skipped
  await prisma.$executeRawUnsafe(
    `UPDATE "OutreachEnrollmentStep"
     SET "status" = 'SKIPPED'
     WHERE "enrollmentId" = $1 AND "status"::text = 'PENDING'`,
    enrollmentId
  )

  return { message: 'Prospect marked as replied, sequence paused' }
}

async function generateEmail(data: any) {
  const { templateType, prospectId, customContext } = data

  if (!templateType) {
    throw new Error('templateType required')
  }

  // Get template
  const template: any[] = await prisma.$queryRawUnsafe(
    `SELECT "subject", "body" FROM "OutreachTemplate" WHERE "templateType" = $1 LIMIT 1`,
    templateType
  )

  if (template.length === 0) {
    throw new Error('Template not found')
  }

  const { subject, body } = template[0]

  // If prospectId provided, get prospect data for personalization
  let prospectData = { companyName: 'Your Company', contactName: 'there', repName: 'Your Account Manager' }

  if (prospectId && customContext) {
    prospectData = {
      companyName: customContext.companyName || prospectData.companyName,
      contactName: customContext.contactName || prospectData.contactName,
      repName: customContext.repName || prospectData.repName,
    }
  }

  // Replace placeholders
  const personalizedSubject = subject
    .replace(/{{companyName}}/g, prospectData.companyName)
    .replace(/{{contactName}}/g, prospectData.contactName)
    .replace(/{{repName}}/g, prospectData.repName)

  const personalizedBody = body
    .replace(/{{companyName}}/g, prospectData.companyName)
    .replace(/{{contactName}}/g, prospectData.contactName)
    .replace(/{{repName}}/g, prospectData.repName)

  return {
    subject: personalizedSubject,
    body: personalizedBody,
    templateType,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// ROUTE HANDLERS
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    await ensureTables()

    const { searchParams } = new URL(request.url)
    const report = searchParams.get('report')

    let data: any = null

    switch (report) {
      case 'sequences':
        data = await getSequences()
        break
      case 'queue':
        data = await getQueue()
        break
      case 'performance':
        data = await getPerformance()
        break
      case 'templates':
        data = await getTemplates()
        break
      case 'prospect-pipeline':
        data = await getProspectPipeline()
        break
      default:
        return safeJson({ error: 'Invalid report parameter' }, { status: 400 })
    }

    return safeJson({ report, data })
  } catch (error: any) {
    console.error('Outreach engine GET error:', error)
    return safeJson({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Sales', undefined, { method: 'POST' }).catch(() => {})

    await ensureTables()

    const body = await request.json()
    const { action } = body

    let result: any = null

    switch (action) {
      case 'create_sequence':
        const staffId = request.headers.get('x-staff-id') || 'system'
        result = await createSequence(body, staffId)
        break

      case 'enroll_prospect':
        result = await enrollProspect(body)
        break

      case 'process_queue':
        result = await processQueue()
        break

      case 'approve_send':
        result = await approveSend(body)
        break

      case 'mark_replied':
        result = await markReplied(body)
        break

      case 'generate_email':
        result = await generateEmail(body)
        break

      default:
        return safeJson({ error: 'Invalid action' }, { status: 400 })
    }

    return safeJson({ action, result }, { status: 200 })
  } catch (error: any) {
    console.error('Outreach engine POST error:', error)
    return safeJson({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
