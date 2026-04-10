export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { checkStaffAuth } from '@/lib/api-auth';
import * as fs from 'fs';
import * as path from 'path';

// Configurable via env var for production; defaults to local Box export for dev
const BOX_EXPORT_PATH = process.env.DOCUMENTS_PATH
  || path.resolve(process.cwd(), '..', 'Abel Door & Trim_ DFW Box Export', 'Abel Door & Trim_ DFW');

interface Document {
  name: string;
  path: string;
  type: string;
  size: number;
  department: string;
  tags: string[];
}

interface Department {
  name: string;
  description: string;
  documents: Document[];
}

interface ByType {
  [key: string]: number;
}

// Department mappings with descriptions
const DEPARTMENT_DESCRIPTIONS: Record<string, string> = {
  Training: 'Training materials and curricula',
  'Operations/Standard Operating Procedures': 'Standard operating procedures and guidelines',
  'Delivery & Driver Documents': 'Delivery and driver operational documents',
  Warehouse: 'Warehouse operations and inventory',
  Manufacturing: 'Manufacturing processes and specifications',
  Purchasing: 'Purchasing and vendor management',
  Sales: 'Sales materials and documentation',
  Management: 'Management documentation and strategic planning',
  'Scott Johnson Docs': 'Operational spreadsheets and analysis',
  Financial: 'Financial analysis and projections',
};

const TARGET_DIRECTORIES = [
  'Training',
  'Operations/Standard Operating Procedures',
  'Delivery & Driver Documents',
  'Warehouse',
  'Manufacturing',
  'Purchasing',
  'Sales',
  'Management',
  'Scott Johnson Docs',
  'Financial',
];

const ALLOWED_EXTENSIONS = ['.xlsx', '.docx', '.pdf', '.pptx', '.csv'];

// Auto-tag keywords for document categorization
const TAG_KEYWORDS: Record<string, string[]> = {
  training: ['training', 'course', 'curriculum', 'module'],
  bid: ['bid', 'bidding', 'quote', 'estimate'],
  pricing: ['pricing', 'price', 'cost', 'margin'],
  invoice: ['invoice', 'billing', 'payment'],
  delivery: ['delivery', 'driver', 'route', 'dispatch'],
  manufacturing: ['manufacturing', 'production', 'mfg', 'fabrication'],
  inventory: ['inventory', 'stock', 'warehouse', 'sku'],
  management: ['management', 'plan', 'strategy', 'roadmap'],
  finance: ['finance', 'financial', 'accounting', 'budget'],
  sales: ['sales', 'customer', 'account'],
};

function getFileExtension(filename: string): string {
  return path.extname(filename).toLowerCase();
}

function getDocumentType(filename: string): string {
  const ext = getFileExtension(filename);
  switch (ext) {
    case '.xlsx':
    case '.csv':
      return 'spreadsheet';
    case '.docx':
      return 'document';
    case '.pdf':
      return 'pdf';
    case '.pptx':
      return 'presentation';
    default:
      return 'file';
  }
}

function extractTags(filename: string): string[] {
  const tags: string[] = [];
  const lowerFilename = filename.toLowerCase();

  for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
    if (keywords.some((keyword) => lowerFilename.includes(keyword))) {
      tags.push(tag);
    }
  }

  return tags.length > 0 ? tags : ['general'];
}

function scanDirectory(dirPath: string, relativePath: string = ''): Document[] {
  const documents: Document[] = [];

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const entryRelativePath = path.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        documents.push(...scanDirectory(fullPath, entryRelativePath));
      } else if (entry.isFile()) {
        const ext = getFileExtension(entry.name);
        if (ALLOWED_EXTENSIONS.includes(ext)) {
          const stats = fs.statSync(fullPath);
          // Determine department from the relative path
          const departmentMatch = entryRelativePath.split(path.sep)[0];

          documents.push({
            name: entry.name,
            path: entryRelativePath.replace(/\\/g, '/'),
            type: ext.substring(1),
            size: stats.size,
            department: departmentMatch || 'Other',
            tags: extractTags(entry.name),
          });
        }
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dirPath}:`, error);
  }

  return documents;
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const allDocuments: Document[] = [];
    const typeCount: ByType = {};

    // If the Box export directory doesn't exist, return empty result gracefully
    if (!fs.existsSync(BOX_EXPORT_PATH)) {
      return NextResponse.json({
        departments: [],
        totalDocuments: 0,
        byType: {},
        note: 'Document storage directory not configured. Set DOCUMENTS_PATH environment variable.',
      }, { status: 200 });
    }

    // Scan each target directory
    for (const dir of TARGET_DIRECTORIES) {
      const dirPath = path.join(BOX_EXPORT_PATH, dir);

      try {
        if (fs.existsSync(dirPath)) {
          const docs = scanDirectory(dirPath, dir);
          allDocuments.push(...docs);

          // Count file types
          for (const doc of docs) {
            const type = doc.type.toLowerCase();
            typeCount[type] = (typeCount[type] || 0) + 1;
          }
        }
      } catch (error) {
        console.error(`Error processing directory ${dir}:`, error);
      }
    }

    // Group documents by department
    const departmentMap: Record<string, Document[]> = {};

    for (const doc of allDocuments) {
      if (!departmentMap[doc.department]) {
        departmentMap[doc.department] = [];
      }
      departmentMap[doc.department].push(doc);
    }

    // Create department array with descriptions and documents
    const departments: Department[] = TARGET_DIRECTORIES
      .filter((dir) => departmentMap[dir] && departmentMap[dir].length > 0)
      .map((dir) => ({
        name: dir,
        description: DEPARTMENT_DESCRIPTIONS[dir] || 'Department documents',
        documents: departmentMap[dir].sort((a, b) => a.name.localeCompare(b.name)),
      }));

    return NextResponse.json(
      {
        departments,
        totalDocuments: allDocuments.length,
        byType: typeCount,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('GET /api/ops/documents error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch documents' },
      { status: 500 }
    );
  }
}
