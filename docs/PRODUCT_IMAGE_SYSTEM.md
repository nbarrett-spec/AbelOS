# Product Image Management System

A comprehensive image management system for Abel Lumber's builder platform, enabling smart placeholder generation and bulk image assignment for products across all categories.

## Overview

The system provides three main components:

1. **Image Utility Library** - Smart placeholder generation based on product category
2. **REST API** - Backend endpoints for product data and image management
3. **Management UI** - Interactive interface for viewing and assigning product images

## Files Created

### 1. `/src/lib/product-images.ts`

Core utility library for product image management.

**Key Exports:**

- `getDefaultProductImage(category, subcategory)` - Returns professional SVG placeholder based on category
- `getProductImageUrl(product)` - Returns product image URL or smart placeholder
- `isUsingPlaceholder(product)` - Checks if product uses a placeholder
- `CATEGORY_PLACEHOLDER_COLORS` - Color mapping for visual consistency
- `PRODUCT_CATEGORIES` - Available product categories
- `SUBCATEGORIES_BY_CATEGORY` - Subcategory organization

**Features:**

- Generates inline SVG placeholders for each category type
- Uses Abel brand colors (navy #1B4F72, orange #E67E22, green #27AE60)
- SVG types:
  - **Doors** - Door panel outline with handle indicator
  - **Hardware** - Lever handle shape
  - **Trim** - Horizontal profile lines
  - **Closet Components** - Shelving with vertical supports
  - **Specialty** - Generic item shape

### 2. `/src/app/api/ops/products/route.ts`

Main products API endpoint.

**GET** - List products with filtering
- Query parameters:
  - `skip` (default: 0) - Pagination offset
  - `take` (default: 50) - Items per page
  - `category` - Filter by category
  - `search` - Search by name/SKU/description
  - `imageStatus` - Filter by 'has-image' or 'needs-image'

- Response:
  ```json
  {
    "products": [...],
    "pagination": { "skip": 0, "take": 50, "total": 500 },
    "stats": {
      "total": 500,
      "withImages": 245,
      "needingImages": 255,
      "byCategory": {
        "Interior Door": { "total": 150, "withImages": 100, "needingImages": 50 },
        ...
      }
    }
  }
  ```

### 3. `/src/app/api/ops/products/images/route.ts`

Image management API endpoint.

**GET** - Retrieve products grouped by category
- Query parameters:
  - `category` - Filter by specific category
  - `skip`, `take` - Pagination

- Response includes image status indicators (`hasImage` boolean)

**PATCH** - Bulk update product images
- Request body:
  ```json
  {
    "updates": [
      {
        "productId": "prod_123",
        "imageUrl": "https://...",
        "thumbnailUrl": "https://... (optional)",
        "imageAlt": "Description (optional)"
      }
    ]
  }
  ```

- Response includes count of successful updates and any errors

### 4. `/src/app/ops/products/page.tsx`

Interactive product image management UI.

**Features:**

- **Stats Dashboard** - Shows total products, with images, needing images, coverage %
- **Advanced Filtering**
  - Search by name or SKU
  - Filter by category
  - Filter by image status (all/has/needs)
  - View mode toggle (grid/list)

- **Grid View** - Card-based product display
  - Product image/placeholder
  - Status indicator (green = image, orange = placeholder)
  - SKU, name, category badges, price
  - Stock status

- **List View** - Table format
  - All product details in tabular layout
  - Quick image status badges
  - Edit action buttons

- **Detail Modal** - Edit individual product images
  - Current image preview
  - Product information display
  - Image URL input field
  - Thumbnail URL input (optional)
  - Alt text input (optional)
  - Save button with validation

- **Pagination** - Navigate through product results

**Styling:**

- Professional CSS with Abel brand colors
- Responsive design (mobile, tablet, desktop)
- Smooth animations and transitions
- Status indicators and visual feedback
- Accessible form controls

### 5. `/src/app/ops/products/products.css`

Comprehensive styling for the product management UI.

**Design System:**

- Brand color variables (navy, orange, green, etc.)
- Grid-based layout system
- Responsive breakpoints (768px, 480px)
- Shadow and border utilities
- Transition and animation effects

## Usage Guide

### Adding Product Images via UI

1. Navigate to `/ops/products`
2. Use filters to find products needing images
3. Click a product card to open the detail modal
4. Paste the image URL (and optional thumbnail/alt text)
5. Click "Save Image"
6. System updates product database and refreshes list

### Bulk Image Assignment

1. Use the API endpoint `/api/ops/products/images` with PATCH method
2. Send array of updates with product IDs and image URLs
3. System validates and updates all products
4. Returns success count and any errors

### Smart Placeholders

Products without assigned images automatically display:
- Category-specific SVG illustrations
- Brand-appropriate colors
- Professional appearance
- Accessibility alt text

## Integration Points

### Database (Prisma)

Uses existing Product model with these fields:
- `imageUrl` - Primary product image
- `thumbnailUrl` - Thumbnail for lists
- `imageAlt` - Accessibility text
- `category` - Product category
- `subcategory` - Product subcategory

### Authentication

All API endpoints require active session (via `getSession()`)

### Error Handling

- 401 - Unauthorized (no session)
- 400 - Bad request (invalid input)
- 404 - Product not found
- 500 - Server error with logging

## Performance Considerations

- Pagination limits initial load to 50 products
- Grouped category views reduce API calls
- SVG placeholders are lightweight and generated on-demand
- Modal components only render when needed
- Efficient Prisma queries with specific field selection

## Future Enhancements

- Integration with image CDN for optimization
- Batch image upload from supplier files
- AI-powered image recommendations
- Image crop/edit tools
- Asset library management
- Integration with web scraping for auto-discovery

## Support for Categories

The system is pre-configured for Abel Lumber's product categories:

- **Interior Door** - Doors for interior use (Pre-Hung, Slab, Bifold, French, Attic Access, Fire-Rated)
- **Exterior Door** - Weather-resistant doors (Pre-Hung, Slab, Sliding/Patio, Fire-Rated)
- **Hardware** - Door and cabinet hardware (Lever, Deadbolt, Hinge, Door Stop, Bifold Kit)
- **Trim** - Decorative molding (Base, Casing, Crown, Shoe, Chair Rail)
- **Window Trim** - Window-specific trim (Casing, Apron, Stool, Sill)
- **Closet Component** - Closet organizers (Shelving, Hanging Rod, Bracket, Track)
- **Specialty** - Specialty items (Acoustic Panel, Specialty Millwork)
- **Miscellaneous** - Uncategorized items

Each category has color-coded placeholders and is supported by the UI filters and API.
