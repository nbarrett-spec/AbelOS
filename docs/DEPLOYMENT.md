# Abel Builder Platform — Production Deployment Guide

## Prerequisites

- Node.js 18+ and npm
- PostgreSQL database (Neon Serverless recommended)
- Domain name with SSL
- Hosting: Vercel (recommended), Railway, or any Node.js host

---

## 1. Environment Variables

Copy `.env.example` to `.env.production` and fill in ALL values:

```bash
cp .env.example .env.production
```

**Required variables:**

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string (use pooled URL for serverless) | `postgresql://user:pass@host/db?sslmode=require` |
| `JWT_SECRET` | 32+ char random string. Generate with: `openssl rand -base64 32` | `aB3x...` |
| `NEXT_PUBLIC_APP_URL` | Your production domain | `https://builders.abellumber.com` |
| `RESEND_API_KEY` | Resend email API key (for order confirmations, password resets) | `re_...` |
| `RESEND_FROM_EMAIL` | Sender email address | `Abel Lumber <noreply@abellumber.com>` |
| `NODE_ENV` | Must be `production` | `production` |

**CRITICAL:** Change `JWT_SECRET` from the dev default before deploying.

---

## 2. Database Setup

The app uses Prisma ORM. Run migrations on your production database:

```bash
# Generate Prisma client
npx prisma generate

# Push schema to database (for initial setup)
npx prisma db push

# OR run migrations (if using migration-based workflow)
npx prisma migrate deploy
```

### Self-Creating Tables

Several features use `CREATE TABLE IF NOT EXISTS` patterns and will auto-create tables on first API call:
- `WarrantyClaim` — warranty claims system
- `Invoice` / `InvoicePayment` — invoicing system
- `QuoteRequest` — builder quote requests
- `BuilderNotification` — notification system
- `InventoryItem` — inventory tracking

No manual setup needed for these.

### Seed Data

For production, seed staff accounts:

```bash
npx tsx prisma/seed.ts
```

**Default admin login:** `n.barrett@abellumber.com` / `Abel2026!`
Change this password immediately after first login.

---

## 3. Build & Deploy

### Vercel (Recommended)

1. Push code to GitHub
2. Connect repo in Vercel dashboard
3. Set environment variables in Vercel settings
4. Vercel auto-detects Next.js and builds

### Manual Deploy

```bash
# Install dependencies
npm ci

# Generate Prisma client
npx prisma generate

# Build
npm run build

# Start production server
npm start
```

The app runs on port 3000 by default. Use a reverse proxy (nginx/caddy) for SSL termination.

---

## 4. Security Checklist

- [x] Security headers configured in `next.config.js` (X-Frame-Options, HSTS, CSP)
- [x] Rate limiting on auth endpoints (login, signup, forgot-password)
- [x] httpOnly JWT cookies for both builder and staff auth
- [x] SQL injection protection via parameterized queries
- [x] Input validation with Zod on critical endpoints
- [ ] **Change JWT_SECRET** from dev default
- [ ] **Change default admin password** after first login
- [ ] **Enable HTTPS** on your domain
- [ ] Set `NEXT_PUBLIC_APP_URL` to your production domain
- [ ] Review and restrict CORS if needed
- [ ] Set up database backups (Neon has automatic backups)

---

## 5. Post-Deploy Tasks

### Product Catalog Cleanup

Navigate to **Ops > Products** and click **"Clean Up Categories"** to consolidate the 130+ imported categories into ~25 clean categories. This is a one-time operation.

### Verify Critical Flows

1. Builder signup & login
2. Quote request submission
3. Order creation from approved quote
4. Invoice generation
5. Warranty claim filing
6. Ops dashboard data loading
7. Dark mode toggle

---

## 6. Architecture Notes

- **Framework:** Next.js 14 App Router
- **Database:** PostgreSQL via Prisma ORM (raw SQL for complex queries)
- **Auth:** JWT in httpOnly cookies, separate builder/staff sessions
- **Styling:** Tailwind CSS with Abel brand colors (#1B4F72 navy, #E67E22 orange)
- **Email:** Resend API (fire-and-forget pattern)
- **File Structure:**
  - `/dashboard/*` — Builder-facing portal
  - `/ops/*` — Staff operations portal
  - `/admin/*` — Admin settings
  - `/api/*` — API routes
