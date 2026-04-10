import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  // Create demo builder account
  const passwordHash = await bcrypt.hash('Demo1234', 12)

  const demoBuilder = await prisma.builder.upsert({
    where: { email: 'demo@abelbuilder.com' },
    update: {},
    create: {
      companyName: 'Demo Homes LLC',
      contactName: 'Demo Builder',
      email: 'demo@abelbuilder.com',
      passwordHash,
      phone: '(555) 123-4567',
      paymentTerm: 'NET_15',
      status: 'ACTIVE',
      emailVerified: true,
    },
  })

  console.log(`Created demo builder: ${demoBuilder.email}`)

  // Create sample products
  const products = [
    { sku: 'DR-2068-2PS-HC-LH', name: '2068 2-Panel Shaker Hollow Core LH Pre-Hung', category: 'Interior Doors', subcategory: 'Pre-Hung', cost: 98, basePrice: 165, doorSize: '2068', handing: 'LH', coreType: 'Hollow', panelStyle: '2-Panel Shaker' },
    { sku: 'DR-2068-2PS-HC-RH', name: '2068 2-Panel Shaker Hollow Core RH Pre-Hung', category: 'Interior Doors', subcategory: 'Pre-Hung', cost: 98, basePrice: 165, doorSize: '2068', handing: 'RH', coreType: 'Hollow', panelStyle: '2-Panel Shaker' },
    { sku: 'DR-2668-2PS-HC-LH', name: '2668 2-Panel Shaker Hollow Core LH Pre-Hung', category: 'Interior Doors', subcategory: 'Pre-Hung', cost: 104, basePrice: 175, doorSize: '2668', handing: 'LH', coreType: 'Hollow', panelStyle: '2-Panel Shaker' },
    { sku: 'DR-2668-2PS-HC-RH', name: '2668 2-Panel Shaker Hollow Core RH Pre-Hung', category: 'Interior Doors', subcategory: 'Pre-Hung', cost: 104, basePrice: 175, doorSize: '2668', handing: 'RH', coreType: 'Hollow', panelStyle: '2-Panel Shaker' },
    { sku: 'DR-2868-2PS-SC-RH', name: '2868 2-Panel Shaker Solid Core RH Pre-Hung', category: 'Interior Doors', subcategory: 'Pre-Hung', cost: 152, basePrice: 245, doorSize: '2868', handing: 'RH', coreType: 'Solid', panelStyle: '2-Panel Shaker' },
    { sku: 'DR-2868-2PS-SC-LH', name: '2868 2-Panel Shaker Solid Core LH Pre-Hung', category: 'Interior Doors', subcategory: 'Pre-Hung', cost: 152, basePrice: 245, doorSize: '2868', handing: 'LH', coreType: 'Solid', panelStyle: '2-Panel Shaker' },
    { sku: 'DR-2668-FP-HC-LH', name: '2668 Flat Panel Hollow Core LH Pre-Hung', category: 'Interior Doors', subcategory: 'Pre-Hung', cost: 92, basePrice: 155, doorSize: '2668', handing: 'LH', coreType: 'Hollow', panelStyle: 'Flat Panel' },
    { sku: 'DR-2668-FP-HC-RH', name: '2668 Flat Panel Hollow Core RH Pre-Hung', category: 'Interior Doors', subcategory: 'Pre-Hung', cost: 92, basePrice: 155, doorSize: '2668', handing: 'RH', coreType: 'Hollow', panelStyle: 'Flat Panel' },
    { sku: 'DR-2868-FP-SC-LH-FR20', name: '2868 Flat Panel Solid Core LH 20min Fire Pre-Hung', category: 'Interior Doors', subcategory: 'Pre-Hung', cost: 195, basePrice: 310, doorSize: '2868', handing: 'LH', coreType: 'Solid', panelStyle: 'Flat Panel' },
    { sku: 'DR-2468-BF-2PS', name: '2468 Bifold 2-Panel Shaker', category: 'Interior Doors', subcategory: 'Bifold', cost: 72, basePrice: 125, doorSize: '2468', handing: null, coreType: 'Hollow', panelStyle: '2-Panel Shaker' },
    { sku: 'DR-4068-BF-2PS', name: '4068 Bifold 2-Panel Shaker', category: 'Interior Doors', subcategory: 'Bifold', cost: 98, basePrice: 165, doorSize: '4068', handing: null, coreType: 'Hollow', panelStyle: '2-Panel Shaker' },
    { sku: 'DR-3068-FG-6P', name: '3068 Fiberglass 6-Panel Exterior', category: 'Exterior Doors', subcategory: 'Fiberglass', cost: 268, basePrice: 425, doorSize: '3068', handing: null, coreType: null, panelStyle: '6-Panel' },
    { sku: 'HW-PAS-SN', name: 'Passage Lever — Satin Nickel', category: 'Hardware', subcategory: 'Levers', cost: 16, basePrice: 32, hardwareFinish: 'SN' },
    { sku: 'HW-PRIV-SN', name: 'Privacy Lever — Satin Nickel', category: 'Hardware', subcategory: 'Levers', cost: 18, basePrice: 35, hardwareFinish: 'SN' },
    { sku: 'HW-PAS-BLK', name: 'Passage Lever — Matte Black', category: 'Hardware', subcategory: 'Levers', cost: 17.5, basePrice: 35, hardwareFinish: 'BLK' },
    { sku: 'HW-PRIV-BLK', name: 'Privacy Lever — Matte Black', category: 'Hardware', subcategory: 'Levers', cost: 19.5, basePrice: 38, hardwareFinish: 'BLK' },
    { sku: 'HW-ENTRY-ORB', name: 'Entry Handleset — Oil Rubbed Bronze', category: 'Hardware', subcategory: 'Handlesets', cost: 95, basePrice: 185, hardwareFinish: 'ORB' },
    { sku: 'HW-BF-KNOB-SN', name: 'Bifold Knob — Satin Nickel', category: 'Hardware', subcategory: 'Knobs', cost: 3.5, basePrice: 8, hardwareFinish: 'SN' },
    { sku: 'TR-BASE-314-MDF', name: '3-1/4" Base MDF Primed (per LF)', category: 'Trim', subcategory: 'Base', cost: 0.92, basePrice: 1.85 },
    { sku: 'TR-CAS-214-MDF', name: '2-1/4" Casing MDF Primed (per LF)', category: 'Trim', subcategory: 'Casing', cost: 0.68, basePrice: 1.45 },
    { sku: 'TR-EXT-CAS-PVC', name: '3-1/2" Exterior Casing PVC (per LF)', category: 'Trim', subcategory: 'Exterior Casing', cost: 1.75, basePrice: 3.25 },
  ]

  for (const product of products) {
    await prisma.product.upsert({
      where: { sku: product.sku },
      update: {},
      create: {
        sku: product.sku,
        name: product.name,
        category: product.category,
        subcategory: product.subcategory || null,
        cost: product.cost,
        basePrice: product.basePrice,
        doorSize: (product as any).doorSize || null,
        handing: (product as any).handing || null,
        coreType: (product as any).coreType || null,
        panelStyle: (product as any).panelStyle || null,
        hardwareFinish: (product as any).hardwareFinish || null,
      },
    })
  }

  console.log(`Seeded ${products.length} products`)

  // Create a demo project with blueprint
  const demoProject = await prisma.project.upsert({
    where: { id: 'demo-project-1' },
    update: {},
    create: {
      id: 'demo-project-1',
      builderId: demoBuilder.id,
      name: 'Smith Residence - Lot 42',
      planName: 'The Aspen',
      jobAddress: '1234 Desert View Dr',
      city: 'Scottsdale',
      state: 'AZ',
      lotNumber: '42',
      subdivision: 'Desert Ridge Estates',
      sqFootage: 2400,
      status: 'DRAFT',
    },
  })

  console.log(`Created demo project: ${demoProject.name}`)
  console.log('')
  console.log('=== Demo Credentials ===')
  console.log('Email: demo@abelbuilder.com')
  console.log('Password: Demo1234')
  console.log('========================')
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
