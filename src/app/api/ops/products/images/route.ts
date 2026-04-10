export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// ============================================================================
// SUPPLIER IMAGE MAP
// Maps styleKey patterns to real supplier product image URLs
// Sources: Woodgrain (woodgrain.com), Therma-Tru (thermatru.com/Salsify CDN)
// ============================================================================

interface ImageMapping {
  imageUrl: string
  thumbnailUrl: string
  source: string
}

// Woodgrain CDN base
const WG = 'https://www.woodgrain.com/wp-content/uploads'

// Therma-Tru / Salsify CDN
const TT_SALSIFY = 'https://images.salsify.com/image/upload'

// Comprehensive style-to-image mapping from supplier websites
const STYLE_IMAGE_MAP: Record<string, ImageMapping> = {
  // =========================================================================
  // INTERIOR MOLDED & FLUSH DOORS (Woodgrain)
  // =========================================================================
  'interior': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },
  'interior-hc': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },
  'interior-sc': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },
  'interior-flush': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },
  'interior-flush-hc': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },
  'interior-flush-sc': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },
  'interior-flush-primed': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },
  'interior-flush-sc-primed': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },
  'interior-flush-mahogany': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },
  'interior-primed': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },
  'interior-mdf': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },
  'interior-flat': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },
  'interior-flat-hc': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },
  'interior-flat-sc': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },

  // =========================================================================
  // SHAKER DOORS (Woodgrain)
  // =========================================================================
  'interior-shaker': {
    imageUrl: `${WG}/5-Panel-Shaker.jpg`,
    thumbnailUrl: `${WG}/5-Panel-Shaker.jpg`,
    source: 'Woodgrain',
  },
  'interior-shaker-hc': {
    imageUrl: `${WG}/5-Panel-Shaker.jpg`,
    thumbnailUrl: `${WG}/5-Panel-Shaker.jpg`,
    source: 'Woodgrain',
  },
  'interior-shaker-sc': {
    imageUrl: `${WG}/5-Panel-Shaker.jpg`,
    thumbnailUrl: `${WG}/5-Panel-Shaker.jpg`,
    source: 'Woodgrain',
  },
  'interior-shaker-hc-mdf': {
    imageUrl: `${WG}/5-Panel-Shaker.jpg`,
    thumbnailUrl: `${WG}/5-Panel-Shaker.jpg`,
    source: 'Woodgrain',
  },
  'interior-shaker-mdf': {
    imageUrl: `${WG}/5-Panel-Shaker.jpg`,
    thumbnailUrl: `${WG}/5-Panel-Shaker.jpg`,
    source: 'Woodgrain',
  },
  'interior-shaker-pine': {
    imageUrl: `${WG}/3-Panel-Equal-Shaker.jpg`,
    thumbnailUrl: `${WG}/3-Panel-Equal-Shaker.jpg`,
    source: 'Woodgrain',
  },
  'interior-shaker-oak': {
    imageUrl: `${WG}/3-Panel-Equal-Shaker.jpg`,
    thumbnailUrl: `${WG}/3-Panel-Equal-Shaker.jpg`,
    source: 'Woodgrain',
  },

  // =========================================================================
  // 6-PANEL DOORS (Woodgrain)
  // =========================================================================
  'interior-6panel-hc': {
    imageUrl: `${WG}/6-Panel.jpg`,
    thumbnailUrl: `${WG}/6-Panel.jpg`,
    source: 'Woodgrain',
  },
  'interior-6panel': {
    imageUrl: `${WG}/6-Panel.jpg`,
    thumbnailUrl: `${WG}/6-Panel.jpg`,
    source: 'Woodgrain',
  },

  // =========================================================================
  // 2-PANEL DOORS (Woodgrain)
  // =========================================================================
  'interior-2panel': {
    imageUrl: `${WG}/2-Panel-Squaretop.jpg`,
    thumbnailUrl: `${WG}/2-Panel-Squaretop.jpg`,
    source: 'Woodgrain',
  },

  // =========================================================================
  // WOOD SPECIES STILE & RAIL DOORS (Woodgrain)
  // =========================================================================
  'interior-pine': {
    imageUrl: `${WG}/PON-100-448x1200.png`,
    thumbnailUrl: `${WG}/PON-100-448x1200.png`,
    source: 'Woodgrain',
  },
  'interior-sc-pine': {
    imageUrl: `${WG}/PON-100-448x1200.png`,
    thumbnailUrl: `${WG}/PON-100-448x1200.png`,
    source: 'Woodgrain',
  },
  'interior-oak': {
    imageUrl: `${WG}/KAL-102-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-102-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-mahogany': {
    imageUrl: `${WG}/KAL-106-450x1200.png`,
    thumbnailUrl: `${WG}/KAL-106-450x1200.png`,
    source: 'Woodgrain',
  },
  'interior-hemlock': {
    imageUrl: `${WG}/KAL-107-448x1200.png`,
    thumbnailUrl: `${WG}/KAL-107-448x1200.png`,
    source: 'Woodgrain',
  },
  'interior-knottyalder': {
    imageUrl: `${WG}/KAL-012-450x1200.png`,
    thumbnailUrl: `${WG}/KAL-012-450x1200.png`,
    source: 'Woodgrain',
  },
  'interior-walnut': {
    imageUrl: `${WG}/KAL-108-450x1200.png`,
    thumbnailUrl: `${WG}/KAL-108-450x1200.png`,
    source: 'Woodgrain',
  },
  'interior-steel': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },
  'interior-fiberglass': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },

  // =========================================================================
  // GLASS LITE DOORS (Woodgrain)
  // =========================================================================
  'interior-1lite': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-1lite-pine': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-1lite-hemlock': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-1lite-sc': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-1lite-hc-mdf': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-1lite-fiberglass': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-2lite': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-2lite-pine': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-3lite': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-4lite': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-4lite-mahogany': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-4lite-fiberglass': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-5lite-pine': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-6lite': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-6lite-pine': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-6lite-mahogany': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-6lite-knottyalder': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-9lite': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-9lite-mahogany': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-10lite-pine': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-10lite-mdf': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-12lite': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-12lite-pine': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-12lite-mdf': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-18lite-pine': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-french': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-french-primed': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },

  // =========================================================================
  // DOUBLE DOORS (Woodgrain)
  // =========================================================================
  'interior-double': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },
  'interior-double-hc': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },
  'interior-double-sc': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },
  'interior-double-hc-primed': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },
  'interior-double-hc-pine': {
    imageUrl: `${WG}/PON-100-448x1200.png`,
    thumbnailUrl: `${WG}/PON-100-448x1200.png`,
    source: 'Woodgrain',
  },
  'interior-double-pine': {
    imageUrl: `${WG}/PON-100-448x1200.png`,
    thumbnailUrl: `${WG}/PON-100-448x1200.png`,
    source: 'Woodgrain',
  },
  'interior-double-mdf': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },
  'interior-double-shaker-hc': {
    imageUrl: `${WG}/5-Panel-Shaker.jpg`,
    thumbnailUrl: `${WG}/5-Panel-Shaker.jpg`,
    source: 'Woodgrain',
  },
  'interior-double-shaker-sc': {
    imageUrl: `${WG}/5-Panel-Shaker.jpg`,
    thumbnailUrl: `${WG}/5-Panel-Shaker.jpg`,
    source: 'Woodgrain',
  },
  'interior-double-shaker-pine': {
    imageUrl: `${WG}/3-Panel-Equal-Shaker.jpg`,
    thumbnailUrl: `${WG}/3-Panel-Equal-Shaker.jpg`,
    source: 'Woodgrain',
  },
  'interior-double-6panel-hc': {
    imageUrl: `${WG}/6-Panel.jpg`,
    thumbnailUrl: `${WG}/6-Panel.jpg`,
    source: 'Woodgrain',
  },
  'interior-double-6panel': {
    imageUrl: `${WG}/6-Panel.jpg`,
    thumbnailUrl: `${WG}/6-Panel.jpg`,
    source: 'Woodgrain',
  },
  'interior-double-flush': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },
  'interior-double-1lite': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-double-1lite-hc-pine': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-double-1lite-pine': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-double-4lite': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-double-4lite-mahogany': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-double-6lite': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-double-10lite-hc-pine': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-double-10lite-sc-mdf': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-double-12lite-hc-pine': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-double-12lite-mdf': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'interior-double-18lite-hc-pine': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },

  // =========================================================================
  // EXTERIOR DOORS (Therma-Tru)
  // =========================================================================
  'exterior': {
    imageUrl: `${TT_SALSIFY}/s--Z4FxC3OU--/t8niwgwffsreevz8rglu.jpg`,
    thumbnailUrl: `${TT_SALSIFY}/s--Z4FxC3OU--/t8niwgwffsreevz8rglu.jpg`,
    source: 'Therma-Tru',
  },
  'exterior-flush': {
    imageUrl: `${TT_SALSIFY}/s--Z4FxC3OU--/t8niwgwffsreevz8rglu.jpg`,
    thumbnailUrl: `${TT_SALSIFY}/s--Z4FxC3OU--/t8niwgwffsreevz8rglu.jpg`,
    source: 'Therma-Tru',
  },
  'exterior-flat-steel': {
    imageUrl: `${TT_SALSIFY}/s--Z4FxC3OU--/t8niwgwffsreevz8rglu.jpg`,
    thumbnailUrl: `${TT_SALSIFY}/s--Z4FxC3OU--/t8niwgwffsreevz8rglu.jpg`,
    source: 'Therma-Tru',
  },
  'exterior-steel': {
    imageUrl: `${TT_SALSIFY}/s--Z4FxC3OU--/t8niwgwffsreevz8rglu.jpg`,
    thumbnailUrl: `${TT_SALSIFY}/s--Z4FxC3OU--/t8niwgwffsreevz8rglu.jpg`,
    source: 'Therma-Tru',
  },
  'exterior-primed': {
    imageUrl: `${TT_SALSIFY}/s--Z4FxC3OU--/t8niwgwffsreevz8rglu.jpg`,
    thumbnailUrl: `${TT_SALSIFY}/s--Z4FxC3OU--/t8niwgwffsreevz8rglu.jpg`,
    source: 'Therma-Tru',
  },
  'exterior-fiberglass': {
    imageUrl: `${TT_SALSIFY}/s--Z4FxC3OU--/t8niwgwffsreevz8rglu.jpg`,
    thumbnailUrl: `${TT_SALSIFY}/s--Z4FxC3OU--/t8niwgwffsreevz8rglu.jpg`,
    source: 'Therma-Tru',
  },
  'exterior-mahogany': {
    imageUrl: `${WG}/KAL-106-450x1200.png`,
    thumbnailUrl: `${WG}/KAL-106-450x1200.png`,
    source: 'Woodgrain',
  },
  'exterior-oak': {
    imageUrl: `${WG}/KAL-102-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-102-449x1200.png`,
    source: 'Woodgrain',
  },
  'exterior-hemlock': {
    imageUrl: `${WG}/KAL-107-448x1200.png`,
    thumbnailUrl: `${WG}/KAL-107-448x1200.png`,
    source: 'Woodgrain',
  },
  'exterior-knottyalder': {
    imageUrl: `${WG}/KAL-012-450x1200.png`,
    thumbnailUrl: `${WG}/KAL-012-450x1200.png`,
    source: 'Woodgrain',
  },
  'exterior-shaker-oak': {
    imageUrl: `${WG}/3-Panel-Equal-Shaker.jpg`,
    thumbnailUrl: `${WG}/3-Panel-Equal-Shaker.jpg`,
    source: 'Woodgrain',
  },
  'exterior-1lite': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'exterior-1lite-mahogany': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'exterior-2lite': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'exterior-3lite-mahogany': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'exterior-4lite': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'exterior-4lite-mahogany': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'exterior-5lite-mahogany': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'exterior-6lite': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'exterior-6lite-mahogany': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'exterior-7lite-mahogany': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'exterior-8lite': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'exterior-8lite-mahogany': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'exterior-8lite-oak': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },
  'exterior-12lite-mahogany': {
    imageUrl: `${WG}/KAL-103T-449x1200.png`,
    thumbnailUrl: `${WG}/KAL-103T-449x1200.png`,
    source: 'Woodgrain',
  },

  // =========================================================================
  // FIRE-RATED DOORS
  // =========================================================================
  'fire-rated': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },
  'fire-rated-20-min': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },
  'fire-rated-20-min-mdf': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },
  'fire-rated-20-min-pine': {
    imageUrl: `${WG}/PON-100-448x1200.png`,
    thumbnailUrl: `${WG}/PON-100-448x1200.png`,
    source: 'Woodgrain',
  },
  'fire-rated-20-min-primed': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },
  'fire-rated-45-min': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },
  'fire-rated-mdf': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },

  // =========================================================================
  // SPECIALTY DOORS
  // =========================================================================
  'barn-door': {
    imageUrl: `${WG}/3-Panel-T-Shaker.jpg`,
    thumbnailUrl: `${WG}/3-Panel-T-Shaker.jpg`,
    source: 'Woodgrain',
  },
  'bifold': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },
  'attic-door': {
    imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
    source: 'Woodgrain',
  },
  'service-door': {
    imageUrl: `${TT_SALSIFY}/s--Z4FxC3OU--/t8niwgwffsreevz8rglu.jpg`,
    thumbnailUrl: `${TT_SALSIFY}/s--Z4FxC3OU--/t8niwgwffsreevz8rglu.jpg`,
    source: 'Therma-Tru',
  },
  'service-door-steel': {
    imageUrl: `${TT_SALSIFY}/s--Z4FxC3OU--/t8niwgwffsreevz8rglu.jpg`,
    thumbnailUrl: `${TT_SALSIFY}/s--Z4FxC3OU--/t8niwgwffsreevz8rglu.jpg`,
    source: 'Therma-Tru',
  },
  'thermatru-fc60-oak': {
    imageUrl: `${TT_SALSIFY}/s--Z4FxC3OU--/t8niwgwffsreevz8rglu.jpg`,
    thumbnailUrl: `${TT_SALSIFY}/s--Z4FxC3OU--/t8niwgwffsreevz8rglu.jpg`,
    source: 'Therma-Tru',
  },

  // =========================================================================
  // TRIM & THRESHOLDS
  // =========================================================================
  'trim': {
    imageUrl: `${WG}/Interior-Doors-4.jpg`,
    thumbnailUrl: `${WG}/Interior-Doors-4.jpg`,
    source: 'Woodgrain',
  },
  'trim-pine': {
    imageUrl: `${WG}/Interior-Doors-4.jpg`,
    thumbnailUrl: `${WG}/Interior-Doors-4.jpg`,
    source: 'Woodgrain',
  },
  'trim-mdf': {
    imageUrl: `${WG}/Interior-Doors-4.jpg`,
    thumbnailUrl: `${WG}/Interior-Doors-4.jpg`,
    source: 'Woodgrain',
  },
  'trim-primed': {
    imageUrl: `${WG}/Interior-Doors-4.jpg`,
    thumbnailUrl: `${WG}/Interior-Doors-4.jpg`,
    source: 'Woodgrain',
  },
  'threshold': {
    imageUrl: `${WG}/Interior-Doors-4.jpg`,
    thumbnailUrl: `${WG}/Interior-Doors-4.jpg`,
    source: 'Woodgrain',
  },
}

// ============================================================================
// FALLBACK LOGIC
// ============================================================================

const FALLBACK_PATTERNS: Array<{ pattern: string; mapping: ImageMapping }> = [
  {
    pattern: 'thermatru',
    mapping: {
      imageUrl: `${TT_SALSIFY}/s--Z4FxC3OU--/t8niwgwffsreevz8rglu.jpg`,
      thumbnailUrl: `${TT_SALSIFY}/s--Z4FxC3OU--/t8niwgwffsreevz8rglu.jpg`,
      source: 'Therma-Tru',
    },
  },
  {
    pattern: 'exterior',
    mapping: {
      imageUrl: `${TT_SALSIFY}/s--Z4FxC3OU--/t8niwgwffsreevz8rglu.jpg`,
      thumbnailUrl: `${TT_SALSIFY}/s--Z4FxC3OU--/t8niwgwffsreevz8rglu.jpg`,
      source: 'Therma-Tru',
    },
  },
  {
    pattern: 'fire-rated',
    mapping: {
      imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
      thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
      source: 'Woodgrain',
    },
  },
  {
    pattern: 'interior-double',
    mapping: {
      imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
      thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
      source: 'Woodgrain',
    },
  },
  {
    pattern: 'interior-shaker',
    mapping: {
      imageUrl: `${WG}/5-Panel-Shaker.jpg`,
      thumbnailUrl: `${WG}/5-Panel-Shaker.jpg`,
      source: 'Woodgrain',
    },
  },
  {
    pattern: 'interior-flush',
    mapping: {
      imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
      thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
      source: 'Woodgrain',
    },
  },
  {
    pattern: 'interior',
    mapping: {
      imageUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
      thumbnailUrl: `${WG}/2-Panel-Flat-Molded-1.jpeg`,
      source: 'Woodgrain',
    },
  },
  {
    pattern: 'service',
    mapping: {
      imageUrl: `${TT_SALSIFY}/s--Z4FxC3OU--/t8niwgwffsreevz8rglu.jpg`,
      thumbnailUrl: `${TT_SALSIFY}/s--Z4FxC3OU--/t8niwgwffsreevz8rglu.jpg`,
      source: 'Therma-Tru',
    },
  },
]

function getImageForStyleKey(styleKey: string): ImageMapping | null {
  if (STYLE_IMAGE_MAP[styleKey]) {
    return STYLE_IMAGE_MAP[styleKey]
  }
  for (const { pattern, mapping } of FALLBACK_PATTERNS) {
    if (styleKey.startsWith(pattern)) {
      return mapping
    }
  }
  return null
}

// ============================================================================
// STYLE KEY GENERATION (independent copy from enrich route)
// ============================================================================

function computeStyleKey(name: string, category: string): string {
  const upper = name.toUpperCase()
  const parts: string[] = []

  const isExterior = category.includes('EXTERIOR') || upper.includes('EXTERIOR')
  const isThermaRu = upper.includes('THERMA-TRU')
  const isFireRated = category.includes('FIRE') || upper.includes('FIRE DOOR') || upper.includes('20 MIN') || upper.includes('45 MIN') || upper.includes('90 MIN')
  const isAtticDoor = category.includes('ATTIC') || upper.includes('ATTIC')
  const isBarnDoor = category.includes('BARN') || upper.includes('BARN DOOR')
  const isServiceDoor = category.includes('SERVICE') || upper.includes('SERVICE DOOR')
  const isThreshold = category.includes('THRESHOLD') || upper.includes('THRESHOLD')
  const isTrim = category.includes('TRIM')
  const isBifold = upper.includes('BIFOLD')

  let panelStyle: string | undefined
  const panelMatch = upper.match(/(\d+)\s*(?:-\s*)?LITE/)
  if (panelMatch) panelStyle = `${panelMatch[1]}-Lite`
  else if (upper.includes('SHAKER')) panelStyle = 'Shaker'
  else if (upper.match(/(\d+)\s*PANEL/)) {
    const pm = upper.match(/(\d+)\s*PANEL/)
    panelStyle = `${pm![1]}-Panel`
  } else if (upper.includes('FLUSH')) panelStyle = 'Flush'
  else if (upper.includes('FLAT PANEL') || upper.includes('FLAT')) panelStyle = 'Flat'
  else if (upper.includes('FRENCH')) panelStyle = 'French'

  let coreType: string | undefined
  if (upper.includes('H/C') || upper.includes('HOLLOW')) coreType = 'Hollow Core'
  else if (upper.includes('S/C') || upper.includes('SOLID CORE')) coreType = 'Solid Core'

  let material: string | undefined
  const materialPatterns: Array<[RegExp, string]> = [
    [/\bPINE\b/, 'PINE'], [/\bOAK\b/, 'OAK'], [/\bMAHOGANY\b/, 'MAHOGANY'],
    [/\bHEMLOCK\b/, 'HEMLOCK'], [/\bMDF\b/, 'MDF'], [/\bPRIMED\b/, 'PRIMED'],
    [/\bSTEEL\b/, 'STEEL'], [/\bFIBERGLASS\b/, 'FIBERGLASS'],
    [/\bKNOTTY\s*ALDER\b/, 'KNOTTYALDER'], [/\bWALNUT\b/, 'WALNUT'],
  ]
  for (const [regex, mat] of materialPatterns) {
    if (regex.test(upper)) { material = mat; break }
  }

  const isDoubleDoor = upper.includes('DOUBLE') || upper.includes('DBL') || upper.includes('TWIN') || upper.includes('T-AST') || upper.includes('T/BC')

  if (isThermaRu) {
    parts.push('thermatru')
    const thermaMatch = upper.match(/\b([A-Z]+\d+[A-Z]?)\b/)
    if (thermaMatch) parts.push(thermaMatch[1].toLowerCase())
  } else if (isFireRated) {
    parts.push('fire-rated')
    if (upper.includes('90 MIN')) parts.push('90-min')
    else if (upper.includes('45 MIN')) parts.push('45-min')
    else if (upper.includes('20 MIN')) parts.push('20-min')
  } else if (isAtticDoor) {
    parts.push('attic-door')
  } else if (isBarnDoor) {
    parts.push('barn-door')
  } else if (isServiceDoor) {
    parts.push('service-door')
  } else if (isThreshold) {
    parts.push('threshold')
  } else if (isTrim) {
    parts.push('trim')
  } else if (isBifold) {
    parts.push('bifold')
  } else if (isExterior) {
    parts.push('exterior')
    if (panelStyle) parts.push(panelStyle.toLowerCase().replace(/-/g, ''))
  } else {
    parts.push('interior')
    if (isDoubleDoor) parts.push('double')
    if (panelStyle) parts.push(panelStyle.toLowerCase().replace(/-/g, ''))
    if (coreType) parts.push(coreType === 'Hollow Core' ? 'hc' : 'sc')
  }

  if (material) parts.push(material.toLowerCase().replace(/\s+/g, ''))

  return parts.filter(Boolean).join('-')
}

// ============================================================================
// API HANDLERS
// ============================================================================

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '20')

    const totalProductsResult = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT COUNT(*)::int as count FROM "Product" WHERE "active" = true'
    )
    const totalProducts = Number(totalProductsResult[0].count)

    const withImagesResult = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT COUNT(*)::int as count FROM "Product" WHERE "active" = true AND "imageUrl" IS NOT NULL'
    )
    const withImages = Number(withImagesResult[0].count)

    const sampleProducts = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "Product" WHERE "active" = true ORDER BY "category" ASC, "name" ASC LIMIT $1`,
      limit
    )

    const preview = sampleProducts.map((p: any) => {
      const styleKey = computeStyleKey(p.name, p.category)
      const mapping = getImageForStyleKey(styleKey)
      return {
        sku: p.sku,
        name: p.name,
        category: p.category,
        styleKey,
        wouldGetImage: mapping?.imageUrl || null,
        source: mapping?.source || 'No match',
        hasMapping: !!mapping,
      }
    })

    return NextResponse.json({
      coverage: {
        totalProducts,
        withImages,
        withoutImages: totalProducts - withImages,
        coveragePercent: ((withImages / totalProducts) * 100).toFixed(1) + '%',
      },
      mappingStats: {
        directMappings: Object.keys(STYLE_IMAGE_MAP).length,
        fallbackPatterns: FALLBACK_PATTERNS.length,
      },
      preview,
    })
  } catch (error) {
    console.error('Image preview error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const products = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; category: string }>>(
      'SELECT "id", "name", "category" FROM "Product" WHERE "active" = true'
    )

    console.log(`Processing ${products.length} products for image mapping...`)

    let mapped = 0
    let noMatch = 0
    const batchSize = 50
    const updates: Array<{ id: string; imageUrl: string; thumbnailUrl: string }> = []

    for (const product of products) {
      const styleKey = computeStyleKey(product.name, product.category)
      const mapping = getImageForStyleKey(styleKey)

      if (mapping) {
        updates.push({
          id: product.id,
          imageUrl: mapping.imageUrl,
          thumbnailUrl: mapping.thumbnailUrl,
        })
        mapped++
      } else {
        noMatch++
      }
    }

    let applied = 0
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize)
      const promises = batch.map(({ id, imageUrl, thumbnailUrl }) =>
        prisma.$executeRawUnsafe(
          'UPDATE "Product" SET "imageUrl" = $1, "thumbnailUrl" = $2 WHERE "id" = $3',
          imageUrl,
          thumbnailUrl,
          id
        )
      )
      await Promise.all(promises)
      applied += batch.length
    }

    console.log(`Image mapping complete: ${applied} updated, ${noMatch} no match`)

    const totalWithImagesResult = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT COUNT(*)::int as count FROM "Product" WHERE "active" = true AND "imageUrl" IS NOT NULL'
    )
    const totalWithImages = Number(totalWithImagesResult[0].count)

    const totalProductsResult = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT COUNT(*)::int as count FROM "Product" WHERE "active" = true'
    )
    const totalProducts = Number(totalProductsResult[0].count)

    return NextResponse.json({
      mode: 'applied',
      totalProcessed: products.length,
      mapped,
      applied,
      noMatch,
      coverage: {
        totalProducts,
        withImages: totalWithImages,
        coveragePercent: ((totalWithImages / totalProducts) * 100).toFixed(1) + '%',
      },
      message: `Successfully mapped images to ${applied} products. Coverage: ${((totalWithImages / totalProducts) * 100).toFixed(1)}%.`,
    })
  } catch (error) {
    console.error('Image mapping POST error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { updates } = body as {
      updates: Array<{
        productId: string
        imageUrl: string
        thumbnailUrl?: string | null
        imageAlt?: string | null
      }>
    }

    if (!updates || !Array.isArray(updates)) {
      return NextResponse.json({ error: 'Missing updates array' }, { status: 400 })
    }

    const results = await Promise.all(
      updates.map((u) =>
        prisma.$executeRawUnsafe(
          'UPDATE "Product" SET "imageUrl" = $1, "thumbnailUrl" = $2, "imageAlt" = $3 WHERE "id" = $4',
          u.imageUrl,
          u.thumbnailUrl || u.imageUrl,
          u.imageAlt || null,
          u.productId
        )
      )
    )

    const updatedProducts = await prisma.$queryRawUnsafe(
      `SELECT "id", "sku", "imageUrl" FROM "Product" WHERE "id" = ANY($1)`,
      updates.map(u => u.productId)
    )

    return NextResponse.json({
      updated: results.length,
      products: updatedProducts,
    })
  } catch (error) {
    console.error('Image PATCH error:', error)
    return NextResponse.json(
      { error: 'Failed to update images', details: String(error) },
      { status: 500 }
    )
  }
}
