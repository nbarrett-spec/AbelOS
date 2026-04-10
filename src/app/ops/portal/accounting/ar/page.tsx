'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronLeft, Send, AlertCircle } from 'lucide-react';

interface ARAgingBucket {
  name: string;
  amount: number;
  count: number;
  color: string;
  bgColor: string;
}

interface ARByBuilder {
  builder: string;
  current: number;
  days1to30: number;
  days31to60: number;
  days61to90: number;
  days90plus: number;
  total: number;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  builder: string;
  amount: number;
  balanceDue: number;
  status: 'DRAFT' | 'ISSUED' | 'SENT' | 'OVERDUE' | 'PARTIALLY_PAID';
  dueDate: string;
  daysOutstanding: number;
  agingBucket: string;
}

interface Payment {
  id: string;
  builderName: string;
  invoiceNumber: string;
  amount: number;
  method: string;
  date: string;
}

interface ARData {
  agingBuckets: ARAgingBucket[];
  arByBuilder: ARByBuilder[];
  unpaidInvoices: Invoice[];
  recentPayments: Payment[];
  metrics: {
    avgDaysToPay: number;
    collectionRate: number;
    totalOutstanding: number;
    overdueAmount: number;
  };
}

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

const StatusBadge = ({ status }: { status: string }) => {
  const statusConfig = {
    DRAFT: { bg: 'bg-gray-700', text: 'text-gray-200', label: 'Draft' },
    ISSUED: { bg: 'bg-blue-900', text: 'text-blue-200', label: 'Issued' },
    SENT: { bg: 'bg-sky-900', text: 'text-sky-200', label: 'Sent' },
    OVERDUE: { bg: 'bg-red-900', text: 'text-red-200', label: 'Overdue' },
    PARTIALLY_PAID: { bg: 'bg-amber-900', text: 'text-amber-200', label: 'Partially Paid' },
  };

  const config = statusConfig[status as keyof typeof statusConfig];

  return (
    <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
      {config.label}
    </span>
  );
};

const AgingBucketCard = ({ bucket }: { bucket: ARAgingBucket }) => (
  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
    <div className="text-xs text-gray-400 mb-2">{bucket.name}</div>
    <div className={`text-2xl font-bold mb-1 ${bucket.color}`}>{formatCurrency(bucket.amount)}</div>
    <div className="text-sm text-gray-400">{bucket.count} invoices</div>
  </div>
);

const MetricCard = ({ label, value }: { label: string; value: string | number }) => (
  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
    <div className="text-xs text-gray-400 mb-2">{label}</div>
    <div className="text-2xl font-bold text-white">{value}</div>
  </div>
);

const LoadingSkeleton = () => (
  <div className="space-y-6">
    <div className="h-8 bg-gray-800 rounded-lg w-32 animate-pulse" />
    <div className="grid grid-cols-5 gap-4">
      {[...Array(5)].map((_: any, i: number) => (
        <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-24 animate-pulse" />
      ))}
    </div>
    <div className="bg-gray-900 border border-gray-800 rounded-xl h-16 animate-pulse" />
    <div className="grid grid-cols-4 gap-4">
      {[...Array(4)].map((_: any, i: number) => (
        <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-20 animate-pulse" />
      ))}
    </div>
  </div>
);

export default function ARManagementPage() {
  const [data, setData] = useState<ARData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [selectedBuilder, setSelectedBuilder] = useState<string | null>(null);
  const [searchInvoice, setSearchInvoice] = useState('');
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/api/ops/accounting-command?section=ar-detail');
        if (!response.ok) throw new Error('Failed to fetch AR data');
        const result = await response.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleSendReminder = async (invoiceId: string) => {
    setSendingReminder(invoiceId);
    try {
      const response = await fetch('/api/ops/invoice-reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId }),
      });
      if (!response.ok) throw new Error('Failed to send reminder');
    } catch (err) {
      console.error('Error sending reminder:', err);
    } finally {
      setSendingReminder(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 p-6">
        <div className="max-w-7xl mx-auto">
          <LoadingSkeleton />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-900 border border-red-800 rounded-xl p-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-red-200" />
            <div>
              <div className="font-semibold text-red-200">Error loading AR data</div>
              <div className="text-sm text-red-300">{error}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-950 p-6">
        <div className="max-w-7xl mx-auto text-white">No data available</div>
      </div>
    );
  }

  const filteredInvoices = data.unpaidInvoices.filter((invoice: Invoice) => {
    const matchesBucket = !selectedBucket || invoice.agingBucket === selectedBucket;
    const matchesBuilder = !selectedBuilder || invoice.builder === selectedBuilder;
    const matchesSearch = !searchInvoice || invoice.invoiceNumber.toLowerCase().includes(searchInvoice.toLowerCase());
    return matchesBucket && matchesBuilder && matchesSearch;
  });

  const builders = Array.from(new Set(data.unpaidInvoices.map((inv: Invoice) => inv.builder))).sort((a: string, b: string) => a.localeCompare(b));
  const totalOutstanding = data.agingBuckets.reduce((sum: number, bucket: ARAgingBucket) => sum + bucket.amount, 0);
  const totalInvoices = data.agingBuckets.reduce((sum: number, bucket: ARAgingBucket) => sum + bucket.count, 0);

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center gap-4 mb-8">
            <Link
              href="/ops/portal/accounting"
              className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
            >
              <ChevronLeft className="h-5 w-5" />
              <span>Back to Accounting</span>
            </Link>
          </div>

          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Accounts Receivable</h1>
            <p className="text-gray-400">Deep-dive analysis of customer payments and aging</p>
          </div>

          {/* AR Aging Summary Cards */}
          <div className="grid grid-cols-5 gap-4">
            {data.agingBuckets.map((bucket: ARAgingBucket, idx: number) => (
              <AgingBucketCard key={idx} bucket={bucket} />
            ))}
          </div>

          {/* Total Row */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="grid grid-cols-2 gap-8">
              <div>
                <div className="text-xs text-gray-400 mb-2">Total Outstanding</div>
                <div className="text-3xl font-bold text-white">{formatCurrency(totalOutstanding)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-2">Total Invoices</div>
                <div className="text-3xl font-bold text-white">{totalInvoices}</div>
              </div>
            </div>
          </div>

          {/* AR Aging Visual Bar */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="text-sm font-medium text-gray-300 mb-3">Aging Distribution</div>
            <div className="flex h-8 rounded-lg overflow-hidden gap-1 bg-gray-800">
              {data.agingBuckets.map((bucket: ARAgingBucket, idx: number) => {
                const percentage = (bucket.amount / totalOutstanding) * 100;
                return (
                  <div
                    key={idx}
                    className={`${bucket.bgColor}`}
                    style={{ width: `${percentage}%` }}
                    title={`${bucket.name}: ${formatCurrency(bucket.amount)}`}
                  />
                );
              })}
            </div>
            <div className="grid grid-cols-5 gap-4 mt-4">
              {data.agingBuckets.map((bucket: ARAgingBucket, idx: number) => (
                <div key={idx} className="text-center">
                  <div className="text-xs text-gray-400">{bucket.name}</div>
                  <div className={`text-sm font-semibold ${bucket.color}`}>
                    {((bucket.amount / totalOutstanding) * 100).toFixed(1)}%
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Key Metrics Row */}
          <div className="grid grid-cols-4 gap-4">
            <MetricCard label="Average Days to Pay" value={data.metrics.avgDaysToPay} />
            <MetricCard label="Collection Rate" value={`${data.metrics.collectionRate}%`} />
            <MetricCard label="Total Outstanding" value={formatCurrency(data.metrics.totalOutstanding)} />
            <MetricCard label="Overdue Amount" value={formatCurrency(data.metrics.overdueAmount)} />
          </div>

          {/* AR by Builder Table */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-gray-800">
              <h2 className="text-lg font-semibold text-white">AR by Builder</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-800 bg-opacity-50">
                    <th className="px-4 py-3 text-left text-gray-300 font-semibold">Builder</th>
                    <th className="px-4 py-3 text-right text-gray-300 font-semibold">Current</th>
                    <th className="px-4 py-3 text-right text-gray-300 font-semibold">1-30 Days</th>
                    <th className="px-4 py-3 text-right text-gray-300 font-semibold">31-60 Days</th>
                    <th className="px-4 py-3 text-right text-gray-300 font-semibold">61-90 Days</th>
                    <th className="px-4 py-3 text-right text-gray-300 font-semibold">90+ Days</th>
                    <th className="px-4 py-3 text-right text-gray-300 font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.arByBuilder.map((row: ARByBuilder, idx: number) => (
                    <tr key={idx} className="border-b border-gray-800 hover:bg-gray-800 hover:bg-opacity-50 transition-colors">
                      <td className="px-4 py-3 text-gray-200 font-medium">{row.builder}</td>
                      <td className="px-4 py-3 text-right text-emerald-400">{formatCurrency(row.current)}</td>
                      <td className="px-4 py-3 text-right text-amber-300">{formatCurrency(row.days1to30)}</td>
                      <td className="px-4 py-3 text-right text-amber-500">{formatCurrency(row.days31to60)}</td>
                      <td className="px-4 py-3 text-right text-orange-500">{formatCurrency(row.days61to90)}</td>
                      <td className="px-4 py-3 text-right text-red-500">{formatCurrency(row.days90plus)}</td>
                      <td className="px-4 py-3 text-right text-white font-semibold">{formatCurrency(row.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* All Unpaid Invoices Table */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-gray-800">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">Unpaid Invoices</h2>
                <div className="text-sm text-gray-400">{filteredInvoices.length} invoices</div>
              </div>

              {/* Filters */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-2">Search Invoice</label>
                  <input
                    type="text"
                    placeholder="Invoice number..."
                    value={searchInvoice}
                    onChange={(e) => setSearchInvoice(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:border-gray-600"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-2">Aging Bucket</label>
                  <select
                    value={selectedBucket || ''}
                    onChange={(e) => setSelectedBucket(e.target.value || null)}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-gray-600"
                  >
                    <option value="">All buckets</option>
                    {data.agingBuckets.map((bucket, idx) => (
                      <option key={idx} value={bucket.name}>
                        {bucket.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-2">Builder</label>
                  <select
                    value={selectedBuilder || ''}
                    onChange={(e) => setSelectedBuilder(e.target.value || null)}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-gray-600"
                  >
                    <option value="">All builders</option>
                    {builders.map((builder: string) => (
                      <option key={builder} value={builder}>
                        {builder}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-800 bg-opacity-50">
                    <th className="px-4 py-3 text-left text-gray-300 font-semibold">Invoice #</th>
                    <th className="px-4 py-3 text-left text-gray-300 font-semibold">Builder</th>
                    <th className="px-4 py-3 text-right text-gray-300 font-semibold">Amount</th>
                    <th className="px-4 py-3 text-right text-gray-300 font-semibold">Balance Due</th>
                    <th className="px-4 py-3 text-left text-gray-300 font-semibold">Status</th>
                    <th className="px-4 py-3 text-left text-gray-300 font-semibold">Due Date</th>
                    <th className="px-4 py-3 text-right text-gray-300 font-semibold">Days Out</th>
                    <th className="px-4 py-3 text-left text-gray-300 font-semibold">Bucket</th>
                    <th className="px-4 py-3 text-left text-gray-300 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.length > 0 ? (
                    filteredInvoices.map((invoice: Invoice) => (
                      <tr key={invoice.id} className="border-b border-gray-800 hover:bg-gray-800 hover:bg-opacity-50 transition-colors">
                        <td className="px-4 py-3 text-gray-200 font-medium">{invoice.invoiceNumber}</td>
                        <td className="px-4 py-3 text-gray-300">{invoice.builder}</td>
                        <td className="px-4 py-3 text-right text-white font-medium">{formatCurrency(invoice.amount)}</td>
                        <td className="px-4 py-3 text-right text-white font-medium">{formatCurrency(invoice.balanceDue)}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={invoice.status} />
                        </td>
                        <td className="px-4 py-3 text-gray-400">{new Date(invoice.dueDate).toLocaleDateString()}</td>
                        <td className="px-4 py-3 text-right text-gray-400">{invoice.daysOutstanding}</td>
                        <td className="px-4 py-3 text-gray-400">{invoice.agingBucket}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => handleSendReminder(invoice.id)}
                            disabled={sendingReminder === invoice.id}
                            className="inline-flex items-center gap-2 px-3 py-1 bg-blue-900 hover:bg-blue-800 disabled:opacity-50 text-blue-200 rounded-lg text-xs font-medium transition-colors"
                          >
                            <Send className="h-3 w-3" />
                            {sendingReminder === invoice.id ? 'Sending...' : 'Remind'}
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                        No invoices match the selected filters
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Payments */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-gray-800">
              <h2 className="text-lg font-semibold text-white">Recent Payments</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-800 bg-opacity-50">
                    <th className="px-4 py-3 text-left text-gray-300 font-semibold">Builder</th>
                    <th className="px-4 py-3 text-left text-gray-300 font-semibold">Invoice #</th>
                    <th className="px-4 py-3 text-right text-gray-300 font-semibold">Amount</th>
                    <th className="px-4 py-3 text-left text-gray-300 font-semibold">Method</th>
                    <th className="px-4 py-3 text-left text-gray-300 font-semibold">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentPayments.slice(0, 10).map((payment: Payment) => (
                    <tr key={payment.id} className="border-b border-gray-800 hover:bg-gray-800 hover:bg-opacity-50 transition-colors">
                      <td className="px-4 py-3 text-gray-200 font-medium">{payment.builderName}</td>
                      <td className="px-4 py-3 text-gray-300">{payment.invoiceNumber}</td>
                      <td className="px-4 py-3 text-right text-emerald-400 font-medium">{formatCurrency(payment.amount)}</td>
                      <td className="px-4 py-3 text-gray-400">{payment.method}</td>
                      <td className="px-4 py-3 text-gray-400">{new Date(payment.date).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
