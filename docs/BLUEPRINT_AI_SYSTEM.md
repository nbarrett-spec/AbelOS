# AI-Powered Blueprint Parsing System — Abel Lumber

## Overview

This system leverages Claude Vision API to automatically analyze floor plans and generate accurate material takeoffs. It's the #1 differentiator for Abel Lumber, enabling builders to submit floor plans and receive instant, detailed material lists with product matching.

## Architecture

### Core Components

1. **Blueprint AI Library** (`src/lib/blueprint-ai.ts`)
   - Handles Claude Vision API integration
   - Analyzes floor plan images (PNG, JPG, PDF)
   - Returns structured JSON analysis of rooms, doors, windows, closets, trim
   - Includes confidence scoring and uncertainty notes

2. **API Routes**
   - `POST /api/ops/blueprints/analyze` — Analyze a blueprint with Claude Vision
   - `POST /api/ops/blueprints/generate-takeoff` — Generate takeoff from analysis with product matching
   - `GET/POST /api/projects/[id]/blueprints` — Builder-facing blueprint management

3. **UI Pages**
   - `src/app/ops/blueprints/analyze/page.tsx` — Staff analysis & takeoff review page
   - `src/app/projects/[id]/upload-plans/page.tsx` — Builder-facing upload interface

### Data Flow

```
Builder uploads blueprint
    ↓
Blueprint stored in DB (ProcessingStatus: PENDING)
    ↓
Staff accesses /ops/blueprints/analyze
    ↓
Claude Vision analyzes floor plan
    ↓
AI returns structured analysis (rooms, doors, windows, closets, trim, confidence)
    ↓
Staff reviews analysis, confidence meter shows quality
    ↓
Generate Takeoff button creates line items
    ↓
Product matching engine finds catalog matches
    ↓
Takeoff record created with TakeoffItem records
    ↓
Staff reviews/edits takeoff on takeoff-review page
    ↓
Create Quote from takeoff
```

## Features

### 1. Claude Vision Image Analysis

The system uses `claude-sonnet-4-20250514` with vision capabilities to:
- Identify all doors by type (interior, exterior, closet, pocket, barn, french, bifold, sliding)
- Count windows by type
- Extract room information (name, type, estimated square footage)
- Detect closets (walk-in, reach-in, linen, coat closet)
- Estimate trim/molding requirements (linear feet)
- Calculate summary statistics (total doors, windows, closets, square footage, stories, bedrooms, bathrooms)
- Provide confidence scoring (0-100)
- Include AI notes about uncertainty or unclear elements

**System Prompt** emphasizes:
- Conservative confidence scoring (lower if dimensions unclear)
- Focus on accuracy over completeness
- Structured JSON output matching `BlueprintAnalysis` interface

### 2. Product Matching Engine

The `findProductMatches()` function in `generate-takeoff/route.ts`:
- Maps AI-detected items to actual products in the catalog
- Searches by category (Interior Door, Exterior Door, Trim, Hardware, Closet Systems, etc.)
- Returns up to 5 best matches, sorted by price
- Creates TakeoffItem records with matched productId

Current matching logic:
```typescript
const categoryMap: Record<string, string[]> = {
  'Interior Door': ['Interior Door', 'Pre-Hung', 'Slab', 'Bifold'],
  'Exterior Door': ['Exterior Door', 'Entry Door', 'Patio Door'],
  'Closet Door': ['Interior Door', 'Bifold'],
  'Pocket Door': ['Pocket Door', 'Interior Door'],
  Window: ['Window', 'Window Casing'],
  'Closet System': ['Closet Shelving', 'Closet Rod', 'Closet Components'],
  Trim: ['Base', 'Casing', 'Trim', 'Crown Moulding'],
  Hardware: ['Hardware', 'Hinges', 'Handles', 'Locks', 'Door Stops'],
}
```

### 3. Confidence Scoring

The system provides confidence scores at multiple levels:
- **Blueprint-level confidence** (0-100): Overall quality of analysis
- **Per-item confidence** (0-1): Individual product match confidence

Color-coded UI:
- Green: ≥80% confidence
- Yellow: 50-80% confidence
- Red: <50% confidence

### 4. Hardware Estimation

For doors detected, the system automatically estimates:
- Hinges: 3-pack per 2 doors (conservative)
- Handles/Levers: 1 per door
- Door Stops: 1 per door
- Locks: Optional, based on room type

This can be refined post-generation in the takeoff review page.

## Usage

### For Abel Staff

1. **Access Blueprint Analysis**
   - Navigate to `/ops/blueprints/analyze`
   - Upload a floor plan (PNG, JPG, PDF drag-and-drop)
   - Claude Vision analyzes in real-time (~30-60 seconds)
   - Review results:
     - Room breakdown (expandable cards)
     - Summary statistics (doors, windows, closets, sq ft)
     - Confidence meter (color-coded)
     - AI notes/warnings
   - Click "Generate Takeoff" to create line items with product matching
   - Takeoff is marked NEEDS_REVIEW and can be edited on takeoff-review page

2. **Review & Approve**
   - Navigate to `/ops/takeoff-review/[id]`
   - Edit quantities, swap products, add notes
   - Approve takeoff (status: APPROVED)
   - Create Quote from approved takeoff

### For Builders

1. **Upload Plans**
   - Navigate to project's `/projects/[id]/upload-plans`
   - Drag-and-drop floor plans (PDF, PNG, JPG)
   - Add optional notes (bedrooms, bathrooms, special features)
   - Files upload and are queued for AI analysis

2. **Track Status**
   - Blueprint status shows: Uploaded → Analyzing → Under Review → Takeoff Ready
   - Polling updates every 5 seconds (configurable)
   - When "Takeoff Ready", staff will review and contact with quote

3. **See Results**
   - Once takeoff is approved and quote generated, builder sees quote in their dashboard
   - Can approve quote → order placed

## API Endpoints

### POST `/api/ops/blueprints/analyze`

**Auth**: Staff (checkStaffAuth)

**Request**:
```json
{
  "blueprintId": "clu123...",  // OR provide image data
  "imageBase64": "iVBORw0KGgoAAAANSUhEUgAA...",  // optional
  "mediaType": "image/png"  // optional, required if imageBase64 provided
}
```

**Response** (success):
```json
{
  "analysis": {
    "rooms": [
      {
        "name": "Master Bedroom",
        "type": "bedroom",
        "estimatedSqFt": 240,
        "doors": [
          { "type": "interior", "width": "36", "quantity": 1 },
          { "type": "closet", "width": "36", "quantity": 1 }
        ],
        "windows": [
          { "type": "double-hung", "quantity": 2 }
        ],
        "closets": [
          { "type": "walk-in", "width": "120" }
        ]
      },
      // ... more rooms
    ],
    "summary": {
      "totalDoors": 18,
      "totalWindows": 12,
      "totalClosets": 6,
      "estimatedTrimLF": 480,
      "floorPlanSqFt": 3200,
      "stories": 2,
      "bedrooms": 4,
      "bathrooms": 3
    },
    "confidence": 87,
    "notes": [
      "Exterior door type unclear from image quality",
      "Window dimensions not visible on plan"
    ]
  },
  "blueprintId": "clu123...",
  "timestamp": "2026-03-29T15:30:00Z"
}
```

### POST `/api/ops/blueprints/generate-takeoff`

**Auth**: Staff (checkStaffAuth)

**Request**:
```json
{
  "blueprintId": "clu123...",
  "analysis": { /* BlueprintAnalysis object from /analyze */ }
}
```

**Response** (success):
```json
{
  "takeoff": {
    "id": "clu456...",
    "projectId": "proj123...",
    "blueprintId": "clu123...",
    "status": "NEEDS_REVIEW",
    "confidence": 0.87,
    "itemCount": 24,
    "matchedCount": 22,
    "createdAt": "2026-03-29T15:35:00Z"
  },
  "items": [
    {
      "id": "toi123...",
      "takeoffId": "clu456...",
      "category": "Interior Door",
      "description": "2068 Pre-Hung interior door (36W)",
      "location": "Master Bedroom",
      "quantity": 1,
      "productId": "prod789...",
      "product": {
        "id": "prod789...",
        "name": "2068 2-Panel Shaker SC RH Pre-Hung 4-9/16 Jamb",
        "basePrice": 189.99
      },
      "confidence": 0.7,
      "aiNotes": "Matched to catalog product"
    },
    // ... more items
  ],
  "analysisUsed": {
    "totalDoors": 18,
    "totalWindows": 12,
    "totalClosets": 6,
    "estimatedTrimLF": 480,
    "floorPlanSqFt": 3200
  }
}
```

### GET `/api/projects/[id]/blueprints`

**Auth**: Builder (getSession)

**Response**:
```json
{
  "blueprints": [
    {
      "id": "clu123...",
      "fileName": "Floor Plan.pdf",
      "fileSize": 2048576,
      "fileType": "pdf",
      "uploadedAt": "2026-03-29T15:00:00Z",
      "processedAt": "2026-03-29T15:05:00Z",
      "status": "READY"
    }
  ],
  "count": 1
}
```

### POST `/api/projects/[id]/blueprints`

**Auth**: Builder (getSession)

**Request**: FormData with:
- `file` (File): Blueprint image/PDF
- `notes` (string, optional): Project notes

**Response**:
```json
{
  "blueprint": {
    "id": "clu123...",
    "fileName": "Floor Plan.pdf",
    "fileSize": 2048576,
    "fileType": "pdf",
    "uploadedAt": "2026-03-29T15:00:00Z",
    "status": "UPLOADED"
  }
}
```

## Database Schema

### Blueprint Model
```prisma
model Blueprint {
  id                String   @id @default(cuid())
  projectId         String
  project           Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)

  fileName          String
  fileUrl           String
  fileSize          Int
  fileType          String   // pdf, png, jpg, dwg
  pageCount         Int?

  // AI processing
  processedAt       DateTime?
  processingStatus  ProcessingStatus @default(PENDING)

  takeoffs          Takeoff[]

  createdAt         DateTime @default(now())

  @@index([projectId])
}

enum ProcessingStatus {
  PENDING
  PROCESSING
  COMPLETE
  FAILED
}
```

### Takeoff Model
```prisma
model Takeoff {
  id                String   @id @default(cuid())
  projectId         String
  project           Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  blueprintId       String
  blueprint         Blueprint @relation(fields: [blueprintId], references: [id], onDelete: Cascade)

  status            TakeoffStatus @default(PROCESSING)
  confidence        Float?        // 0-1 overall confidence score

  // AI results
  rawResult         Json?         // Full AI response
  reviewedBy        String?       // Admin who reviewed
  reviewedAt        DateTime?

  items             TakeoffItem[]
  quote             Quote?

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([projectId])
}

enum TakeoffStatus {
  PROCESSING
  NEEDS_REVIEW
  APPROVED
  REJECTED
}
```

### TakeoffItem Model
```prisma
model TakeoffItem {
  id                String   @id @default(cuid())
  takeoffId         String
  takeoff           Takeoff  @relation(fields: [takeoffId], references: [id], onDelete: Cascade)

  // What was detected
  category          String       // Interior Door, Exterior Door, Trim, Hardware, etc.
  description       String       // "2068 2-Panel Shaker Hollow Core LH"
  location          String?      // "Master Bedroom", "Hallway", etc.
  quantity          Int

  // Matched product
  productId         String?
  product           Product?     @relation(fields: [productId], references: [id], onDelete: SetNull)

  // AI confidence
  confidence        Float?       // 0-1 per-item confidence
  aiNotes           String?      // AI reasoning

  // Human overrides
  overridden        Boolean      @default(false)
  originalDesc      String?      // What AI originally detected

  createdAt         DateTime     @default(now())

  @@index([takeoffId])
}
```

## Configuration

### Environment Variables

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-v4...

# Optional (for file storage)
AWS_S3_BUCKET=abel-lumber-blueprints
AWS_REGION=us-east-1
```

### API Model

Currently using: `claude-sonnet-4-20250514`

To change model, edit `src/lib/blueprint-ai.ts`:
```typescript
model: 'claude-opus-4-1-20250805', // or another Anthropic model
```

## Performance Considerations

### Analysis Time
- **Typical**: 30-60 seconds for a single-page blueprint
- **Multi-page PDFs**: ~30 seconds per page (parallel processing recommended)
- **Timeout**: 60 seconds per request

### Costs
- **Claude Vision**: Charged per 1,000 tokens (images and text)
- **Typical blueprint**: ~4,000-8,000 tokens
- **Estimated cost per analysis**: $0.02-0.04

### Scaling

For high-volume operations:
1. Implement async job queue (e.g., Bull, RQ)
2. Process multiple blueprints in parallel
3. Cache common product matches
4. Batch product lookups

Example queue implementation:
```typescript
// POST /api/ops/blueprints/analyze - enqueue job
const job = await blueprintQueue.add({
  blueprintId,
  imageBase64,
  mediaType,
})

// Background worker
blueprintQueue.process(async (job) => {
  const result = await analyzeBlueprint(...)
  await updateBlueprintWithAnalysis(result)
})
```

## Accuracy & Confidence

### Factors Affecting Confidence

**High Confidence (>80%)**:
- Clear floor plan with labeled rooms
- Visible door/window dimensions
- Good image quality
- Standard layout

**Medium Confidence (50-80%)**:
- Partially labeled rooms
- Some unclear dimensions
- Moderate image quality
- Mixed room types

**Low Confidence (<50%)**:
- Poor image quality
- Unlabeled or ambiguous rooms
- Missing dimensions
- Complex/unusual layouts
- Very small/large floor plan

### Improving Results

1. **Image Quality**: Use high-res PDF or scanned plans (>200dpi)
2. **Labels**: Ensure all rooms are labeled with dimensions
3. **Scale**: Mark scale on plan if not standard
4. **Clarity**: Use clear line work (avoid faded PDFs)

## Limitations & Future Enhancements

### Current Limitations
- Single-image analysis (multi-page PDFs analyzed page-by-page)
- No 3D model support (floor plans only)
- Limited to residential layouts
- No structural analysis (walls, load-bearing, etc.)
- Hardware estimates are conservative

### Planned Enhancements
1. **Multi-page PDF processing**: Batch process all pages in one request
2. **Elevation drawings**: Analyze exterior elevations for siding, roofing
3. **Detail sheets**: Extract specific product codes if visible
4. **Builder feedback loop**: Learn from corrections to improve confidence
5. **Specification matching**: Match to builder's preferred products/brands
6. **Cost estimation**: Integrate with pricing engine for instant quotes
7. **Compliance checking**: Flag code requirements (egress, accessibility, etc.)

## Troubleshooting

### Common Issues

**"Claude API returned 401"**
- Check `ANTHROPIC_API_KEY` is set and valid
- Verify key has vision capability enabled

**"No text response from Claude"**
- Ensure image is valid (not corrupted)
- Try re-uploading
- Check image dimensions (min 50x50, max 20000x20000)

**"Could not find JSON in Claude response"**
- Claude returned non-JSON text
- May indicate API overload or response truncation
- Increase max_tokens if needed

**Low confidence scores**
- Image quality is poor (try higher resolution)
- Room labels are unclear
- Floor plan dimensions not visible
- Consider manual entry for critical items

**Product match failures**
- Check product catalog is populated
- Verify category names match (case-sensitive)
- Add more products to catalog
- Refine matching logic in `findProductMatches()`

## Testing

### Manual Testing

```bash
# Test blueprint analysis
curl -X POST http://localhost:3000/api/ops/blueprints/analyze \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <staff-token>" \
  -d '{
    "imageBase64": "iVBORw0KGg...",
    "mediaType": "image/png"
  }'

# Test takeoff generation
curl -X POST http://localhost:3000/api/ops/blueprints/generate-takeoff \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <staff-token>" \
  -d '{
    "blueprintId": "clu123...",
    "analysis": { /* analysis from /analyze */ }
  }'
```

### Unit Tests

Example test structure:
```typescript
describe('Blueprint AI', () => {
  it('should analyze a sample blueprint', async () => {
    const result = await analyzeBlueprint({
      type: 'url',
      url: 'https://example.com/sample-blueprint.png'
    })
    expect(result.analysis.summary.totalDoors).toBeGreaterThan(0)
    expect(result.analysis.confidence).toBeGreaterThan(50)
  })

  it('should match products from analysis', async () => {
    const items = await findProductMatches('Interior Door', '2068 door')
    expect(items.length).toBeGreaterThan(0)
  })
})
```

## Security & Privacy

- **File Storage**: Blueprints stored securely (encrypted at rest)
- **API Keys**: ANTHROPIC_API_KEY never exposed to client
- **Auth**: All endpoints require staff or builder authentication
- **Data Handling**: Claude Vision API does not retain images (per Anthropic ToS)
- **PII Protection**: No builder contact info sent to Claude

## Support & Maintenance

### Monitoring
- Log all API calls to Claude Vision
- Track confidence scores and accuracy over time
- Monitor for API errors/timeouts
- Alert on low success rates

### Maintenance Schedule
- Weekly: Check API error logs, high-fail patterns
- Monthly: Review confidence scores, refine prompts if needed
- Quarterly: Audit product catalog for updates, new categories
- Annually: Benchmark against new Claude models, evaluate upgrading

## References

- [Anthropic Claude API Documentation](https://docs.anthropic.com/claude/reference)
- [Claude Vision Capability](https://docs.anthropic.com/claude/reference/vision)
- [Message API](https://docs.anthropic.com/claude/reference/messages_post)
- [Model List](https://docs.anthropic.com/claude/reference/models_list)
