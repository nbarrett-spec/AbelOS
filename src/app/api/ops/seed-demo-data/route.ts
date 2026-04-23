export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ═══════════════════════════════════════════════════════════════════════
// POST /api/ops/seed-demo-data
// Populates the ENTIRE Abel OS database with realistic sample data.
// Designed to make every page in the system show meaningful content.
//
// IDEMPOTENT: Deletes existing demo data (by known IDs) before re-seeding.
// SAFE: Only creates demo records; does not touch real production data.
// ═══════════════════════════════════════════════════════════════════════

const ID = (prefix: string, n: number) => `seed_${prefix}_${String(n).padStart(3, '0')}`
const NOW = new Date()
const TODAY = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate())
const daysAgo = (d: number) => new Date(TODAY.getTime() - d * 86400000)
const daysFromNow = (d: number) => new Date(TODAY.getTime() + d * 86400000)

// ─── REALISTIC ABEL LUMBER DATA ─────────────────────────────────────

const BUILDERS = [
  { id: ID('bld', 1), companyName: 'Brookfield Residential', contactName: 'Amanda Barham', email: 'amanda.barham@brookfieldresidential.com', phone: '469-555-0101', city: 'Dallas', state: 'TX', builderType: 'PRODUCTION', paymentTerm: 'NET_30', creditLimit: 250000, annualVolume: 800, territory: 'DFW North' },
  { id: ID('bld', 2), companyName: 'Bloomfield Homes', contactName: 'Mike Anderson', email: 'mike.a@bloomfieldhomes.com', phone: '817-555-0202', city: 'Fort Worth', state: 'TX', builderType: 'PRODUCTION', paymentTerm: 'NET_15', creditLimit: 175000, annualVolume: 500, territory: 'DFW West' },
  { id: ID('bld', 3), companyName: 'Cross Custom Homes', contactName: 'Dave Cross', email: 'dave@crosscustom.com', phone: '214-555-0303', city: 'Southlake', state: 'TX', builderType: 'CUSTOM', paymentTerm: 'NET_15', creditLimit: 100000, annualVolume: 40, territory: 'DFW' },
  { id: ID('bld', 4), companyName: 'Highland Homes', contactName: 'Robert Schultz', email: 'rschultz@highlandhomes.com', phone: '972-555-0404', city: 'Plano', state: 'TX', builderType: 'PRODUCTION', paymentTerm: 'NET_30', creditLimit: 200000, annualVolume: 600, territory: 'DFW North' },
  { id: ID('bld', 5), companyName: 'Grand Homes', contactName: 'Lisa Chen', email: 'lchen@grandhomes.com', phone: '972-555-0505', city: 'Frisco', state: 'TX', builderType: 'PRODUCTION', paymentTerm: 'NET_15', creditLimit: 150000, annualVolume: 350, territory: 'DFW North' },
  { id: ID('bld', 6), companyName: 'Trophy Signature Homes', contactName: 'Jason White', email: 'jwhite@trophysig.com', phone: '469-555-0606', city: 'Haslet', state: 'TX', builderType: 'PRODUCTION', paymentTerm: 'PAY_ON_DELIVERY', creditLimit: 100000, annualVolume: 200, territory: 'DFW Northwest' },
  { id: ID('bld', 7), companyName: 'Ashton Woods Homes', contactName: 'Sarah Miller', email: 'smiller@ashtonwoods.com', phone: '214-555-0707', city: 'McKinney', state: 'TX', builderType: 'PRODUCTION', paymentTerm: 'NET_30', creditLimit: 180000, annualVolume: 400, territory: 'DFW North' },
  { id: ID('bld', 8), companyName: 'Matteson Custom Homes', contactName: 'Tom Matteson', email: 'tom@mattesoncustom.com', phone: '817-555-0808', city: 'Westlake', state: 'TX', builderType: 'CUSTOM', paymentTerm: 'PAY_AT_ORDER', creditLimit: 75000, annualVolume: 15, territory: 'DFW' },
  { id: ID('bld', 9), companyName: 'Shaddock Homes', contactName: 'Pete Rodriguez', email: 'prodriguez@shaddockhomes.com', phone: '972-555-0909', city: 'Allen', state: 'TX', builderType: 'PRODUCTION', paymentTerm: 'NET_15', creditLimit: 120000, annualVolume: 250, territory: 'DFW East' },
  { id: ID('bld', 10), companyName: 'Covenant Custom Homes', contactName: 'Brian Foster', email: 'brian@covenantcustom.com', phone: '940-555-1010', city: 'Denton', state: 'TX', builderType: 'CUSTOM', paymentTerm: 'NET_15', creditLimit: 50000, annualVolume: 20, territory: 'Denton' },
]

const PRODUCTS = [
  // Interior Doors - Pre-Hung
  { id: ID('prod', 1), sku: 'ID-2068-2PNL-HC-LH', name: '2068 2-Panel Shaker Hollow Core LH Pre-Hung', category: 'Interior Doors', subcategory: 'Pre-Hung', cost: 85, basePrice: 142, doorSize: '2068', handing: 'LH', coreType: 'Hollow', panelStyle: '2-Panel Shaker' },
  { id: ID('prod', 2), sku: 'ID-2068-2PNL-HC-RH', name: '2068 2-Panel Shaker Hollow Core RH Pre-Hung', category: 'Interior Doors', subcategory: 'Pre-Hung', cost: 85, basePrice: 142, doorSize: '2068', handing: 'RH', coreType: 'Hollow', panelStyle: '2-Panel Shaker' },
  { id: ID('prod', 3), sku: 'ID-2868-2PNL-HC-LH', name: '2868 2-Panel Shaker Hollow Core LH Pre-Hung', category: 'Interior Doors', subcategory: 'Pre-Hung', cost: 95, basePrice: 158, doorSize: '2868', handing: 'LH', coreType: 'Hollow', panelStyle: '2-Panel Shaker' },
  { id: ID('prod', 4), sku: 'ID-2868-2PNL-HC-RH', name: '2868 2-Panel Shaker Hollow Core RH Pre-Hung', category: 'Interior Doors', subcategory: 'Pre-Hung', cost: 95, basePrice: 158, doorSize: '2868', handing: 'RH', coreType: 'Hollow', panelStyle: '2-Panel Shaker' },
  { id: ID('prod', 5), sku: 'ID-2068-FLT-SC-LH', name: '2068 Flat Panel Solid Core LH Pre-Hung', category: 'Interior Doors', subcategory: 'Pre-Hung', cost: 145, basePrice: 242, doorSize: '2068', handing: 'LH', coreType: 'Solid', panelStyle: 'Flat' },
  { id: ID('prod', 6), sku: 'ID-2068-FLT-SC-RH', name: '2068 Flat Panel Solid Core RH Pre-Hung', category: 'Interior Doors', subcategory: 'Pre-Hung', cost: 145, basePrice: 242, doorSize: '2068', handing: 'RH', coreType: 'Solid', panelStyle: 'Flat' },
  // Interior Doors - Slab
  { id: ID('prod', 7), sku: 'ID-SLB-2068-2PNL-HC', name: '2068 2-Panel Shaker Hollow Core Slab', category: 'Interior Doors', subcategory: 'Slab', cost: 38, basePrice: 65, doorSize: '2068', coreType: 'Hollow', panelStyle: '2-Panel Shaker' },
  { id: ID('prod', 8), sku: 'ID-SLB-2868-6PNL-HC', name: '2868 6-Panel Hollow Core Slab', category: 'Interior Doors', subcategory: 'Slab', cost: 42, basePrice: 72, doorSize: '2868', coreType: 'Hollow', panelStyle: '6-Panel' },
  // Exterior Doors
  { id: ID('prod', 9), sku: 'ED-3068-FG-LH', name: '3068 Fiberglass Entry LH', category: 'Exterior Doors', subcategory: 'Entry', cost: 420, basePrice: 695, doorSize: '3068', handing: 'LH', material: 'Fiberglass' },
  { id: ID('prod', 10), sku: 'ED-3068-FG-RH', name: '3068 Fiberglass Entry RH', category: 'Exterior Doors', subcategory: 'Entry', cost: 420, basePrice: 695, doorSize: '3068', handing: 'RH', material: 'Fiberglass' },
  { id: ID('prod', 11), sku: 'ED-6068-FG-DBL', name: '6068 Fiberglass Double Entry', category: 'Exterior Doors', subcategory: 'Entry', cost: 850, basePrice: 1395, doorSize: '6068', material: 'Fiberglass' },
  { id: ID('prod', 12), sku: 'ED-PATIO-6068-SLD', name: '6068 Sliding Patio Door', category: 'Exterior Doors', subcategory: 'Patio', cost: 520, basePrice: 865, doorSize: '6068' },
  // Bifold
  { id: ID('prod', 13), sku: 'ID-BF-2068-2PNL', name: '2068 Bifold 2-Panel', category: 'Interior Doors', subcategory: 'Bifold', cost: 55, basePrice: 92, doorSize: '2068', panelStyle: '2-Panel' },
  { id: ID('prod', 14), sku: 'ID-BF-4068-2PNL', name: '4068 Bifold 2-Panel', category: 'Interior Doors', subcategory: 'Bifold', cost: 95, basePrice: 158, doorSize: '4068', panelStyle: '2-Panel' },
  // Trim
  { id: ID('prod', 15), sku: 'TR-BASE-314-PRM', name: '3-1/4" Primed MDF Baseboard', category: 'Trim', subcategory: 'Baseboard', cost: 1.20, basePrice: 2.10, material: 'MDF' },
  { id: ID('prod', 16), sku: 'TR-CASE-256-PRM', name: '2-5/8" Primed MDF Casing', category: 'Trim', subcategory: 'Casing', cost: 0.85, basePrice: 1.55, material: 'MDF' },
  { id: ID('prod', 17), sku: 'TR-CROWN-312-PRM', name: '3-1/2" Primed Crown Moulding', category: 'Trim', subcategory: 'Crown', cost: 2.10, basePrice: 3.65, material: 'MDF' },
  { id: ID('prod', 18), sku: 'TR-SHOE-PRM', name: 'Primed Quarter Round Shoe', category: 'Trim', subcategory: 'Shoe Mould', cost: 0.45, basePrice: 0.82, material: 'MDF' },
  // Hardware
  { id: ID('prod', 19), sku: 'HW-KNOB-SN-INT', name: 'Interior Knob Set Satin Nickel', category: 'Hardware', subcategory: 'Interior Knobs', cost: 12, basePrice: 22, hardwareFinish: 'SN' },
  { id: ID('prod', 20), sku: 'HW-LEVER-SN-INT', name: 'Interior Lever Set Satin Nickel', category: 'Hardware', subcategory: 'Interior Levers', cost: 18, basePrice: 32, hardwareFinish: 'SN' },
  { id: ID('prod', 21), sku: 'HW-ENTRY-BLK', name: 'Entry Handleset Matte Black', category: 'Hardware', subcategory: 'Entry Sets', cost: 85, basePrice: 145, hardwareFinish: 'BLK' },
  { id: ID('prod', 22), sku: 'HW-DEAD-SN', name: 'Deadbolt Satin Nickel', category: 'Hardware', subcategory: 'Deadbolts', cost: 22, basePrice: 38, hardwareFinish: 'SN' },
  { id: ID('prod', 23), sku: 'HW-HINGE-SN-3PK', name: 'Door Hinges Satin Nickel 3-Pack', category: 'Hardware', subcategory: 'Hinges', cost: 8, basePrice: 15, hardwareFinish: 'SN' },
  // Fire-rated
  { id: ID('prod', 24), sku: 'ID-2068-FLT-FR20-LH', name: '2068 Flat Panel 20-min Fire Rated LH', category: 'Interior Doors', subcategory: 'Fire Rated', cost: 195, basePrice: 325, doorSize: '2068', handing: 'LH', fireRating: '20min' },
  { id: ID('prod', 25), sku: 'ID-2068-FLT-FR20-RH', name: '2068 Flat Panel 20-min Fire Rated RH', category: 'Interior Doors', subcategory: 'Fire Rated', cost: 195, basePrice: 325, doorSize: '2068', handing: 'RH', fireRating: '20min' },
]

const VENDORS = [
  { id: ID('vnd', 1), name: 'Boise Cascade', code: 'BC', contactName: 'Regional Sales Team', email: 'dfwsales@bc.com', phone: '800-555-1234', avgLeadDays: 7, onTimeRate: 0.92 },
  { id: ID('vnd', 2), name: 'DW Distribution', code: 'DW', contactName: 'Jim Parker', email: 'jim@dwdist.com', phone: '972-555-2345', avgLeadDays: 5, onTimeRate: 0.95 },
  { id: ID('vnd', 3), name: 'Masonite', code: 'MASO', contactName: 'Sales Support', email: 'orders@masonite.com', phone: '800-555-3456', avgLeadDays: 14, onTimeRate: 0.88 },
  { id: ID('vnd', 4), name: 'JELD-WEN', code: 'JW', contactName: 'Dallas Rep', email: 'dallas@jeld-wen.com', phone: '800-555-4567', avgLeadDays: 10, onTimeRate: 0.85 },
  { id: ID('vnd', 5), name: 'Therma-Tru', code: 'TT', contactName: 'Shawn Brooks', email: 'sbrooks@thermatru.com', phone: '800-555-5678', avgLeadDays: 12, onTimeRate: 0.90 },
  { id: ID('vnd', 6), name: 'Emtek', code: 'EMT', contactName: 'Hardware Dept', email: 'orders@emtek.com', phone: '800-555-6789', avgLeadDays: 8, onTimeRate: 0.94 },
  { id: ID('vnd', 7), name: 'Metrie', code: 'MET', contactName: 'Brad Wilson', email: 'brad@metrie.com', phone: '800-555-7890', avgLeadDays: 6, onTimeRate: 0.91 },
]

// DFW Communities / Subdivisions
const COMMUNITIES = [
  'Canyon Ridge Estates', 'Mobberly Farms', 'Sunset Mesa', 'Heritage Ranch', 'Prairie View',
  'Willow Creek', 'Stone Gate', 'Oak Hollow', 'Lone Star Trails', 'Harvest Crossing',
  'Mustang Heights', 'Cypress Bend', 'Walsh Ranch', 'Windsong Ranch', 'Light Farms',
]

const DFW_ADDRESSES = [
  '1247 Canyon Ridge Dr', '3891 Heritage Ln', '2056 Sunset Blvd', '4712 Prairie Wind Ct',
  '886 Willow Creek Way', '1503 Stone Gate Pl', '2901 Oak Hollow Dr', '715 Lone Star Trail',
  '4388 Harvest Crossing Ln', '1967 Mustang Heights Rd', '3214 Cypress Bend Ave',
  '5502 Walsh Ranch Blvd', '2778 Windsong Way', '1134 Light Farms Rd', '4095 Brookfield Pkwy',
  '2347 Bloomfield Ct', '3680 Highland Vista Dr', '1892 Grand Oaks Ln', '5061 Trophy Ridge Way',
  '716 Ashton Woods Pl', '3345 Shaddock Creek Dr', '2109 Covenant Hills Rd',
  '4500 Matteson Manor', '1678 Cross Creek Ln', '2834 Denton Valley Dr',
]

const DFW_CITIES = ['Frisco', 'McKinney', 'Allen', 'Plano', 'Prosper', 'Celina', 'Little Elm',
  'Denton', 'Fort Worth', 'Haslet', 'Roanoke', 'Southlake', 'Westlake', 'Keller', 'Flower Mound']

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const counts: Record<string, number> = {}

  try {
    // ════════════════════════════════════════════════════════════════
    // PHASE 0: Clean up previous seed data
    // ════════════════════════════════════════════════════════════════
    const cleanupTables = [
      'Payment', 'InvoiceItem', 'CollectionAction',
      'DeliveryTracking', 'MaterialPick', 'QualityCheck',
      'DecisionNote', 'ScheduleEntry', 'Installation',
      'DealActivity', 'DocumentRequest', 'Contract',
      'PurchaseOrderItem', 'OutreachEnrollmentStep', 'OutreachEnrollment',
      'OutreachStep', 'OutreachSequence',
      'JobPhase', 'CrewMember',
      'Delivery', 'Crew',
      'Task', 'Activity', 'Notification',
      'OrderItem', 'QuoteItem', 'TakeoffItem',
      'HomeownerSelection', 'HomeownerAccess',
      'Invoice', 'Job',
      'OrderTemplateItem', 'OrderTemplate',
      'Order', 'Takeoff', 'Quote', 'Blueprint', 'Project',
      'BuilderPricing', 'AccountCategoryMargin', 'AccountMarginTarget',
      'BuilderContact', 'CommunityFloorPlan', 'CommunityNote', 'Community',
      'BuilderReferral', 'BuilderApplication',
      'Deal', 'PurchaseOrder', 'VendorProduct', 'Vendor',
      'InventoryItem', 'Product',
    ]
    for (const table of cleanupTables) {
      try {
        await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "id" LIKE 'seed_%'`)
      } catch { /* table might not exist yet */ }
    }
    // Clean Builder last (FKs)
    try { await prisma.$executeRawUnsafe(`DELETE FROM "Builder" WHERE "id" LIKE 'seed_%'`) } catch {}
    // Clean raw-SQL tables
    try { await prisma.$executeRawUnsafe(`DELETE FROM "BuilderIntelligence" WHERE "builderId" LIKE 'seed_%'`) } catch {}
    try { await prisma.$executeRawUnsafe(`DELETE FROM "AgentTask" WHERE "id" LIKE 'seed_%'`) } catch {}

    // ════════════════════════════════════════════════════════════════
    // PHASE 1: Products
    // ════════════════════════════════════════════════════════════════
    for (const p of PRODUCTS) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Product" ("id", "sku", "name", "category", "subcategory", "cost", "basePrice",
          "doorSize", "handing", "coreType", "panelStyle", "hardwareFinish", "material", "fireRating",
          "active", "inStock", "createdAt", "updatedAt")
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true,true,NOW(),NOW())
        ON CONFLICT ("sku") DO UPDATE SET "name"=$3, "cost"=$6, "basePrice"=$7, "updatedAt"=NOW()
      `, p.id, p.sku, p.name, p.category, p.subcategory || null, p.cost, p.basePrice,
        p.doorSize || null, p.handing || null, p.coreType || null, p.panelStyle || null,
        p.hardwareFinish || null, p.material || null, p.fireRating || null)
    }
    counts.products = PRODUCTS.length

    // ════════════════════════════════════════════════════════════════
    // PHASE 2: Builders
    // ════════════════════════════════════════════════════════════════
    for (const b of BUILDERS) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Builder" ("id","companyName","contactName","email","passwordHash","phone",
          "city","state","builderType","paymentTerm","creditLimit","annualVolume","territory",
          "status","emailVerified","createdAt","updatedAt")
        VALUES ($1,$2,$3,$4,'not-set',$5,$6,$7,$8::"BuilderType",$9::"PaymentTerm",$10,$11,$12,
          'ACTIVE'::"AccountStatus",true,NOW(),NOW())
        ON CONFLICT ("email") DO UPDATE SET "companyName"=$2, "updatedAt"=NOW()
      `, b.id, b.companyName, b.contactName, b.email, b.phone,
        b.city, b.state, b.builderType, b.paymentTerm, b.creditLimit, b.annualVolume, b.territory)
    }
    counts.builders = BUILDERS.length

    // ════════════════════════════════════════════════════════════════
    // PHASE 3: Builder Contacts
    // ════════════════════════════════════════════════════════════════
    const contactRoles = ['PURCHASING', 'SUPERINTENDENT', 'PROJECT_MANAGER', 'ACCOUNTS_PAYABLE']
    const contactFirstNames = ['Jennifer', 'Mike', 'Carlos', 'Beth', 'Ryan', 'Stacy', 'Derek', 'Linda']
    const contactLastNames = ['Thompson', 'Garcia', 'Davis', 'Martinez', 'Johnson', 'Lee', 'Nguyen', 'Patel']
    let contactCount = 0
    for (let bi = 0; bi < BUILDERS.length; bi++) {
      const numContacts = BUILDERS[bi].builderType === 'PRODUCTION' ? 3 : 2
      for (let ci = 0; ci < numContacts; ci++) {
        const fn = contactFirstNames[(bi * 3 + ci) % contactFirstNames.length]
        const ln = contactLastNames[(bi * 3 + ci) % contactLastNames.length]
        const role = contactRoles[ci % contactRoles.length]
        await prisma.$executeRawUnsafe(`
          INSERT INTO "BuilderContact" ("id","builderId","firstName","lastName","email","phone",
            "role","isPrimary","receivesPO","receivesInvoice","active","createdAt","updatedAt")
          VALUES ($1,$2,$3,$4,$5,$6,$7::"ContactRole",$8,$9,$10,true,NOW(),NOW())
        `, ID('bcon', bi * 10 + ci), BUILDERS[bi].id, fn, ln,
          `${fn.toLowerCase()}.${ln.toLowerCase()}@${BUILDERS[bi].email.split('@')[1]}`,
          `${BUILDERS[bi].phone?.slice(0, -4)}${String(1000 + ci).slice(1)}`,
          role, ci === 0, role === 'PURCHASING', role === 'ACCOUNTS_PAYABLE')
        contactCount++
      }
    }
    counts.contacts = contactCount

    // ════════════════════════════════════════════════════════════════
    // PHASE 4: Communities (for production builders)
    // ════════════════════════════════════════════════════════════════
    let communityCount = 0
    const productionBuilders = BUILDERS.filter(b => b.builderType === 'PRODUCTION')
    for (let bi = 0; bi < productionBuilders.length; bi++) {
      const numComm = 2
      for (let ci = 0; ci < numComm; ci++) {
        const commName = COMMUNITIES[(bi * 2 + ci) % COMMUNITIES.length]
        await prisma.$executeRawUnsafe(`
          INSERT INTO "Community" ("id","builderId","name","city","state","totalLots","activeLots",
            "status","avgOrderValue","totalRevenue","totalOrders","createdAt","updatedAt")
          VALUES ($1,$2,$3,$4,'TX',$5,$6,$7::"CommunityStatus",$8,$9,$10,NOW(),NOW())
          ON CONFLICT ("builderId","name") DO NOTHING
        `, ID('comm', bi * 10 + ci), productionBuilders[bi].id, commName,
          DFW_CITIES[(bi * 2 + ci) % DFW_CITIES.length],
          80 + ci * 40, 30 + ci * 15,
          ci === 0 ? 'ACTIVE' : 'ACTIVE',
          2500 + Math.random() * 3000, (80000 + Math.random() * 200000), 25 + Math.floor(Math.random() * 50))
        communityCount++
      }
    }
    counts.communities = communityCount

    // ════════════════════════════════════════════════════════════════
    // PHASE 5: Vendors
    // ════════════════════════════════════════════════════════════════
    for (const v of VENDORS) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Vendor" ("id","name","code","contactName","email","phone","avgLeadDays","onTimeRate","active","createdAt","updatedAt")
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,NOW(),NOW())
        ON CONFLICT ("code") DO UPDATE SET "name"=$2, "updatedAt"=NOW()
      `, v.id, v.name, v.code, v.contactName, v.email, v.phone, v.avgLeadDays, v.onTimeRate)
    }
    counts.vendors = VENDORS.length

    // ════════════════════════════════════════════════════════════════
    // PHASE 6: Projects
    // ════════════════════════════════════════════════════════════════
    const projectStatuses = ['ORDERED', 'IN_PROGRESS', 'QUOTE_APPROVED', 'TAKEOFF_COMPLETE', 'DELIVERED', 'COMPLETE']
    let projectCount = 0
    for (let bi = 0; bi < BUILDERS.length; bi++) {
      const numProjects = BUILDERS[bi].builderType === 'PRODUCTION' ? 4 : 2
      for (let pi = 0; pi < numProjects; pi++) {
        const idx = bi * 10 + pi
        const addr = DFW_ADDRESSES[idx % DFW_ADDRESSES.length]
        const city = DFW_CITIES[idx % DFW_CITIES.length]
        const comm = COMMUNITIES[idx % COMMUNITIES.length]
        await prisma.$executeRawUnsafe(`
          INSERT INTO "Project" ("id","builderId","name","jobAddress","city","state","lotNumber",
            "subdivision","planName","sqFootage","status","createdAt","updatedAt")
          VALUES ($1,$2,$3,$4,$5,'TX',$6,$7,$8,$9,$10::"ProjectStatus",NOW(),NOW())
        `, ID('proj', idx), BUILDERS[bi].id,
          `${comm} - Lot ${10 + pi}`, addr, city,
          `Lot ${10 + pi}`, comm, `Plan ${['Aspen', 'Birch', 'Cedar', 'Elm'][pi % 4]}`,
          2200 + pi * 400, projectStatuses[idx % projectStatuses.length])
        projectCount++
      }
    }
    counts.projects = projectCount

    // ════════════════════════════════════════════════════════════════
    // PHASE 7: Quotes (one per project, with items)
    // ════════════════════════════════════════════════════════════════
    // First create Takeoffs (required by Quote FK)
    let quoteCount = 0
    for (let bi = 0; bi < BUILDERS.length; bi++) {
      const numProjects = BUILDERS[bi].builderType === 'PRODUCTION' ? 4 : 2
      for (let pi = 0; pi < numProjects; pi++) {
        const idx = bi * 10 + pi
        const projId = ID('proj', idx)
        const bpId = ID('bp', idx)
        const toId = ID('to', idx)
        const qId = ID('qt', idx)

        // Blueprint
        await prisma.$executeRawUnsafe(`
          INSERT INTO "Blueprint" ("id","projectId","fileName","fileUrl","fileSize","fileType","processingStatus","createdAt")
          VALUES ($1,$2,'plan.pdf','https://storage.abel/bp/'||$1||'.pdf',250000,'pdf','COMPLETE'::"ProcessingStatus",NOW())
        `, bpId, projId)

        // Takeoff
        await prisma.$executeRawUnsafe(`
          INSERT INTO "Takeoff" ("id","projectId","blueprintId","status","confidence","createdAt","updatedAt")
          VALUES ($1,$2,$3,'APPROVED'::"TakeoffStatus",0.92,NOW(),NOW())
        `, toId, projId, bpId)

        // Quote items — typical door package
        const doorQty = 8 + pi * 2
        const trimLf = 400 + pi * 100
        const hwQty = doorQty
        const subtotal =
          doorQty * 142 + // interior doors
          1 * 695 +       // exterior entry
          1 * 865 +       // patio door
          trimLf * 2.10 + // baseboard
          trimLf * 0.6 * 1.55 + // casing
          hwQty * 22 +    // knobs
          2 * 38 +        // deadbolts
          1 * 145          // entry handleset
        const total = Math.round(subtotal * 100) / 100
        const quoteStatuses = ['DRAFT', 'SENT', 'APPROVED', 'ORDERED']

        await prisma.$executeRawUnsafe(`
          INSERT INTO "Quote" ("id","projectId","takeoffId","quoteNumber","version","subtotal","taxRate","taxAmount","termAdjustment","total","status","validUntil","createdAt","updatedAt")
          VALUES ($1,$2,$3,$4,1,$5,0,0,0,$5,$6::"QuoteStatus",$7,NOW(),NOW())
        `, qId, projId, toId, `ABL-2026-${String(1000 + idx).slice(1)}`,
          total, quoteStatuses[idx % quoteStatuses.length], daysFromNow(30))

        // Quote line items
        const quoteItems = [
          { prodIdx: 0, desc: '2068 2-Panel Shaker HC LH Pre-Hung', qty: Math.ceil(doorQty / 2), price: 142 },
          { prodIdx: 1, desc: '2068 2-Panel Shaker HC RH Pre-Hung', qty: Math.floor(doorQty / 2), price: 142 },
          { prodIdx: 8, desc: '3068 Fiberglass Entry LH', qty: 1, price: 695 },
          { prodIdx: 11, desc: '6068 Sliding Patio Door', qty: 1, price: 865 },
          { prodIdx: 14, desc: '3-1/4" Primed MDF Baseboard (LF)', qty: trimLf, price: 2.10 },
          { prodIdx: 15, desc: '2-5/8" Primed MDF Casing (LF)', qty: Math.round(trimLf * 0.6), price: 1.55 },
          { prodIdx: 18, desc: 'Interior Knob Set SN', qty: hwQty, price: 22 },
          { prodIdx: 21, desc: 'Deadbolt SN', qty: 2, price: 38 },
          { prodIdx: 20, desc: 'Entry Handleset Matte Black', qty: 1, price: 145 },
        ]
        for (let qi = 0; qi < quoteItems.length; qi++) {
          const item = quoteItems[qi]
          const lineTotal = Math.round(item.qty * item.price * 100) / 100
          await prisma.$executeRawUnsafe(`
            INSERT INTO "QuoteItem" ("id","quoteId","productId","description","quantity","unitPrice","lineTotal","sortOrder")
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          `, ID('qi', idx * 100 + qi), qId, PRODUCTS[item.prodIdx].id,
            item.desc, item.qty, item.price, lineTotal, qi)
        }
        quoteCount++
      }
    }
    counts.quotes = quoteCount

    // ════════════════════════════════════════════════════════════════
    // PHASE 8: Orders (from approved/ordered quotes) + Order Items
    // ════════════════════════════════════════════════════════════════
    const orderStatuses: string[] = ['RECEIVED', 'CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'COMPLETE']
    let orderCount = 0
    // Create orders from ~70% of projects
    for (let bi = 0; bi < BUILDERS.length; bi++) {
      const numProjects = BUILDERS[bi].builderType === 'PRODUCTION' ? 4 : 2
      for (let pi = 0; pi < numProjects; pi++) {
        const idx = bi * 10 + pi
        if (idx % 10 >= 7) continue // skip ~30%
        const qId = ID('qt', idx)
        const oId = ID('ord', idx)
        const status = orderStatuses[idx % orderStatuses.length]
        const orderDate = daysAgo(30 - (idx % 25))

        // Get quote total
        const qtRows: any[] = await prisma.$queryRawUnsafe(`SELECT "total" FROM "Quote" WHERE "id"=$1`, qId)
        const total = qtRows.length > 0 ? Number(qtRows[0].total) : 3500

        const paymentStatuses = ['PENDING', 'INVOICED', 'PAID', 'OVERDUE']
        const dueDate = new Date(orderDate.getTime() + 30 * 86400000)

        await prisma.$executeRawUnsafe(`
          INSERT INTO "Order" ("id","builderId","quoteId","orderNumber","subtotal","taxAmount","shippingCost","total",
            "paymentTerm","paymentStatus","status","orderDate","dueDate","deliveryDate","createdAt","updatedAt")
          VALUES ($1,$2,$3,$4,$5,0,0,$5,$6::"PaymentTerm",$7::"PaymentStatus",$8::"OrderStatus",$9,$10,$11,NOW(),NOW())
        `, oId, BUILDERS[bi].id, qId, `ORD-2026-${String(1000 + idx).slice(1)}`,
          total, BUILDERS[bi].paymentTerm,
          paymentStatuses[idx % paymentStatuses.length],
          status, orderDate, dueDate, daysFromNow(idx % 14))

        // Mark quote as ORDERED
        await prisma.$executeRawUnsafe(`UPDATE "Quote" SET "status"='ORDERED'::"QuoteStatus", "approvedAt"=NOW() WHERE "id"=$1`, qId)

        // Order items (simplified — 3-5 line items per order)
        const oiProducts = [
          { pidx: 0, qty: 6, price: 142 },
          { pidx: 8, qty: 1, price: 695 },
          { pidx: 14, qty: 400, price: 2.10 },
          { pidx: 18, qty: 6, price: 22 },
          { pidx: 20, qty: 1, price: 145 },
        ]
        for (let oi = 0; oi < oiProducts.length; oi++) {
          const oip = oiProducts[oi]
          await prisma.$executeRawUnsafe(`
            INSERT INTO "OrderItem" ("id","orderId","productId","description","quantity","unitPrice","lineTotal")
            VALUES ($1,$2,$3,$4,$5,$6,$7)
          `, ID('oi', idx * 100 + oi), oId, PRODUCTS[oip.pidx].id,
            PRODUCTS[oip.pidx].name, oip.qty, oip.price, Math.round(oip.qty * oip.price * 100) / 100)
        }
        orderCount++
      }
    }
    counts.orders = orderCount

    // ════════════════════════════════════════════════════════════════
    // PHASE 9: Get a Staff ID for FK references
    // ════════════════════════════════════════════════════════════════
    const staffRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id","firstName","lastName","email","role","department" FROM "Staff" WHERE "active"=true ORDER BY "role" ASC LIMIT 20
    `)
    const adminStaff = staffRows.find((s: any) => s.role === 'ADMIN') || staffRows[0]
    const pmStaff = staffRows.filter((s: any) => s.role === 'PROJECT_MANAGER' || s.department === 'PROJECT_MANAGEMENT')
    const salesStaff = staffRows.filter((s: any) => s.role === 'SALES_REP' || s.department === 'SALES' || s.department === 'BUSINESS_DEVELOPMENT')
    const driverStaff = staffRows.filter((s: any) => s.role === 'DRIVER' || s.department === 'DELIVERY')

    if (!adminStaff) {
      return NextResponse.json({ error: 'No active staff found. Run seed-employees first.' }, { status: 400 })
    }

    // ════════════════════════════════════════════════════════════════
    // PHASE 10: Jobs (from orders)
    // ════════════════════════════════════════════════════════════════
    const jobStatuses: string[] = ['CREATED', 'READINESS_CHECK', 'MATERIALS_LOCKED', 'IN_PRODUCTION', 'STAGED', 'LOADED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETE', 'INVOICED']
    let jobCount = 0
    for (let bi = 0; bi < BUILDERS.length; bi++) {
      const numProjects = BUILDERS[bi].builderType === 'PRODUCTION' ? 4 : 2
      for (let pi = 0; pi < numProjects; pi++) {
        const idx = bi * 10 + pi
        if (idx % 10 >= 7) continue
        const oId = ID('ord', idx)
        const jId = ID('job', idx)
        const pm = pmStaff.length > 0 ? pmStaff[idx % pmStaff.length] : adminStaff
        const status = jobStatuses[idx % jobStatuses.length]
        const addr = DFW_ADDRESSES[idx % DFW_ADDRESSES.length]
        const comm = COMMUNITIES[idx % COMMUNITIES.length]

        await prisma.$executeRawUnsafe(`
          INSERT INTO "Job" ("id","jobNumber","orderId","builderName","builderContact","jobAddress",
            "community","scopeType","assignedPMId","status","scheduledDate","readinessCheck","materialsLocked","loadConfirmed",
            "createdAt","updatedAt")
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8::"ScopeType",$9,$10::"JobStatus",$11,$12,$13,$14,NOW(),NOW())
        `, jId, `JOB-2026-${String(100 + idx).slice(0)}`, oId,
          BUILDERS[bi].companyName, BUILDERS[bi].contactName, addr, comm,
          'FULL_PACKAGE', pm.id, status,
          daysFromNow(-10 + idx % 20),
          ['READINESS_CHECK','MATERIALS_LOCKED','IN_PRODUCTION','STAGED','LOADED','IN_TRANSIT','DELIVERED','COMPLETE','INVOICED'].includes(status),
          ['MATERIALS_LOCKED','IN_PRODUCTION','STAGED','LOADED','IN_TRANSIT','DELIVERED','COMPLETE','INVOICED'].includes(status),
          ['LOADED','IN_TRANSIT','DELIVERED','COMPLETE','INVOICED'].includes(status))
        jobCount++
      }
    }
    counts.jobs = jobCount

    // ════════════════════════════════════════════════════════════════
    // PHASE 11: Crews + Crew Members
    // ════════════════════════════════════════════════════════════════
    const crews = [
      { id: ID('crew', 1), name: 'Delivery Team A', type: 'DELIVERY' },
      { id: ID('crew', 2), name: 'Delivery Team B', type: 'DELIVERY' },
      { id: ID('crew', 3), name: 'Install Crew Alpha', type: 'INSTALLATION' },
    ]
    for (const c of crews) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Crew" ("id","name","crewType","active","createdAt","updatedAt")
        VALUES ($1,$2,$3::"CrewType",true,NOW(),NOW())
      `, c.id, c.name, c.type)
    }
    // Assign drivers to delivery crews
    for (let di = 0; di < driverStaff.length && di < 4; di++) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "CrewMember" ("id","crewId","staffId","role","createdAt","updatedAt")
        VALUES ($1,$2,$3,$4,NOW(),NOW())
        ON CONFLICT ("crewId","staffId") DO NOTHING
      `, ID('cm', di), crews[di % 2].id, driverStaff[di].id, di === 0 ? 'Lead' : 'Driver')
    }
    counts.crews = crews.length

    // ════════════════════════════════════════════════════════════════
    // PHASE 12: Deliveries
    // ════════════════════════════════════════════════════════════════
    const deliveryStatuses = ['SCHEDULED', 'LOADING', 'IN_TRANSIT', 'COMPLETE', 'COMPLETE', 'COMPLETE']
    let deliveryCount = 0
    for (let bi = 0; bi < BUILDERS.length; bi++) {
      const numProjects = BUILDERS[bi].builderType === 'PRODUCTION' ? 4 : 2
      for (let pi = 0; pi < numProjects; pi++) {
        const idx = bi * 10 + pi
        if (idx % 10 >= 7) continue
        const jId = ID('job', idx)
        const dId = ID('del', idx)
        const addr = DFW_ADDRESSES[idx % DFW_ADDRESSES.length]
        const status = deliveryStatuses[idx % deliveryStatuses.length]
        await prisma.$executeRawUnsafe(`
          INSERT INTO "Delivery" ("id","jobId","crewId","deliveryNumber","routeOrder","address","status",
            "completedAt","notes","createdAt","updatedAt")
          VALUES ($1,$2,$3,$4,$5,$6,$7::"DeliveryStatus",$8,$9,NOW(),NOW())
        `, dId, jId, crews[idx % 2].id, `DEL-2026-${String(100 + idx)}`,
          idx % 8, addr, status,
          status === 'COMPLETE' ? daysAgo(idx % 15) : null,
          status === 'COMPLETE' ? 'Delivered successfully. All items verified.' : null)
        deliveryCount++
      }
    }
    counts.deliveries = deliveryCount

    // ════════════════════════════════════════════════════════════════
    // PHASE 12b: Schedule Entries (for dispatch board)
    // ════════════════════════════════════════════════════════════════
    let scheduleCount = 0
    for (let bi = 0; bi < BUILDERS.length; bi++) {
      const numProjects = BUILDERS[bi].builderType === 'PRODUCTION' ? 4 : 2
      for (let pi = 0; pi < numProjects; pi++) {
        const idx = bi * 10 + pi
        if (idx % 10 >= 7) continue
        const jId = ID('job', idx)
        const seId = ID('se', idx)
        const schedDate = daysFromNow(-5 + (idx % 12))
        const schedStatuses = ['TENTATIVE', 'FIRM', 'IN_PROGRESS', 'COMPLETED', 'COMPLETED']
        const sStatus = schedStatuses[idx % schedStatuses.length]
        await prisma.$executeRawUnsafe(`
          INSERT INTO "ScheduleEntry" ("id","jobId","entryType","title","scheduledDate","scheduledTime",
            "crewId","status","notes","createdAt","updatedAt")
          VALUES ($1,$2,$3::"ScheduleType",$4,$5,$6,$7,$8::"ScheduleStatus",$9,NOW(),NOW())
        `, seId, jId, 'DELIVERY',
          `Deliver to ${BUILDERS[bi].companyName} - ${COMMUNITIES[idx % COMMUNITIES.length]}`,
          schedDate, ['8:00 AM', '10:00 AM', 'PM', 'Morning'][idx % 4],
          crews[idx % 2].id, sStatus,
          sStatus === 'COMPLETED' ? 'Delivered on time' : null)
        scheduleCount++
      }
    }
    counts.scheduleEntries = scheduleCount

    // ════════════════════════════════════════════════════════════════
    // PHASE 12c: Material Picks (for warehouse picking board)
    // ════════════════════════════════════════════════════════════════
    let pickCount = 0
    for (let bi = 0; bi < Math.min(BUILDERS.length, 6); bi++) {
      const idx = bi * 10
      if (idx % 10 >= 7) continue
      const jId = ID('job', idx)
      for (let pki = 0; pki < 3; pki++) {
        const prod = PRODUCTS[pki]
        const qty = 4 + pki * 2
        const pickStatuses = ['PENDING', 'PICKING', 'PICKED', 'VERIFIED']
        await prisma.$executeRawUnsafe(`
          INSERT INTO "MaterialPick" ("id","jobId","productId","sku","description","quantity","pickedQty",
            "status","zone","createdAt")
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8::"PickStatus",$9,NOW())
        `, ID('mp', bi * 10 + pki), jId, prod.id, prod.sku, prod.name,
          qty, pickStatuses[pki % pickStatuses.length] === 'VERIFIED' ? qty : Math.floor(qty * 0.6),
          pickStatuses[pki % pickStatuses.length],
          ['A1', 'A2', 'B1'][pki])
        pickCount++
      }
    }
    counts.materialPicks = pickCount

    // ════════════════════════════════════════════════════════════════
    // PHASE 13: Invoices + Payments
    // ════════════════════════════════════════════════════════════════
    const invoiceStatuses = ['DRAFT', 'ISSUED', 'SENT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'PAID', 'OVERDUE', 'OVERDUE']
    let invoiceCount = 0
    let paymentCount = 0
    for (let bi = 0; bi < BUILDERS.length; bi++) {
      const numProjects = BUILDERS[bi].builderType === 'PRODUCTION' ? 4 : 2
      for (let pi = 0; pi < numProjects; pi++) {
        const idx = bi * 10 + pi
        if (idx % 10 >= 7) continue
        const invId = ID('inv', idx)
        const oId = ID('ord', idx)
        const jId = ID('job', idx)
        const status = invoiceStatuses[idx % invoiceStatuses.length] as string

        // Get order total
        const ordRows: any[] = await prisma.$queryRawUnsafe(`SELECT "total" FROM "Order" WHERE "id"=$1`, oId)
        const total = ordRows.length > 0 ? Number(ordRows[0].total) : 3500
        const issuedAt = daysAgo(25 - (idx % 20))
        const dueDate = new Date(issuedAt.getTime() + 30 * 86400000)
        const amountPaid = status === 'PAID' ? total : status === 'PARTIALLY_PAID' ? Math.round(total * 0.5 * 100) / 100 : 0
        const balanceDue = Math.round((total - amountPaid) * 100) / 100

        await prisma.$executeRawUnsafe(`
          INSERT INTO "Invoice" ("id","invoiceNumber","builderId","orderId","jobId","createdById",
            "subtotal","taxAmount","total","amountPaid","balanceDue",
            "status","paymentTerm","issuedAt","dueDate","paidAt","createdAt","updatedAt")
          VALUES ($1,$2,$3,$4,$5,$6,$7,0,$7,$8,$9,
            $10::"InvoiceStatus",$11::"PaymentTerm",$12,$13,$14,NOW(),NOW())
        `, invId, `INV-2026-${String(1000 + idx).slice(1)}`, BUILDERS[bi].id, oId, jId, adminStaff.id,
          total, amountPaid, balanceDue,
          status, BUILDERS[bi].paymentTerm, issuedAt, dueDate,
          status === 'PAID' ? daysAgo(5) : null)

        // Invoice items
        await prisma.$executeRawUnsafe(`
          INSERT INTO "InvoiceItem" ("id","invoiceId","description","quantity","unitPrice","lineTotal")
          VALUES ($1,$2,'Door & Trim Package',1,$3,$3)
        `, ID('ii', idx), invId, total)

        // Payments for paid/partially paid invoices
        if (amountPaid > 0) {
          const methods = ['CHECK', 'ACH', 'WIRE', 'CREDIT_CARD']
          await prisma.$executeRawUnsafe(`
            INSERT INTO "Payment" ("id","invoiceId","amount","method","reference","receivedAt")
            VALUES ($1,$2,$3,$4::"PaymentMethod",$5,$6)
          `, ID('pay', idx), invId, amountPaid,
            methods[idx % methods.length], `REF-${1000 + idx}`,
            daysAgo(3 + (idx % 10)))
          paymentCount++
        }
        invoiceCount++
      }
    }
    counts.invoices = invoiceCount
    counts.payments = paymentCount

    // ════════════════════════════════════════════════════════════════
    // PHASE 14: Collection Rules
    // ════════════════════════════════════════════════════════════════
    const collRules = [
      { id: ID('cr', 1), name: 'Friendly Reminder', days: 1, action: 'REMINDER', channel: 'EMAIL', body: 'Just a friendly reminder that your invoice is past due.' },
      { id: ID('cr', 2), name: 'Past Due Notice', days: 15, action: 'PAST_DUE', channel: 'EMAIL', body: 'Your account has an outstanding balance. Please remit payment.' },
      { id: ID('cr', 3), name: 'Phone Follow-Up', days: 30, action: 'PHONE_CALL', channel: 'PHONE', body: 'Phone call to discuss outstanding balance.' },
      { id: ID('cr', 4), name: 'Final Notice', days: 45, action: 'FINAL_NOTICE', channel: 'EMAIL', body: 'Final notice before account hold. Immediate payment required.' },
      { id: ID('cr', 5), name: 'Account Hold', days: 60, action: 'ACCOUNT_HOLD', channel: 'EMAIL', body: 'Account placed on hold. Contact accounting to resolve.' },
    ]
    for (const cr of collRules) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "CollectionRule" ("id","name","daysOverdue","actionType","channel","templateBody","isActive","createdAt","updatedAt")
        VALUES ($1,$2,$3,$4,$5,$6,true,NOW(),NOW())
        ON CONFLICT DO NOTHING
      `, cr.id, cr.name, cr.days, cr.action, cr.channel, cr.body)
    }
    counts.collectionRules = collRules.length

    // ════════════════════════════════════════════════════════════════
    // PHASE 15: Inventory Items
    // ════════════════════════════════════════════════════════════════
    const zones = ['A1', 'A2', 'B1', 'B2', 'C1', 'STAGING']
    for (let pi = 0; pi < PRODUCTS.length; pi++) {
      const p = PRODUCTS[pi]
      const isHighVolume = p.category === 'Interior Doors' || p.category === 'Trim'
      const onHand = isHighVolume ? 40 + Math.floor(Math.random() * 80) : 10 + Math.floor(Math.random() * 30)
      const committed = Math.floor(onHand * 0.3)
      const reorderPoint = isHighVolume ? 25 : 8
      // Make some items low stock for alerts
      const actualOnHand = pi % 5 === 0 ? Math.min(onHand, reorderPoint - 2) : onHand
      await prisma.$executeRawUnsafe(`
        INSERT INTO "InventoryItem" ("id","productId","sku","productName","category",
          "onHand","committed","onOrder","available","reorderPoint","reorderQty","safetyStock",
          "unitCost","avgDailyUsage","daysOfSupply","warehouseZone","binLocation","status","lastCountedAt","updatedAt")
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW())
        ON CONFLICT ("productId") DO UPDATE SET "onHand"=$6,"committed"=$7,"available"=$9,"updatedAt"=NOW()
      `, ID('inv_item', pi), p.id, p.sku, p.name, p.category,
        actualOnHand, committed, Math.floor(Math.random() * 20), actualOnHand - committed,
        reorderPoint, reorderPoint * 2, isHighVolume ? 10 : 3,
        p.cost, isHighVolume ? 3.5 : 0.8, Math.round((actualOnHand - committed) / (isHighVolume ? 3.5 : 0.8)),
        zones[pi % zones.length], `Shelf ${Math.floor(pi / 4) + 1} Row ${(pi % 4) + 1}`,
        (actualOnHand - committed) <= reorderPoint ? 'LOW_STOCK' : 'IN_STOCK',
        daysAgo(pi % 14))
    }
    counts.inventoryItems = PRODUCTS.length

    // ════════════════════════════════════════════════════════════════
    // PHASE 16: Purchase Orders
    // ════════════════════════════════════════════════════════════════
    const poStatuses = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED', 'RECEIVED']
    let poCount = 0
    for (let vi = 0; vi < VENDORS.length; vi++) {
      for (let poi = 0; poi < 2; poi++) {
        const idx = vi * 10 + poi
        const poId = ID('po', idx)
        const status = poStatuses[idx % poStatuses.length]
        const total = 2500 + Math.floor(Math.random() * 8000)
        await prisma.$executeRawUnsafe(`
          INSERT INTO "PurchaseOrder" ("id","poNumber","vendorId","createdById","status",
            "subtotal","total","orderedAt","expectedDate","notes","createdAt","updatedAt")
          VALUES ($1,$2,$3,$4,$5::"POStatus",$6,$6,$7,$8,$9,NOW(),NOW())
        `, poId, `PO-2026-${String(400 + idx)}`, VENDORS[vi].id, adminStaff.id,
          status, total, daysAgo(10 + idx), daysFromNow(idx % 14),
          `Restock order from ${VENDORS[vi].name}`)

        // PO Items
        const numItems = 2 + (idx % 3)
        for (let ii = 0; ii < numItems; ii++) {
          const prod = PRODUCTS[(vi * 3 + ii) % PRODUCTS.length]
          const qty = 10 + Math.floor(Math.random() * 30)
          await prisma.$executeRawUnsafe(`
            INSERT INTO "PurchaseOrderItem" ("id","purchaseOrderId","productId","vendorSku","description","quantity","unitCost","lineTotal","receivedQty","createdAt","updatedAt")
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
          `, ID('poi', idx * 10 + ii), poId, prod.id, prod.sku, prod.name,
            qty, prod.cost, Math.round(qty * prod.cost * 100) / 100,
            status === 'RECEIVED' ? qty : status === 'PARTIALLY_RECEIVED' ? Math.floor(qty * 0.6) : 0)
        }
        poCount++
      }
    }
    counts.purchaseOrders = poCount

    // ════════════════════════════════════════════════════════════════
    // PHASE 17: Deals (Sales Pipeline)
    // ════════════════════════════════════════════════════════════════
    const dealStages = ['PROSPECT', 'DISCOVERY', 'WALKTHROUGH', 'BID_SUBMITTED', 'BID_REVIEW', 'NEGOTIATION', 'WON', 'LOST']
    const dealProspects = [
      { company: 'Perry Homes', contact: 'Tim Perry', value: 180000, city: 'Houston', source: 'OUTBOUND' },
      { company: 'Taylor Morrison', contact: 'Angela Scott', value: 220000, city: 'Dallas', source: 'INBOUND' },
      { company: 'Lennar', contact: 'Marcus Webb', value: 350000, city: 'Fort Worth', source: 'TRADE_SHOW' },
      { company: 'DR Horton', contact: 'Kim Patel', value: 400000, city: 'Arlington', source: 'OUTBOUND' },
      { company: 'KB Home', contact: 'Frank Rodriguez', value: 150000, city: 'Plano', source: 'REFERRAL' },
      { company: 'Meritage Homes', contact: 'Susan Chang', value: 200000, city: 'McKinney', source: 'INBOUND' },
      { company: 'Beazer Homes', contact: 'David Brown', value: 120000, city: 'Frisco', source: 'OUTBOUND' },
      { company: 'Tri Pointe Homes', contact: 'Rachel Kim', value: 175000, city: 'Prosper', source: 'TRADE_SHOW' },
    ]
    const salesOwner = salesStaff.length > 0 ? salesStaff[0] : adminStaff
    let dealCount = 0
    for (let di = 0; di < dealProspects.length; di++) {
      const d = dealProspects[di]
      const stage = dealStages[di % dealStages.length]
      const prob = stage === 'WON' ? 100 : stage === 'LOST' ? 0 : [10, 20, 40, 60, 70, 80][di % 6]
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Deal" ("id","dealNumber","companyName","contactName","contactEmail",
          "city","state","stage","probability","dealValue","source",
          "expectedCloseDate","ownerId","description","createdAt","updatedAt")
        VALUES ($1,$2,$3,$4,$5,$6,'TX',$7::"DealStage",$8,$9,$10::"DealSource",$11,$12,$13,NOW(),NOW())
      `, ID('deal', di), `DEAL-2026-${String(40 + di)}`, d.company, d.contact,
        `${d.contact.split(' ')[0].toLowerCase()}@${d.company.toLowerCase().replace(/\s/g, '')}.com`,
        d.city, stage, prob, d.value, d.source,
        daysFromNow(15 + di * 7), salesOwner.id,
        `${d.company} — ${d.value > 200000 ? 'Large' : 'Mid-size'} production builder in ${d.city} market`)

      // Deal activities
      const actTypes = ['CALL', 'EMAIL', 'MEETING', 'SITE_VISIT', 'NOTE']
      for (let ai = 0; ai < 3; ai++) {
        await prisma.$executeRawUnsafe(`
          INSERT INTO "DealActivity" ("id","dealId","staffId","type","subject","notes","createdAt")
          VALUES ($1,$2,$3,$4::"DealActivityType",$5,$6,$7)
        `, ID('da', di * 10 + ai), ID('deal', di), salesOwner.id,
          actTypes[ai % actTypes.length],
          [`Initial outreach call`, `Sent capabilities overview`, `Showroom walkthrough scheduled`][ai],
          [`Left VM with ${d.contact}`, `Sent full product catalog and pricing guide`, `Site visit confirmed for next week`][ai],
          daysAgo(20 - ai * 5))
      }
      dealCount++
    }
    counts.deals = dealCount

    // ════════════════════════════════════════════════════════════════
    // PHASE 18: Tasks + Activities + Notifications
    // ════════════════════════════════════════════════════════════════
    const taskTitles = [
      'Verify material availability for next week deliveries',
      'Follow up on Brookfield pricing proposal',
      'Schedule T-72 readiness check',
      'Review and approve PO for Boise Cascade',
      'Call Highland Homes about overdue invoice',
      'Update delivery schedule for Canyon Ridge',
      'Prepare quarterly sales report',
      'Coordinate install crew for custom home in Westlake',
      'Check inventory levels for 2068 pre-hung doors',
      'Process builder credit application for Beazer',
      'Quality check on staged orders',
      'Route optimization for Thursday deliveries',
    ]
    let taskCount = 0
    const taskStatuses = ['TODO', 'TODO', 'IN_PROGRESS', 'IN_PROGRESS', 'DONE', 'DONE']
    const taskPriorities = ['LOW', 'MEDIUM', 'MEDIUM', 'HIGH', 'CRITICAL']
    for (let ti = 0; ti < taskTitles.length; ti++) {
      const assignee = staffRows[ti % staffRows.length]
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Task" ("id","assigneeId","creatorId","title","priority","status","category",
          "dueDate","createdAt","updatedAt")
        VALUES ($1,$2,$3,$4,$5::"TaskPriority",$6::"TaskStatus",$7::"TaskCategory",$8,NOW(),NOW())
      `, ID('task', ti), assignee.id, adminStaff.id,
        taskTitles[ti], taskPriorities[ti % taskPriorities.length],
        taskStatuses[ti % taskStatuses.length],
        ['GENERAL', 'MATERIAL_VERIFICATION', 'SCHEDULING', 'BUILDER_COMMUNICATION'][ti % 4],
        daysFromNow(ti % 7))
      taskCount++
    }
    counts.tasks = taskCount

    // Activities (CRM log)
    let activityCount = 0
    for (let ai = 0; ai < 15; ai++) {
      const builderIdx = ai % BUILDERS.length
      const staffMember = staffRows[ai % staffRows.length]
      const actTypes = ['CALL', 'EMAIL', 'MEETING', 'SITE_VISIT', 'NOTE']
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Activity" ("id","staffId","builderId","activityType","subject","notes","completedAt","createdAt")
        VALUES ($1,$2,$3,$4::"ActivityType",$5,$6,$7,$8)
      `, ID('act', ai), staffMember.id, BUILDERS[builderIdx].id,
        actTypes[ai % actTypes.length],
        [`Pricing discussion with ${BUILDERS[builderIdx].companyName}`,
         `Order status update`,
         `Quarterly review meeting`,
         `Job site walkthrough`,
         `Internal note on account status`][ai % 5],
        `Discussed ${['pricing adjustments', 'delivery scheduling', 'new community plans', 'quality concerns', 'payment terms'][ai % 5]}`,
        daysAgo(ai), daysAgo(ai))
      activityCount++
    }
    counts.activities = activityCount

    // Notifications
    let notifCount = 0
    const notifTypes = ['JOB_UPDATE', 'TASK_ASSIGNED', 'DELIVERY_UPDATE', 'INVOICE_OVERDUE', 'PO_APPROVAL', 'SCHEDULE_CHANGE']
    for (let ni = 0; ni < 20; ni++) {
      const recipient = staffRows[ni % staffRows.length]
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Notification" ("id","staffId","type","title","body","link","read","createdAt")
        VALUES ($1,$2,$3::"NotificationType",$4,$5,$6,$7,$8)
      `, ID('notif', ni), recipient.id,
        notifTypes[ni % notifTypes.length],
        [`Job JOB-2026-${100 + ni} status changed`,
         `New task assigned: ${taskTitles[ni % taskTitles.length]}`,
         `Delivery DEL-2026-${100 + ni} completed`,
         `Invoice INV-2026-${ni} is overdue`,
         `PO PO-2026-${400 + ni} needs approval`,
         `Schedule change for ${COMMUNITIES[ni % COMMUNITIES.length]}`][ni % 6],
        `Details about the ${notifTypes[ni % notifTypes.length].toLowerCase().replace(/_/g, ' ')} event.`,
        `/ops/jobs`, ni > 10, daysAgo(ni % 7))
      notifCount++
    }
    counts.notifications = notifCount

    // ════════════════════════════════════════════════════════════════
    // PHASE 19: BuilderIntelligence (raw SQL table)
    // ════════════════════════════════════════════════════════════════
    for (let bi = 0; bi < BUILDERS.length; bi++) {
      const b = BUILDERS[bi]
      const healthScore = 40 + Math.floor(Math.random() * 50)
      const ltv = 20000 + Math.floor(Math.random() * 200000)
      const trends = ['GROWING', 'STABLE', 'STABLE', 'DECLINING', 'CHURNING']
      const payTrends = ['IMPROVING', 'STABLE', 'STABLE', 'DECLINING']
      try {
        await prisma.$executeRawUnsafe(`
          INSERT INTO "BuilderIntelligence" ("id","builderId","avgOrderValue","orderFrequencyDays",
            "totalLifetimeValue","totalOrders","healthScore","orderTrend","paymentTrend",
            "avgDaysToPayment","onTimePaymentRate","creditRiskScore","daysSinceLastOrder",
            "crossSellScore","estimatedWalletShare","activeProjectCount","pipelineValue",
            "dataQualityScore","lastUpdated")
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
          ON CONFLICT ("builderId") DO UPDATE SET
            "healthScore"=$7,"orderTrend"=$8,"totalLifetimeValue"=$5,"lastUpdated"=NOW()
        `, ID('bi', bi), b.id,
          2000 + Math.floor(Math.random() * 5000), // avgOrderValue
          7 + Math.floor(Math.random() * 21), // orderFrequencyDays
          ltv, 15 + Math.floor(Math.random() * 80), // totalOrders
          healthScore, trends[bi % trends.length], payTrends[bi % payTrends.length],
          18 + Math.floor(Math.random() * 25), // avgDaysToPayment
          0.6 + Math.random() * 0.35, // onTimePaymentRate
          30 + Math.floor(Math.random() * 50), // creditRiskScore
          Math.floor(Math.random() * 30), // daysSinceLastOrder
          Math.floor(Math.random() * 80), // crossSellScore
          0.15 + Math.random() * 0.5, // estimatedWalletShare
          b.builderType === 'PRODUCTION' ? 3 + Math.floor(Math.random() * 5) : 1, // activeProjectCount
          ltv * 0.3, // pipelineValue
          50 + Math.floor(Math.random() * 40)) // dataQualityScore
      } catch { /* table might not exist */ }
    }
    counts.builderIntelligence = BUILDERS.length

    // ════════════════════════════════════════════════════════════════
    // PHASE 20: Agent Tasks (for Command Center)
    // ════════════════════════════════════════════════════════════════
    const agentTasks = [
      { role: 'OPS', type: 'DELIVERY_OPTIMIZATION', title: 'Optimize Thursday delivery routes', priority: 'HIGH', status: 'PENDING' },
      { role: 'SALES', type: 'FOLLOW_UP', title: 'Follow up with Taylor Morrison — bid review', priority: 'HIGH', status: 'PENDING' },
      { role: 'OPS', type: 'INVENTORY_CHECK', title: 'Low stock alert: 2068 2-Panel Shaker HC', priority: 'URGENT', status: 'IN_PROGRESS' },
      { role: 'CUSTOMER_SUCCESS', type: 'HEALTH_CHECK', title: 'Declining health score: Grand Homes', priority: 'NORMAL', status: 'PENDING' },
      { role: 'SALES', type: 'OUTREACH', title: 'New lead: Beazer Homes DFW', priority: 'NORMAL', status: 'COMPLETED' },
      { role: 'OPS', type: 'COLLECTION_ACTION', title: 'Final Notice — Highland Homes INV-2026-004', priority: 'HIGH', status: 'PENDING', requiresApproval: true },
    ]
    for (let ati = 0; ati < agentTasks.length; ati++) {
      const at = agentTasks[ati]
      try {
        await prisma.$executeRawUnsafe(`
          INSERT INTO "AgentTask" ("id","agentRole","taskType","title","priority","status","createdBy",
            "requiresApproval","createdAt","updatedAt")
          VALUES ($1,$2,$3,$4,$5,$6,'system',$7,NOW(),NOW())
          ON CONFLICT DO NOTHING
        `, ID('at', ati), at.role, at.type, at.title, at.priority, at.status,
          (at as any).requiresApproval || false)
      } catch { /* table might not exist */ }
    }
    counts.agentTasks = agentTasks.length

    // ════════════════════════════════════════════════════════════════
    // PHASE 21: FinancialSnapshots (for finance dashboard)
    // ════════════════════════════════════════════════════════════════
    try {
      for (let di = 0; di < 30; di++) {
        const date = daysAgo(di)
        const revenue = 8000 + Math.floor(Math.random() * 12000)
        const expenses = 5000 + Math.floor(Math.random() * 6000)
        await prisma.$executeRawUnsafe(`
          INSERT INTO "FinancialSnapshot" ("id","snapshotDate","totalRevenue","totalExpenses",
            "grossProfit","netProfit","cashOnHand","arBalance","apBalance","createdAt")
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
          ON CONFLICT DO NOTHING
        `, ID('fs', di), date, revenue, expenses,
          revenue - expenses, Math.round((revenue - expenses) * 0.7),
          45000 + Math.floor(Math.random() * 30000),
          85000 + Math.floor(Math.random() * 50000),
          35000 + Math.floor(Math.random() * 25000))
      }
      counts.financialSnapshots = 30
    } catch { counts.financialSnapshots = 0 }

    // ════════════════════════════════════════════════════════════════
    // PHASE 22: Outreach Sequences
    // ════════════════════════════════════════════════════════════════
    const seqId = ID('seq', 1)
    await prisma.$executeRawUnsafe(`
      INSERT INTO "OutreachSequence" ("id","name","type","mode","stepCount","active","createdBy","createdAt","updatedAt")
      VALUES ($1,'New Builder Welcome Sequence','ONBOARDING','AUTO',3,true,$2,NOW(),NOW())
      ON CONFLICT DO NOTHING
    `, seqId, adminStaff.id)
    const steps = [
      { delay: 0, channel: 'EMAIL', subject: 'Welcome to Abel Lumber', body: 'Thank you for choosing Abel Lumber...' },
      { delay: 3, channel: 'CALL_TASK', subject: 'Follow-up call', body: 'Check in on first order experience...' },
      { delay: 7, channel: 'EMAIL', subject: 'Your first order guide', body: 'Here is how to place your first order...' },
    ]
    for (let si = 0; si < steps.length; si++) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "OutreachStep" ("id","sequenceId","stepNumber","delayDays","channel","subject","bodyTemplate","createdAt")
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
        ON CONFLICT DO NOTHING
      `, ID('os', si), seqId, si + 1, steps[si].delay, steps[si].channel, steps[si].subject, steps[si].body)
    }
    counts.outreachSequences = 1

    // ════════════════════════════════════════════════════════════════
    // AUDIT
    // ════════════════════════════════════════════════════════════════
    await audit(request, 'SEED_DEMO_DATA', 'Database', undefined, counts).catch(() => {})

    const totalRecords = Object.values(counts).reduce((a, b) => a + b, 0)

    return NextResponse.json({
      success: true,
      message: `Seeded ${totalRecords} records across ${Object.keys(counts).length} tables`,
      counts,
    })
  } catch (error: any) {
    console.error('[Seed Demo Data] Error:', error)
    return NextResponse.json({ error: error.message, stack: error.stack?.slice(0, 500) }, { status: 500 })
  }
}
