# Field Crew Portal - UI/UX Reference Guide

## Mobile-First Design System

All pages are designed for mobile viewing (375px+) and scale responsively to desktop. The interface prioritizes touch targets, readability, and quick task completion in field conditions.

## Color Palette

```
Primary Navy:        #1B4F72  (Headers, branding, primary text)
Secondary Navy:      #0D2438  (Dark headers, high contrast)
Accent Orange:       #E67E22  (Buttons, active states, highlights)
Success Green:       #27AE60  (Installation complete, QC pass)
Delivery Blue:       #3498DB  (Delivery status, info)
Warning Yellow:      #F39C12  (Tentative, needs attention)
Neutral Gray:        #6C757D  (Secondary text, borders)
Light Gray:          #F8F9FA  (Backgrounds, cards)
White:               #FFFFFF  (Card backgrounds, text on dark)
```

## Typography Scale

```
Display (Large Headings):  28px - 32px
Heading 1:                 24px
Heading 2:                 20px
Heading 3:                 18px
Body Text:                 16px (MINIMUM - must be readable in sun)
Small Text:                14px
Meta Text:                 12px - 13px
```

## Component Specifications

### Buttons

**Large Primary Button** (CTA)
- Height: 48-56px
- Padding: 16px horizontal, 12px vertical
- Font: 16px, bold
- Background: #E67E22 (orange)
- Text: White
- Border radius: 8px
- Min width: 100% on mobile, auto on desktop
- Hover state: Darker orange (#D35400)

Example: "Mark as Complete", "Start Delivery"

**Large Secondary Button**
- Height: 48px
- Background: #6C757D (gray)
- Text: White
- Hover state: Darker gray

Example: "Clear Notes", "Back"

**Status Button** (Progress Steps)
- Height: 44px minimum
- Width: 100%
- Padding: 12px
- Completed: Green background (#27AE60), green text
- Current: Yellow background (#FFF3CD), yellow-900 text
- Next: Clickable, hover state
- Disabled: Gray background (#E9ECEF), gray text, no cursor

Example: "✓ Load Confirmed", "🚗 Departed", "📍 Arrived"

### Cards

**Assignment Card** (Schedule View)
- Padding: 16px
- Border: 2px solid (color-coded: blue for delivery, green for install)
- Border radius: 8px
- Background: Light tinted (blue-50 or green-50)
- Margin bottom: 12px
- Action buttons: Flex row at bottom, equal width

**Info Card** (Job Details)
- Padding: 16px
- Border: 1px solid #DEE2E6
- Border radius: 8px
- Background: #FFFFFF
- Margin bottom: 16px
- Sections separated by divider line

### Input Fields

**Text Input**
- Height: 44px minimum
- Padding: 12px 16px
- Font size: 16px
- Border: 1px solid #DEE2E6
- Border radius: 6px
- Focus: 2px solid #E67E22 (orange ring)
- Width: 100%

**Textarea**
- Min height: 100px (3 rows)
- Padding: 12px
- Font size: 16px
- Border: 1px solid #DEE2E6
- Border radius: 6px
- Resize: vertical
- Focus: 2px solid #E67E22

**Select Dropdown**
- Height: 44px
- Padding: 12px 16px
- Font size: 16px
- Border: 1px solid #DEE2E6
- Border radius: 6px
- Width: 100%

### Status Badges

```css
.badge {
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  display: inline-block;
}

/* Status-specific colors */
.badge-scheduled { background: #FFF3CD; color: #856404; }
.badge-in-progress { background: #D1ECF1; color: #0C5460; }
.badge-complete { background: #D4EDDA; color: #155724; }
.badge-pending { background: #FFF3CD; color: #856404; }
```

### Bottom Navigation

- Height: 80px (includes safe area padding)
- Background: #FFFFFF
- Border top: 1px solid #DEE2E6
- Position: fixed bottom
- 3-4 tabs, equally spaced
- Each tab: 64px × 64px minimum touch area
- Icon size: 24px
- Label size: 12px
- Active tab: Orange (#E67E22) text, light orange background
- Inactive: Gray (#6C757D) text

### Header Bar

- Height: 56px minimum
- Background: Linear gradient #1B4F72 → #0D2438
- Padding: 12px 16px
- Text color: White
- Shadow: 0 2px 4px rgba(0,0,0,0.1)
- Sticky/fixed when needed

## Layout Patterns

### Page Structure (Crew Home)
```
┌─────────────────────────┐
│     Header Bar          │  56px, navy
├─────────────────────────┤
│     Main Content        │  Scrollable, 0-24px pb for nav
│  (Schedule cards, etc)  │
│                         │
│                         │
└─────────────────────────┤
│   Bottom Nav (Fixed)    │  80px, white
└─────────────────────────┘
```

### Card Layout (Assignment Card)
```
┌─ Card (2px colored border) ─┐
│ Type Badge    Status Badge  │  16px padding
│ Job Number                  │  Blue/green bg-50
│ Builder Name                │
│ 📍 Address                  │
│ Community • Lot             │
│ 🕐 Scheduled Time           │
├─────────────────────────────┤
│ [Button] [Button] [Button]  │  Grid layout, flex
└─────────────────────────────┘
```

### Info Card (Delivery Detail)
```
┌─ White Card (1px border) ──┐
│ Label (uppercase, gray)     │  16px padding
│ Value (bold, large)         │
├─────────────────────────────┤
│ Label                       │  Divided sections
│ Value                       │
├─────────────────────────────┤
│ Label                       │
│ Value                       │
└─────────────────────────────┘
```

## Spacing System

```
xs:  4px   (small gaps, icon padding)
sm:  8px   (element gaps, borders)
md:  12px  (section padding, card padding)
lg:  16px  (page padding, large gaps)
xl:  24px  (section margins)
xxl: 32px  (major section breaks)
```

## Icon Usage

### Icons (24px size, inline)
- 📦 Package/Delivery
- 🔧 Installation/Tools
- 📍 Location/Address
- 🕐 Time/Schedule
- 📋 List/Schedule
- 🗺️ Route/Map
- 👤 Profile/Person
- ✓ Check/Complete
- ✅ Verified/QC Pass
- 📸 Photo/Camera
- 📝 Notes/Write
- 🔄 Pickup/Refresh
- ⚠️ Warning/Issue
- ❌ Error/Damage

### Emojis in Buttons/Status
```
[✓ Complete]
[✅ Completed]
[📦 Start]
[🚗 Arrived]
[🔧 In Progress]
[📋 Scheduled]
```

## State Examples

### Delivery Status Progression

```
┌─ Scheduled ──────┐
│ 📋 Scheduled     │  Tentative, yellow badge
└──────────────────┘
        ↓ (Click)
┌─ Load Confirmed ─┐
│ ✓ Load Confirmed │  Checkmark, green bg
│ Can start pickup │
└──────────────────┘
        ↓ (Click)
┌─ Departed ───────┐
│ 🚗 Departed      │  In progress, blue bg
│ 8:45 AM          │
└──────────────────┘
        ↓ (Click)
┌─ Arrived ────────┐
│ 📍 Arrived       │  In progress, blue bg
│ 10:15 AM         │
└──────────────────┘
        ↓ (Unload)
┌─ Unloading ──────┐
│ 📦 Unloading     │  In progress, blue bg
└──────────────────┘
        ↓ (Click)
┌─ Complete ───────┐
│ ✅ Complete      │  Completed, green bg
│ Signed by: _____ │
└──────────────────┘
```

### Installation Status Progression

```
┌─ Scheduled ──────┐
│ 📋 Scheduled     │  Tentative, yellow badge
└──────────────────┘
        ↓
┌─ In Progress ────┐
│ 🔧 In Progress   │  In progress, blue bg
│ Started 8:00 AM  │
└──────────────────┘
        ↓ (Must pass QC)
┌─ Complete ───────┐
│ ✅ Complete      │  Completed, green bg
│ QC: ✓ Passed     │
└──────────────────┘
```

## Empty States

### No Assignments
```
┌─────────────────────────────┐
│                             │
│         (Large icon)        │  ✓ or 📋
│      No assignments         │  Gray text, centered
│      today                  │
│                             │
│  Check back later or        │  Secondary text
│  select a different crew    │
│                             │
└─────────────────────────────┘
```

### No Schedule Results
```
Message: "No deliveries scheduled"
Secondary: "Check back later"
Icon: Large magnifying glass or calendar
```

## Responsive Breakpoints

```
Mobile:    375px - 767px   (Primary design target)
Tablet:    768px - 1023px  (Scale UI proportionally)
Desktop:   1024px+         (Max width container at ~768px)
```

### Adaptations by Size
- Mobile: Single column, full width cards, bottom nav
- Tablet: Slightly larger touch targets, more padding
- Desktop: Max-width container, centered on screen, sidebar possible

## Accessibility

### Touch Targets
- Minimum 44px × 44px for interactive elements
- 48px × 48px for primary buttons in field conditions
- 8px minimum spacing between touch targets

### Contrast Ratios
- Text on background: 4.5:1 minimum
- Badges and accents: 3:1 minimum
- All text readable in bright sunlight

### Legibility
- No text smaller than 14px
- Body text locked at 16px minimum
- Line height: 1.5 for readability
- Letter spacing: Normal or slightly increased

## Loading & Error States

### Loading
```
Spinner animation, "Loading..."
Gray text, centered
Typical delay: <500ms
```

### Error
```
Background: Red/pink (#F8D7DA)
Border: Red (#F5C6CB)
Icon: ⚠️ or ❌
Text: "Error message here"
Action: Retry button or back link
```

### Offline
```
Banner at top of page
Background: Gray
Text: "Offline - Some features unavailable"
Auto-dismiss when connection restored
```

## Form Validation

### Invalid Input
- Red border: #DC3545
- Red text: #721C24
- Error message below field
- Error icon (❌) if space permits

### Success
- Green border: #28A745
- Green text: #155724
- Checkmark icon (✓)
- "Field saved" message

## Animation Guidelines

### Page Transitions
- Fade in/out: 200ms
- Slide transitions: 300ms (if used)
- Keep animations subtle (not distracting in field)

### Button States
- Hover: Color change 150ms
- Active/pressed: Slight scale (98-99%)
- Disabled: Opacity 0.6

### Loading States
- Spinner rotation: 1s per rotation
- Pulse for pending items (slow)
- Progress bar: Smooth linear animation

## Dark Mode (Optional Future)

If implemented:
- Use system preference
- Invert color palette
- Maintain contrast ratios
- Buttons: Lighter backgrounds on dark
- Cards: Dark background (#1F2937) with light borders

## Printing (Future Enhancement)

If needed:
- Hide bottom nav
- Adjust colors for B&W printing
- Font sizes: Maintain minimum 12pt
- QR codes for digital signatures
