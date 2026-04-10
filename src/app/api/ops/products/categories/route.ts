export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * Category normalization map.
 * Keys are the messy imported categories (case-insensitive match).
 * Values are the clean target categories.
 *
 * Products whose category doesn't match any key are left unchanged.
 */
const CATEGORY_MAP: Record<string, string> = {
  // ── Doors ──────────────────────────────────────────
  'INTERIOR DOORS': 'Interior Doors',
  'INTERIOR DOOR': 'Interior Doors',
  'INT DOORS': 'Interior Doors',
  'INT DOOR': 'Interior Doors',
  'HOLLOW CORE': 'Interior Doors',
  'HOLLOW CORE DOORS': 'Interior Doors',
  'HOLLOW CORE DOOR': 'Interior Doors',
  'SOLID CORE': 'Interior Doors',
  'SOLID CORE DOORS': 'Interior Doors',
  'SOLID CORE DOOR': 'Interior Doors',
  'PANEL DOORS': 'Interior Doors',
  'PANEL DOOR': 'Interior Doors',
  'FLAT PANEL DOORS': 'Interior Doors',
  'FLAT PANEL': 'Interior Doors',
  'SHAKER DOORS': 'Interior Doors',
  'SHAKER DOOR': 'Interior Doors',
  'FLUSH DOORS': 'Interior Doors',
  'FLUSH DOOR': 'Interior Doors',
  'BARN DOORS': 'Interior Doors',
  'BARN DOOR': 'Interior Doors',
  'CLOSET DOORS': 'Interior Doors',
  'CLOSET DOOR': 'Interior Doors',
  'POCKET DOORS': 'Interior Doors',
  'POCKET DOOR': 'Interior Doors',
  'BIFOLD DOORS': 'Interior Doors',
  'BIFOLD DOOR': 'Interior Doors',
  'BIFOLD': 'Interior Doors',
  'BI-FOLD': 'Interior Doors',
  'LOUVERED DOORS': 'Interior Doors',
  'LOUVERED DOOR': 'Interior Doors',
  'PREHUNG INTERIOR': 'Interior Doors',
  'SLAB DOORS': 'Interior Doors',
  'SLAB DOOR': 'Interior Doors',
  'DOOR SLAB': 'Interior Doors',
  'DOOR SLABS': 'Interior Doors',
  '1 LITE': 'Interior Doors',
  '1-LITE': 'Interior Doors',
  '2 LITE': 'Interior Doors',
  '3 LITE': 'Interior Doors',
  '4 LITE': 'Interior Doors',
  '5 LITE': 'Interior Doors',
  '6 LITE': 'Interior Doors',
  'GLASS INSERT': 'Interior Doors',
  'GLASS INSERTS': 'Interior Doors',

  'EXTERIOR DOORS': 'Exterior Doors',
  'EXTERIOR DOOR': 'Exterior Doors',
  'EXT DOORS': 'Exterior Doors',
  'EXT DOOR': 'Exterior Doors',
  'ENTRY DOORS': 'Exterior Doors',
  'ENTRY DOOR': 'Exterior Doors',
  'FRONT DOORS': 'Exterior Doors',
  'FRONT DOOR': 'Exterior Doors',
  'STEEL DOORS': 'Exterior Doors',
  'STEEL DOOR': 'Exterior Doors',
  'FIBERGLASS DOORS': 'Exterior Doors',
  'FIBERGLASS DOOR': 'Exterior Doors',
  'PATIO DOORS': 'Exterior Doors',
  'PATIO DOOR': 'Exterior Doors',
  'SLIDING DOORS': 'Exterior Doors',
  'SLIDING DOOR': 'Exterior Doors',
  'FRENCH DOORS': 'Exterior Doors',
  'FRENCH DOOR': 'Exterior Doors',
  'STORM DOORS': 'Exterior Doors',
  'STORM DOOR': 'Exterior Doors',
  'SCREEN DOORS': 'Exterior Doors',
  'SCREEN DOOR': 'Exterior Doors',
  'PREHUNG EXTERIOR': 'Exterior Doors',

  // ── Door Hardware & Accessories ────────────────────
  'DOOR HARDWARE': 'Door Hardware',
  'DOOR HANDLES': 'Door Hardware',
  'DOOR KNOBS': 'Door Hardware',
  'LOCKSETS': 'Door Hardware',
  'DEADBOLTS': 'Door Hardware',
  'HINGES': 'Door Hardware',
  'DOOR HINGES': 'Door Hardware',
  'DOOR STOPS': 'Door Hardware',
  'DOOR CLOSERS': 'Door Hardware',
  'DOOR ACCESSORIES': 'Door Hardware',
  'WEATHERSTRIPPING': 'Door Hardware',
  'THRESHOLDS': 'Door Hardware',
  'DOOR FRAMES': 'Door Frames & Jambs',
  'DOOR FRAME': 'Door Frames & Jambs',
  'DOOR JAMBS': 'Door Frames & Jambs',
  'DOOR JAMB': 'Door Frames & Jambs',
  'JAMB KITS': 'Door Frames & Jambs',
  'JAMB KIT': 'Door Frames & Jambs',
  'CASING': 'Trim & Moulding',
  'DOOR CASING': 'Trim & Moulding',

  // ── Windows ────────────────────────────────────────
  'WINDOWS': 'Windows',
  'WINDOW': 'Windows',
  'VINYL WINDOWS': 'Windows',
  'ALUMINUM WINDOWS': 'Windows',
  'WOOD WINDOWS': 'Windows',
  'DOUBLE HUNG': 'Windows',
  'DOUBLE HUNG WINDOWS': 'Windows',
  'SINGLE HUNG': 'Windows',
  'SINGLE HUNG WINDOWS': 'Windows',
  'CASEMENT WINDOWS': 'Windows',
  'CASEMENT': 'Windows',
  'AWNING WINDOWS': 'Windows',
  'SLIDING WINDOWS': 'Windows',
  'PICTURE WINDOWS': 'Windows',
  'BAY WINDOWS': 'Windows',
  'SKYLIGHTS': 'Windows',
  'WINDOW HARDWARE': 'Windows',

  // ── Lumber & Framing ──────────────────────────────
  'LUMBER': 'Lumber & Framing',
  'FRAMING LUMBER': 'Lumber & Framing',
  'FRAMING': 'Lumber & Framing',
  'DIMENSIONAL LUMBER': 'Lumber & Framing',
  'STUDS': 'Lumber & Framing',
  'PLYWOOD': 'Lumber & Framing',
  'OSB': 'Lumber & Framing',
  'SHEATHING': 'Lumber & Framing',
  'TREATED LUMBER': 'Lumber & Framing',
  'PRESSURE TREATED': 'Lumber & Framing',
  'LVL': 'Lumber & Framing',
  'ENGINEERED LUMBER': 'Lumber & Framing',
  'I-JOISTS': 'Lumber & Framing',
  'TRUSSES': 'Lumber & Framing',
  'BEAMS': 'Lumber & Framing',
  'POSTS': 'Lumber & Framing',
  'HEADERS': 'Lumber & Framing',
  'JOISTS': 'Lumber & Framing',
  'RAFTERS': 'Lumber & Framing',
  'BOARDS': 'Lumber & Framing',

  // ── Trim & Moulding ──────────────────────────────
  'TRIM': 'Trim & Moulding',
  'MOULDING': 'Trim & Moulding',
  'MOLDING': 'Trim & Moulding',
  'MOULDINGS': 'Trim & Moulding',
  'CROWN MOULDING': 'Trim & Moulding',
  'CROWN MOLDING': 'Trim & Moulding',
  'BASEBOARD': 'Trim & Moulding',
  'BASEBOARDS': 'Trim & Moulding',
  'BASE MOULDING': 'Trim & Moulding',
  'CHAIR RAIL': 'Trim & Moulding',
  'WAINSCOTING': 'Trim & Moulding',
  'WINDOW TRIM': 'Trim & Moulding',
  'INTERIOR TRIM': 'Trim & Moulding',
  'EXTERIOR TRIM': 'Trim & Moulding',
  'MDF MOULDING': 'Trim & Moulding',
  'PRIMED MOULDING': 'Trim & Moulding',

  // ── Cabinets & Countertops ────────────────────────
  'CABINETS': 'Cabinets',
  'CABINET': 'Cabinets',
  'KITCHEN CABINETS': 'Cabinets',
  'BATH CABINETS': 'Cabinets',
  'VANITIES': 'Cabinets',
  'VANITY': 'Cabinets',
  'COUNTERTOPS': 'Countertops',
  'COUNTERTOP': 'Countertops',

  // ── Flooring ──────────────────────────────────────
  'FLOORING': 'Flooring',
  'HARDWOOD FLOORING': 'Flooring',
  'LAMINATE FLOORING': 'Flooring',
  'VINYL FLOORING': 'Flooring',
  'LVP': 'Flooring',
  'TILE': 'Flooring',
  'TILE FLOORING': 'Flooring',
  'CARPET': 'Flooring',
  'UNDERLAYMENT': 'Flooring',

  // ── Roofing ───────────────────────────────────────
  'ROOFING': 'Roofing',
  'SHINGLES': 'Roofing',
  'ROOF SHINGLES': 'Roofing',
  'METAL ROOFING': 'Roofing',
  'ROOFING MATERIALS': 'Roofing',
  'ROOFING ACCESSORIES': 'Roofing',
  'FLASHING': 'Roofing',
  'GUTTERS': 'Roofing',
  'DOWNSPOUTS': 'Roofing',

  // ── Siding & Exterior ────────────────────────────
  'SIDING': 'Siding & Exterior',
  'VINYL SIDING': 'Siding & Exterior',
  'FIBER CEMENT': 'Siding & Exterior',
  'HARDIE BOARD': 'Siding & Exterior',
  'LAP SIDING': 'Siding & Exterior',
  'SOFFIT': 'Siding & Exterior',
  'FASCIA': 'Siding & Exterior',

  // ── Insulation ────────────────────────────────────
  'INSULATION': 'Insulation',
  'BATT INSULATION': 'Insulation',
  'BLOWN INSULATION': 'Insulation',
  'SPRAY FOAM': 'Insulation',
  'RIGID INSULATION': 'Insulation',
  'FOAM BOARD': 'Insulation',
  'HOUSEWRAP': 'Insulation',

  // ── Drywall & Plaster ────────────────────────────
  'DRYWALL': 'Drywall',
  'SHEETROCK': 'Drywall',
  'DRYWALL SHEETS': 'Drywall',
  'JOINT COMPOUND': 'Drywall',
  'DRYWALL ACCESSORIES': 'Drywall',
  'DRYWALL TAPE': 'Drywall',
  'CORNER BEAD': 'Drywall',

  // ── Paint & Stain ────────────────────────────────
  'PAINT': 'Paint & Stain',
  'STAIN': 'Paint & Stain',
  'PRIMER': 'Paint & Stain',
  'PAINTS': 'Paint & Stain',
  'STAINS': 'Paint & Stain',
  'INTERIOR PAINT': 'Paint & Stain',
  'EXTERIOR PAINT': 'Paint & Stain',
  'WOOD STAIN': 'Paint & Stain',

  // ── Concrete & Masonry ────────────────────────────
  'CONCRETE': 'Concrete & Masonry',
  'MASONRY': 'Concrete & Masonry',
  'CEMENT': 'Concrete & Masonry',
  'MORTAR': 'Concrete & Masonry',
  'BLOCK': 'Concrete & Masonry',
  'BRICK': 'Concrete & Masonry',
  'CONCRETE BLOCK': 'Concrete & Masonry',
  'PAVERS': 'Concrete & Masonry',

  // ── Plumbing ──────────────────────────────────────
  'PLUMBING': 'Plumbing',
  'FIXTURES': 'Plumbing',
  'PLUMBING FIXTURES': 'Plumbing',
  'FAUCETS': 'Plumbing',
  'TOILETS': 'Plumbing',
  'SINKS': 'Plumbing',
  'SHOWER': 'Plumbing',
  'BATHTUBS': 'Plumbing',
  'PIPES': 'Plumbing',
  'PIPE FITTINGS': 'Plumbing',
  'WATER HEATERS': 'Plumbing',

  // ── Electrical ────────────────────────────────────
  'ELECTRICAL': 'Electrical',
  'WIRING': 'Electrical',
  'SWITCHES': 'Electrical',
  'OUTLETS': 'Electrical',
  'ELECTRICAL BOXES': 'Electrical',
  'LIGHTING': 'Lighting',
  'LIGHT FIXTURES': 'Lighting',
  'LED LIGHTING': 'Lighting',
  'RECESSED LIGHTING': 'Lighting',
  'CEILING FANS': 'Lighting',

  // ── HVAC ──────────────────────────────────────────
  'HVAC': 'HVAC',
  'DUCTWORK': 'HVAC',
  'VENTS': 'HVAC',
  'REGISTERS': 'HVAC',
  'THERMOSTATS': 'HVAC',

  // ── Hardware & Fasteners ──────────────────────────
  'HARDWARE': 'Hardware & Fasteners',
  'FASTENERS': 'Hardware & Fasteners',
  'NAILS': 'Hardware & Fasteners',
  'SCREWS': 'Hardware & Fasteners',
  'BOLTS': 'Hardware & Fasteners',
  'ANCHORS': 'Hardware & Fasteners',
  'BRACKETS': 'Hardware & Fasteners',
  'JOIST HANGERS': 'Hardware & Fasteners',
  'SIMPSON': 'Hardware & Fasteners',
  'CONNECTORS': 'Hardware & Fasteners',
  'ADHESIVES': 'Hardware & Fasteners',
  'CAULK': 'Hardware & Fasteners',
  'SEALANTS': 'Hardware & Fasteners',

  // ── Decking & Outdoor ─────────────────────────────
  'DECKING': 'Decking & Outdoor',
  'DECK': 'Decking & Outdoor',
  'COMPOSITE DECKING': 'Decking & Outdoor',
  'DECK BOARDS': 'Decking & Outdoor',
  'RAILING': 'Decking & Outdoor',
  'RAILINGS': 'Decking & Outdoor',
  'DECK RAILING': 'Decking & Outdoor',
  'FENCING': 'Decking & Outdoor',
  'FENCE': 'Decking & Outdoor',
  'FENCE PANELS': 'Decking & Outdoor',
  'GATES': 'Decking & Outdoor',
  'PERGOLAS': 'Decking & Outdoor',
  'LANDSCAPE': 'Decking & Outdoor',

  // ── Stairs & Railings ─────────────────────────────
  'STAIRS': 'Stairs & Railings',
  'STAIR PARTS': 'Stairs & Railings',
  'STAIR TREADS': 'Stairs & Railings',
  'STAIR RISERS': 'Stairs & Railings',
  'BALUSTERS': 'Stairs & Railings',
  'NEWEL POSTS': 'Stairs & Railings',
  'HANDRAILS': 'Stairs & Railings',
  'INTERIOR RAILING': 'Stairs & Railings',

  // ── Garage & Storage ──────────────────────────────
  'GARAGE DOORS': 'Garage Doors',
  'GARAGE DOOR': 'Garage Doors',
  'GARAGE': 'Garage Doors',
  'GARAGE DOOR OPENERS': 'Garage Doors',
  'SHELVING': 'Shelving & Storage',
  'CLOSET SYSTEMS': 'Shelving & Storage',
  'STORAGE': 'Shelving & Storage',

  // ── Tools & Safety ────────────────────────────────
  'TOOLS': 'Tools',
  'POWER TOOLS': 'Tools',
  'HAND TOOLS': 'Tools',
  'SAFETY': 'Safety & PPE',
  'SAFETY EQUIPMENT': 'Safety & PPE',
  'PPE': 'Safety & PPE',

  // ── Vendor-specific door categories (ADT, Pulte, Toll Brothers, Brookfield, AGD) ──
  'ADT H/C INTERIOR DOORS': 'Interior Doors',
  'ADT S/C INTERIOR DOORS': 'Interior Doors',
  'ADT EXTERIOR DOORS': 'Exterior Doors',
  'ADT GARAGE TO HOUSE DOORS': 'Interior Doors',
  'ADT PULTE EXT': 'Exterior Doors',
  'ADT ATTIC DOORS': 'Interior Doors',
  'ADT DUNNAGE DOORS': 'Interior Doors',
  'ADT SG DUNNAGE DOORS': 'Interior Doors',
  'ADT PULTE GARAGE TO HOUSE DOORS': 'Interior Doors',
  'ADT PULTE DUNNAGE DOORS': 'Interior Doors',
  'ADT PULTE HVAC DOORS': 'HVAC',
  'ADT SPECIALTY DOORS': 'Interior Doors',
  'TOLL BROTHERS INTERIOR DOORS': 'Interior Doors',
  'TOLL BROTHERS GARAGE SERVICE DOOR': 'Interior Doors',
  'TOLL BROTHERS PATIO DOOR': 'Exterior Doors',
  'TOLL BROTHERS ATTIC ACCESS DOOR': 'Interior Doors',
  'TOLL BROTHERS TRIM': 'Trim & Moulding',
  'AGD INTERIOR DOORS': 'Interior Doors',
  'AGD 20 MIN FIRE DOOR': 'Interior Doors',
  'PULTE FRONT DOOR': 'Exterior Doors',
  'PULTE LITE INTERIOR DOORS': 'Interior Doors',
  'PULTE INTERIOR DOORS': 'Interior Doors',
  'PULTE GARAGE 20 MIN FIRE DOOR': 'Interior Doors',
  'PULTE I/S BACK PATIO DOOR': 'Exterior Doors',
  'PULTE OS BACK PATIO DOOR': 'Exterior Doors',
  'PULTE HVAC DOOR': 'HVAC',
  'PULTE TRADITIONAL MUD BENCH': 'Cabinets',
  'BROOKFIELD PATIO DOOR': 'Exterior Doors',
  'BROOKFIELD FRONT DOOR UPGRADED SLAB': 'Exterior Doors',
  'BROOKFIELD SLIDERS': 'Exterior Doors',

  // ── Straggler / one-off categories ──
  'NO BMC': 'Miscellaneous',
  'BURRIS TECTVIEW AC': 'Windows',
  'OIL RUB BRZ': 'Door Hardware',

  // ── Door types & variants ──
  'SLAB ONLY': 'Interior Doors',
  '20 MIN FIRE DOOR': 'Interior Doors',
  '20 MIN FIRE DOOR UNITS': 'Interior Doors',
  'INTERIOR DOOR UNITS': 'Interior Doors',
  'EXTERIOR DOOR UNITS': 'Exterior Doors',
  'FIBERGLASS DOOR UNITS': 'Exterior Doors',
  'DUNNAGE DOOR UNITS': 'Interior Doors',
  'DUNNAGE DOOR': 'Interior Doors',
  'CUT DOWN DOOR UNITS': 'Interior Doors',
  'HVAC DOOR': 'HVAC',
  'DOOR COMPONENTS': 'Door Hardware',
  'INSERTS': 'Interior Doors',
  'DIVIDED LITE': 'Interior Doors',
  'WESTERN SLIDING GLASS DOOR': 'Exterior Doors',
  'DOOR FRAMES & COMPONENTS': 'Door Frames & Jambs',

  // ── Door hardware & accessories ──
  'INTERIOR DOOR HARDWARE': 'Door Hardware',
  'BARN DOOR HARDWARE': 'Door Hardware',
  'INTERIOR T-ASTRIGALS': 'Door Hardware',
  'EXTERIOR T-ASTRIGALS': 'Door Hardware',
  'FLIP LOCKS': 'Door Hardware',
  '4" HINGES': 'Door Hardware',
  '3 1/2\'\' HINGES': 'Door Hardware',
  'SPECIALTY HINGES': 'Door Hardware',
  'SPRING HINGES': 'Door Hardware',
  'NRP HINGES': 'Door Hardware',
  'DOOR STOP': 'Door Hardware',
  'SWEEPS': 'Door Hardware',
  'WEATHERSTRIP': 'Door Hardware',
  'SILL PANS': 'Door Hardware',
  'EXTERIOR DOOR HARDEWARE': 'Door Hardware',
  'FRONT DOOR PEEP': 'Door Hardware',
  'BATH HARDWARE': 'Hardware & Fasteners',
  'THRESHOLD': 'Door Hardware',

  // ── Frames & Jambs (ADT-specific) ──
  'ADT EXT FRAME ONLY - SINGLE 4-5/8"': 'Door Frames & Jambs',
  'ADT EXT FRAME ONLY - SINGLE 6-5/8"': 'Door Frames & Jambs',
  'ADT INT FRAME ONLY - H/C 1-3/8" TWIN 6-5/8"': 'Door Frames & Jambs',
  'ADT INT FRAME ONLY - H/C 1-3/8" TWIN 4-5/8"': 'Door Frames & Jambs',
  'ADT INT FRAME ONLY - S/C 1-3/4" TWIN 6-5/8"': 'Door Frames & Jambs',
  'ADT INT FRAME ONLY - S/C 1-3/4" TWIN 4-5/8"': 'Door Frames & Jambs',
  'ADT INT FRAME ONLY - S/C 1-3/4" SINGLE 6-5/8"': 'Door Frames & Jambs',
  'ADT INT FRAME ONLY - H/C 1-3/8" SINGLE 6-5/8"': 'Door Frames & Jambs',
  'ADT INT FRAME ONLY - S/C 1-3/4" SINGLE 4-5/8"': 'Door Frames & Jambs',
  'ADT INT FRAME ONLY - H/C 1-3/8" SINGLE 4-5/8"': 'Door Frames & Jambs',
  'PRIMED FJ JAMBS W/ APPLIED DOOR STOP': 'Door Frames & Jambs',
  'FJ JAMBS W/ APPLIED DOOR STOP': 'Door Frames & Jambs',
  'PRIMED FJ EXT FRAME LEGS': 'Door Frames & Jambs',

  // ── Trim, Moulding & Wood Products ──
  'CROWN': 'Trim & Moulding',
  'BASE': 'Trim & Moulding',
  'PANEL MOULD': 'Trim & Moulding',
  'BRICK MOULD': 'Trim & Moulding',
  'PRECUT CASING': 'Trim & Moulding',
  'WINDOW STOOL': 'Trim & Moulding',
  'CEDAR PRODUCTS': 'Lumber & Framing',
  'WHITE OAK': 'Lumber & Framing',
  'RAW PINE S4S': 'Lumber & Framing',
  'RAW MDF S4S': 'Trim & Moulding',
  'PRIMED MDF S4S': 'Trim & Moulding',
  'RADIATTA PINE S4S': 'Lumber & Framing',
  'PRIMED PINE S4S': 'Trim & Moulding',
  'WHITE PINE S4S': 'Lumber & Framing',
  'KNOTTY PINE': 'Lumber & Framing',
  'RED OAK': 'Lumber & Framing',
  'HEMLOCK BEAMS & LVL BEAMS': 'Lumber & Framing',
  'PLYWOOD / SHEET GOODS': 'Lumber & Framing',
  'PARTICLE BOARD BULLNOSED': 'Shelving & Storage',
  'NICKEL GAP/ T&G/SHIP LAP': 'Siding & Exterior',

  // ── Stairs & Storage ──
  'ATTIC STAIR': 'Stairs & Railings',
  'CLOSET ROD': 'Shelving & Storage',
  'POLE SOCKETS': 'Shelving & Storage',
  'SHELF BRACKETS': 'Shelving & Storage',
  'COAT HOOKS': 'Hardware & Fasteners',

  // ── Miscellaneous & services ──
  'SERVICE': 'Miscellaneous',
  'FLEX': 'Miscellaneous',
  'QUOTE ADT': 'Miscellaneous',
  'SHOP SUPPLIES': 'Miscellaneous',
  'INSTALLER SUPPLIES': 'Miscellaneous',
  'UNCATEGORIZED': 'Miscellaneous',
  'MISC': 'Miscellaneous',
  'MISCELLANEOUS': 'Miscellaneous',
  'OTHER': 'Miscellaneous',
  'GENERAL': 'Miscellaneous',
  'ACCESSORIES': 'Miscellaneous',
  'SUPPLIES': 'Miscellaneous',
}

/**
 * Fallback keyword matching for categories that don't have an exact match.
 * Checks if the category name contains certain keywords and maps accordingly.
 */
function inferCategory(cat: string): string | null {
  const upper = cat.toUpperCase()

  // Frame-related
  if (upper.includes('FRAME ONLY') || upper.includes('FRAME LEG') || upper.includes('JAMB')) return 'Door Frames & Jambs'

  // Door types
  if (upper.includes('FIRE DOOR')) return 'Interior Doors'
  if (upper.includes('HVAC DOOR') || upper.includes('HVAC')) return 'HVAC'
  if (upper.includes('PATIO DOOR') || upper.includes('SLIDING GLASS DOOR')) return 'Exterior Doors'
  if (upper.includes('FRONT DOOR') || upper.includes('ENTRY DOOR')) return 'Exterior Doors'
  if (upper.includes('GARAGE') && upper.includes('DOOR')) return 'Interior Doors'
  if (upper.includes('ATTIC') && (upper.includes('DOOR') || upper.includes('STAIR') || upper.includes('ACCESS'))) return 'Interior Doors'
  if (upper.includes('DUNNAGE DOOR')) return 'Interior Doors'
  if (upper.includes('EXTERIOR DOOR') || upper.includes('EXT DOOR')) return 'Exterior Doors'
  if (upper.includes('INTERIOR DOOR') || upper.includes('INT DOOR')) return 'Interior Doors'

  // Hinges and door hardware
  if (upper.includes('HINGE')) return 'Door Hardware'
  if (upper.includes('ASTRIGAL') || upper.includes('T-ASTRIGAL')) return 'Door Hardware'
  if (upper.includes('DOOR STOP') || upper.includes('DOOR SWEEP') || upper.includes('WEATHERSTRIP')) return 'Door Hardware'
  if (upper.includes('LOCK') && !upper.includes('BLOCK')) return 'Door Hardware'
  if (upper.includes('DOOR HARDWARE') || upper.includes('DOOR HARDEWARE')) return 'Door Hardware'
  if (upper.includes('SILL PAN') || upper.includes('THRESHOLD')) return 'Door Hardware'
  if (upper.includes('PEEP')) return 'Door Hardware'

  // Trim & Moulding
  if (upper.includes('MOULD') || upper.includes('MOLDING') || upper.includes('CASING') || upper.includes('TRIM')) return 'Trim & Moulding'
  if (upper.includes('CROWN') || upper.includes('BASE') || upper.includes('STOOL')) return 'Trim & Moulding'
  if (upper.includes('MDF S4S') || upper.includes('PRIMED') && upper.includes('S4S')) return 'Trim & Moulding'

  // Lumber
  if (upper.includes('PINE') || upper.includes('OAK') || upper.includes('CEDAR') || upper.includes('HEMLOCK')) return 'Lumber & Framing'
  if (upper.includes('PLYWOOD') || upper.includes('SHEET GOOD') || upper.includes('S4S')) return 'Lumber & Framing'
  if (upper.includes('BEAM') || upper.includes('LVL')) return 'Lumber & Framing'

  // Siding
  if (upper.includes('SHIP LAP') || upper.includes('SHIPLAP') || upper.includes('T&G') || upper.includes('NICKEL GAP')) return 'Siding & Exterior'

  // Storage
  if (upper.includes('CLOSET ROD') || upper.includes('POLE SOCKET') || upper.includes('SHELF') || upper.includes('SHELVING')) return 'Shelving & Storage'
  if (upper.includes('COAT HOOK')) return 'Hardware & Fasteners'

  // Stairs
  if (upper.includes('STAIR') || upper.includes('ATTIC STAIR')) return 'Stairs & Railings'

  // Catch-all for remaining door-related items
  if (upper.includes('DOOR') || upper.includes('SLAB')) return 'Interior Doors'
  if (upper.includes('LITE') && !upper.includes('LIGHT')) return 'Interior Doors'

  return null
}

/**
 * Resolve category: exact match first, then keyword inference.
 */
function resolveCategory(category: string): string | null {
  const upperCat = category.toUpperCase().trim()
  return CATEGORY_MAP[upperCat] || inferCategory(category)
}

// GET — List all current categories with counts and suggested mappings
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const categoryCounts = await prisma.$queryRawUnsafe<Array<{ category: string; count: number }>>(
      `SELECT "category", COUNT(*)::int as count
       FROM "Product" WHERE "active" = true
       GROUP BY "category" ORDER BY count DESC`
    )

    const categories = categoryCounts.map(c => {
      const mappedTo = resolveCategory(c.category)
      return {
        current: c.category,
        productCount: c.count,
        mappedTo,
        willChange: mappedTo !== null && mappedTo !== c.category,
      }
    })

    const uniqueTargets = new Set(Object.values(CATEGORY_MAP))
    const currentUnique = new Set(categoryCounts.map(c => c.category))
    const willBeAfter = new Set<string>()
    for (const cat of categoryCounts) {
      willBeAfter.add(resolveCategory(cat.category) || cat.category)
    }

    return NextResponse.json({
      currentCategoryCount: currentUnique.size,
      afterCleanupCount: willBeAfter.size,
      targetCategories: [...uniqueTargets].sort(),
      categories,
    })
  } catch (error: any) {
    console.error('Category list error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST — Execute the category normalization
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { confirm } = body

    if (confirm !== 'NORMALIZE') {
      return NextResponse.json(
        { error: 'Send { "confirm": "NORMALIZE" } to execute the cleanup' },
        { status: 400 }
      )
    }

    let updatedCount = 0

    // Get all distinct categories
    const categoryCounts = await prisma.$queryRawUnsafe<Array<{ category: string; count: number }>>(
      `SELECT "category", COUNT(*)::int as count
       FROM "Product" GROUP BY "category"`
    )

    for (const cat of categoryCounts) {
      const target = resolveCategory(cat.category)

      if (target && target !== cat.category) {
        const result = await prisma.$executeRawUnsafe(
          `UPDATE "Product" SET "category" = $1, "updatedAt" = NOW() WHERE "category" = $2`,
          target,
          cat.category
        )
        updatedCount += result
      }
    }

    // Get new category counts after cleanup
    const newCategoryCounts = await prisma.$queryRawUnsafe<Array<{ category: string; count: number }>>(
      `SELECT "category", COUNT(*)::int as count
       FROM "Product" WHERE "active" = true
       GROUP BY "category" ORDER BY count DESC`
    )

    return NextResponse.json({
      success: true,
      productsUpdated: updatedCount,
      categoriesBefore: categoryCounts.length,
      categoriesAfter: newCategoryCounts.length,
      categories: newCategoryCounts.map(c => ({
        category: c.category,
        productCount: c.count,
      })),
    })
  } catch (error: any) {
    console.error('Category normalization error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
