# Product Image Management System - Integration Guide

## Quick Start

### Step 1: Access the UI

Navigate to your local development server at `/ops/products`

### Step 2: View Dashboard

The page loads with:
- **Stats Dashboard** showing product image coverage
- **Filtering Controls** to find products
- **Grid or List View** of all products
- **Pagination** for managing large catalogs

### Step 3: Assign Images

#### Option A: Single Product (UI)
1. Click any product card
2. Paste image URL into the input field
3. (Optional) Add thumbnail URL and alt text
4. Click "Save Image"

#### Option B: Bulk Update (API)
```bash
curl -X PATCH http://localhost:3000/api/ops/products/images \
  -H "Content-Type: application/json" \
  -d '{
    "updates": [
      {
        "productId": "prod_123",
        "imageUrl": "https://supplier.com/door1.jpg",
        "thumbnailUrl": "https://supplier.com/door1_thumb.jpg",
        "imageAlt": "Interior 6-Panel White Primed Door"
      },
      {
        "productId": "prod_124",
        "imageUrl": "https://supplier.com/door2.jpg"
      }
    ]
  }'
```

## API Endpoints

### GET /api/ops/products

Retrieve products with filtering and stats.

**Query Parameters:**
- `skip` - Pagination offset (default: 0)
- `take` - Items per page (default: 50)
- `category` - Filter by category
- `search` - Search products
- `imageStatus` - 'has-image' or 'needs-image'

**Example:**
```bash
# Get products needing images
curl "http://localhost:3000/api/ops/products?imageStatus=needs-image&take=100"

# Filter by category
curl "http://localhost:3000/api/ops/products?category=Hardware&take=50"

# Search products
curl "http://localhost:3000/api/ops/products?search=door&category=Interior"
```

**Response:**
```json
{
  "products": [
    {
      "id": "prod_123",
      "sku": "DOR-001",
      "name": "6-Panel Interior Door",
      "category": "Interior Door",
      "subcategory": "Pre-Hung",
      "basePrice": 89.99,
      "imageUrl": null,
      "inStock": true
    }
  ],
  "pagination": {
    "skip": 0,
    "take": 50,
    "total": 500
  },
  "stats": {
    "total": 500,
    "withImages": 245,
    "needingImages": 255,
    "byCategory": {
      "Interior Door": {
        "total": 150,
        "withImages": 100,
        "needingImages": 50
      }
    }
  }
}
```

### GET /api/ops/products/images

Retrieve products grouped by category with image status.

**Query Parameters:**
- `category` - Filter by specific category
- `skip`, `take` - Pagination

**Example:**
```bash
curl "http://localhost:3000/api/ops/products/images?category=Hardware"
```

**Response:**
```json
{
  "products": {
    "Hardware": [
      {
        "id": "hw_001",
        "sku": "HW-LEVER-01",
        "name": "Brushed Nickel Lever Handle",
        "imageUrl": "https://...",
        "hasImage": true
      }
    ],
    "Interior Door": [...]
  },
  "pagination": {
    "skip": 0,
    "take": 100,
    "total": 250
  },
  "stats": {
    "total": 250,
    "withImages": 180,
    "needingImages": 70
  }
}
```

### PATCH /api/ops/products/images

Bulk update product images.

**Request Body:**
```json
{
  "updates": [
    {
      "productId": "prod_123",
      "imageUrl": "https://example.com/image.jpg",
      "thumbnailUrl": "https://example.com/thumb.jpg",
      "imageAlt": "Product description"
    }
  ]
}
```

**Response:**
```json
{
  "updated": 3,
  "failed": 0,
  "results": [
    {
      "id": "prod_123",
      "sku": "DOR-001",
      "name": "Interior Door",
      "imageUrl": "https://example.com/image.jpg",
      "thumbnailUrl": "https://example.com/thumb.jpg",
      "imageAlt": "Product description"
    }
  ]
}
```

## Smart Placeholders

The system automatically generates professional SVG placeholders when no image is assigned.

### Placeholder Types

**Interior/Exterior Doors**
- Door panel outline with handle indicator
- Category-specific colors

**Hardware**
- Lever handle shape with mounting detail
- Professional metallic styling

**Trim**
- Horizontal profile lines
- Shows trim style variations

**Closet Components**
- Shelving units with vertical supports
- Storage organization visualization

**Specialty Items**
- Generic item shape with details
- Flexible for various product types

### Using in Code

```typescript
import { getProductImageUrl, isUsingPlaceholder } from '@/lib/product-images'

// Get appropriate image (URL or placeholder)
const imageUrl = getProductImageUrl({
  imageUrl: product.imageUrl,
  category: product.category,
  subcategory: product.subcategory
})

// Check if using placeholder
const usePlaceholder = isUsingPlaceholder({
  imageUrl: product.imageUrl,
  category: product.category,
  subcategory: product.subcategory
})
```

## Categories Supported

| Category | Subcategories | Color |
|----------|---|---|
| Interior Door | Pre-Hung, Slab, Bifold, French, Attic Access, Fire-Rated | Navy |
| Exterior Door | Pre-Hung, Slab, Sliding/Patio, Fire-Rated | Orange |
| Hardware | Lever, Deadbolt, Hinge, Door Stop, Bifold Kit, Latch, Handle | Dark Gray |
| Trim | Base, Casing, Crown, Shoe, Chair Rail | Orange |
| Window Trim | Casing, Apron, Stool, Sill | Navy |
| Closet Component | Shelving, Hanging Rod, Bracket, Track, Sliding Door | Green |
| Specialty | Acoustic Panel, Specialty Millwork | Dark Gray |
| Miscellaneous | (none) | Light Gray |

## Workflow Examples

### Scenario 1: Add Images from Excel Supplier File

1. Export supplier product data with image URLs to CSV
2. Use PATCH endpoint to bulk upload:
   ```bash
   # Parse CSV and generate JSON payload
   cat supplier_images.csv | process_to_json.sh | curl -X PATCH /api/ops/products/images
   ```
3. Monitor stats dashboard for coverage improvement

### Scenario 2: Find and Assign Missing Images

1. Filter UI to show "Needs Image" products
2. Sort by category
3. Manually paste URLs for each product
4. System validates and saves immediately

### Scenario 3: Web Search Integration

1. Get product SKU and name from UI
2. Search supplier website for images
3. Copy URL and paste into modal
4. Save and move to next product

### Scenario 4: Batch Update from CDN

1. Upload images to your CDN
2. Prepare JSON payload with CDN URLs
3. Send PATCH request with all updates
4. Verify success in response

## Performance Tips

### For Large Product Catalogs
- Use pagination with `take=100` for API calls
- Filter by category to reduce result sets
- Use `imageStatus` filter to focus on products needing work

### For Bulk Uploads
- Send updates in batches of 100-500 products
- Monitor server response times
- Handle partial failures gracefully

### For UI Performance
- Collapse the stats bar on mobile devices
- Lazy-load product images
- Cache placeholder SVGs in browser

## Troubleshooting

### Images Not Showing
- Check image URL is accessible and public
- Verify URL includes full protocol (http:// or https://)
- Check browser console for CORS errors
- Ensure product has active status

### Bulk Upload Fails
- Verify all product IDs exist in database
- Check image URLs are valid
- Review error response for specific failures
- Try smaller batch sizes

### Placeholder Not Displaying
- Clear browser cache
- Verify category name matches exactly
- Check browser console for SVG encoding errors
- Ensure JavaScript is enabled

### Performance Issues
- Reduce pagination limit temporarily
- Clear database of duplicate products
- Index category field in database
- Monitor API response times

## Customization

### Changing Brand Colors

Edit `CATEGORY_PLACEHOLDER_COLORS` in `/src/lib/product-images.ts`:

```typescript
export const CATEGORY_PLACEHOLDER_COLORS: Record<string, string> = {
  'Interior Door': '#YOUR_COLOR',
  'Exterior Door': '#YOUR_COLOR',
  // ... etc
}
```

### Adding New Categories

1. Add category to `PRODUCT_CATEGORIES` constant
2. Add color mapping in `CATEGORY_PLACEHOLDER_COLORS`
3. Add subcategories to `SUBCATEGORIES_BY_CATEGORY`
4. Create placeholder function if needed

### Custom Placeholder SVGs

Modify SVG generation functions in `product-images.ts`:
- `createDoorPlaceholder()`
- `createHardwarePlaceholder()`
- `createTrimPlaceholder()`
- `createClosetPlaceholder()`
- `createSpecialtyPlaceholder()`

## Database Requirements

Ensure your Product model includes:
```prisma
model Product {
  // ... existing fields
  imageUrl      String?     // Primary product image URL
  thumbnailUrl  String?     // Thumbnail for lists
  imageAlt      String?     // Accessibility text
  category      String      // Product category
  subcategory   String?     // Product subcategory
}
```

The system requires these fields but handles null values gracefully.

## Security Considerations

- All endpoints require authentication (via session)
- URLs are stored as-is; validate external sources
- No file uploads to avoid server storage issues
- External image hosting recommended for security

## Next Steps

1. **Test the UI** - Navigate to `/ops/products` and explore
2. **Try bulk API** - Use PATCH endpoint with test data
3. **Connect suppliers** - Set up image URLs from vendors
4. **Monitor coverage** - Track image assignment progress
5. **Integrate workflow** - Add to product intake pipeline

## Support

For issues or questions:
- Review the PRODUCT_IMAGE_SYSTEM.md documentation
- Check API response error messages
- Monitor browser console for client errors
- Review server logs for API errors
