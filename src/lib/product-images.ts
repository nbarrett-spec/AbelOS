/**
 * Product Image Management System
 * Provides default SVG placeholder images and utilities for managing product images
 */

// Abel Brand Colors
const ABEL_NAVY = '#0f2a3e'
const ABEL_ORANGE = '#C6A24E'
const ABEL_GREEN = '#27AE60'
const ABEL_LIGHT_GRAY = '#ECF0F1'
const ABEL_DARK_GRAY = '#404040'

// Category to color mapping for visual consistency
export const CATEGORY_PLACEHOLDER_COLORS: Record<string, string> = {
  'Interior Door': ABEL_NAVY,
  'Exterior Door': ABEL_ORANGE,
  Hardware: ABEL_DARK_GRAY,
  Trim: ABEL_ORANGE,
  'Window Trim': ABEL_NAVY,
  'Closet Component': ABEL_GREEN,
  Specialty: ABEL_DARK_GRAY,
  Miscellaneous: ABEL_LIGHT_GRAY,
}

/**
 * Creates an SVG data URL for a door placeholder
 */
function createDoorPlaceholder(color: string, label: string): string {
  const svg = `
    <svg width="200" height="280" viewBox="0 0 200 280" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="280" fill="${ABEL_LIGHT_GRAY}"/>
      <rect x="20" y="20" width="160" height="240" fill="white" stroke="${color}" stroke-width="2"/>
      <!-- Door panels -->
      <line x1="100" y1="20" x2="100" y2="260" stroke="${color}" stroke-width="1" opacity="0.5"/>
      <circle cx="160" cy="140" r="4" fill="${color}"/>
      <!-- Door handle -->
      <text x="100" y="270" font-size="12" text-anchor="middle" fill="${color}" font-weight="bold">${label}</text>
    </svg>
  `
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

/**
 * Creates an SVG data URL for a hardware placeholder
 */
function createHardwarePlaceholder(color: string, label: string): string {
  const svg = `
    <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="200" fill="${ABEL_LIGHT_GRAY}"/>
      <!-- Hardware item (lever handle) -->
      <ellipse cx="100" cy="80" rx="30" ry="20" fill="${color}"/>
      <rect x="85" y="95" width="30" height="60" fill="${color}" rx="4"/>
      <circle cx="100" cy="165" r="8" fill="${ABEL_DARK_GRAY}"/>
      <text x="100" y="190" font-size="12" text-anchor="middle" fill="${color}" font-weight="bold">${label}</text>
    </svg>
  `
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

/**
 * Creates an SVG data URL for a trim placeholder
 */
function createTrimPlaceholder(color: string, label: string): string {
  const svg = `
    <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="200" fill="${ABEL_LIGHT_GRAY}"/>
      <!-- Trim profile -->
      <rect x="30" y="40" width="140" height="20" fill="${color}"/>
      <rect x="30" y="75" width="140" height="20" fill="${color}"/>
      <rect x="30" y="110" width="140" height="20" fill="${color}"/>
      <rect x="30" y="145" width="140" height="20" fill="${color}"/>
      <text x="100" y="190" font-size="12" text-anchor="middle" fill="${color}" font-weight="bold">${label}</text>
    </svg>
  `
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

/**
 * Creates an SVG data URL for a closet component placeholder
 */
function createClosetPlaceholder(color: string, label: string): string {
  const svg = `
    <svg width="200" height="240" viewBox="0 0 200 240" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="240" fill="${ABEL_LIGHT_GRAY}"/>
      <!-- Shelving -->
      <rect x="25" y="40" width="150" height="15" fill="${color}"/>
      <rect x="25" y="80" width="150" height="15" fill="${color}"/>
      <rect x="25" y="120" width="150" height="15" fill="${color}"/>
      <rect x="25" y="160" width="150" height="15" fill="${color}"/>
      <!-- Vertical supports -->
      <rect x="30" y="30" width="8" height="150" fill="${ABEL_DARK_GRAY}" opacity="0.6"/>
      <rect x="162" y="30" width="8" height="150" fill="${ABEL_DARK_GRAY}" opacity="0.6"/>
      <text x="100" y="230" font-size="12" text-anchor="middle" fill="${color}" font-weight="bold">${label}</text>
    </svg>
  `
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

/**
 * Creates an SVG data URL for a specialty item placeholder
 */
function createSpecialtyPlaceholder(color: string, label: string): string {
  const svg = `
    <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="200" fill="${ABEL_LIGHT_GRAY}"/>
      <!-- Generic item shape -->
      <rect x="40" y="35" width="120" height="130" rx="10" fill="none" stroke="${color}" stroke-width="2"/>
      <circle cx="100" cy="100" r="30" fill="none" stroke="${color}" stroke-width="2" opacity="0.6"/>
      <path d="M 70 70 L 130 130" stroke="${color}" stroke-width="2" opacity="0.4"/>
      <path d="M 130 70 L 70 130" stroke="${color}" stroke-width="2" opacity="0.4"/>
      <text x="100" y="190" font-size="12" text-anchor="middle" fill="${color}" font-weight="bold">${label}</text>
    </svg>
  `
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

/**
 * Get default product image based on category and subcategory
 * Returns an SVG data URL with a professional product illustration
 */
export function getDefaultProductImage(
  category: string,
  subcategory?: string | null
): string {
  const color = CATEGORY_PLACEHOLDER_COLORS[category] || ABEL_DARK_GRAY
  const displayLabel = subcategory || category.split(' ')[0]

  // Door categories
  if (
    category === 'Interior Door' ||
    category === 'Exterior Door'
  ) {
    return createDoorPlaceholder(color, displayLabel)
  }

  // Hardware category
  if (category === 'Hardware') {
    return createHardwarePlaceholder(color, displayLabel)
  }

  // Trim categories
  if (
    category === 'Trim' ||
    category === 'Window Trim'
  ) {
    return createTrimPlaceholder(color, displayLabel)
  }

  // Closet components
  if (category === 'Closet Component') {
    return createClosetPlaceholder(color, displayLabel)
  }

  // Specialty and miscellaneous
  return createSpecialtyPlaceholder(color, displayLabel)
}

/**
 * Product type for type safety
 */
export interface ProductImageData {
  imageUrl?: string | null
  category: string
  subcategory?: string | null
}

/**
 * Get the appropriate product image URL
 * Returns the imageUrl if available, otherwise returns a smart placeholder
 */
export function getProductImageUrl(product: ProductImageData): string {
  if (product.imageUrl) {
    return product.imageUrl
  }
  return getDefaultProductImage(product.category, product.subcategory)
}

/**
 * Check if a product is using a placeholder image
 */
export function isUsingPlaceholder(product: ProductImageData): boolean {
  return !product.imageUrl || product.imageUrl.trim() === ''
}

/**
 * Get product image categories for filtering/organization
 */
export const PRODUCT_CATEGORIES = [
  'Interior Door',
  'Exterior Door',
  'Hardware',
  'Trim',
  'Window Trim',
  'Closet Component',
  'Specialty',
  'Miscellaneous',
] as const

/**
 * Get subcategories by category
 */
export const SUBCATEGORIES_BY_CATEGORY: Record<string, string[]> = {
  'Interior Door': [
    'Pre-Hung',
    'Slab',
    'Bifold',
    'French',
    'Attic Access',
    'Fire-Rated',
  ],
  'Exterior Door': [
    'Pre-Hung',
    'Slab',
    'Sliding/Patio',
    'Fire-Rated',
  ],
  Hardware: [
    'Lever',
    'Deadbolt',
    'Hinge',
    'Door Stop',
    'Bifold Kit',
    'Latch',
    'Handle',
  ],
  Trim: [
    'Base',
    'Casing',
    'Crown',
    'Shoe',
    'Chair Rail',
  ],
  'Window Trim': [
    'Casing',
    'Apron',
    'Stool',
    'Sill',
  ],
  'Closet Component': [
    'Shelving',
    'Hanging Rod',
    'Shelf Bracket',
    'Track',
    'Sliding Door',
  ],
  Specialty: [
    'Acoustic Panel',
    'Specialty Millwork',
  ],
  Miscellaneous: [],
}
