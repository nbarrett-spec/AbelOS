/**
 * AI Takeoff Engine — Abel Lumber
 *
 * Comprehensive takeoff engine that generates detailed material lists from blueprints.
 * Covers ALL Abel product categories:
 *   - Interior Doors (pre-hung, slab, bifold, pocket, barn)
 *   - Exterior Doors (entry, patio/sliding, storm, side entry)
 *   - Hardware (passage, privacy, entry, deadbolt, bifold, hinges, stops, bumpers)
 *   - Trim/Base/Casing (interior base, casing, crown, shoe, chair rail, window stool/apron)
 *   - Closet Components (shelving, rods, pole sockets, shelf brackets, shoe racks)
 *   - Specialty (mud benches, attic access, garage fire doors, pet doors)
 *   - Window Trim (interior window casing, stools, aprons — optional add-on)
 *   - Miscellaneous (weatherstripping, thresholds, door sweeps)
 *
 * Phase 1: Template-based mock engine with realistic Abel product references
 * Phase 2: Will integrate with vision AI (Claude/GPT-4V) for real blueprint analysis
 */

export interface TakeoffRequest {
  blueprintUrl: string
  blueprintType: string
  pageCount?: number
  sqFootage?: number
  planName?: string
  // Optional selections for what to include
  includeWindowTrim?: boolean // Optional add-on
  includeClosetComponents?: boolean // Usually included
  includeSpecialty?: boolean // Mud benches, built-ins
}

export interface TakeoffResult {
  confidence: number
  items: TakeoffItemResult[]
  processingTimeMs: number
  notes: string[]
  summary: TakeoffSummary
}

export interface TakeoffSummary {
  totalItems: number
  interiorDoors: number
  exteriorDoors: number
  hardware: number
  trimLinearFeet: number
  closetComponents: number
  windowTrimPieces: number
  specialtyItems: number
  rooms: number
}

export interface TakeoffItemResult {
  category: string
  subcategory?: string
  description: string
  location: string
  quantity: number
  unit: 'ea' | 'lf' | 'set' | 'pair' | 'pc'
  confidence: number
  suggestedSku?: string
  notes?: string
}

// ─── INTERIOR DOOR + HARDWARE + TRIM per room ────────────────────────
interface RoomTemplate {
  doors: Array<{ category: string; subcategory?: string; desc: string; qty: number; unit?: 'ea' | 'lf' | 'set' | 'pair' | 'pc' }>
  hardware: Array<{ desc: string; qty: number; unit?: 'ea' | 'lf' | 'set' | 'pair' | 'pc'; subcategory?: string }>
  trim: Array<{ desc: string; qty: number; unit?: 'ea' | 'lf' | 'set' | 'pair' | 'pc'; subcategory?: string }>
  closet?: Array<{ desc: string; qty: number; unit?: 'ea' | 'lf' | 'set' | 'pair' | 'pc'; subcategory?: string }>
  specialty?: Array<{ category: string; desc: string; qty: number; unit?: 'ea' | 'lf' | 'set' | 'pair' | 'pc'; subcategory?: string }>
}

const ROOM_TEMPLATES: Record<string, RoomTemplate> = {
  'Master Bedroom': {
    doors: [
      { category: 'Interior Door', subcategory: 'Pre-Hung', desc: '2868 2-Panel Shaker SC RH Pre-Hung 4-9/16 Jamb', qty: 1 },
      { category: 'Interior Door', subcategory: 'Bifold', desc: '6068 Bifold 2-Panel Shaker (pair)', qty: 1 },
    ],
    hardware: [
      { desc: 'Privacy Lever SN', qty: 1, subcategory: 'Lever' },
      { desc: '3-1/2" x 3-1/2" Hinge SN (3-pack)', qty: 1, subcategory: 'Hinge' },
      { desc: 'Bifold Track Hardware Kit 6ft', qty: 1, subcategory: 'Bifold Hardware' },
      { desc: 'Door Stop Wall Mount SN', qty: 1, subcategory: 'Door Stop' },
    ],
    trim: [
      { desc: '3-1/4" Base MDF Primed', qty: 58, subcategory: 'Base' },
      { desc: '2-1/4" Casing MDF Primed', qty: 34, subcategory: 'Casing' },
      { desc: '3/4" x 3/4" Shoe Mould Primed', qty: 58, subcategory: 'Shoe Mould' },
    ],
    closet: [
      { desc: '12" Ventilated Wire Shelf White', qty: 12, unit: 'lf', subcategory: 'Closet Shelving' },
      { desc: '1-5/16" Round Closet Rod Chrome', qty: 12, unit: 'lf', subcategory: 'Closet Rod' },
      { desc: 'Pole Socket Chrome (pair)', qty: 2, unit: 'pair', subcategory: 'Pole Socket' },
      { desc: 'Shelf Bracket 12" White', qty: 6, unit: 'ea', subcategory: 'Shelf Bracket' },
    ],
  },
  'Master Bathroom': {
    doors: [
      { category: 'Interior Door', subcategory: 'Pre-Hung', desc: '2668 2-Panel Shaker SC LH Pre-Hung 4-9/16 Jamb', qty: 1 },
    ],
    hardware: [
      { desc: 'Privacy Lever SN', qty: 1, subcategory: 'Lever' },
      { desc: '3-1/2" x 3-1/2" Hinge SN (3-pack)', qty: 1, subcategory: 'Hinge' },
      { desc: 'Door Stop Wall Mount SN', qty: 1, subcategory: 'Door Stop' },
    ],
    trim: [
      { desc: '3-1/4" Base MDF Primed', qty: 36, subcategory: 'Base' },
      { desc: '2-1/4" Casing MDF Primed', qty: 17, subcategory: 'Casing' },
      { desc: '3/4" x 3/4" Shoe Mould Primed', qty: 36, subcategory: 'Shoe Mould' },
    ],
  },
  'Bedroom 2': {
    doors: [
      { category: 'Interior Door', subcategory: 'Pre-Hung', desc: '2668 2-Panel Shaker HC RH Pre-Hung 4-9/16 Jamb', qty: 1 },
      { category: 'Interior Door', subcategory: 'Bifold', desc: '4068 Bifold 2-Panel Shaker', qty: 1 },
    ],
    hardware: [
      { desc: 'Passage Lever SN', qty: 1, subcategory: 'Lever' },
      { desc: '3-1/2" x 3-1/2" Hinge SN (3-pack)', qty: 1, subcategory: 'Hinge' },
      { desc: 'Bifold Track Hardware Kit 4ft', qty: 1, subcategory: 'Bifold Hardware' },
      { desc: 'Door Stop Wall Mount SN', qty: 1, subcategory: 'Door Stop' },
    ],
    trim: [
      { desc: '3-1/4" Base MDF Primed', qty: 44, subcategory: 'Base' },
      { desc: '2-1/4" Casing MDF Primed', qty: 34, subcategory: 'Casing' },
      { desc: '3/4" x 3/4" Shoe Mould Primed', qty: 44, subcategory: 'Shoe Mould' },
    ],
    closet: [
      { desc: '12" Ventilated Wire Shelf White', qty: 8, unit: 'lf', subcategory: 'Closet Shelving' },
      { desc: '1-5/16" Round Closet Rod Chrome', qty: 8, unit: 'lf', subcategory: 'Closet Rod' },
      { desc: 'Pole Socket Chrome (pair)', qty: 1, unit: 'pair', subcategory: 'Pole Socket' },
      { desc: 'Shelf Bracket 12" White', qty: 4, unit: 'ea', subcategory: 'Shelf Bracket' },
    ],
  },
  'Bedroom 3': {
    doors: [
      { category: 'Interior Door', subcategory: 'Pre-Hung', desc: '2668 2-Panel Shaker HC LH Pre-Hung 4-9/16 Jamb', qty: 1 },
      { category: 'Interior Door', subcategory: 'Bifold', desc: '4068 Bifold 2-Panel Shaker', qty: 1 },
    ],
    hardware: [
      { desc: 'Passage Lever SN', qty: 1, subcategory: 'Lever' },
      { desc: '3-1/2" x 3-1/2" Hinge SN (3-pack)', qty: 1, subcategory: 'Hinge' },
      { desc: 'Bifold Track Hardware Kit 4ft', qty: 1, subcategory: 'Bifold Hardware' },
      { desc: 'Door Stop Wall Mount SN', qty: 1, subcategory: 'Door Stop' },
    ],
    trim: [
      { desc: '3-1/4" Base MDF Primed', qty: 40, subcategory: 'Base' },
      { desc: '2-1/4" Casing MDF Primed', qty: 34, subcategory: 'Casing' },
      { desc: '3/4" x 3/4" Shoe Mould Primed', qty: 40, subcategory: 'Shoe Mould' },
    ],
    closet: [
      { desc: '12" Ventilated Wire Shelf White', qty: 8, unit: 'lf', subcategory: 'Closet Shelving' },
      { desc: '1-5/16" Round Closet Rod Chrome', qty: 8, unit: 'lf', subcategory: 'Closet Rod' },
      { desc: 'Pole Socket Chrome (pair)', qty: 1, unit: 'pair', subcategory: 'Pole Socket' },
      { desc: 'Shelf Bracket 12" White', qty: 4, unit: 'ea', subcategory: 'Shelf Bracket' },
    ],
  },
  'Bedroom 4': {
    doors: [
      { category: 'Interior Door', subcategory: 'Pre-Hung', desc: '2668 2-Panel Shaker HC RH Pre-Hung 4-9/16 Jamb', qty: 1 },
      { category: 'Interior Door', subcategory: 'Bifold', desc: '4068 Bifold 2-Panel Shaker', qty: 1 },
    ],
    hardware: [
      { desc: 'Passage Lever SN', qty: 1, subcategory: 'Lever' },
      { desc: '3-1/2" x 3-1/2" Hinge SN (3-pack)', qty: 1, subcategory: 'Hinge' },
      { desc: 'Bifold Track Hardware Kit 4ft', qty: 1, subcategory: 'Bifold Hardware' },
      { desc: 'Door Stop Wall Mount SN', qty: 1, subcategory: 'Door Stop' },
    ],
    trim: [
      { desc: '3-1/4" Base MDF Primed', qty: 38, subcategory: 'Base' },
      { desc: '2-1/4" Casing MDF Primed', qty: 34, subcategory: 'Casing' },
      { desc: '3/4" x 3/4" Shoe Mould Primed', qty: 38, subcategory: 'Shoe Mould' },
    ],
    closet: [
      { desc: '12" Ventilated Wire Shelf White', qty: 6, unit: 'lf', subcategory: 'Closet Shelving' },
      { desc: '1-5/16" Round Closet Rod Chrome', qty: 6, unit: 'lf', subcategory: 'Closet Rod' },
      { desc: 'Pole Socket Chrome (pair)', qty: 1, unit: 'pair', subcategory: 'Pole Socket' },
      { desc: 'Shelf Bracket 12" White', qty: 3, unit: 'ea', subcategory: 'Shelf Bracket' },
    ],
  },
  'Bathroom 2': {
    doors: [
      { category: 'Interior Door', subcategory: 'Pre-Hung', desc: '2668 Flat Panel HC LH Pre-Hung 4-9/16 Jamb', qty: 1 },
    ],
    hardware: [
      { desc: 'Privacy Lever SN', qty: 1, subcategory: 'Lever' },
      { desc: '3-1/2" x 3-1/2" Hinge SN (3-pack)', qty: 1, subcategory: 'Hinge' },
      { desc: 'Door Stop Wall Mount SN', qty: 1, subcategory: 'Door Stop' },
    ],
    trim: [
      { desc: '3-1/4" Base MDF Primed', qty: 28, subcategory: 'Base' },
      { desc: '2-1/4" Casing MDF Primed', qty: 17, subcategory: 'Casing' },
      { desc: '3/4" x 3/4" Shoe Mould Primed', qty: 28, subcategory: 'Shoe Mould' },
    ],
  },
  'Bathroom 3': {
    doors: [
      { category: 'Interior Door', subcategory: 'Pre-Hung', desc: '2468 Flat Panel HC RH Pre-Hung 4-9/16 Jamb', qty: 1 },
    ],
    hardware: [
      { desc: 'Privacy Lever SN', qty: 1, subcategory: 'Lever' },
      { desc: '3-1/2" x 3-1/2" Hinge SN (3-pack)', qty: 1, subcategory: 'Hinge' },
      { desc: 'Door Stop Wall Mount SN', qty: 1, subcategory: 'Door Stop' },
    ],
    trim: [
      { desc: '3-1/4" Base MDF Primed', qty: 22, subcategory: 'Base' },
      { desc: '2-1/4" Casing MDF Primed', qty: 17, subcategory: 'Casing' },
    ],
  },
  'Powder Room': {
    doors: [
      { category: 'Interior Door', subcategory: 'Pre-Hung', desc: '2468 2-Panel Shaker HC RH Pre-Hung 4-9/16 Jamb', qty: 1 },
    ],
    hardware: [
      { desc: 'Privacy Lever SN', qty: 1, subcategory: 'Lever' },
      { desc: '3-1/2" x 3-1/2" Hinge SN (3-pack)', qty: 1, subcategory: 'Hinge' },
      { desc: 'Door Stop Hinge Pin SN', qty: 1, subcategory: 'Door Stop' },
    ],
    trim: [
      { desc: '3-1/4" Base MDF Primed', qty: 20, subcategory: 'Base' },
      { desc: '2-1/4" Casing MDF Primed', qty: 17, subcategory: 'Casing' },
    ],
  },
  'Laundry': {
    doors: [
      { category: 'Interior Door', subcategory: 'Pre-Hung', desc: '2668 Flat Panel HC RH Pre-Hung 4-9/16 Jamb', qty: 1 },
    ],
    hardware: [
      { desc: 'Passage Lever SN', qty: 1, subcategory: 'Lever' },
      { desc: '3-1/2" x 3-1/2" Hinge SN (3-pack)', qty: 1, subcategory: 'Hinge' },
      { desc: 'Door Stop Wall Mount SN', qty: 1, subcategory: 'Door Stop' },
    ],
    trim: [
      { desc: '3-1/4" Base MDF Primed', qty: 24, subcategory: 'Base' },
      { desc: '2-1/4" Casing MDF Primed', qty: 17, subcategory: 'Casing' },
    ],
    closet: [
      { desc: '16" Ventilated Wire Shelf White', qty: 4, unit: 'lf', subcategory: 'Closet Shelving' },
      { desc: 'Shelf Bracket 16" White', qty: 3, unit: 'ea', subcategory: 'Shelf Bracket' },
    ],
  },
  'Pantry': {
    doors: [
      { category: 'Interior Door', subcategory: 'Pre-Hung', desc: '2468 2-Panel Shaker HC LH Pre-Hung 4-9/16 Jamb', qty: 1 },
    ],
    hardware: [
      { desc: 'Passage Lever SN', qty: 1, subcategory: 'Lever' },
      { desc: '3-1/2" x 3-1/2" Hinge SN (3-pack)', qty: 1, subcategory: 'Hinge' },
    ],
    trim: [
      { desc: '2-1/4" Casing MDF Primed', qty: 17, subcategory: 'Casing' },
    ],
    closet: [
      { desc: '16" Ventilated Wire Shelf White', qty: 16, unit: 'lf', subcategory: 'Closet Shelving' },
      { desc: 'Shelf Bracket 16" White', qty: 8, unit: 'ea', subcategory: 'Shelf Bracket' },
    ],
  },
  'Hall Coat Closet': {
    doors: [
      { category: 'Interior Door', subcategory: 'Bifold', desc: '4068 Bifold 2-Panel Shaker', qty: 1 },
    ],
    hardware: [
      { desc: 'Bifold Knob SN', qty: 1, subcategory: 'Bifold Hardware' },
      { desc: 'Bifold Track Hardware Kit 4ft', qty: 1, subcategory: 'Bifold Hardware' },
    ],
    trim: [
      { desc: '2-1/4" Casing MDF Primed', qty: 17, subcategory: 'Casing' },
    ],
    closet: [
      { desc: '12" Ventilated Wire Shelf White', qty: 4, unit: 'lf', subcategory: 'Closet Shelving' },
      { desc: '1-5/16" Round Closet Rod Chrome', qty: 4, unit: 'lf', subcategory: 'Closet Rod' },
      { desc: 'Pole Socket Chrome (pair)', qty: 1, unit: 'pair', subcategory: 'Pole Socket' },
      { desc: 'Shelf Bracket 12" White', qty: 2, unit: 'ea', subcategory: 'Shelf Bracket' },
    ],
  },
  'Linen Closet': {
    doors: [
      { category: 'Interior Door', subcategory: 'Bifold', desc: '2468 Bifold 2-Panel Shaker', qty: 1 },
    ],
    hardware: [
      { desc: 'Bifold Knob SN', qty: 1, subcategory: 'Bifold Hardware' },
      { desc: 'Bifold Track Hardware Kit 2ft', qty: 1, subcategory: 'Bifold Hardware' },
    ],
    trim: [
      { desc: '2-1/4" Casing MDF Primed', qty: 14, subcategory: 'Casing' },
    ],
    closet: [
      { desc: '16" Ventilated Wire Shelf White', qty: 12, unit: 'lf', subcategory: 'Closet Shelving' },
      { desc: 'Shelf Bracket 16" White', qty: 6, unit: 'ea', subcategory: 'Shelf Bracket' },
    ],
  },
  'Garage Entry': {
    doors: [
      { category: 'Interior Door', subcategory: 'Fire-Rated', desc: '2868 Flat Panel SC 20min Fire LH Pre-Hung 4-9/16 Jamb', qty: 1 },
    ],
    hardware: [
      { desc: 'Passage Lever SN', qty: 1, subcategory: 'Lever' },
      { desc: '3-1/2" x 3-1/2" Hinge SN (3-pack)', qty: 1, subcategory: 'Hinge' },
      { desc: 'Door Stop Wall Mount SN', qty: 1, subcategory: 'Door Stop' },
    ],
    trim: [
      { desc: '2-1/4" Casing MDF Primed', qty: 17, subcategory: 'Casing' },
    ],
    specialty: [
      { category: 'Miscellaneous', desc: 'Door Sweep Aluminum/Vinyl 36"', qty: 1, subcategory: 'Weatherstrip' },
    ],
  },
  'Front Entry': {
    doors: [
      { category: 'Exterior Door', subcategory: 'Entry', desc: '3068 Fiberglass 6-Panel Entry Door Pre-Hung', qty: 1 },
    ],
    hardware: [
      { desc: 'Entry Handleset ORB', qty: 1, subcategory: 'Handleset' },
      { desc: 'Single Cylinder Deadbolt ORB', qty: 1, subcategory: 'Deadbolt' },
      { desc: '4" x 4" Ball Bearing Hinge ORB (3-pack)', qty: 1, subcategory: 'Hinge' },
    ],
    trim: [
      { desc: '3-1/2" Exterior Casing PVC', qty: 17, subcategory: 'Exterior Casing' },
    ],
    specialty: [
      { category: 'Miscellaneous', desc: 'Adjustable Threshold Oak/Aluminum 36"', qty: 1, subcategory: 'Threshold' },
      { category: 'Miscellaneous', desc: 'Weatherstrip Set Fiberglass Door', qty: 1, unit: 'set', subcategory: 'Weatherstrip' },
    ],
  },
  'Back/Patio Entry': {
    doors: [
      { category: 'Exterior Door', subcategory: 'Patio/Sliding', desc: '6068 Sliding Patio Door Vinyl White', qty: 1 },
    ],
    hardware: [
      { desc: 'Sliding Door Handle Set Keyed ORB', qty: 1, subcategory: 'Sliding Hardware' },
    ],
    trim: [
      { desc: '3-1/2" Exterior Casing PVC', qty: 20, subcategory: 'Exterior Casing' },
      { desc: '2-1/4" Interior Casing MDF Primed', qty: 20, subcategory: 'Casing' },
    ],
    specialty: [
      { category: 'Miscellaneous', desc: 'Sliding Door Track Cover', qty: 1, subcategory: 'Threshold' },
    ],
  },
  'Side Entry': {
    doors: [
      { category: 'Exterior Door', subcategory: 'Entry', desc: '2868 Steel 6-Panel Entry Door Pre-Hung', qty: 1 },
    ],
    hardware: [
      { desc: 'Entry Knob/Deadbolt Combo ORB', qty: 1, unit: 'set', subcategory: 'Handleset' },
      { desc: '4" x 4" Ball Bearing Hinge ORB (3-pack)', qty: 1, subcategory: 'Hinge' },
    ],
    trim: [
      { desc: '3-1/2" Exterior Casing PVC', qty: 17, subcategory: 'Exterior Casing' },
    ],
    specialty: [
      { category: 'Miscellaneous', desc: 'Adjustable Threshold Oak/Aluminum 36"', qty: 1, subcategory: 'Threshold' },
      { category: 'Miscellaneous', desc: 'Weatherstrip Set Steel Door', qty: 1, unit: 'set', subcategory: 'Weatherstrip' },
    ],
  },
  'Attic Access': {
    doors: [
      { category: 'Interior Door', subcategory: 'Attic Access', desc: '2244 Attic Access Door Drywall Bead', qty: 1 },
    ],
    hardware: [
      { desc: 'Attic Access Spring Hinge Kit', qty: 1, unit: 'set', subcategory: 'Specialty Hardware' },
    ],
    trim: [
      { desc: '2-1/4" Casing MDF Primed', qty: 10, subcategory: 'Casing' },
    ],
  },
}

// ─── MUD BENCH / SPECIALTY ROOM TEMPLATES ────────────────────────────
const SPECIALTY_TEMPLATES: Record<string, Array<{ category: string; subcategory?: string; desc: string; qty: number; unit?: 'ea' | 'lf' | 'set' | 'pair' | 'pc' }>> = {
  'Mud Room / Drop Zone': [
    { category: 'Interior Door', subcategory: 'Pre-Hung', desc: '2868 2-Panel Shaker HC RH Pre-Hung 4-9/16 Jamb', qty: 1 },
    { category: 'Hardware', subcategory: 'Lever', desc: 'Passage Lever SN', qty: 1 },
    { category: 'Trim', subcategory: 'Base', desc: '3-1/4" Base MDF Primed', qty: 32 },
    { category: 'Trim', subcategory: 'Casing', desc: '2-1/4" Casing MDF Primed', qty: 17 },
    { category: 'Trim', subcategory: 'Crown', desc: '3-5/8" Crown MDF Primed', qty: 32 },
    { category: 'Specialty', subcategory: 'Mud Bench', desc: 'Mud Bench Top Pine 1x12 Clear', qty: 6, unit: 'lf' },
    { category: 'Specialty', subcategory: 'Mud Bench', desc: 'Mud Bench Bead Board Wainscot Panel 4x8', qty: 2 },
    { category: 'Specialty', subcategory: 'Mud Bench', desc: 'Mud Bench Coat Hook Rail 4ft', qty: 1 },
    { category: 'Closet Component', subcategory: 'Closet Shelving', desc: '12" Ventilated Wire Shelf White', qty: 6, unit: 'lf' },
    { category: 'Closet Component', subcategory: 'Shelf Bracket', desc: 'Shelf Bracket 12" White', qty: 3 },
  ],
  'Study / Office': [
    { category: 'Interior Door', subcategory: 'Pre-Hung', desc: '2868 2-Panel Shaker HC LH Pre-Hung 4-9/16 Jamb', qty: 1 },
    { category: 'Hardware', subcategory: 'Lever', desc: 'Passage Lever SN', qty: 1 },
    { category: 'Trim', subcategory: 'Base', desc: '3-1/4" Base MDF Primed', qty: 42 },
    { category: 'Trim', subcategory: 'Casing', desc: '2-1/4" Casing MDF Primed', qty: 17 },
    { category: 'Trim', subcategory: 'Crown', desc: '3-5/8" Crown MDF Primed', qty: 42 },
    { category: 'Closet Component', subcategory: 'Closet Shelving', desc: '12" Ventilated Wire Shelf White', qty: 4, unit: 'lf' },
    { category: 'Closet Component', subcategory: 'Shelf Bracket', desc: 'Shelf Bracket 12" White', qty: 2 },
  ],
}

// ─── WINDOW TRIM TEMPLATES (optional add-on) ────────────────────────
interface WindowTrimSet {
  stoolDesc: string
  apronDesc: string
  casingDesc: string
  stoolQty: number // LF per window
  apronQty: number // LF per window
  casingQty: number // LF per window
}

const WINDOW_TRIM: WindowTrimSet = {
  stoolDesc: '11/16" x 3-1/2" Window Stool Pine',
  apronDesc: '11/16" x 2-1/2" Window Apron Pine',
  casingDesc: '2-1/4" Window Casing MDF Primed',
  stoolQty: 4,
  apronQty: 4,
  casingQty: 14,
}

// Window count estimates by room
const WINDOW_COUNTS: Record<string, number> = {
  'Master Bedroom': 3,
  'Master Bathroom': 1,
  'Bedroom 2': 2,
  'Bedroom 3': 2,
  'Bedroom 4': 2,
  'Bathroom 2': 1,
  'Bathroom 3': 1,
  'Powder Room': 0,
  'Laundry': 1,
  'Pantry': 0,
  'Kitchen': 2,
  'Living Room': 4,
  'Dining Room': 2,
  'Study / Office': 2,
  'Mud Room / Drop Zone': 1,
  'Front Entry': 1,
  'Back/Patio Entry': 0,
  'Side Entry': 0,
}

// ─── WHOLE-HOUSE items (not room-specific) ──────────────────────────
const WHOLE_HOUSE_ITEMS: Array<{ category: string; subcategory?: string; desc: string; qty: number; unit?: 'ea' | 'lf' | 'set' | 'pair' | 'pc'; location: string }> = [
  // Hallway trim (not tied to a specific room)
  { category: 'Trim', subcategory: 'Base', desc: '3-1/4" Base MDF Primed', qty: 48, unit: 'lf', location: 'Hallways' },
  { category: 'Trim', subcategory: 'Shoe Mould', desc: '3/4" x 3/4" Shoe Mould Primed', qty: 48, unit: 'lf', location: 'Hallways' },
  // Living/Great Room base (open plan — no doors)
  { category: 'Trim', subcategory: 'Base', desc: '3-1/4" Base MDF Primed', qty: 72, unit: 'lf', location: 'Living Room / Great Room' },
  { category: 'Trim', subcategory: 'Shoe Mould', desc: '3/4" x 3/4" Shoe Mould Primed', qty: 72, unit: 'lf', location: 'Living Room / Great Room' },
  // Kitchen base
  { category: 'Trim', subcategory: 'Base', desc: '3-1/4" Base MDF Primed', qty: 24, unit: 'lf', location: 'Kitchen' },
  // Dining Room
  { category: 'Trim', subcategory: 'Base', desc: '3-1/4" Base MDF Primed', qty: 40, unit: 'lf', location: 'Dining Room' },
  { category: 'Trim', subcategory: 'Chair Rail', desc: '2-1/2" Chair Rail MDF Primed', qty: 40, unit: 'lf', location: 'Dining Room' },
  // Staircase (if applicable)
  { category: 'Trim', subcategory: 'Base', desc: '3-1/4" Base MDF Primed', qty: 24, unit: 'lf', location: 'Staircase' },
]

/**
 * Process a blueprint and generate a comprehensive takeoff.
 * Covers: doors (interior + exterior), hardware (levers, hinges, stops, deadbolts),
 * trim (base, casing, crown, shoe, chair rail), closet components (shelving, rods,
 * pole sockets, brackets), window trim (stool, apron, casing), specialty items
 * (mud bench, thresholds, weatherstripping, attic access).
 */
export async function processBlueprint(
  request: TakeoffRequest
): Promise<TakeoffResult> {
  const startTime = Date.now()

  // Simulate AI processing time (2-5 seconds)
  await new Promise((resolve) => setTimeout(resolve, 2000 + Math.random() * 3000))

  const sqFt = request.sqFootage || 2200
  const includeWindowTrim = request.includeWindowTrim !== false // default true
  const includeCloset = request.includeClosetComponents !== false // default true
  const includeSpecialty = request.includeSpecialty !== false // default true

  // ─── SELECT ROOMS BASED ON SQ FOOTAGE ───────────────────────────
  const allRoomKeys = Object.keys(ROOM_TEMPLATES) as (keyof typeof ROOM_TEMPLATES)[]

  let selectedRooms: string[]
  if (sqFt < 1200) {
    // Starter home
    selectedRooms = [
      'Master Bedroom', 'Master Bathroom', 'Bedroom 2',
      'Bathroom 2', 'Laundry', 'Pantry', 'Hall Coat Closet',
      'Garage Entry', 'Front Entry',
    ]
  } else if (sqFt < 1800) {
    // Small home
    selectedRooms = [
      'Master Bedroom', 'Master Bathroom', 'Bedroom 2', 'Bedroom 3',
      'Bathroom 2', 'Powder Room', 'Laundry', 'Pantry',
      'Hall Coat Closet', 'Linen Closet',
      'Garage Entry', 'Front Entry', 'Back/Patio Entry',
      'Attic Access',
    ]
  } else if (sqFt < 2800) {
    // Standard home
    selectedRooms = allRoomKeys.filter(r => r !== 'Bedroom 4' && r !== 'Bathroom 3')
  } else {
    // Large home — everything plus extras
    selectedRooms = [...allRoomKeys]
  }

  // Add specialty rooms for larger homes
  const selectedSpecialty: string[] = []
  if (includeSpecialty) {
    if (sqFt >= 2000) selectedSpecialty.push('Mud Room / Drop Zone')
    if (sqFt >= 2200) selectedSpecialty.push('Study / Office')
  }

  const items: TakeoffItemResult[] = []

  // ─── PROCESS EACH ROOM ──────────────────────────────────────────
  for (const roomName of selectedRooms) {
    const room = ROOM_TEMPLATES[roomName]
    if (!room) continue

    // Doors
    for (const door of room.doors) {
      items.push({
        category: door.category,
        subcategory: door.subcategory,
        description: door.desc,
        location: roomName,
        quantity: door.qty,
        unit: 'ea',
        confidence: 0.88 + Math.random() * 0.10,
      })
    }

    // Hardware
    for (const hw of room.hardware) {
      items.push({
        category: 'Hardware',
        subcategory: hw.subcategory,
        description: hw.desc,
        location: roomName,
        quantity: hw.qty,
        unit: 'ea',
        confidence: 0.90 + Math.random() * 0.08,
      })
    }

    // Trim
    for (const trim of room.trim) {
      items.push({
        category: 'Trim',
        subcategory: trim.subcategory,
        description: trim.desc,
        location: roomName,
        quantity: trim.qty,
        unit: 'lf',
        confidence: 0.85 + Math.random() * 0.12,
      })
    }

    // Closet components
    if (includeCloset && room.closet) {
      for (const c of room.closet) {
        items.push({
          category: 'Closet Component',
          subcategory: c.subcategory,
          description: c.desc,
          location: roomName,
          quantity: c.qty,
          unit: (c.unit as any) || 'ea',
          confidence: 0.90 + Math.random() * 0.08,
        })
      }
    }

    // Specialty items (thresholds, weatherstrip, sweeps)
    if (room.specialty) {
      for (const s of room.specialty) {
        items.push({
          category: s.category,
          subcategory: s.subcategory,
          description: s.desc,
          location: roomName,
          quantity: s.qty,
          unit: (s.unit as any) || 'ea',
          confidence: 0.88 + Math.random() * 0.10,
        })
      }
    }
  }

  // ─── SPECIALTY ROOMS (mud bench, study, etc.) ──────────────────
  for (const specName of selectedSpecialty) {
    const specItems = SPECIALTY_TEMPLATES[specName]
    if (!specItems) continue
    for (const s of specItems) {
      items.push({
        category: s.category,
        subcategory: s.subcategory,
        description: s.desc,
        location: specName,
        quantity: s.qty,
        unit: (s.unit as any) || 'ea',
        confidence: 0.85 + Math.random() * 0.12,
      })
    }
  }

  // ─── WHOLE-HOUSE ITEMS (hallways, living, dining, kitchen) ─────
  for (const item of WHOLE_HOUSE_ITEMS) {
    // Scale quantities by house size
    const scaleFactor = sqFt < 1500 ? 0.7 : sqFt < 2500 ? 1.0 : 1.3
    // Skip staircase for single-story (assume 2-story if > 2000 sqft)
    if (item.location === 'Staircase' && sqFt < 2000) continue
    // Skip dining chair rail for smaller homes
    if (item.subcategory === 'Chair Rail' && sqFt < 2000) continue

    items.push({
      category: item.category,
      subcategory: item.subcategory,
      description: item.desc,
      location: item.location,
      quantity: Math.round(item.qty * scaleFactor),
      unit: (item.unit as any) || 'ea',
      confidence: 0.87 + Math.random() * 0.10,
    })
  }

  // ─── WINDOW TRIM (optional add-on) ────────────────────────────
  if (includeWindowTrim) {
    const allRoomsForWindows = [...selectedRooms, ...selectedSpecialty]
    for (const roomName of allRoomsForWindows) {
      const windowCount = WINDOW_COUNTS[roomName] || 0
      if (windowCount === 0) continue

      items.push({
        category: 'Window Trim',
        subcategory: 'Window Stool',
        description: WINDOW_TRIM.stoolDesc,
        location: roomName,
        quantity: windowCount * WINDOW_TRIM.stoolQty,
        unit: 'lf',
        confidence: 0.82 + Math.random() * 0.14,
        notes: `${windowCount} window(s) detected`,
      })
      items.push({
        category: 'Window Trim',
        subcategory: 'Window Apron',
        description: WINDOW_TRIM.apronDesc,
        location: roomName,
        quantity: windowCount * WINDOW_TRIM.apronQty,
        unit: 'lf',
        confidence: 0.82 + Math.random() * 0.14,
      })
      items.push({
        category: 'Window Trim',
        subcategory: 'Window Casing',
        description: WINDOW_TRIM.casingDesc,
        location: roomName,
        quantity: windowCount * WINDOW_TRIM.casingQty,
        unit: 'lf',
        confidence: 0.82 + Math.random() * 0.14,
      })
    }
  }

  // ─── ADD CONFIDENCE ROUNDING AND LOW-CONFIDENCE NOTES ──────────
  for (const item of items) {
    item.confidence = Math.round(item.confidence * 100) / 100
    if (item.confidence < 0.88) {
      item.notes = item.notes || 'Low confidence — verify against blueprint'
    }
  }

  // ─── BUILD SUMMARY ────────────────────────────────────────────
  const interiorDoors = items.filter(i => i.category === 'Interior Door').length
  const exteriorDoors = items.filter(i => i.category === 'Exterior Door').length
  const hardwareCount = items.filter(i => i.category === 'Hardware').length
  const trimLF = items.filter(i => i.category === 'Trim' || i.category === 'Window Trim')
    .reduce((sum, i) => sum + i.quantity, 0)
  const closetCount = items.filter(i => i.category === 'Closet Component').length
  const windowTrimPieces = items.filter(i => i.category === 'Window Trim').length
  const specialtyCount = items.filter(i => i.category === 'Specialty' || i.category === 'Miscellaneous').length

  const avgConfidence = items.reduce((sum, i) => sum + i.confidence, 0) / items.length

  const summary: TakeoffSummary = {
    totalItems: items.length,
    interiorDoors,
    exteriorDoors,
    hardware: hardwareCount,
    trimLinearFeet: trimLF,
    closetComponents: closetCount,
    windowTrimPieces,
    specialtyItems: specialtyCount,
    rooms: selectedRooms.length + selectedSpecialty.length,
  }

  return {
    confidence: Math.round(avgConfidence * 100) / 100,
    items,
    processingTimeMs: Date.now() - startTime,
    summary,
    notes: [
      `Detected ${summary.rooms} rooms/areas from ${sqFt.toLocaleString()} sq ft blueprint`,
      `${interiorDoors} interior doors (pre-hung, bifold, fire-rated, attic access)`,
      `${exteriorDoors} exterior doors (entry, patio/sliding)`,
      `${hardwareCount} hardware items (levers, deadbolts, hinges, stops, bifold kits)`,
      `~${trimLF.toLocaleString()} LF total trim (base, casing, shoe, crown, chair rail, exterior)`,
      closetCount > 0 ? `${closetCount} closet components (shelving, rods, pole sockets, brackets)` : '',
      windowTrimPieces > 0 ? `${windowTrimPieces} window trim pieces (stools, aprons, casing)` : '',
      specialtyCount > 0 ? `${specialtyCount} specialty items (mud bench, thresholds, weatherstrip)` : '',
      sqFt < 1800 ? 'Compact floor plan — reduced room count' : sqFt > 2800 ? 'Large floor plan — full room set + extras' : 'Standard residential floor plan',
    ].filter(Boolean),
  }
}
