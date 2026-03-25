'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Upload, Settings2, Info, TrendingUp, TrendingDown, DollarSign, Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PnlProductTable } from '@/components/pnl/PnlProductTable'
import { PnlChannelTable } from '@/components/pnl/PnlChannelTable'
import { PnlAccountTable } from '@/components/pnl/PnlAccountTable'
import { PnlImportDialog } from '@/components/pnl/PnlImportDialog'
import { AnomalyRulesPanel } from '@/components/pnl/AnomalyRulesPanel'
import type { PnlBreakdown, PnlSummary } from '@/lib/pnl/calculate'

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function getCurrentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function monthRange(month: string): { from: string; to: string } {
  const [year, m] = month.split('-').map(Number)
  const from = `${year}-${String(m).padStart(2, '0')}-01`
  const lastDay = new Date(year, m, 0).getDate()
  const to = `${year}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { from, to }
}

interface MarketplaceAccount {
  id: string
  account_name: string
}

interface PnlData {
  summary: PnlSummary
  rows: PnlBreakdown[]
}

function SummaryCard({
  title,
  value,
  icon: Icon,
  sub,
  color,
}: {
  title: string
  value: string
  icon: React.ElementType
  sub?: string
  color?: string
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className={`h-4 w-4 ${color ?? ''}`} />
        {title}
      </div>
      <div className={`mt-1 text-2xl font-bold ${color ?? ''}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

export default function PnlPage() {
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth)
  const [selectedAccount, setSelectedAccount] = useState<string>('all')
  const [accounts, setAccounts] = useState<MarketplaceAccount[]>([])
  const [activeTab, setActiveTab] = useState('product')

  const [productData, setProductData] = useState<PnlData | null>(null)
  const [channelData, setChannelData] = useState<PnlData | null>(null)
  const [accountData, setAccountData] = useState<PnlData | null>(null)
  const [loading, setLoading] = useState(true)

  const [showImport, setShowImport] = useState(false)
  const [showRules, setShowRules] = useState(false)

  // Fetch marketplace accounts on mount
  useEffect(() => {
    fetch('/api/marketplace-accounts')
      .then(r => r.ok ? r.json() : [])
      .then(setAccounts)
      .catch(() => {})
  }, [])

  const fetchPnl = useCallback(async (groupBy: string) => {
    const { from, to } = monthRange(selectedMonth)
    const params = new URLSearchParams({ groupBy, from, to })
    if (selectedAccount !== 'all') {
      params.set('accountIds', selectedAccount)
    }
    const res = await fetch(`/api/pnl/summary?${params}`)
    if (!res.ok) throw new Error('Failed to fetch P&L data')
    return res.json() as Promise<PnlData>
  }, [selectedMonth, selectedAccount])

  // Fetch all 3 groupings when filters change
  useEffect(() => {
    let cancelled = false
    setLoading(true)

    Promise.all([
      fetchPnl('product'),
      fetchPnl('channel'),
      fetchPnl('account'),
    ])
      .then(([prod, chan, acct]) => {
        if (cancelled) return
        setProductData(prod)
        setChannelData(chan)
        setAccountData(acct)
      })
      .catch(() => {
        if (!cancelled) toast.error('Failed to load P&L data')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [fetchPnl])

  const summary = productData?.summary
  const hasData = productData && productData.rows.length > 0

  const hasMissingCogs = productData?.rows.some(r => r.cogs_per_unit === null)
  const hasUnmapped = productData?.rows.some(r => r.group_key === 'unmapped')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Profit & Loss</h1>
          <p className="text-sm text-muted-foreground">
            True profit per SKU combining platform fees with your COGS data. Import P&L reports from Flipkart Seller Hub.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowRules(true)}>
            <Settings2 className="h-4 w-4 mr-2" /> Anomaly Rules
          </Button>
          <Button onClick={() => setShowImport(true)}>
            <Upload className="h-4 w-4 mr-2" /> Import P&L Report
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4 items-center">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Month</label>
          <input
            type="month"
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Account</label>
          <select
            value={selectedAccount}
            onChange={e => setSelectedAccount(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring min-w-[180px]"
          >
            <option value="all">All Accounts</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.account_name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="py-12 text-center text-muted-foreground">Loading P&L data...</div>
      )}

      {/* Empty state */}
      {!loading && !hasData && (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <Package className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
          <h3 className="text-lg font-medium mb-1">No P&L data yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Import your first Flipkart P&L report to see true profit per SKU.
          </p>
          <p className="text-xs text-muted-foreground mb-4">
            Go to Flipkart Seller Hub &rarr; Payments &rarr; P&L Report &rarr; Download CSV for the month.
          </p>
          <Button onClick={() => setShowImport(true)}>
            <Upload className="h-4 w-4 mr-2" /> Import P&L Report
          </Button>
        </div>
      )}

      {/* Data-missing banners */}
      {!loading && hasData && hasMissingCogs && (
        <div className="flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 dark:border-yellow-900 dark:bg-yellow-950/30 dark:text-yellow-200">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Some products are missing COGS data. True Profit for those products only includes platform earnings.
            Set up purchases and packaging on the <a href="/cogs" className="underline font-medium">COGS page</a>.
          </span>
        </div>
      )}
      {!loading && hasData && hasUnmapped && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Some orders have unmapped platform SKUs. Map them in the{' '}
            <a href="/catalog" className="underline font-medium">Master Catalog</a> to see per-product breakdown.
          </span>
        </div>
      )}

      {/* Summary cards */}
      {!loading && hasData && summary && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <SummaryCard
            title="Revenue"
            value={fmt(summary.total_revenue)}
            icon={DollarSign}
          />
          <SummaryCard
            title="COGS"
            value={fmt(summary.total_cogs)}
            icon={Package}
          />
          <SummaryCard
            title="Platform Fees"
            value={fmt(Math.abs(summary.total_platform_fees))}
            icon={DollarSign}
          />
          <SummaryCard
            title="Logistics"
            value={fmt(Math.abs(summary.total_logistics))}
            icon={DollarSign}
          />
          <SummaryCard
            title="True Profit"
            value={fmt(summary.total_true_profit)}
            icon={summary.total_true_profit >= 0 ? TrendingUp : TrendingDown}
            color={summary.total_true_profit >= 0 ? 'text-green-600' : 'text-red-600'}
          />
          <SummaryCard
            title="Overall Margin"
            value={`${summary.overall_margin_pct.toFixed(1)}%`}
            icon={TrendingUp}
            color={
              summary.overall_margin_pct > 20
                ? 'text-green-600'
                : summary.overall_margin_pct >= 0
                  ? 'text-yellow-600'
                  : 'text-red-600'
            }
          />
        </div>
      )}

      {/* Tabs */}
      {!loading && hasData && (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="product">By Product</TabsTrigger>
            <TabsTrigger value="channel">By Channel</TabsTrigger>
            <TabsTrigger value="account">By Account</TabsTrigger>
          </TabsList>
          <TabsContent value="product">
            <PnlProductTable rows={productData?.rows ?? []} />
          </TabsContent>
          <TabsContent value="channel">
            <PnlChannelTable rows={channelData?.rows ?? []} />
          </TabsContent>
          <TabsContent value="account">
            <PnlAccountTable rows={accountData?.rows ?? []} />
          </TabsContent>
        </Tabs>
      )}

      <PnlImportDialog
        open={showImport}
        onOpenChange={setShowImport}
        onImportComplete={() => {
          setShowImport(false)
          // Refetch data
          Promise.all([fetchPnl('product'), fetchPnl('channel'), fetchPnl('account')])
            .then(([prod, chan, acct]) => {
              setProductData(prod)
              setChannelData(chan)
              setAccountData(acct)
            })
        }}
      />
      <AnomalyRulesPanel open={showRules} onOpenChange={setShowRules} />
    </div>
  )
}
