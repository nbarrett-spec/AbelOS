// ──────────────────────────────────────────────────────────────────────────
// Abel Door & Trim — Product Category Taxonomy
// ──────────────────────────────────────────────────────────────────────────
// Consolidated from 133 InFlow raw categories down to clean hierarchy.
// Each product gets a top-level category + subcategory.
// ──────────────────────────────────────────────────────────────────────────

export interface CategoryDef {
  name: string
  description: string
  subcategories: string[]
  icon: string // emoji for UI
  color: string // hex for badges
}

export const PRODUCT_TAXONOMY: CategoryDef[] = [
  {
    name: 'Interior Doors',
    description: 'Pre-hung and slab interior doors for residential builds',
    subcategories: [
      'Hollow Core',
      'Solid Core',
      'Fire Rated',
      'Pocket Doors',
      'French Doors',
      'Barn Doors',
      'Glass Insert',
      'Slab Only',
      'Custom',
    ],
    icon: '🚪',
    color: '#3B82F6',
  },
  {
    name: 'Exterior Doors',
    description: 'Entry, patio, and garage-to-house doors',
    subcategories: [
      'Front Entry',
      'Fiberglass',
      'Patio Doors',
      'Garage to House',
      'French Doors',
      'Slab Only',
      'Custom',
    ],
    icon: '🏠',
    color: '#10B981',
  },
  {
    name: 'Specialty Doors',
    description: 'Attic, dunnage, and commercial doors',
    subcategories: [
      'Attic Doors',
      'Attic Stairs',
      'Dunnage Doors',
      'Commercial',
    ],
    icon: '🔧',
    color: '#F59E0B',
  },
  {
    name: 'Door Frames & Components',
    description: 'Frames, jambs, hinges, hardware, and weatherstripping',
    subcategories: [
      'Interior Frames',
      'Exterior Frames',
      'Hinges & Hardware',
      'Weatherstripping',
      'Thresholds',
      'Door Components',
    ],
    icon: '🔩',
    color: '#8B5CF6',
  },
  {
    name: 'Trim & Moulding',
    description: 'Casing, base, crown, and decorative moulding',
    subcategories: [
      'Casing',
      'Baseboard',
      'Crown Moulding',
      'Chair Rail',
      'Window Trim',
      'Decorative',
    ],
    icon: '📐',
    color: '#EC4899',
  },
  {
    name: 'Glass & Inserts',
    description: 'Door glass, sidelites, transoms, and decorative inserts',
    subcategories: [
      'Door Glass',
      'Sidelites',
      'Transoms',
      'Decorative Inserts',
    ],
    icon: '🪟',
    color: '#06B6D4',
  },
  {
    name: 'Lumber & Sheet Goods',
    description: 'Dimensional lumber, plywood, and engineered wood',
    subcategories: [
      'Dimensional Lumber',
      'Plywood',
      'Cedar Products',
      'Hemlock & LVL Beams',
      'Sheet Goods',
    ],
    icon: '🪵',
    color: '#D97706',
  },
  {
    name: 'Services & Labor',
    description: 'Installation, delivery, and service charges',
    subcategories: [
      'Installation',
      'Delivery',
      'Repairs',
      'Custom Fabrication',
      'Quotes',
    ],
    icon: '🛠️',
    color: '#6B7280',
  },
  {
    name: 'Miscellaneous',
    description: 'Flex items, supplies, and uncategorized products',
    subcategories: [
      'Supplies',
      'Hardware',
      'Flex Items',
      'Other',
    ],
    icon: '📦',
    color: '#9CA3AF',
  },
]

// ──────────────────────────────────────────────────────────────────────────
// Category Mapping — maps raw InFlow categories to clean taxonomy
// ──────────────────────────────────────────────────────────────────────────

export const CATEGORY_MAP: Record<string, { category: string; subcategory: string }> = {
  // Interior Doors — Hollow Core
  'ADT H/C Interior Doors': { category: 'Interior Doors', subcategory: 'Hollow Core' },
  'AGD INTERIOR DOORS': { category: 'Interior Doors', subcategory: 'Hollow Core' },
  'TOLL BROTHERS INTERIOR DOORS': { category: 'Interior Doors', subcategory: 'Hollow Core' },
  'INTERIOR DOOR UNITS': { category: 'Interior Doors', subcategory: 'Hollow Core' },
  'INTERIOR DOOR': { category: 'Interior Doors', subcategory: 'Hollow Core' },

  // Interior Doors — Solid Core
  'ADT S/C Interior Doors': { category: 'Interior Doors', subcategory: 'Solid Core' },

  // Interior Doors — Fire Rated
  '20 MIN FIRE DOOR': { category: 'Interior Doors', subcategory: 'Fire Rated' },

  // Interior Doors — Pocket
  'POCKET DOOR': { category: 'Interior Doors', subcategory: 'Pocket Doors' },

  // Interior Doors — Glass Insert
  '1 Lite': { category: 'Interior Doors', subcategory: 'Glass Insert' },

  // Interior Doors — Slab Only
  'SLAB ONLY': { category: 'Interior Doors', subcategory: 'Slab Only' },

  // Exterior Doors — Front Entry
  'ADT Exterior Doors': { category: 'Exterior Doors', subcategory: 'Front Entry' },
  'EXTERIOR DOOR': { category: 'Exterior Doors', subcategory: 'Front Entry' },
  'EXTERIOR DOOR UNITS': { category: 'Exterior Doors', subcategory: 'Front Entry' },
  'ADT Pulte EXT': { category: 'Exterior Doors', subcategory: 'Front Entry' },
  'PULTE FRONT DOOR': { category: 'Exterior Doors', subcategory: 'Front Entry' },
  'BROOKFIELD FRONT DOOR UPGRADED SLAB': { category: 'Exterior Doors', subcategory: 'Front Entry' },

  // Exterior Doors — Fiberglass
  'FIBERGLASS DOOR': { category: 'Exterior Doors', subcategory: 'Fiberglass' },

  // Exterior Doors — Patio
  'BROOKFIELD PATIO DOOR': { category: 'Exterior Doors', subcategory: 'Patio Doors' },

  // Exterior Doors — Garage to House
  'ADT Garage to House Doors': { category: 'Exterior Doors', subcategory: 'Garage to House' },
  'ADT Pulte Garage to House Doors': { category: 'Exterior Doors', subcategory: 'Garage to House' },

  // Specialty Doors
  'ADT Attic Doors': { category: 'Specialty Doors', subcategory: 'Attic Doors' },
  'ATTIC STAIR': { category: 'Specialty Doors', subcategory: 'Attic Stairs' },
  'ADT Dunnage Doors': { category: 'Specialty Doors', subcategory: 'Dunnage Doors' },
  'ADT SG Dunnage Doors': { category: 'Specialty Doors', subcategory: 'Dunnage Doors' },

  // Door Frames & Components
  'DOOR COMPONENTS': { category: 'Door Frames & Components', subcategory: 'Door Components' },
  'THRESHOLD': { category: 'Door Frames & Components', subcategory: 'Thresholds' },
  'INTERIOR DOOR HARDWARE': { category: 'Door Frames & Components', subcategory: 'Hinges & Hardware' },
  'HARDWARE': { category: 'Door Frames & Components', subcategory: 'Hinges & Hardware' },
  'WEATHERSTRIP': { category: 'Door Frames & Components', subcategory: 'Weatherstripping' },

  // Trim & Moulding
  'TRIM': { category: 'Trim & Moulding', subcategory: 'Casing' },
  'CASING': { category: 'Trim & Moulding', subcategory: 'Casing' },
  'BASE': { category: 'Trim & Moulding', subcategory: 'Baseboard' },
  'CROWN': { category: 'Trim & Moulding', subcategory: 'Crown Moulding' },

  // Glass & Inserts
  'INSERTS': { category: 'Glass & Inserts', subcategory: 'Decorative Inserts' },
  'GLASS INSERTS': { category: 'Glass & Inserts', subcategory: 'Door Glass' },

  // Lumber & Sheet Goods
  'LUMBER': { category: 'Lumber & Sheet Goods', subcategory: 'Dimensional Lumber' },
  'PLYWOOD / SHEET GOODS': { category: 'Lumber & Sheet Goods', subcategory: 'Plywood' },
  'CEDAR PRODUCTS': { category: 'Lumber & Sheet Goods', subcategory: 'Cedar Products' },
  'HEMLOCK BEAMS & LVL BEAMS': { category: 'Lumber & Sheet Goods', subcategory: 'Hemlock & LVL Beams' },

  // Services & Labor
  'Services & Labor': { category: 'Services & Labor', subcategory: 'Installation' },
  'QUOTE ADT': { category: 'Services & Labor', subcategory: 'Quotes' },

  // Miscellaneous
  'FLEX': { category: 'Miscellaneous', subcategory: 'Flex Items' },
}

// ──────────────────────────────────────────────────────────────────────────
// Smart category mapper — uses the explicit map first, then fuzzy matching
// ──────────────────────────────────────────────────────────────────────────

export function mapCategory(rawCategory: string): { category: string; subcategory: string } {
  // 1. Check exact match
  if (CATEGORY_MAP[rawCategory]) {
    return CATEGORY_MAP[rawCategory]
  }

  // 2. Fuzzy matching based on keywords
  const lower = rawCategory.toLowerCase()

  // Frame-only patterns
  if (lower.includes('frame only') || lower.includes('frame -')) {
    if (lower.includes('ext') || lower.includes('exterior')) {
      return { category: 'Door Frames & Components', subcategory: 'Exterior Frames' }
    }
    return { category: 'Door Frames & Components', subcategory: 'Interior Frames' }
  }

  // Interior door patterns
  if (lower.includes('interior') || lower.includes('h/c') || lower.includes('s/c')) {
    if (lower.includes('s/c') || lower.includes('solid')) {
      return { category: 'Interior Doors', subcategory: 'Solid Core' }
    }
    return { category: 'Interior Doors', subcategory: 'Hollow Core' }
  }

  // Exterior door patterns
  if (lower.includes('exterior') || lower.includes('ext ') || lower.includes('front door') || lower.includes('entry')) {
    if (lower.includes('fiberglass')) {
      return { category: 'Exterior Doors', subcategory: 'Fiberglass' }
    }
    if (lower.includes('patio')) {
      return { category: 'Exterior Doors', subcategory: 'Patio Doors' }
    }
    if (lower.includes('garage')) {
      return { category: 'Exterior Doors', subcategory: 'Garage to House' }
    }
    return { category: 'Exterior Doors', subcategory: 'Front Entry' }
  }

  // Fire door patterns
  if (lower.includes('fire') || lower.includes('20 min') || lower.includes('90 min')) {
    return { category: 'Interior Doors', subcategory: 'Fire Rated' }
  }

  // Attic patterns
  if (lower.includes('attic')) {
    if (lower.includes('stair')) {
      return { category: 'Specialty Doors', subcategory: 'Attic Stairs' }
    }
    return { category: 'Specialty Doors', subcategory: 'Attic Doors' }
  }

  // Specialty Doors (exact match from sync-catalog)
  if (lower === 'specialty doors') {
    return { category: 'Specialty Doors', subcategory: 'Commercial' }
  }

  // Dunnage patterns
  if (lower.includes('dunnage')) {
    return { category: 'Specialty Doors', subcategory: 'Dunnage Doors' }
  }

  // Stair parts
  if (lower.includes('stair')) {
    return { category: 'Specialty Doors', subcategory: 'Attic Stairs' }
  }

  // Pocket door patterns
  if (lower.includes('pocket')) {
    return { category: 'Interior Doors', subcategory: 'Pocket Doors' }
  }

  // Door slab patterns
  if (lower.includes('slab')) {
    if (lower.includes('ext') || lower.includes('exterior')) {
      return { category: 'Exterior Doors', subcategory: 'Slab Only' }
    }
    return { category: 'Interior Doors', subcategory: 'Slab Only' }
  }

  // Trim/moulding patterns
  if (lower.includes('trim') || lower.includes('casing') || lower.includes('base') || lower.includes('crown') || lower.includes('moulding') || lower.includes('molding')) {
    if (lower.includes('crown')) return { category: 'Trim & Moulding', subcategory: 'Crown Moulding' }
    if (lower.includes('base')) return { category: 'Trim & Moulding', subcategory: 'Baseboard' }
    if (lower.includes('casing')) return { category: 'Trim & Moulding', subcategory: 'Casing' }
    return { category: 'Trim & Moulding', subcategory: 'Casing' }
  }

  // Hardware/component patterns
  if (lower.includes('hardware') || lower.includes('hinge') || lower.includes('threshold') || lower.includes('component')) {
    return { category: 'Door Frames & Components', subcategory: 'Door Components' }
  }

  // Glass/insert patterns
  if (lower.includes('glass') || lower.includes('insert') || lower.includes('lite')) {
    return { category: 'Glass & Inserts', subcategory: 'Decorative Inserts' }
  }

  // Lumber patterns
  if (lower.includes('lumber') || lower.includes('plywood') || lower.includes('cedar') || lower.includes('beam') || lower.includes('lvl')) {
    return { category: 'Lumber & Sheet Goods', subcategory: 'Dimensional Lumber' }
  }

  // Service patterns
  if (lower.includes('service') || lower.includes('labor') || lower.includes('install') || lower.includes('delivery') || lower.includes('quote')) {
    return { category: 'Services & Labor', subcategory: 'Installation' }
  }

  // Weatherstrip
  if (lower.includes('weather')) {
    return { category: 'Door Frames & Components', subcategory: 'Weatherstripping' }
  }

  // Builder-specific categories — map by door type
  if (lower.includes('pulte') || lower.includes('brookfield') || lower.includes('toll')) {
    if (lower.includes('ext') || lower.includes('front') || lower.includes('patio')) {
      return { category: 'Exterior Doors', subcategory: 'Front Entry' }
    }
    return { category: 'Interior Doors', subcategory: 'Hollow Core' }
  }

  // Default fallback
  return { category: 'Miscellaneous', subcategory: 'Other' }
}

// ──────────────────────────────────────────────────────────────────────────
// Get taxonomy as flat array for dropdowns
// ──────────────────────────────────────────────────────────────────────────

export function getCategoryOptions(): { value: string; label: string }[] {
  return PRODUCT_TAXONOMY.map(cat => ({
    value: cat.name,
    label: `${cat.icon} ${cat.name}`,
  }))
}

export function getSubcategoryOptions(category: string): { value: string; label: string }[] {
  const cat = PRODUCT_TAXONOMY.find(c => c.name === category)
  if (!cat) return []
  return cat.subcategories.map(sub => ({
    value: sub,
    label: sub,
  }))
}

export function getCategoryColor(category: string): string {
  const cat = PRODUCT_TAXONOMY.find(c => c.name === category)
  return cat?.color || '#9CA3AF'
}

export function getCategoryIcon(category: string): string {
  const cat = PRODUCT_TAXONOMY.find(c => c.name === category)
  return cat?.icon || '📦'
}
