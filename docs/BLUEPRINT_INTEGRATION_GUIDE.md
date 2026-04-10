# Blueprint AI System — Integration Guide

## Quick Start

### 1. Verify Environment

Ensure `ANTHROPIC_API_KEY` is set in your `.env.local`:

```bash
ANTHROPIC_API_KEY=sk-ant-v4-YOUR_KEY_HERE
```

### 2. Database Setup

The schema includes Blueprint, Takeoff, and TakeoffItem models. Run migrations:

```bash
npx prisma migrate deploy
```

If new migration needed:
```bash
npx prisma migrate dev --name add_blueprint_ai
```

### 3. Test the System

#### Option A: Test via UI

1. **Staff**: Navigate to `/ops/blueprints/analyze`
2. **Upload**: Drag-drop a floor plan (PNG, JPG, or PDF)
3. **Analyze**: Click "Analyze Blueprint" button
4. **Review**: Check confidence score and room details
5. **Generate**: Click "Generate Takeoff"
6. **Review Takeoff**: Go to `/ops/takeoff-review/[id]` to edit line items

#### Option B: Test via API

```bash
# 1. Analyze blueprint (replace with real base64 image)
curl -X POST http://localhost:3000/api/ops/blueprints/analyze \
  -H "Content-Type: application/json" \
  -H "Cookie: staff_session=YOUR_SESSION_TOKEN" \
  -d '{
    "imageBase64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "mediaType": "image/png"
  }'

# 2. Generate takeoff (use analysis from step 1)
curl -X POST http://localhost:3000/api/ops/blueprints/generate-takeoff \
  -H "Content-Type: application/json" \
  -H "Cookie: staff_session=YOUR_SESSION_TOKEN" \
  -d '{
    "blueprintId": "clu_test123",
    "analysis": {
      "rooms": [...],
      "summary": {...},
      "confidence": 85,
      "notes": []
    }
  }'
```

## File Structure

### New Files Created

```
src/lib/
├── blueprint-ai.ts                          # Core Vision API integration
    ├── analyzeBlueprint()                   # Main analysis function
    ├── BlueprintAnalysis interface          # Response type
    └── imageToBase64()                      # Image encoding helper

src/app/api/ops/blueprints/
├── analyze/
│   └── route.ts                             # POST /api/ops/blueprints/analyze
├── generate-takeoff/
│   └── route.ts                             # POST /api/ops/blueprints/generate-takeoff
└── [id]/
    └── route.ts                             # GET /api/ops/blueprints/[id] (future)

src/app/api/projects/[id]/blueprints/
└── route.ts                                 # GET/POST builder blueprint management

src/app/ops/blueprints/analyze/
└── page.tsx                                 # Staff analysis UI

src/app/projects/[id]/upload-plans/
└── page.tsx                                 # Builder upload UI

Root/
└── BLUEPRINT_AI_SYSTEM.md                   # Full documentation
```

## Component Integration Points

### 1. Existing Takeoff Review Page

The blueprint system integrates with existing takeoff review:

```typescript
// src/app/ops/takeoff-review/page.tsx (EXISTING)
// Already supports reviewing takeoffs generated from blueprints
// Takeoffs can be marked APPROVED, then turned into Quotes
```

**How it works**:
1. Blueprint → Analysis → Takeoff (status: NEEDS_REVIEW)
2. Staff reviews on takeoff-review page
3. Edit line items, quantities, products
4. Approve (status: APPROVED)
5. Create Quote from approved takeoff

### 2. Builder Project Dashboard

The blueprint upload integrates with projects:

```typescript
// src/app/projects/[id]/page.tsx (EXISTING)
// Should link to /upload-plans for blueprint submission
```

**Suggested addition to project page**:
```tsx
<Link
  href={`/projects/${project.id}/upload-plans`}
  className="btn btn-primary"
>
  Upload Floor Plans
</Link>
```

### 3. Product Catalog

The matching engine queries the Product model:

```typescript
// Uses existing Product model from schema.prisma
// Searches by category and name
// Returns basePrice for quote generation
```

**Ensure products exist**:
- Categories must match: "Interior Door", "Exterior Door", "Trim", "Hardware", "Closet Shelving", etc.
- Each product should have meaningful `category` and optional `subcategory`

## Customization

### 1. Adjust Analysis Prompt

Edit system prompt in `src/lib/blueprint-ai.ts`:

```typescript
const SYSTEM_PROMPT = `
  Your custom instructions here...
`
```

Examples:
- Request specific measurements
- Ask for building code notes
- Specify regional preferences
- Request energy-efficiency notes

### 2. Change Claude Model

In `src/lib/blueprint-ai.ts`:

```typescript
model: 'claude-opus-4-1-20250805', // Change this
```

Current recommendation: `claude-sonnet-4-20250514` (balance of speed/cost/quality)

### 3. Customize Product Matching

In `src/app/api/ops/blueprints/generate-takeoff/route.ts`:

```typescript
const categoryMap: Record<string, string[]> = {
  'Interior Door': ['Interior Door', 'Pre-Hung', 'Slab', 'Bifold'],
  // Add/modify category mappings
}
```

Add logic to prefer builder's custom pricing:

```typescript
// Find builder-specific pricing
const builderPricing = await prisma.builderPricing.findFirst({
  where: {
    builderId: project.builderId,
    productId: matchedProduct.id,
  },
})

const unitPrice = builderPricing?.customPrice || product.basePrice
```

### 4. Extend Hardware Estimation

Currently: Hinges (3/2 doors), Handles (1/door), Door Stops (1/door)

Enhance in `generate-takeoff/route.ts`:

```typescript
// Add locks for exterior doors
const exteriorDoors = ...
items.push({
  category: 'Hardware',
  description: 'Entry door locks (estimated)',
  quantity: exteriorDoors,
  unit: 'ea',
})

// Add bumpers for closet doors
items.push({
  category: 'Hardware',
  description: 'Door bumpers (estimated)',
  quantity: closets,
  unit: 'ea',
})
```

## Database Queries

### Common Queries

```typescript
// Find all pending blueprints
const pending = await prisma.blueprint.findMany({
  where: { processingStatus: 'PENDING' },
  include: { project: true },
})

// Get takeoff with all items
const takeoff = await prisma.takeoff.findUnique({
  where: { id: takeoffId },
  include: {
    blueprint: true,
    items: { include: { product: true } },
  },
})

// Find blueprints by builder
const builderBlueprints = await prisma.blueprint.findMany({
  where: {
    project: { builderId: builderId },
  },
  include: { project: true },
})

// Get analysis results
const rawAnalysis = await prisma.takeoff.findUnique({
  where: { id: takeoffId },
  select: { rawResult: true },
})
```

### Performance Indexes

Already in schema:
- `Blueprint.projectId` — Find blueprints by project
- `Takeoff.projectId` — Find takeoffs by project
- `TakeoffItem.takeoffId` — Find items in takeoff
- `Product.category` — Find products by category

## File Upload & Storage

Currently, blueprint files are stored as data URLs (embedded base64).

**For production**, implement cloud storage:

```typescript
// In POST /api/projects/[id]/blueprints

// Option 1: AWS S3
import AWS from 'aws-sdk'
const s3 = new AWS.S3()
const result = await s3.upload({
  Bucket: process.env.AWS_S3_BUCKET,
  Key: `blueprints/${projectId}/${file.name}`,
  Body: fileBuffer,
}).promise()
const fileUrl = result.Location

// Option 2: Cloudflare R2
import { S3Client } from '@aws-sdk/client-s3'
// ... similar pattern with R2-compatible API

// Option 3: Firebase Storage
import { bucket } from '@/lib/firebase'
const ref = bucket.ref(`blueprints/${projectId}/${file.name}`)
await ref.put(fileBuffer)
const fileUrl = await ref.getDownloadURL()

// Update database
await prisma.blueprint.update({
  where: { id: blueprintId },
  data: { fileUrl },
})
```

## Monitoring & Analytics

### Add Logging

```typescript
// In analyze/route.ts
console.log('Blueprint analysis started', {
  blueprintId,
  fileSize: blueprint.fileSize,
  timestamp: new Date().toISOString(),
})

// In generate-takeoff/route.ts
console.log('Takeoff generated', {
  blueprintId,
  takeoffId: takeoff.id,
  itemCount: takeoffItems.length,
  matchedCount: takeoffItems.filter(i => i.productId).length,
  confidence: body.analysis.confidence,
})
```

### Track Metrics

```typescript
// Create a metrics table (optional)
model BlueprintMetric {
  id            String   @id @default(cuid())
  blueprintId   String
  analysisTime  Int      // milliseconds
  tokenCount    Int      // approximate Claude tokens used
  confidence    Float    // 0-100
  itemCount     Int      // detected items
  matchedCount  Int      // successfully matched products
  cost          Float    // estimated API cost
  createdAt     DateTime @default(now())

  @@index([blueprintId])
  @@index([createdAt])
}
```

## Testing Scenarios

### Test Case 1: Simple Floor Plan
- Upload 1-bedroom apartment plan
- Expect: 3-5 doors, 2-3 windows, 1-2 closets
- Confidence: Should be >80%

### Test Case 2: Complex Multi-Story
- Upload 4-5 bedroom house plan
- Expect: 18-25 doors, 12-16 windows, 6-8 closets
- Confidence: 70-85% (complexity reduces confidence)

### Test Case 3: Poor Quality Image
- Upload low-res/faded blueprint
- Expect: Low confidence (<50%), warnings in notes
- System should still generate takeoff but flag for manual review

### Test Case 4: Unknown Format
- Upload unsupported file type (DWG, SKP, etc.)
- Expect: 400 error, clear message to user

## Troubleshooting Checklist

- [ ] ANTHROPIC_API_KEY is set and valid
- [ ] Claude API account has vision capability enabled
- [ ] Database migrations run successfully
- [ ] Product catalog has items in relevant categories
- [ ] Staff user has appropriate role for /ops routes
- [ ] Builder user authenticated for /projects routes
- [ ] Blueprint files upload correctly
- [ ] Test image from browser shows preview
- [ ] Claude Vision API returns 200 status
- [ ] JSON response parses correctly
- [ ] Takeoff items created in database
- [ ] Product matching returns results

## Next Steps

1. **Production Deployment**
   - Move file storage to cloud (S3, R2, Firebase)
   - Set up monitoring/logging
   - Configure error alerts
   - Load test with multiple concurrent analyses

2. **Feature Expansion**
   - Multi-page PDF support
   - Elevation drawing analysis
   - Batch blueprint processing
   - Builder feedback loop for accuracy improvement

3. **Performance Optimization**
   - Implement job queue for async processing
   - Cache frequently matched products
   - Batch product catalog queries
   - Compress stored analysis JSON

4. **User Experience**
   - Add real-time progress updates (WebSocket)
   - Show Claude token estimates before processing
   - Add batch upload with progress bar
   - Email notifications when ready for review

## Support

For issues or questions:
- Check BLUEPRINT_AI_SYSTEM.md for detailed documentation
- Review error logs in `/ops/blueprints/analyze` page
- Test API endpoints with curl/Postman
- Contact Anthropic support for Claude API issues
