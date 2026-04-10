# Field Crew Portal - Complete Implementation

A mobile-first crew management portal for Abel Lumber's delivery and installation teams. Built with Next.js 14 App Router, TypeScript, Tailwind CSS, and Prisma/PostgreSQL.

## 📋 Overview

The Field Crew Portal enables delivery and installation crews to:
- View their daily schedule and assignments
- Track delivery status from pickup to completion
- Complete installation workflows with QC validation
- View optimized delivery routes
- Manage team information
- Document job completion with signatures and notes

## 🚀 Quick Start

### Prerequisites
- Node.js 16+
- PostgreSQL database with Abel schema
- `.env` file configured with `DATABASE_URL`

### Installation

1. **Seed test data:**
   ```bash
   npx ts-node scripts/seed-crew-portal.ts
   ```

2. **Start the development server:**
   ```bash
   npm run dev
   ```

3. **Access the portal:**
   - Navigate to `http://localhost:3000/crew`
   - Log in with a staff member's credentials
   - Select your crew from the dropdown

## 📁 Project Structure

```
src/
├── app/
│   ├── crew/
│   │   ├── layout.tsx              # Main layout with nav
│   │   ├── page.tsx                # Home/today's schedule
│   │   ├── route/page.tsx          # Route view
│   │   ├── profile/page.tsx        # Profile & crew info
│   │   ├── delivery/[id]/page.tsx  # Delivery workflow
│   │   └── install/[id]/page.tsx   # Installation workflow
│   └── api/
│       └── crew/
│           ├── schedule/route.ts   # Get daily schedule
│           ├── route/route.ts      # Get delivery route
│           ├── delivery/[id]/route.ts  # Delivery APIs
│           ├── install/[id]/route.ts   # Installation APIs
│           └── crews/              # Crew list/detail APIs
├── lib/
│   ├── prisma.ts                   # Prisma client
│   └── crew-utils.ts               # Utility functions
└── components/                      # Reusable components (future)

scripts/
└── seed-crew-portal.ts             # Test data seeding

docs/
├── CREW_PORTAL_SETUP.md            # Setup & reference guide
├── CREW_PORTAL_FILES.md            # File index & structure
└── CREW_PORTAL_UI_REFERENCE.md     # Design system & UX
```

## 🎨 Design System

### Colors (Abel Brand)
- **Primary Navy**: `#1B4F72` - Headers, branding
- **Accent Orange**: `#E67E22` - Buttons, highlights
- **Success Green**: `#27AE60` - Installation, completion
- **Delivery Blue**: `#3498DB` - Delivery indicators

### Layout
- **Mobile-First**: Optimized for 375px+ phones
- **Bottom Navigation**: 3 tabs (Today, Route, Profile)
- **Large Touch Targets**: 48px minimum buttons
- **Responsive**: Scales to desktop (max ~768px width)

### Typography
- **Body Text**: 16px minimum (readable in sunlight)
- **Large Headings**: 24-32px
- **Labels**: 12-14px
- **High contrast** for readability

## 📄 Pages

### `/crew` — Today's Schedule
- Crew selection with persistence
- Color-coded assignments (blue=delivery, green=install)
- Quick status update buttons
- Date and assignment count display

### `/crew/route` — Delivery Route
- Ordered stops with sequence numbers
- Address, builder, item count per stop
- Progress indicator
- Navigation to delivery details

### `/crew/delivery/[id]` — Delivery Workflow
- 6-step status progression
- Material list
- Signature field
- Damage/notes documentation
- Timestamp capture per step

### `/crew/install/[id]` — Installation Workflow
- 3-step status progression
- Scope of work display
- Punch list for rework items
- QC pass/fail requirement
- Notes field

### `/crew/profile` — Crew Information
- Crew details and vehicle info
- Team members with roles
- Quick navigation links
- Logout option

## 🔌 API Endpoints

All endpoints return JSON and require crew context.

### Schedule Management
- `GET /api/crew/schedule?crewId=X&date=YYYY-MM-DD`
  - Returns today's assignments for crew

- `GET /api/crew/route?crewId=X&date=YYYY-MM-DD`
  - Returns ordered delivery route for day

### Delivery Operations
- `GET /api/crew/delivery/[jobId]`
  - Get delivery details with materials

- `PATCH /api/crew/delivery/[jobId]`
  - Update status, timestamp, signature, notes

### Installation Operations
- `GET /api/crew/install/[jobId]`
  - Get installation details

- `PATCH /api/crew/install/[jobId]`
  - Update status, punch items, QC, notes

### Crew Management
- `GET /api/crew/crews`
  - List all active crews with members

- `GET /api/crew/crews/[id]`
  - Get specific crew details

## 🔄 Workflows

### Delivery Workflow
```
SCHEDULED → LOADING → IN_TRANSIT → ARRIVED → UNLOADING → COMPLETE
```

Each step:
- Must be triggered by crew member clicking button
- Captures timestamp automatically
- Validates completion requirements (signature for COMPLETE)

### Installation Workflow
```
SCHEDULED → IN_PROGRESS → COMPLETE
```

Requirements:
- Must pass QC before marking complete
- Documents punch items if issues found
- Captures start and end timestamps

## 💾 Data Persistence

### Client-Side
- Selected crew ID stored in localStorage
- Can be overridden via URL: `?crewId=crew_123`

### Server-Side
- All data stored in PostgreSQL via Prisma
- Timestamps captured as ISO 8601
- Status changes create audit trail via database

## 🧪 Testing

### Manual Testing Checklist
- [ ] Crew dropdown works and persists selection
- [ ] Schedule loads for selected crew
- [ ] Delivery cards show correct details
- [ ] Installation cards display properly
- [ ] Route view shows stops in order
- [ ] Status buttons prevent invalid transitions
- [ ] Timestamps capture on status change
- [ ] Signature required for delivery completion
- [ ] QC required for installation completion
- [ ] Bottom navigation highlights active tab
- [ ] Mobile responsive (test on 375px, 768px, 1024px)
- [ ] No console errors

### Seed Data
Run `npx ts-node scripts/seed-crew-portal.ts` to create:
- 2 crews (delivery & installation)
- 4 staff members
- 1 test job with all fields
- 3 material picks
- Schedule entries for today

Login credentials:
- Email: `driver1@abel.com` (Delivery crew)
- Email: `installer1@abel.com` (Installation crew)

## 📱 Mobile Optimization

### Touch Targets
- Minimum 44px × 44px
- 48px preferred for main buttons
- 8px spacing between targets

### Performance
- Lazy load route view
- Minimize re-renders with React hooks
- Images/photos optimized (future)

### Offline Readiness
- Currently online-only
- Future: Service workers for offline mode

## 🔒 Security Considerations

- Crew access requires authentication
- Staff can see only their assigned crew's data
- Timestamps server-generated (can't be spoofed)
- Database validates all state transitions
- No sensitive data in URLs (use POST/PATCH for sensitive updates)

## 🚀 Deployment

### Environment Variables
```
DATABASE_URL=postgresql://...
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://your-domain.com  (optional)
```

### Build
```bash
npm run build
npm start
```

### Production Checklist
- [ ] Environment variables configured
- [ ] Database migrations run
- [ ] Seed data created (or use production data)
- [ ] Test all workflows
- [ ] Verify authentication
- [ ] Check error logging
- [ ] Monitor API performance

## 📚 Documentation

- **CREW_PORTAL_SETUP.md** - Complete setup guide with API documentation
- **CREW_PORTAL_FILES.md** - Index of all created files
- **CREW_PORTAL_UI_REFERENCE.md** - Design system and component specifications
- **CREW_PORTAL_README.md** - This file

## 🔧 Troubleshooting

### Issue: Crew dropdown empty
**Solution**: Run `npx ts-node scripts/seed-crew-portal.ts` to create test crews

### Issue: Schedule not loading
**Solution**: Check that:
- Database connection is active
- Schedule entries exist for today
- Crew ID is valid
- No console errors in browser

### Issue: Status buttons don't work
**Solution**:
- Check network tab for API errors
- Verify crew assignment exists
- Check server logs for 500 errors
- Try browser refresh

### Issue: Timestamps not updating
**Solution**:
- Server must have correct system time
- Database timezone must be correct
- Check API response in network tab

## 🎯 Future Enhancements

- Photo capture (before/after for installs)
- Real-time GPS tracking
- Offline mode with sync
- Push notifications
- Customer text notifications
- Performance metrics per crew
- Integration with ECI Bolt
- Mobile app version
- Punch list photo attachment
- Digital signature capture

## 📞 Support

For issues or questions:
1. Check documentation in `/docs` folder
2. Review console for error messages
3. Check database connectivity
4. Verify seed data was created
5. Review API responses in network tab

## 📄 License

Abel Lumber - Internal Use Only

## ✅ Completion Status

- [x] Home page with schedule view
- [x] Delivery detail and workflow
- [x] Installation detail and workflow
- [x] Route view for deliveries
- [x] Profile and crew info page
- [x] Bottom navigation layout
- [x] API endpoints (schedule, delivery, installation, route, crews)
- [x] Status progression validation
- [x] Timestamp capture
- [x] Signature fields
- [x] Notes fields
- [x] QC validation
- [x] Crew selection persistence
- [x] Mobile-first design
- [x] Color-coded workflows
- [x] Utility functions
- [x] Test data seeding
- [x] Complete documentation

Ready for staging/production deployment!
