/**
 * Gold-data fixture from the 2026-04-29 v2 builder push.
 *
 * Source of truth: `Sales Pipeline/Custom Builder Push April 2026 v2/_Send_Ready_2026-04-29/`
 *   - {NN}_{slug}/Builder_Recipient.txt   — outreach email (the actual builder)
 *   - {NN}_{slug}/Notes.md                — hook, founder, city, confidence stamp
 *   - {NN}_{slug}/Email_Subject.txt       — outreach subject line (used for context)
 *   - INDEX.md                            — Tier A/B/C ranking, slug list
 *   - .claude/skills/builder-enrichment/SKILL.md (v2 Batch Results table)
 *
 * Confidence rules (mirroring src/lib/agents/types.ts):
 *   CONFIRMED  — Notes.md stamp says [CONFIRMED] OR direct personal email matches
 *                pattern + has cited source URL.
 *   LIKELY     — Notes.md stamp says [LIKELY] OR pattern-inferred from masked
 *                or sibling employee email (e.g. ZoomInfo d***@domain.com).
 *   UNVERIFIED — generic info@ / yahoo.com / outlook.com / live.com only,
 *                or no founder name confirmed.
 *
 * Cite the file you pulled from in a comment above each entry.
 */

import type { EnrichmentConfidence } from '../../types'

export interface BuilderFixture {
  slug: string
  companyName: string
  city: string
  state: string
  expectedDomain: string | null
  expectedFounder: string | null
  expectedEmail: string | null
  expectedConfidence: EnrichmentConfidence
  notes?: string
}

export const BUILDERS_2026_04_29: BuilderFixture[] = [
  // 01 — Garabedian Properties
  // Source: 01_Garabedian_Properties/Builder_Recipient.txt + Notes.md
  // Notes.md stamp: "Recipient changed from generic info@ to michael@garabedianproperties.com [CONFIRMED]. RocketReach format verification."
  {
    slug: 'garabedian-properties',
    companyName: 'Garabedian Properties',
    city: 'Southlake',
    state: 'TX',
    expectedDomain: 'garabedianproperties.com',
    expectedFounder: 'Michael Garabedian',
    expectedEmail: 'michael@garabedianproperties.com',
    expectedConfidence: 'CONFIRMED',
    notes: '2013 NAHB Master Builder of the Year. Tier A. RocketReach-verified personal email.',
  },

  // 02 — Goff Custom Homes
  // Source: 02_Goff_Custom_Homes/Builder_Recipient.txt = rusty@goffcustomhomes.com
  // Notes.md hook confirms founder Rusty Goff; matches firstname pattern on own domain.
  {
    slug: 'goff-custom-homes',
    companyName: 'Goff Custom Homes',
    city: 'Dallas',
    state: 'TX',
    expectedDomain: 'goffcustomhomes.com',
    expectedFounder: 'Rusty Goff',
    expectedEmail: 'rusty@goffcustomhomes.com',
    expectedConfidence: 'CONFIRMED',
    notes: 'D Magazine Best Home Builder 12+ years (Park Cities / Preston Hollow). Direct personal email on own domain.',
  },

  // 03 — John Schedcik Custom Homes
  // Source: 03_John_Schedcik_Custom_Homes/Builder_Recipient.txt = jmschedcik@gmail.com
  // Personal gmail (not on company domain). Founder is John Schedcik per Notes.md hook.
  {
    slug: 'john-schedcik-custom-homes',
    companyName: 'John Schedcik Custom Homes',
    city: 'Alvord',
    state: 'TX',
    expectedDomain: null,
    expectedFounder: 'John Schedcik',
    expectedEmail: 'jmschedcik@gmail.com',
    expectedConfidence: 'LIKELY',
    notes: 'CMB + Wise County RC 2014–2026. Personal gmail (not own-domain) — confirmed contact, but pattern not verifiable on a custom domain.',
  },

  // 04 — Don Hall Construction
  // Source: 04_Don_Hall_Construction/Builder_Recipient.txt = dhci62@gmail.com
  // Notes.md "Drew Hall, 2nd-gen, 250+ homes". dhci = Don Hall Construction Inc.
  {
    slug: 'don-hall-construction',
    companyName: 'Don Hall Construction',
    city: 'Lantana',
    state: 'TX',
    expectedDomain: null,
    expectedFounder: 'Drew Hall',
    expectedEmail: 'dhci62@gmail.com',
    expectedConfidence: 'LIKELY',
    notes: 'CMB, 2nd-gen, 250+ homes. Personal gmail (dhci62 = Don Hall Construction Inc); no custom domain pattern verifiable.',
  },

  // 05 — Herndon Construction
  // Source: 05_Herndon_Construction/Builder_Recipient.txt + Notes.md
  // Stamp: "Recipient changed from generic info@ to mike@herndonconstruction.net [CONFIRMED]. herndonconstruction.net contact page."
  {
    slug: 'herndon-construction',
    companyName: 'Herndon Construction',
    city: 'Kingston',
    state: 'OK',
    expectedDomain: 'herndonconstruction.net',
    expectedFounder: 'Michael Herndon',
    expectedEmail: 'mike@herndonconstruction.net',
    expectedConfidence: 'CONFIRMED',
    notes: 'OSHBA Builder of the Year (Lake Texoma niche). Founder Michael Herndon ("mike@" first-name pattern); contact page sourced.',
  },

  // 06 — Royal Crest Custom Homes
  // Source: 06_Royal_Crest_Custom_Homes/Builder_Recipient.txt = info@royalcrestcustomhomes.com (generic)
  // Founder Dean Smith per INDEX.md, but only generic info@ — no personal email surfaced.
  {
    slug: 'royal-crest-custom-homes',
    companyName: 'Royal Crest Custom Homes',
    city: 'Fort Worth',
    state: 'TX',
    expectedDomain: 'royalcrestcustomhomes.com',
    expectedFounder: 'Dean Smith',
    expectedEmail: 'info@royalcrestcustomhomes.com',
    expectedConfidence: 'UNVERIFIED',
    notes: 'BuildZoom Elite top-4% TX, 21 yrs Fort Worth. Only generic info@ available; founder name from INDEX but personal email not sourced.',
  },

  // 07 — Shadden Custom Homes
  // Source: 07_Shadden_Custom_Homes/Builder_Recipient.txt + Notes.md
  // Stamp: "Recipient changed from generic info@ to shaddenbrian@shaddencustomhomes.com [CONFIRMED]. SignalHire / ZoomInfo employee directory."
  {
    slug: 'shadden-custom-homes',
    companyName: 'Shadden Custom Homes',
    city: 'Whitesboro',
    state: 'TX',
    expectedDomain: 'shaddencustomhomes.com',
    expectedFounder: 'Brian Shadden',
    expectedEmail: 'shaddenbrian@shaddencustomhomes.com',
    expectedConfidence: 'CONFIRMED',
    notes: '47 yrs Whitesboro, family-owned. Unusual lastname+firstname pattern (shaddenbrian) sourced from SignalHire/ZoomInfo.',
  },

  // 08 — Savannah Custom Builders
  // Source: 08_Savannah_Custom_Builders/Builder_Recipient.txt = jim@savannahcustombuilders.com
  // Firstname pattern on own domain — no explicit confidence stamp in Notes; treated LIKELY.
  {
    slug: 'savannah-custom-builders',
    companyName: 'Savannah Custom Builders',
    city: 'Dallas',
    state: 'TX',
    expectedDomain: 'savannahcustombuilders.com',
    expectedFounder: 'Jim',
    expectedEmail: 'jim@savannahcustombuilders.com',
    expectedConfidence: 'LIKELY',
    notes: 'DBA Home of the Week. firstname@own-domain pattern; founder last name not confirmed in handoff materials.',
  },

  // 09 — Reynolds Luxury Homes
  // Source: 09_Reynolds_Luxury_Homes/Builder_Recipient.txt = Reynolds1@live.com (free domain)
  {
    slug: 'reynolds-luxury-homes',
    companyName: 'Reynolds Luxury Homes',
    city: 'Plano',
    state: 'TX',
    expectedDomain: null,
    expectedFounder: null,
    expectedEmail: 'Reynolds1@live.com',
    expectedConfidence: 'UNVERIFIED',
    notes: 'Plano / Preston Hollow luxury, 20+ yrs. Microsoft live.com personal email — no company domain to pattern-match.',
  },

  // 10 — Pavlis Custom Homes
  // Source: 10_Pavlis_Custom_Homes/Builder_Recipient.txt = info@pavliscustomhomes.com (generic)
  {
    slug: 'pavlis-custom-homes',
    companyName: 'Pavlis Custom Homes',
    city: 'Dallas',
    state: 'TX',
    expectedDomain: 'pavliscustomhomes.com',
    expectedFounder: null,
    expectedEmail: 'info@pavliscustomhomes.com',
    expectedConfidence: 'UNVERIFIED',
    notes: '20 yrs Dallas/Plano/Frisco/McKinney. Homesite Reservation process. Generic info@ only.',
  },

  // 11 — Our Country Homes
  // Source: 11_Our_Country_Homes/Builder_Recipient.txt = dustin@ourcountryhomes.com
  // firstname@domain pattern, 35-yr family operation. No explicit stamp; LIKELY.
  {
    slug: 'our-country-homes',
    companyName: 'Our Country Homes',
    city: 'Prosper',
    state: 'TX',
    expectedDomain: 'ourcountryhomes.com',
    expectedFounder: 'Dustin',
    expectedEmail: 'dustin@ourcountryhomes.com',
    expectedConfidence: 'LIKELY',
    notes: '35 yrs family-owned, 3 generations (Prosper/Aledo/Celina/Rockwall). firstname@own-domain.',
  },

  // 12 — Biltmore Homes
  // Source: 12_Biltmore_Homes/Builder_Recipient.txt = info@biltmore-homes.com (generic, hyphenated domain)
  {
    slug: 'biltmore-homes',
    companyName: 'Biltmore Homes',
    city: 'Dallas',
    state: 'TX',
    expectedDomain: 'biltmore-homes.com',
    expectedFounder: null,
    expectedEmail: 'info@biltmore-homes.com',
    expectedConfidence: 'UNVERIFIED',
    notes: '100+ homes in 6 yrs (Yarbrough Farms / Horizons at Bankston). DBJ #47. Generic info@ only.',
  },

  // 13 — Bison Creek Homes
  // Source: 13_Bison_Creek_Homes/Builder_Recipient.txt = info@bisoncreekhomes.com (generic)
  {
    slug: 'bison-creek-homes',
    companyName: 'Bison Creek Homes',
    city: 'Decatur',
    state: 'TX',
    expectedDomain: 'bisoncreekhomes.com',
    expectedFounder: null,
    expectedEmail: 'info@bisoncreekhomes.com',
    expectedConfidence: 'UNVERIFIED',
    notes: 'Decatur, family-owned, in-house licensed architect. Generic info@ only.',
  },

  // 14 — Doug Parr Custom Homes
  // Source: 14_Doug_Parr_Custom_Homes/Builder_Recipient.txt + Notes.md
  // Stamp: "Recipient changed from generic info@ to doug@dougparrhomes.com [LIKELY]. ZoomInfo masked d***@dougparrhomes.com pattern."
  {
    slug: 'doug-parr-custom-homes',
    companyName: 'Doug Parr Custom Homes',
    city: 'Boyd',
    state: 'TX',
    expectedDomain: 'dougparrhomes.com',
    expectedFounder: 'Doug Parr',
    expectedEmail: 'doug@dougparrhomes.com',
    expectedConfidence: 'LIKELY',
    notes: '30+ yrs Boyd, energy-efficient build-on-your-lot. ZoomInfo masked d***@dougparrhomes.com → firstname@ inferred.',
  },

  // 15 — Park Custom Homes
  // Source: 15_Park_Custom_Homes/Builder_Recipient.txt + Notes.md
  // Stamp: "Recipient changed from generic info@ to randy@parkcustomhomes.com [LIKELY]. First-name@domain pattern."
  {
    slug: 'park-custom-homes',
    companyName: 'Park Custom Homes',
    city: 'Decatur',
    state: 'TX',
    expectedDomain: 'parkcustomhomes.com',
    expectedFounder: 'Randy Park',
    expectedEmail: 'randy@parkcustomhomes.com',
    expectedConfidence: 'LIKELY',
    notes: '29 yrs Decatur, family-owned with co-owner Dainya Park. firstname@ pattern (no direct source URL).',
  },

  // 16 — Brookson Builders
  // Source: 16_Brookson_Builders/Builder_Recipient.txt + Notes.md
  // Stamp: "Recipient changed from generic info@ to brooks@brooksonbuilders.com [LIKELY]. Brooks White (President) discovered; first-name@domain pattern."
  {
    slug: 'brookson-builders',
    companyName: 'Brookson Builders',
    city: 'Justin',
    state: 'TX',
    expectedDomain: 'brooksonbuilders.com',
    expectedFounder: 'Brooks White',
    expectedEmail: 'brooks@brooksonbuilders.com',
    expectedConfidence: 'LIKELY',
    notes: '75-yr family operation (Justin / Fort Worth / Parker / Tarrant / Johnson / Denton). firstname@ inferred.',
  },

  // 17 — Structured Custom Homes
  // Source: 17_Structured_Custom_Homes/Builder_Recipient.txt + Notes.md
  // Stamp: "Recipient changed from generic info@ to Jbarnessbg@outlook.com [CONFIRMED]. Josh Barnes via Instagram + WebSearch."
  // Note: outlook.com is not a custom domain — but the stamp marks CONFIRMED because it's a directly sourced personal email.
  {
    slug: 'structured-custom-homes',
    companyName: 'Structured Custom Homes',
    city: 'Decatur',
    state: 'TX',
    expectedDomain: null,
    expectedFounder: 'Josh Barnes',
    expectedEmail: 'Jbarnessbg@outlook.com',
    expectedConfidence: 'CONFIRMED',
    notes: 'Naomi Meadows community in Decatur; Wise County. Personal outlook.com confirmed via Instagram + web search.',
  },

  // 18 — LBK Custom Homes
  // Source: 18_LBK_Custom_Homes/Builder_Recipient.txt = Info@LBK-Homes.com (generic)
  {
    slug: 'lbk-custom-homes',
    companyName: 'LBK Custom Homes',
    city: 'Springtown',
    state: 'TX',
    expectedDomain: 'lbk-homes.com',
    expectedFounder: null,
    expectedEmail: 'Info@LBK-Homes.com',
    expectedConfidence: 'UNVERIFIED',
    notes: 'Santana Ridge community, modern farmhouse blend. BBB-accredited 2017. Generic info@ only.',
  },

  // 19 — TGC Custom Homes
  // Source: 19_TGC_Custom_Homes/Builder_Recipient.txt = Tommy@tgccustomhomes.com
  // firstname@own-domain. Notes.md gives no explicit confidence stamp; treat LIKELY.
  {
    slug: 'tgc-custom-homes',
    companyName: 'TGC Custom Homes',
    city: 'Sanger',
    state: 'TX',
    expectedDomain: 'tgccustomhomes.com',
    expectedFounder: 'Tommy',
    expectedEmail: 'Tommy@tgccustomhomes.com',
    expectedConfidence: 'LIKELY',
    notes: '15 yrs Sanger, 20+ floor plans (Pilot Point / Sanger / Krum / Lindsay). firstname@own-domain.',
  },

  // 20 — Shepherd Custom Homes
  // Source: 20_Shepherd_Custom_Homes/Builder_Recipient.txt = info@shepherdcustomhomes.net (generic)
  {
    slug: 'shepherd-custom-homes',
    companyName: 'Shepherd Custom Homes',
    city: 'Boyd',
    state: 'TX',
    expectedDomain: 'shepherdcustomhomes.net',
    expectedFounder: 'Kenneth Shepherd',
    expectedEmail: 'info@shepherdcustomhomes.net',
    expectedConfidence: 'UNVERIFIED',
    notes: 'Boyd boutique build-to-suit by Kenneth and Ginger Shepherd. BBB-accredited. Generic info@ only.',
  },

  // 21 — Sofey Construction & Design
  // Source: 21_Sofey_Construction_Design/Builder_Recipient.txt + Notes.md
  // Stamp: "Recipient changed from generic info@ to jason@sofeyc-d.com [LIKELY]. First-name@domain inference."
  // Pre-send flag: Yelp showed CLOSED Dec 2025 — Notes confirm reopened (2026 copyright).
  {
    slug: 'sofey-construction-design',
    companyName: 'Sofey Construction & Design',
    city: 'Lake Kiowa',
    state: 'TX',
    expectedDomain: 'sofeyc-d.com',
    expectedFounder: 'Jason',
    expectedEmail: 'jason@sofeyc-d.com',
    expectedConfidence: 'LIKELY',
    notes: '17 yrs design-build with interior design integration. Yelp showed CLOSED Dec 2025 but 2026 copyright on site — operating confirmed.',
  },

  // 22 — Bailee Custom Homes
  // Source: 22_Bailee_Custom_Homes/Builder_Recipient.txt + Notes.md
  // Stamp: "Recipient changed from generic info@ to scott.mauldin@baileecustomhomes.org [CONFIRMED]. LinkedIn (note: .org TLD, not .com)."
  {
    slug: 'bailee-custom-homes',
    companyName: 'Bailee Custom Homes',
    city: 'Haslet',
    state: 'TX',
    expectedDomain: 'baileecustomhomes.org',
    expectedFounder: 'Scott Mauldin',
    expectedEmail: 'scott.mauldin@baileecustomhomes.org',
    expectedConfidence: 'CONFIRMED',
    notes: '34 yrs Haslet (modern farmhouse / luxury). NOTE .org TLD not .com. firstname.lastname pattern from LinkedIn.',
  },

  // 23 — PebbleBrook Homes
  // Source: 23_PebbleBrook_Homes/Builder_Recipient.txt = Randall.Tudor@gmail.com
  // Personal gmail; founder Randall Tudor implied by email alias. No company domain pattern verifiable.
  {
    slug: 'pebblebrook-homes',
    companyName: 'PebbleBrook Homes',
    city: 'Plano',
    state: 'TX',
    expectedDomain: null,
    expectedFounder: 'Randall Tudor',
    expectedEmail: 'Randall.Tudor@gmail.com',
    expectedConfidence: 'LIKELY',
    notes: 'Tudor-family operation (Plano corridor). Personal gmail (firstname.lastname); no custom domain.',
  },

  // 24 — Mastertouch Builders
  // Source: 24_Mastertouch_Builders/Builder_Recipient.txt = npatel@360investtx.com
  // Cross-domain (360investtx.com, an affiliated entity, not mastertouch's own).
  {
    slug: 'mastertouch-builders',
    companyName: 'Mastertouch Builders',
    city: 'Plano',
    state: 'TX',
    expectedDomain: '360investtx.com',
    expectedFounder: 'N. Patel',
    expectedEmail: 'npatel@360investtx.com',
    expectedConfidence: 'LIKELY',
    notes: 'Multi-partner team affiliated with 360 Invest TX (cross-domain — flastname pattern on parent entity).',
  },

  // 25 — Insite Construction
  // Source: 25_Insite_Construction/Builder_Recipient.txt = Insite.Ryan@gmail.com
  {
    slug: 'insite-construction',
    companyName: 'Insite Construction',
    city: 'Decatur',
    state: 'TX',
    expectedDomain: null,
    expectedFounder: 'Ryan',
    expectedEmail: 'Insite.Ryan@gmail.com',
    expectedConfidence: 'LIKELY',
    notes: '940 area builder (Wise/Denton corridor). Personal gmail with company.firstname pattern.',
  },

  // 26 — DC Endeavors
  // Source: 26_DC_Endeavors/Builder_Recipient.txt = dcendeavors_tx@yahoo.com (generic Yahoo with company alias)
  {
    slug: 'dc-endeavors',
    companyName: 'DC Endeavors',
    city: 'Plano',
    state: 'TX',
    expectedDomain: null,
    expectedFounder: null,
    expectedEmail: 'dcendeavors_tx@yahoo.com',
    expectedConfidence: 'UNVERIFIED',
    notes: 'Dallas/Plano area. Yahoo shared inbox (company alias). No founder name confirmed.',
  },

  // 27 — Precision Barn Homes
  // Source: 27_Precision_Barn_Homes/Builder_Recipient.txt = mbousquet@precisionbarnhomes.com
  // flastname pattern on own domain — no explicit stamp; LIKELY.
  {
    slug: 'precision-barn-homes',
    companyName: 'Precision Barn Homes',
    city: 'Krum',
    state: 'TX',
    expectedDomain: 'precisionbarnhomes.com',
    expectedFounder: 'M. Bousquet',
    expectedEmail: 'mbousquet@precisionbarnhomes.com',
    expectedConfidence: 'LIKELY',
    notes: '16 yrs Krum, custom turnkey barndominiums + modern farmhouse. flastname pattern on own domain.',
  },

  // 28 — HL Custom Homes
  // Source: 28_HL_Custom_Homes/Builder_Recipient.txt + Notes.md
  // Stamp: "Recipient changed from generic info@ to jimmy.harrison@hlcustomhomes.com [CONFIRMED]. Owner is Jimmy D. Harrison ... ZoomInfo + LinkedIn."
  {
    slug: 'hl-custom-homes',
    companyName: 'HL Custom Homes',
    city: 'Boyd',
    state: 'TX',
    expectedDomain: 'hlcustomhomes.com',
    expectedFounder: 'Jimmy Harrison',
    expectedEmail: 'jimmy.harrison@hlcustomhomes.com',
    expectedConfidence: 'CONFIRMED',
    notes: 'Boyd, on-your-lot custom across DFW. Owner Jimmy D. Harrison (not "HL" initials) — ZoomInfo + LinkedIn. Warm intro (already in Nate contacts).',
  },

  // 29 — PG Construction
  // Source: 29_PG_Construction/Builder_Recipient.txt = presiciongeneralconstruction@gmail.com (note: typo "presicion" not "precision")
  {
    slug: 'pg-construction',
    companyName: 'PG Construction',
    city: 'Joshua',
    state: 'TX',
    expectedDomain: null,
    expectedFounder: null,
    expectedEmail: 'presiciongeneralconstruction@gmail.com',
    expectedConfidence: 'UNVERIFIED',
    notes: 'Joshua TX custom residential. Company-aliased gmail (note typo "presicion"). No founder name surfaced.',
  },

  // 30 — Destination Homes Texas
  // Source: 30_Destination_Homes_Texas/Builder_Recipient.txt = info@destinationhomestexas.com (generic)
  // Founder JC Donnelly per Notes.md hook — but only generic info@ available.
  {
    slug: 'destination-homes-texas',
    companyName: 'Destination Homes Texas',
    city: 'Bridgeport',
    state: 'TX',
    expectedDomain: 'destinationhomestexas.com',
    expectedFounder: 'JC Donnelly',
    expectedEmail: 'info@destinationhomestexas.com',
    expectedConfidence: 'UNVERIFIED',
    notes: '33 yrs Bridgeport, family-owned, founder JC Donnelly (relocated from Oregon). Personal email not surfaced.',
  },

  // 31 — Troth Construction
  // Source: 31_Troth_Construction/Builder_Recipient.txt + Notes.md
  // Stamp: "Recipient changed from generic info@ to richard@trothconstruction.com [CONFIRMED]. Owner is Richard Troth — LinkedIn + TAB/DBA directories."
  {
    slug: 'troth-construction',
    companyName: 'Troth Construction',
    city: 'Dallas',
    state: 'TX',
    expectedDomain: 'trothconstruction.com',
    expectedFounder: 'Richard Troth',
    expectedEmail: 'richard@trothconstruction.com',
    expectedConfidence: 'CONFIRMED',
    notes: 'Contemporary/modern/transitional Dallas customs ($750K-$2.5M). firstname@own-domain. LinkedIn + TAB/DBA sourced.',
  },

  // 32 — Nexlevel Construction (special — service contractor, not residential builder)
  // Source: 32_Nexlevel_Construction/Builder_Recipient.txt = chad@nex-level.net
  // firstname@own-domain on hyphenated .net.
  {
    slug: 'nexlevel-construction',
    companyName: 'Nexlevel Construction',
    city: 'Celina',
    state: 'TX',
    expectedDomain: 'nex-level.net',
    expectedFounder: 'Chad',
    expectedEmail: 'chad@nex-level.net',
    expectedConfidence: 'LIKELY',
    notes: 'Roofing + outdoor living since 2007 (NOT residential custom builder). Different ICP — door-spend-per-project frame. firstname@own-domain on hyphenated .net.',
  },
]
