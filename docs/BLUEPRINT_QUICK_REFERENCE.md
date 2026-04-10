# Blueprint AI System — Quick Reference

## 🚀 Quick Start

### Setup (5 minutes)
```bash
# 1. Ensure ANTHROPIC_API_KEY is set
echo $ANTHROPIC_API_KEY  # Should show your key

# 2. Run database migrations
npx prisma migrate deploy

# 3. Test it
npm run dev
open http://localhost:3000/ops/blueprints/analyze
```

### Usage Flow

**For Staff**:
```
1. Go to /ops/blueprints/analyze
2. Upload floor plan (PNG/JPG/PDF)
3. Wait 30-60 seconds for analysis
4. Review confidence & details
5. Click "Generate Takeoff"
6. Go to /ops/takeoff-review/[id] to edit
7. Approve & create quote
```

**For Builders**:
```
1. Go to /projects/[id]/upload-plans
2. Drag-drop floor plan(s)
3. Add optional notes
4. Wait for "Takeoff Ready" status
5. Staff generates quote
6. Approve & order
```

## 📁 Files & Paths

| File | Purpose | Location |
|------|---------|----------|
| Blueprint AI Library | Claude Vision integration | `src/lib/blueprint-ai.ts` |
| Analyze API | Process floor plan | `src/app/api/ops/blueprints/analyze/route.ts` |
| Takeoff API | Generate line items | `src/app/api/ops/blueprints/generate-takeoff/route.ts` |
| Blueprint API | Upload management | `src/app/api/projects/[id]/blueprints/route.ts` |
| Analysis UI | Staff interface | `src/app/ops/blueprints/analyze/page.tsx` |
| Upload UI | Builder interface | `src/app/projects/[id]/upload-plans/page.tsx` |

## 🔌 API Endpoints

### POST `/api/ops/blueprints/analyze`
```json
Request:
{
  "imageBase64": "iVBORw0KGgo...",
  "mediaType": "image/png"
}
OR
{
  "blueprintId": "clu_abc123"
}

Response:
{
  "analysis": {
    "rooms": [{...}],
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
    "notes": ["..."]
  }
}
```

### POST `/api/ops/blueprints/generate-takeoff`
```json
Request:
{
  "blueprintId": "clu_abc123",
  "analysis": { /* from /analyze */ }
}

Response:
{
  "takeoff": {
    "id": "to_xyz789",
    "status": "NEEDS_REVIEW",
    "confidence": 0.87,
    "itemCount": 24,
    "matchedCount": 22
  },
  "items": [{...}]
}
```

### GET/POST `/api/projects/[id]/blueprints`
```bash
# List blueprints
curl https://api.example.com/api/projects/proj_123/blueprints

# Upload blueprint
curl -F "file=@plan.pdf" \
     -F "notes=4bed 3bath" \
     https://api.example.com/api/projects/proj_123/blueprints
```

## 🧠 Claude Vision Prompt

The system uses this instruction to analyze blueprints:
- Count doors by type
- Count windows
- Identify rooms and sizes
- List closets
- Estimate trim/molding linear feet
- Estimate hardware needs
- Return JSON with high accuracy

**To customize**: Edit SYSTEM_PROMPT in `src/lib/blueprint-ai.ts`

## 📊 Data Models

```typescript
interface BlueprintAnalysis {
  rooms: Array<{
    name: string
    type: string
    estimatedSqFt: number
    doors: Array<{ type: string; width: string; quantity: number }>
    windows: Array<{ type: string; quantity: number }>
    closets: Array<{ type: string; width: string }>
  }>
  summary: {
    totalDoors: number
    totalWindows: number
    totalClosets: number
    estimatedTrimLF: number
    floorPlanSqFt: number
    stories: number
    bedrooms: number
    bathrooms: number
  }
  confidence: number // 0-100
  notes: string[]
}
```

## 🎨 UI Styling

- **Brand Colors**: #1B4F72 (navy), #E67E22 (orange)
- **Confidence Colors**:
  - Green (≥80%): `text-green-600 bg-green-50`
  - Yellow (50-80%): `text-amber-600 bg-amber-50`
  - Red (<50%): `text-red-600 bg-red-50`
- **Framework**: Tailwind CSS (existing setup)

## 🔐 Auth

```typescript
// Staff endpoints
const authError = checkStaffAuth(request)  // src/lib/api-auth.ts

// Builder endpoints
const session = await getSession()  // src/lib/auth.ts
```

Both already implemented. No auth code needed.

## 📈 Performance Tips

| Task | Time | Notes |
|------|------|-------|
| Analyze blueprint | 30-60s | Claude Vision API |
| Generate takeoff | 2-5s | Product matching |
| Match products | <1s | Database query |
| Upload file | <5s | File handling |

**Cost**: ~$0.02-0.04 per analysis

## 🛠️ Customization Recipes

### Change Analysis Model
```typescript
// In src/lib/blueprint-ai.ts
model: 'claude-opus-4-1-20250805'  // Any Anthropic model
```

### Adjust Product Matching
```typescript
// In generate-takeoff/route.ts
const categoryMap: Record<string, string[]> = {
  'Interior Door': ['Your categories here'],
  // ...
}
```

### Add Builder Pricing
```typescript
const builderPricing = await prisma.builderPricing.findFirst({
  where: {
    builderId: project.builderId,
    productId: product.id,
  },
})
const unitPrice = builderPricing?.customPrice || product.basePrice
```

### Extend Hardware Estimation
```typescript
// Add locks for exterior doors
items.push({
  category: 'Hardware',
  description: 'Entry door locks',
  quantity: exteriorDoorCount,
  unit: 'ea',
})
```

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| "API returned 401" | Check ANTHROPIC_API_KEY |
| "No text response" | Verify image is valid |
| "No JSON in response" | Image might be corrupted |
| Low confidence scores | Upload higher-res image |
| No product matches | Check Product.category names |
| File upload fails | File >50MB or wrong type |

## 📚 Documentation

| File | Content |
|------|---------|
| `BLUEPRINT_AI_SYSTEM.md` | Complete technical docs |
| `BLUEPRINT_INTEGRATION_GUIDE.md` | Integration & customization |
| `BLUEPRINT_QUICK_REFERENCE.md` | This file |

## 🔄 Workflow Diagram

```
Builder                           Staff                      System
  │                                 │                            │
  ├─ Upload blueprint ──────────────┤                            │
  │                                 │                            │
  │                              Click                           │
  │                             "Analyze"                        │
  │                                 ├─ POST /analyze ────────────┤
  │                                 │                            ├─ Claude Vision
  │                                 │                     Process (30-60s)
  │                                 │                            │
  │                                 │◄─ Analysis result ─────────┤
  │                                 │                            │
  │                              Review                         │
  │                             Results                         │
  │                                 │                            │
  │                              Click                          │
  │                            "Generate"                       │
  │                                 ├─ POST /generate-takeoff ──┤
  │                                 │                            ├─ Match products
  │                                 │                     Create takeoff (2-5s)
  │                                 │                            │
  │                                 │◄─ Takeoff created ────────┤
  │                                 │                            │
  │                              Edit &                         │
  │                              Approve                        │
  │                                 │                            │
  │                              Create                         │
  │                              Quote                          │
  │                                 │                            │
  │◄─ Quote ready ──────────────────┤                           │
  │                                 │                            │
  ├─ Approve quote ──────────────────┤                           │
  │                                 │                            │
  │◄─ Order created ──────────────────┤                          │
```

## 📱 Mobile & Responsive

All pages are responsive using Tailwind:
- Mobile-first design
- Works on tablet/desktop
- Touch-friendly file upload
- Optimized forms

## 🚢 Deployment

```bash
# 1. Set ANTHROPIC_API_KEY in production
export ANTHROPIC_API_KEY=sk-ant-v4-...

# 2. Run migrations
npx prisma migrate deploy

# 3. Build and start
npm run build
npm run start
```

## 💡 Pro Tips

1. **Confidence Threshold**: Consider <60% as needing manual verification
2. **Batch Processing**: Use job queue for 50+ blueprints/day
3. **Caching**: Cache product catalog to reduce DB queries
4. **Monitoring**: Log confidence scores to track accuracy
5. **Feedback Loop**: Track manual corrections to refine prompt

## 📞 Support

- **Docs**: See BLUEPRINT_AI_SYSTEM.md
- **Integration**: See BLUEPRINT_INTEGRATION_GUIDE.md
- **Issues**: Check Troubleshooting section above
- **Claude API**: https://docs.anthropic.com/claude

---

**Last Updated**: 2026-03-29
**Status**: Production Ready ✅
