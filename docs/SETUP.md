# Abel Builder Platform — Setup Guide

## Quick Start

### 1. Install dependencies
```bash
cd abel-builder-platform
npm install
```

### 2. Set up your database

You need PostgreSQL running locally or use a cloud provider.

**Option A: Local PostgreSQL**
```bash
# Install PostgreSQL if needed (macOS)
brew install postgresql@16
brew services start postgresql@16

# Create the database
createdb abel_builder
```

**Option B: Free Cloud (Recommended for quick start)**
- [Neon](https://neon.tech) — Free Postgres, instant setup
- [Supabase](https://supabase.com) — Free tier with extras

### 3. Configure environment
```bash
cp .env.example .env
```

Edit `.env` with your database URL:
```
DATABASE_URL="postgresql://user:password@localhost:5432/abel_builder"
JWT_SECRET="generate-a-random-string-here"
```

### 4. Initialize database
```bash
# Generate Prisma client
npx prisma generate

# Push schema to database
npx prisma db push

# Seed with demo data
npm run db:seed
```

### 5. Run the app
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Demo Credentials
- **Email:** demo@abelbuilder.com
- **Password:** Demo1234

## Project Structure
```
abel-builder-platform/
├── prisma/
│   ├── schema.prisma      # Database models (16 tables)
│   └── seed.ts            # Demo data seeder
├── src/
│   ├── app/
│   │   ├── page.tsx              # Landing page
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx    # Builder login
│   │   │   └── signup/page.tsx   # 3-step builder signup
│   │   ├── dashboard/page.tsx    # Builder dashboard
│   │   ├── projects/
│   │   │   ├── new/page.tsx      # Create project
│   │   │   └── [id]/page.tsx     # Project detail (full flow)
│   │   ├── catalog/page.tsx      # Product browsing
│   │   └── api/                  # REST API routes
│   │       ├── auth/             # Signup, login, logout, session
│   │       ├── projects/         # CRUD projects
│   │       ├── upload/           # Blueprint file upload
│   │       ├── takeoff/          # AI takeoff processing
│   │       └── quotes/           # Quote generation
│   ├── components/
│   │   ├── Navbar.tsx            # Top navigation
│   │   ├── UploadZone.tsx        # Drag-and-drop blueprint upload
│   │   ├── TakeoffViewer.tsx     # Room-by-room AI results
│   │   └── QuoteBuilder.tsx      # Interactive quote with pricing
│   ├── hooks/
│   │   └── useAuth.ts           # Auth state management
│   └── lib/
│       ├── auth.ts              # JWT + bcrypt auth logic
│       ├── prisma.ts            # Database client
│       ├── takeoff-engine.ts    # AI takeoff (mock Phase 1)
│       ├── constants.ts         # Payment terms, config
│       ├── utils.ts             # Formatting, calculations
│       └── validations.ts       # Zod schemas
├── package.json
├── tailwind.config.ts
└── tsconfig.json
```

## Core Flow
1. **Builder signs up** — 3-step form: company → personal → payment terms
2. **Creates a project** — Name, plan, address, square footage
3. **Uploads blueprint** — Drag-and-drop PDF/image
4. **AI runs takeoff** — Mock engine generates room-by-room material list
5. **Reviews takeoff** — See items, confidence scores, edit if needed
6. **Generates quote** — Auto-priced with payment term adjustments
7. **Approves quote** → (Phase 2: Creates order)

## Deploying to Vercel
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set environment variables in Vercel dashboard
# DATABASE_URL, JWT_SECRET
```

## What's Next (Phase 2)
- Real AI takeoff via Claude/GPT-4 Vision
- Product matching from InFlow catalog (2,852 SKUs)
- Homeowner selection portal
- Order management and fulfillment
- InFlow inventory sync
- Email notifications
- Admin/ops portal
