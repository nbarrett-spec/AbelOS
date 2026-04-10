'use client'

import { useEffect, useState } from 'react'

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
        <div className="text-gray-500">Loading bank data...</div>
      </div>
    )
  }

  const totalCash = data?.accounts.filter(a => a.accountType !== 'credit_line').reduce((sum, a) => sum + a.currentBalance, 0) || 0
  const totalCreditAvailable = data?.accounts.filter(a => a.accountType === 'credit_line').reduce((sum, a) => sum + (a.creditLimit || 0) - a.currentBalance, 0) || 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Bank & Credit Lines</h1>
        <p className="text-gray-500 mt-1">Manual tracking of accounts, balances, and transactions</p>
      </div>

      {/* Cash Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-[#27AE60]">
          <div className="text-gray-500 text-sm font-medium">Total Cash on Hand</div>
          <div className="text-2xl font-bold text-[#27AE60] mt-2">
            {formatCurrency(totalCash)}
          </div>
          <p className="text-xs text-gray-400 mt-2">Checking + Savings + Money Market</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-[#1B4F72]">
          <div className="text-gray-500 text-sm font-medium">Available Credit</div>
          <div className="text-2xl font-bold text-[#1B4F72] mt-2">
            {formatCurrency(totalCreditAvailable)}
          </div>
          <p className="text-xs text-gray-400 mt-2">Unused credit lines</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-[#E67E22]">
          <div className="text-gray-500 text-sm font-medium">Total Liquidity</div>
          <div className="text-2xl font-bold text-[#E67E22] mt-2">
            {formatCurrency(totalCash + totalCreditAvailable)}
          </div>
          <p className="text-xs text-gray-400 mt-2">Cash + available credit</p>
        </div>
      </div>

      {/* Account Cards */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Bank Accounts & Credit Lines</h3>
          <button
            onClick={() => setShowAddAccount(!showAddAccount)}
            className="bg-[#E67E22] text-white px-4 py-2 rounded font-semibold hover:bg-[#D66D11] transition"
          >
            + Add Account
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data?.accounts.map((account) => {
            const isCredit = account.accountType === 'credit_line'
            const utilized = isCredit ? ((account.currentBalance / (account.creditLimit || 1)) * 100) : null

            return (
              <div key={account.id} className="bg-white rounded-lg shadow p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h4 className="text-lg font-semibold text-gray-900">{account.name}</h4>
                    <p className="text-sm text-gray-500">{account.institution}</p>
                  </div>
                  <span className="text-xs font-semibold px-2 py-1 rounded bg-gray-100 text-gray-700">
                    {account.accountType.replace('_', ' ').toUpperCase()}
                  </span>
                </div>

                {isCredit ? (
                  <>
                    <div className="mb-4">
                      <div className="text-gray-600 text-sm mb-1">Credit Limit</div>
                      <div className="text-xl font-bold text-gray-900">{formatCurrency(account.creditLimit || 0)}</div>
                    </div>
                    <div className="mb-4">
                      <div className="text-gray-600 text-sm mb-1">Balance (Used)</div>
                      <div className="text-xl font-bold text-red-600">{formatCurrency(account.currentBalance)}</div>
                    </div>
                    <div className="mb-4">
                      <div className="text-gray-600 text-sm mb-1">Available</div>
                      <div className="text-xl font-bold text-green-600">
                        {formatCurrency((account.creditLimit || 0) - account.currentBalance)}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600 mb-2">Utilization</div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${utilized && utilized > 80 ? 'bg-red-500' : utilized && utilized > 60 ? 'bg-orange-500' : 'bg-green-500'}`}
                          style={{ width: `${Math.min(utilized || 0, 100)}%` }}
                        />
                      </div>
                      <div className="text-xs text-gray-500 mt-1">{utilized?.toFixed(0)}% used</div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mb-4">
                      <div className="text-gray-600 text-sm mb-1">Current Balance</div>
                      <div className="text-2xl font-bold text-gray-900">{formatCurrency(account.currentBalance)}</div>
                    </div>
                  </>
                )}

                <div className="text-xs text-gray-400 mt-4 pt-4 border-t">
                  Last updated: {formatDate(account.lastUpdated)}
                </div>
                <button className="mt-4 w-full text-sm text-[#E67E22] hover:text-[#E67E22] font-semibold">
                  Edit Account
                </button>
              </div>
            )
          })}
        </div>

        {data?.accounts.length === 0 && (
          <div className="bg-gray-50 rounded-lg p-8 text-center text-gray-500">
            <p>No bank accounts added yet.</p>
            <button
              onClick={() => setShowAddAccount(true)}
              className="mt-4 text-[#E67E22] hover:text-[#E67E22] font-semibold"
            >
              Add your first account →
            </button>
          </div>
        )}
      </div>

      {/* Budget Allocation */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Budget vs Actual</h3>
        <div className="space-y-4">
          {data?.budgetAllocation.map((item) => {
            const percentOfBudget = (item.actual / Math.max(item.budgeted, 1)) * 100
            const isOverBudget = item.variance < 0

            return (
              <div key={item.category}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-sm font-medium text-gray-900">{item.category}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      Budgeted: {formatCurrency(item.budgeted)} | Actual: {formatCurrency(item.actual)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-bold ${isOverBudget ? 'text-red-600' : 'text-green-600'}`}>
                      {isOverBudget ? '−' : '+'}{formatCurrency(Math.abs(item.variance))}
                    </div>
                  </div>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
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
          <h3 className="text-lg font-semibold text-gray-900">Transaction Log</h3>
          <button
            onClick={() => setShowAddTransaction(!showAddTransaction)}
            className="bg-[#E67E22] text-white px-4 py-2 rounded font-semibold hover:bg-[#D66D11] transition"
          >
            + Add Transaction
          </button>
        </div>

        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b-2 border-gray-200">
                <tr>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Date</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Description</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Category</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700">Amount</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700">Running Balance</th>
                </tr>
              </thead>
              <tbody>
                {data?.transactions.slice(0, 20).map((txn, idx) => (
                  <tr key={txn.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td className="py-3 px-4 text-gray-900 font-medium">{formatDate(txn.date)}</td>
                    <td className="py-3 px-4 text-gray-900">{txn.description}</td>
                    <td className="py-3 px-4 text-gray-600 text-xs">{txn.category}</td>
                    <td className={`text-right py-3 px-4 font-bold ${txn.type === 'credit' ? 'text-green-600' : 'text-red-600'}`}>
                      {txn.type === 'credit' ? '+' : '−'}{formatCurrency(txn.amount)}
                    </td>
                    <td className="text-right py-3 px-4 font-bold text-gray-900">{formatCurrency(txn.runningBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {data?.transactions.length === 0 && (
          <div className="bg-gray-50 rounded-lg p-8 text-center text-gray-500 mt-4">
            <p>No transactions recorded yet.</p>
          </div>
        )}
      </div>
    </div>
  )
}
