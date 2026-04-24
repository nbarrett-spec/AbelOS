'use client'

import { useEffect, useState } from 'react'
import { DollarSign } from 'lucide-react'
import { PageHeader, EmptyState } from '@/components/ui'

interface BankAccount {
  id: string
  name: string
  institution: string
  accountType: 'checking' | 'savings' | 'credit_line' | 'money_market'
  currentBalance: number
  creditLimit?: number
  lastUpdated: string
}

interface Transaction {
  id: string
  date: string
  description: string
  amount: number
  category: string
  runningBalance: number
  type: 'debit' | 'credit'
}

interface BankData {
  accounts: BankAccount[]
  transactions: Transaction[]
  budgetAllocation: Array<{
    category: string
    budgeted: number
    actual: number
    variance: number
  }>
}

export default function BankAndCreditLinesPage() {
  const [data, setData] = useState<BankData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [showAddTransaction, setShowAddTransaction] = useState(false)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const response = await fetch('/api/ops/finance/bank')
      if (!response.ok) throw new Error('Failed to fetch bank data')
      const result = await response.json()
      setData(result)
    } catch (err) {
      console.error(err)
      // Set default data if fetch fails
      setData({
        accounts: [],
        transactions: [],
        budgetAllocation: []
      })
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(value)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-fg-muted">Loading bank data...</div>
      </div>
    )
  }

  const totalCash = data?.accounts.filter(a => a.accountType !== 'credit_line').reduce((sum, a) => sum + a.currentBalance, 0) || 0
  const totalCreditAvailable = data?.accounts.filter(a => a.accountType === 'credit_line').reduce((sum, a) => sum + (a.creditLimit || 0) - a.currentBalance, 0) || 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        eyebrow="Finance"
        title="Bank & Credit Lines"
        description="Manual tracking of accounts, balances, and transactions."
      />

      {/* Cash Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-surface rounded-lg shadow p-6 border-l-4 border-data-positive">
          <div className="text-fg-muted text-sm font-medium">Total Cash on Hand</div>
          <div className="text-2xl font-semibold text-data-positive mt-2">
            {formatCurrency(totalCash)}
          </div>
          <p className="text-xs text-fg-subtle mt-2">Checking + Savings + Money Market</p>
        </div>

        <div className="bg-surface rounded-lg shadow p-6 border-l-4 border-[#0f2a3e]">
          <div className="text-fg-muted text-sm font-medium">Available Credit</div>
          <div className="text-2xl font-semibold text-fg mt-2">
            {formatCurrency(totalCreditAvailable)}
          </div>
          <p className="text-xs text-fg-subtle mt-2">Unused credit lines</p>
        </div>

        <div className="bg-surface rounded-lg shadow p-6 border-l-4 border-signal">
          <div className="text-fg-muted text-sm font-medium">Total Liquidity</div>
          <div className="text-2xl font-semibold text-signal mt-2">
            {formatCurrency(totalCash + totalCreditAvailable)}
          </div>
          <p className="text-xs text-fg-subtle mt-2">Cash + available credit</p>
        </div>
      </div>

      {/* Account Cards */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-fg">Bank Accounts & Credit Lines</h3>
          <button
            onClick={() => setShowAddAccount(!showAddAccount)}
            className="bg-signal text-white px-4 py-2 rounded font-semibold hover:bg-signal-hover transition"
          >
            + Add Account
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data?.accounts.map((account) => {
            const isCredit = account.accountType === 'credit_line'
            const utilized = isCredit ? ((account.currentBalance / (account.creditLimit || 1)) * 100) : null

            return (
              <div key={account.id} className="bg-surface rounded-lg shadow p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h4 className="text-lg font-semibold text-fg">{account.name}</h4>
                    <p className="text-sm text-fg-muted">{account.institution}</p>
                  </div>
                  <span className="text-xs font-semibold px-2 py-1 rounded bg-surface-muted text-fg-muted">
                    {account.accountType.replace('_', ' ').toUpperCase()}
                  </span>
                </div>

                {isCredit ? (
                  <>
                    <div className="mb-4">
                      <div className="text-fg-muted text-sm mb-1">Credit Limit</div>
                      <div className="text-xl font-semibold text-fg">{formatCurrency(account.creditLimit || 0)}</div>
                    </div>
                    <div className="mb-4">
                      <div className="text-fg-muted text-sm mb-1">Balance (Used)</div>
                      <div className="text-xl font-semibold text-data-negative">{formatCurrency(account.currentBalance)}</div>
                    </div>
                    <div className="mb-4">
                      <div className="text-fg-muted text-sm mb-1">Available</div>
                      <div className="text-xl font-semibold text-data-positive">
                        {formatCurrency((account.creditLimit || 0) - account.currentBalance)}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-fg-muted mb-2">Utilization</div>
                      <div className="w-full bg-surface-muted rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${utilized && utilized > 80 ? 'bg-red-500' : utilized && utilized > 60 ? 'bg-orange-500' : 'bg-green-500'}`}
                          style={{ width: `${Math.min(utilized || 0, 100)}%` }}
                        />
                      </div>
                      <div className="text-xs text-fg-muted mt-1">{utilized?.toFixed(0)}% used</div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mb-4">
                      <div className="text-fg-muted text-sm mb-1">Current Balance</div>
                      <div className="text-2xl font-semibold text-fg">{formatCurrency(account.currentBalance)}</div>
                    </div>
                  </>
                )}

                <div className="text-xs text-fg-subtle mt-4 pt-4 border-t border-border">
                  Last updated: {formatDate(account.lastUpdated)}
                </div>
                <button className="mt-4 w-full text-sm text-signal hover:text-signal-hover font-semibold">
                  Edit Account
                </button>
              </div>
            )
          })}
        </div>

        {data?.accounts.length === 0 && (
          <EmptyState
            icon={<DollarSign className="w-8 h-8 text-fg-subtle" />}
            title="No financial data yet"
            description="No bank accounts added yet."
            action={{ label: 'Add your first account', onClick: () => setShowAddAccount(true) }}
          />
        )}
      </div>

      {/* Budget Allocation */}
      <div className="bg-surface rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-fg mb-4">Budget vs Actual</h3>
        <div className="space-y-4">
          {data?.budgetAllocation.map((item) => {
            const percentOfBudget = (item.actual / Math.max(item.budgeted, 1)) * 100
            const isOverBudget = item.variance < 0

            return (
              <div key={item.category}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-sm font-medium text-fg">{item.category}</div>
                    <div className="text-xs text-fg-muted mt-1">
                      Budgeted: {formatCurrency(item.budgeted)} | Actual: {formatCurrency(item.actual)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-semibold ${isOverBudget ? 'text-data-negative' : 'text-data-positive'}`}>
                      {isOverBudget ? '−' : '+'}{formatCurrency(Math.abs(item.variance))}
                    </div>
                  </div>
                </div>
                <div className="w-full bg-surface-muted rounded-full h-3">
                  <div
                    className={`h-3 rounded-full ${percentOfBudget > 100 ? 'bg-red-500' : 'bg-green-500'}`}
                    style={{ width: `${Math.min(percentOfBudget, 100)}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Transaction Log */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-fg">Transaction Log</h3>
          <button
            onClick={() => setShowAddTransaction(!showAddTransaction)}
            className="bg-signal text-white px-4 py-2 rounded font-semibold hover:bg-signal-hover transition"
          >
            + Add Transaction
          </button>
        </div>

        <div className="bg-surface rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted border-b-2 border-border-strong">
                <tr>
                  <th className="text-left py-3 px-4 font-semibold text-fg-muted">Date</th>
                  <th className="text-left py-3 px-4 font-semibold text-fg-muted">Description</th>
                  <th className="text-left py-3 px-4 font-semibold text-fg-muted">Category</th>
                  <th className="text-right py-3 px-4 font-semibold text-fg-muted">Amount</th>
                  <th className="text-right py-3 px-4 font-semibold text-fg-muted">Running Balance</th>
                </tr>
              </thead>
              <tbody>
                {data?.transactions.slice(0, 20).map((txn, idx) => (
                  <tr key={txn.id} className={`${idx % 2 === 0 ? 'bg-surface' : 'bg-surface-muted'} border-b border-border`}>
                    <td className="py-3 px-4 text-fg font-medium">{formatDate(txn.date)}</td>
                    <td className="py-3 px-4 text-fg">{txn.description}</td>
                    <td className="py-3 px-4 text-fg-muted text-xs">{txn.category}</td>
                    <td className={`text-right py-3 px-4 font-semibold ${txn.type === 'credit' ? 'text-data-positive' : 'text-data-negative'}`}>
                      {txn.type === 'credit' ? '+' : '−'}{formatCurrency(txn.amount)}
                    </td>
                    <td className="text-right py-3 px-4 font-semibold text-fg">{formatCurrency(txn.runningBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {data?.transactions.length === 0 && (
          <div className="mt-4">
            <EmptyState
              icon={<DollarSign className="w-8 h-8 text-fg-subtle" />}
              title="No financial data yet"
              description="No transactions recorded yet."
              size="compact"
            />
          </div>
        )}
      </div>
    </div>
  )
}
