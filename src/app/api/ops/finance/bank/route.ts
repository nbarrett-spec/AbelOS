export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { checkStaffAuth } from '@/lib/api-auth'
import { parseRoles, type StaffRole } from '@/lib/permissions'

// Bank data is highly sensitive — restrict to ADMIN, MANAGER, ACCOUNTING only
const BANK_ACCESS_ROLES: StaffRole[] = ['ADMIN', 'MANAGER', 'ACCOUNTING']

const DATA_DIR = path.join(process.cwd(), 'src/data')
const BANK_DATA_FILE = path.join(DATA_DIR, 'bank-data.json')

// Ensure data directory exists
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

// Get or create default bank data
function getDefaultBankData() {
  return {
    accounts: [
      {
        id: 'acc-1',
        name: 'Primary Checking',
        institution: 'Wells Fargo',
        accountType: 'checking',
        currentBalance: 125000,
        lastUpdated: new Date().toISOString(),
      },
      {
        id: 'acc-2',
        name: 'Operating Savings',
        institution: 'Wells Fargo',
        accountType: 'savings',
        currentBalance: 250000,
        lastUpdated: new Date().toISOString(),
      },
      {
        id: 'acc-3',
        name: 'Line of Credit',
        institution: 'Bank of America',
        accountType: 'credit_line',
        currentBalance: 45000,
        creditLimit: 100000,
        lastUpdated: new Date().toISOString(),
      },
    ],
    transactions: [
      {
        id: 'txn-1',
        date: new Date(Date.now() - 86400000).toISOString(),
        description: 'Invoice Payment - Boise Cascade',
        amount: 5200.5,
        category: 'Materials',
        runningBalance: 124500,
        type: 'debit',
      },
      {
        id: 'txn-2',
        date: new Date(Date.now() - 172800000).toISOString(),
        description: 'Customer Payment - AMP Builders',
        amount: 8500,
        category: 'Revenue',
        runningBalance: 129700.5,
        type: 'credit',
      },
      {
        id: 'txn-3',
        date: new Date(Date.now() - 259200000).toISOString(),
        description: 'Payroll',
        amount: 12000,
        category: 'Payroll',
        runningBalance: 121200.5,
        type: 'debit',
      },
    ],
    budgetAllocation: [
      {
        category: 'Payroll',
        budgeted: 50000,
        actual: 48200,
        variance: 1800,
      },
      {
        category: 'Materials/Inventory',
        budgeted: 80000,
        actual: 75600,
        variance: 4400,
      },
      {
        category: 'Equipment',
        budgeted: 15000,
        actual: 12500,
        variance: 2500,
      },
      {
        category: 'Insurance',
        budgeted: 8000,
        actual: 8000,
        variance: 0,
      },
      {
        category: 'Rent/Utilities',
        budgeted: 12000,
        actual: 11800,
        variance: 200,
      },
      {
        category: 'Other',
        budgeted: 5000,
        actual: 3200,
        variance: 1800,
      },
    ],
  }
}

// Read bank data from file
function readBankData() {
  ensureDataDir()

  if (!fs.existsSync(BANK_DATA_FILE)) {
    const defaultData = getDefaultBankData()
    fs.writeFileSync(BANK_DATA_FILE, JSON.stringify(defaultData, null, 2))
    return defaultData
  }

  try {
    const data = fs.readFileSync(BANK_DATA_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    const defaultData = getDefaultBankData()
    fs.writeFileSync(BANK_DATA_FILE, JSON.stringify(defaultData, null, 2))
    return defaultData
  }
}

// Write bank data to file
function writeBankData(data: any) {
  ensureDataDir()
  fs.writeFileSync(BANK_DATA_FILE, JSON.stringify(data, null, 2))
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  // Additional role check — bank data restricted to ADMIN, MANAGER, ACCOUNTING
  const staffRolesStr = request.headers.get('x-staff-roles') || request.headers.get('x-staff-role') || ''
  const userRoles = parseRoles(staffRolesStr) as StaffRole[]
  if (!userRoles.some(r => BANK_ACCESS_ROLES.includes(r))) {
    return NextResponse.json({ error: 'Bank data is restricted to authorized personnel' }, { status: 403 })
  }

  try {
    const data = readBankData()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Bank API error:', error)
    return NextResponse.json({ error: 'Failed to fetch bank data' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffRolesStr2 = request.headers.get('x-staff-roles') || request.headers.get('x-staff-role') || ''
  const userRoles2 = parseRoles(staffRolesStr2) as StaffRole[]
  if (!userRoles2.some(r => BANK_ACCESS_ROLES.includes(r))) {
    return NextResponse.json({ error: 'Bank data is restricted to authorized personnel' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const data = readBankData()

    if (body.type === 'account') {
      // Add new account
      const newAccount = {
        id: 'acc-' + Date.now(),
        name: body.name,
        institution: body.institution,
        accountType: body.accountType,
        currentBalance: body.currentBalance || 0,
        creditLimit: body.creditLimit,
        lastUpdated: new Date().toISOString(),
      }
      data.accounts.push(newAccount)
    } else if (body.type === 'transaction') {
      // Add new transaction
      const newTransaction = {
        id: 'txn-' + Date.now(),
        date: body.date,
        description: body.description,
        amount: body.amount,
        category: body.category,
        runningBalance: body.runningBalance,
        type: body.type,
      }
      data.transactions.push(newTransaction)
    }

    writeBankData(data)
    return NextResponse.json(data)
  } catch (error) {
    console.error('Bank API POST error:', error)
    return NextResponse.json({ error: 'Failed to save bank data' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffRolesStr3 = request.headers.get('x-staff-roles') || request.headers.get('x-staff-role') || ''
  const userRoles3 = parseRoles(staffRolesStr3) as StaffRole[]
  if (!userRoles3.some(r => BANK_ACCESS_ROLES.includes(r))) {
    return NextResponse.json({ error: 'Bank data is restricted to authorized personnel' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const data = readBankData()

    if (body.type === 'account') {
      // Update account balance
      const account = data.accounts.find((a: any) => a.id === body.accountId)
      if (account) {
        account.currentBalance = body.currentBalance
        account.lastUpdated = new Date().toISOString()
      }
    }

    writeBankData(data)
    return NextResponse.json(data)
  } catch (error) {
    console.error('Bank API PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update bank data' }, { status: 500 })
  }
}
