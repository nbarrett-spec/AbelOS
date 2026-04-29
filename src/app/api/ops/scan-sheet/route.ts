export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// SCAN SHEET — AI-powered paper form reader
// POST multipart/form-data:
//   image      - photo of completed job packet page (required)
//   jobId      - job ID to write back to (required)
//   jobNumber  - for display / context (required)
//   sheetType  - PICK_LIST | BUILD_SHEET | DELIVERY | QC_PUNCH | AUTO
//   staffId    - who scanned it
//   writeBack  - "true" to apply changes, "false" for preview only
// ──────────────────────────────────────────────────────────────────────────

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const VISION_MODEL = 'claude-sonnet-4-5'
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

interface ExtractionResult {
  sheetType: string
  checkedItems: string[]
  uncheckedItems: string[]
  handwrittenNotes: string[]
  signatures: { role: string; name: string | null; signed: boolean }[]
  defects: { type: string; location: string; notes: string }[]
  disposition: string | null
  punchItemCount: number | null
  summary: string
  confidence: number
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'AI not configured — ANTHROPIC_API_KEY missing' }, { status: 503 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'multipart/form-data required' }, { status: 400 })
  }

  const imageFile = form.get('image')
  if (!(imageFile instanceof File)) {
    return NextResponse.json({ error: 'image file required' }, { status: 400 })
  }
  if (!ALLOWED_MIME.has(imageFile.type)) {
    return NextResponse.json({ error: `Unsupported image type: ${imageFile.type}. Use JPG, PNG, or WebP.` }, { status: 400 })
  }
  if (imageFile.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: 'Image too large — max 20MB' }, { status: 400 })
  }

  const jobId = form.get('jobId') as string
  const jobNumber = form.get('jobNumber') as string
  const sheetType = (form.get('sheetType') as string) || 'AUTO'
  const staffId = form.get('staffId') as string
  const writeBack = form.get('writeBack') === 'true'

  if (!jobId || !jobNumber) {
    return NextResponse.json({ error: 'jobId and jobNumber are required' }, { status: 400 })
  }

  // Audit log
  audit(request, 'CREATE', 'SheetScan', jobId, { sheetType, writeBack }).catch(() => {})

  try {
    // Convert image to base64
    const buffer = Buffer.from(await imageFile.arrayBuffer())
    const base64Image = buffer.toString('base64')
    const mediaType = imageFile.type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'

    // ── Call Claude Vision ──
    const extraction = await callVision(apiKey, base64Image, mediaType, jobNumber, sheetType)

    // ── Write back to Aegis if requested ──
    let writeback = { tasksCompleted: 0, notesAdded: 0, activitiesCreated: 0, statusAdvanced: false, newStatus: null as string | null }

    if (writeBack) {
      writeback = await applyWriteback(jobId, jobNumber, staffId, extraction)
    }

    return NextResponse.json({
      success: true,
      sheetType: extraction.sheetType,
      jobNumber,
      jobId,
      extraction: {
        checkedItems: extraction.checkedItems,
        uncheckedItems: extraction.uncheckedItems,
        handwrittenNotes: extraction.handwrittenNotes,
        signatures: extraction.signatures,
        defects: extraction.defects,
        disposition: extraction.disposition,
        punchItemCount: extraction.punchItemCount,
      },
      writeback,
      confidence: extraction.confidence,
      rawSummary: extraction.summary,
    })
  } catch (error: any) {
    console.error('[Scan Sheet] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to process scan' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Claude Vision call
// ──────────────────────────────────────────────────────────────────────────

async function callVision(
  apiKey: string,
  base64Image: string,
  mediaType: string,
  jobNumber: string,
  sheetTypeHint: string,
): Promise<ExtractionResult> {
  const systemPrompt = `You are a document scanner for Abel Lumber, a door/trim/hardware supplier. You analyze photographs of printed job packet sheets that have been filled out by hand in the field.

Your job is to extract ALL information from the photo:
1. CHECKBOXES: Identify every checkbox. Report which are checked (filled, X'd, ticked) vs unchecked (empty).
2. HANDWRITTEN NOTES: Transcribe ALL handwritten text — notes, comments, damage descriptions, quantities written in.
3. SIGNATURES: Identify signature lines and whether they've been signed. Note the role label (e.g., "Picked By", "QC Inspector", "Driver") and any legible name.
4. DEFECTS: For QC/Punch sheets, extract each defect/punch item with type, location/room, and notes.
5. DISPOSITION: For QC sheets, note the overall result (PASS / CONDITIONAL / FAIL) and punch item count.

Sheet types you may encounter:
- PICK_LIST: Warehouse picking sheet with zone/bin/SKU rows and checkboxes
- BUILD_SHEET: Assembly unit sheet with component checklist and QC sign-off grid (Pass/Fail per check)
- DELIVERY: Pre-delivery checklist, unit count confirmation, loaded-by/driver/received-by sign-offs
- QC_PUNCH: Post-delivery site walkthrough with room-by-room inspection, defect checklist, disposition

Respond with ONLY valid JSON matching this structure exactly:
{
  "sheetType": "PICK_LIST" | "BUILD_SHEET" | "DELIVERY" | "QC_PUNCH",
  "checkedItems": ["item description 1", ...],
  "uncheckedItems": ["item description 1", ...],
  "handwrittenNotes": ["transcribed note 1", ...],
  "signatures": [{"role": "Picked By", "name": "John" or null, "signed": true/false}],
  "defects": [{"type": "Door slab damage", "location": "Master BR", "notes": "scratch on panel 2"}],
  "disposition": "PASS" | "CONDITIONAL" | "FAIL" | null,
  "punchItemCount": number | null,
  "summary": "Brief 1-2 sentence summary of what this sheet shows",
  "confidence": 0.0-1.0
}`

  const userMessage = sheetTypeHint !== 'AUTO'
    ? `This is a ${sheetTypeHint.replace(/_/g, ' ')} sheet for job ${jobNumber}. Extract all filled-out information.`
    : `This is a job packet sheet for job ${jobNumber}. Identify the sheet type and extract all filled-out information.`

  const body = {
    model: VISION_MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64Image,
            },
          },
          {
            type: 'text',
            text: userMessage,
          },
        ],
      },
    ],
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errText = await response.text()
    console.error('[Scan Sheet] Claude Vision error:', response.status, errText)
    throw new Error(`AI processing failed (${response.status})`)
  }

  const result = await response.json()

  // Extract text from response
  const textBlock = result.content?.find((b: any) => b.type === 'text')
  if (!textBlock?.text) {
    throw new Error('No text response from AI')
  }

  // Parse JSON from response (handle markdown code blocks)
  let jsonStr = textBlock.text.trim()
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }

  try {
    return JSON.parse(jsonStr) as ExtractionResult
  } catch (e) {
    console.error('[Scan Sheet] Failed to parse AI response:', jsonStr.slice(0, 500))
    throw new Error('AI returned malformed data — try a clearer photo')
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Writeback logic — apply extracted data to Aegis
// ──────────────────────────────────────────────────────────────────────────

async function applyWriteback(
  jobId: string,
  jobNumber: string,
  staffId: string,
  extraction: ExtractionResult,
) {
  let tasksCompleted = 0
  let notesAdded = 0
  let activitiesCreated = 0
  let statusAdvanced = false
  let newStatus: string | null = null

  const now = new Date().toISOString()
  const scannerName = staffId || 'sheet-scanner'

  // ── 1. Mark tasks as done based on checked items ──
  // Match checked items against open tasks on this job
  if (extraction.checkedItems.length > 0) {
    try {
      const openTasks: any[] = await prisma.$queryRawUnsafe(`
        SELECT t."id", t."title", t."description", t."status", t."category"
        FROM "Task" t
        WHERE t."jobId" = $1
          AND t."status" IN ('PENDING', 'IN_PROGRESS', 'TODO')
        ORDER BY t."createdAt" ASC
      `, jobId)

      for (const task of openTasks) {
        const titleLower = (task.title || '').toLowerCase()
        const descLower = (task.description || '').toLowerCase()

        // Check if any extracted checked item matches this task
        const matched = extraction.checkedItems.some(item => {
          const itemLower = item.toLowerCase()
          return titleLower.includes(itemLower) ||
                 itemLower.includes(titleLower) ||
                 descLower.includes(itemLower) ||
                 itemLower.includes(descLower)
        })

        if (matched) {
          await prisma.$executeRawUnsafe(`
            UPDATE "Task"
            SET "status" = 'DONE', "completedAt" = $2, "updatedAt" = $2
            WHERE "id" = $1 AND "status" IN ('PENDING', 'IN_PROGRESS', 'TODO')
          `, task.id, now)
          tasksCompleted++
        }
      }
    } catch (e) {
      console.warn('[Scan Sheet] Task completion failed:', e)
    }
  }

  // ── 2. Create punch-list tasks from defects ──
  if (extraction.defects.length > 0) {
    for (const defect of extraction.defects) {
      try {
        const taskId = `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
        await prisma.$executeRawUnsafe(`
          INSERT INTO "Task" (
            "id", "jobId", "title", "description", "category", "priority",
            "status", "createdBy", "createdAt", "updatedAt"
          ) VALUES ($1, $2, $3, $4, 'PUNCH_LIST', 'MEDIUM', 'PENDING', $5, NOW(), NOW())
        `,
          taskId,
          jobId,
          `${defect.type}${defect.location ? ` — ${defect.location}` : ''}`,
          defect.notes || defect.type,
          scannerName,
        )
        tasksCompleted++ // Count as a creation, will show in results
      } catch (e) {
        console.warn('[Scan Sheet] Punch task creation failed:', e)
      }
    }
  }

  // ── 3. Add handwritten notes to the job record ──
  if (extraction.handwrittenNotes.length > 0) {
    const noteText = extraction.handwrittenNotes.join('\n')
    try {
      // Append to job notes
      await prisma.$executeRawUnsafe(`
        UPDATE "Job"
        SET "notes" = CASE
              WHEN "notes" IS NULL OR "notes" = '' THEN $2
              ELSE "notes" || E'\n---\n' || $2
            END,
            "updatedAt" = NOW()
        WHERE "id" = $1
      `, jobId, `[Sheet Scan ${new Date().toLocaleDateString()}]\n${noteText}`)
      notesAdded = extraction.handwrittenNotes.length
    } catch (e) {
      console.warn('[Scan Sheet] Note append failed:', e)
    }
  }

  // ── 4. Create Activity / communication log entries ──
  // One activity per scan summarizing what was found
  try {
    const activityId = `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const summary = buildActivitySummary(extraction)

    // staffId is required on Activity — only create if we have one
    if (staffId) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Activity" (
          "id", "activityType", "subject", "notes", "jobId",
          "staffId", "sourceKey", "createdAt"
        ) VALUES ($1, 'NOTE'::"ActivityType", $2, $3, $4, $5, $6, NOW())
      `,
        activityId,
        `Sheet scan: ${extraction.sheetType.replace(/_/g, ' ')} — ${jobNumber}`,
        summary,
        jobId,
        staffId,
        `scan:${jobId}:${Date.now()}`,
      )
    }
    activitiesCreated++
  } catch (e) {
    console.warn('[Scan Sheet] Activity creation failed:', e)
  }

  // ── 5. QC record for QC_PUNCH or BUILD_SHEET ──
  if (extraction.sheetType === 'QC_PUNCH' || extraction.sheetType === 'BUILD_SHEET') {
    try {
      const qcId = `qc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      const checkType = extraction.sheetType === 'QC_PUNCH' ? 'POST_INSTALL' : 'FINAL_UNIT'
      const qcResult = extraction.disposition === 'PASS' ? 'PASS'
        : extraction.disposition === 'FAIL' ? 'FAIL'
        : 'CONDITIONAL_PASS'

      // Only create if we have a valid staffId for the inspector
      if (staffId) {
        await prisma.$executeRawUnsafe(`
          INSERT INTO "QualityCheck" (
            "id", "jobId", "inspectorId", "checkType", "result",
            "notes", "defectCodes", "photos", "createdAt"
          ) VALUES ($1, $2, $3, $4::"QCType", $5::"QCResult", $6, $7, $8, NOW())
        `,
          qcId,
          jobId,
          staffId,
          checkType,
          qcResult,
          extraction.summary,
          extraction.defects.map(d => d.type),
          [], // photos array — could store the uploaded image URL
        )
      }
    } catch (e) {
      console.warn('[Scan Sheet] QC record creation failed:', e)
    }
  }

  // ── 6. Auto-advance job status based on sheet type and results ──
  if (extraction.sheetType === 'PICK_LIST' && extraction.uncheckedItems.length === 0) {
    // All items picked — advance from materials-locked to production
    const advanced = await tryAdvanceStatus(jobId, ['MATERIALS_LOCKED', 'READINESS_CHECK'], 'IN_PRODUCTION')
    if (advanced) { statusAdvanced = true; newStatus = 'IN_PRODUCTION' }
  } else if (extraction.sheetType === 'BUILD_SHEET' && extraction.disposition === 'PASS') {
    const advanced = await tryAdvanceStatus(jobId, ['IN_PRODUCTION'], 'STAGED')
    if (advanced) { statusAdvanced = true; newStatus = 'STAGED' }
  } else if (extraction.sheetType === 'DELIVERY') {
    // Check if all signature lines are signed
    const allSigned = extraction.signatures.length > 0 && extraction.signatures.every(s => s.signed)
    if (allSigned) {
      const advanced = await tryAdvanceStatus(jobId, ['STAGED', 'LOADED', 'IN_TRANSIT'], 'DELIVERED')
      if (advanced) { statusAdvanced = true; newStatus = 'DELIVERED' }
    }
  } else if (extraction.sheetType === 'QC_PUNCH' && extraction.disposition === 'PASS') {
    const advanced = await tryAdvanceStatus(jobId, ['DELIVERED', 'INSTALLING', 'PUNCH_LIST'], 'COMPLETE')
    if (advanced) { statusAdvanced = true; newStatus = 'COMPLETE' }
  }

  return { tasksCompleted, notesAdded, activitiesCreated, statusAdvanced, newStatus }
}

// ── Helpers ──

async function tryAdvanceStatus(jobId: string, fromStatuses: string[], toStatus: string): Promise<boolean> {
  // toStatus is always a hardcoded enum value from our code, not user input
  const VALID_STATUSES = ['CREATED', 'READINESS_CHECK', 'MATERIALS_LOCKED', 'IN_PRODUCTION', 'STAGED', 'LOADED', 'IN_TRANSIT', 'DELIVERED', 'INSTALLING', 'PUNCH_LIST', 'COMPLETE', 'INVOICED', 'CLOSED']
  if (!VALID_STATUSES.includes(toStatus)) return false

  try {
    const placeholders = fromStatuses.map((_, i) => `$${i + 3}`).join(', ')
    const result = await prisma.$executeRawUnsafe(
      `UPDATE "Job" SET "status" = $2::"JobStatus", "updatedAt" = NOW() WHERE "id" = $1 AND "status"::text IN (${placeholders})`,
      jobId,
      toStatus,
      ...fromStatuses,
    )
    return (result as number) > 0
  } catch (e) {
    console.warn('[Scan Sheet] Status advance failed:', e)
    return false
  }
}

function buildActivitySummary(extraction: ExtractionResult): string {
  const parts: string[] = []

  if (extraction.checkedItems.length > 0) {
    parts.push(`${extraction.checkedItems.length} items checked off`)
  }
  if (extraction.handwrittenNotes.length > 0) {
    parts.push(`Notes: ${extraction.handwrittenNotes.join('; ')}`)
  }
  if (extraction.signatures.length > 0) {
    const signed = extraction.signatures.filter(s => s.signed)
    parts.push(`Signatures: ${signed.map(s => `${s.role}${s.name ? ` (${s.name})` : ''}`).join(', ') || 'none'}`)
  }
  if (extraction.defects.length > 0) {
    parts.push(`${extraction.defects.length} defect(s) noted`)
  }
  if (extraction.disposition) {
    parts.push(`Disposition: ${extraction.disposition}`)
  }

  return parts.join(' | ') || extraction.summary
}
