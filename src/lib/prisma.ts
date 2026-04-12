import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

// Cache in ALL environments — without this, every Vercel serverless invocation
// creates a new PrismaClient, exhausting Neon's connection pool within seconds.
globalForPrisma.prisma = prisma
