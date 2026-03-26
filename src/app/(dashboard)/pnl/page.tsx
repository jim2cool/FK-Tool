'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Upload, Settings2, Info, TrendingUp, TrendingDown, DollarSign, Package, Landmark } from 'lucide-react'
import { InfoTooltip } from '@/components/ui/info-tooltip'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PnlProductTable } from '@/components/pnl/PnlProductTable'
import { PnlComparisonTable } from '@/components/pnl/PnlComparisonTable'
import PnlOverviewTab from '@/components/pnl/PnlOverviewTab'
import PnlCashFlowTab from '@/components/pnl/PnlCashFlowTab'
import { PnlInsightsTab } from '@/components/pnl/PnlInsightsTab'
import { ActionDashboard } from '@/components/pnl/ActionDashboard'
import { PnlImportDialog } from '@/components/pnl/PnlImportDialog'
import { AnomalyRulesPanel } from '@/components/pnl/AnomalyRulesPanel'
import { OverheadsDialog } from '@/components/pnl/OverheadsDialog'
import type { PnlBreakdown, PnlSummary } from '@/lib/pnl/calculate'
import type { PnlDashboardResponse } from '@/lib/pnl/waterfall'
import type { RecoveryMetrics } from '@/lib/pnl/recovery'

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
  recoveryMap?: Record<string, RecoveryMetrics>
}

function DeltaBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-xs text-muted-foreground">—</span>
  const isPositive = value > 0
  return (
    <span className={`text-xs font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
      {isPositive ? '↑' : '↓'} {Math.abs(value).toFixed(1)}%
    </span>
  )
}

function MarginDeltaBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-xs text-muted-foreground">—</span>
  const isPositive = value > 0
  return (
    <span className={`text-xs font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
      {isPositive ? '↑' : '↓'} {Math.abs(value).toFixed(1)}pp
    </span>
  )
}

function SummaryCard({
  title, value, icon: Icon, color, delta, deltaType, tooltip,
}: {
  title: string
  value: string
  icon: React.ElementType
  color?: string
  delta?: number | null
  deltaType?: 'pct' | 'margin'
  tooltip?: string
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className={`h-4 w-4 ${color ?? ''}`} />
        {title}
        {tooltip && <InfoTooltip content={tooltip} />}
      </div>
      <div className={`mt-1 text-2xl font-bold ${color ?? ''}`}>{value}</div>
      <div className="mt-0.5">
        {deltaType === 'margin' ? <MarginDeltaBadge value={delta} /> : <DeltaBadge value={delta} />}
      </div>
    </div>
  )
}

export default function PnlPage() {
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth)
  const [selectedAccount, setSelectedAccount] = useState<string>('all')
  const [accounts, setAccounts] = useState<MarketplaceAccount[]>([])
  const [activeTab, setActiveTab] = useState('overview')

  const [productData, setProductData] = useState<PnlData | null>(null)
  const [channelData, setChannelData] = useState<PnlData | null>(null)
  const [accountData, setAccountData] = useState<PnlData | null>(null)
  const [dashboardData, setDashboardData] = useState<PnlDashboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [dismissingKey, setDismissingKey] = useState<string | null>(null)

  const [viewMode, setViewMode] = useState<'current' | 'compare'>('current')
  const [comparisonData, setComparisonData] = useState<Array<{
    month: string
    rows: Array<{ group_key: string; group_name: string; revenue: number; margin_pct: number | null; return_rate: number; net_orders: number }>
  }> | null>(null)
  const [comparisonLoading, setComparisonLoading] = useState(false)

  const [showImport, setShowImport] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const [showOverheads, setShowOverheads] = useState(false)

  useEffect(() => {
    fetch('/api/marketplace-accounts')
      .then(r => r.ok ? r.json() : [])
      .then(setAccounts)
      .catch(() => {})
  }, [])

  const fetchPnl = useCallback(async (groupBy: string) => {
    const { from, to } = monthRange(selectedMonth)
    const params = new URLSearchParams({ groupBy, from, to })
    if (selectedAccount !== 'all') params.set('accountIds', selectedAccount)
    const res = await fetch(`/api/pnl/summary?${params}`)
    if (!res.ok) throw new Error('Failed to fetch P&L data')
    return res.json() as Promise<PnlData>
  }, [selectedMonth, selectedAccount])

  const fetchDashboard = useCallback(async () => {
    const { from, to } = monthRange(selectedMonth)
    const params = new URLSearchParams({ from, to })
    if (selectedAccount !== 'all') params.set('accountIds', selectedAccount)
    const res = await fetch(`/api/pnl/dashboard?${params}`)
    if (!res.ok) throw new Error('Failed to fetch dashboard')
    return res.json() as Promise<PnlDashboardResponse>
  }, [selectedMonth, selectedAccount])

  const loadAll = useCallback(() => {
    let cancelled = false
    setLoading(true)

    Promise.all([
      fetchPnl('product'),
      fetchPnl('channel'),
      fetchPnl('account'),
      fetchDashboard(),
    ])
      .then(([prod, chan, acct, dash]) => {
        if (cancelled) return
        setProductData(prod)
        setChannelData(chan)
        setAccountData(acct)
        setDashboardData(dash)
      })
      .catch(() => {
        if (!cancelled) toast.error('Failed to load P&L data')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [fetchPnl, fetchDashboard])

  useEffect(() => loadAll(), [loadAll])

  useEffect(() => {
    if (viewMode !== 'compare') return
    let cancelled = false
    setComparisonLoading(true)
    const params = new URLSearchParams({ months: '3' })
    if (selectedAccount !== 'all') params.set('accountIds', selectedAccount)
    fetch(`/api/pnl/comparison?${params}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!cancelled && data) setComparisonData(data.months)
      })
      .catch(() => {
        if (!cancelled) toast.error('Failed to load comparison data')
      })
      .finally(() => {
        if (!cancelled) setComparisonLoading(false)
      })
    return () => { cancelled = true }
  }, [viewMode, selectedAccount])

  const summary = productData?.summary
  const hasData = productData && productData.rows.length > 0
  const hasMissingCogs = productData?.rows.some(r => r.cogs_per_unit === null)
  const hasUnmapped = productData?.rows.some(r => r.group_key === 'unmapped')
  const mom = dashboardData?.mom_deltas

  async function handleDismiss(insightKey: string) {
    setDismissingKey(insightKey)
    try {
      const res = await fetch('/api/pnl/insights/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ insight_key: insightKey }),
      })
      if (res.ok && dashboardData) {
        setDashboardData({
          ...dashboardData,
          insights: dashboardData.insights.filter(i => i.id !== insightKey),
        })
      }
    } catch {
      toast.error('Failed to dismiss insight')
    } finally {
      setDismissingKey(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Profit & Loss</h1>
          <p className="text-sm text-muted-foreground">
            Contribution margin per SKU — platform fees, logistics, and COGS breakdown.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowOverheads(true)}>
            <Landmark className="h-4 w-4 mr-2" /> Overheads
          </Button>
          <Button variant="outline" onClick={() => setShowRules(true)}>
            <Settings2 className="h-4 w-4 mr-2" /> Anomaly Rules
          </Button>
          <Button onClick={() => setShowImport(true)}>
            <Upload className="h-4 w-4 mr-2" /> Import Data
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

      {loading && <div className="py-12 text-center text-muted-foreground">Loading P&L data...</div>}

      {!loading && !hasData && (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <Package className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
          <h3 className="text-lg font-medium mb-1">No P&L data yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Import your first Flipkart P&L report to see true profit per SKU.
          </p>
          <Button onClick={() => setShowImport(true)}>
            <Upload className="h-4 w-4 mr-2" /> Import Data
          </Button>
        </div>
      )}

      {/* Data-missing banners */}
      {!loading && hasData && hasMissingCogs && (
        <div className="flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Some products are missing COGS data. Set up purchases on the <a href="/cogs" className="underline font-medium">COGS page</a>.
          </span>
        </div>
      )}
      {!loading && hasData && hasUnmapped && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Some orders have unmapped SKUs. Map them in <a href="/catalog" className="underline font-medium">Master Catalog</a>.
          </span>
        </div>
      )}

      {/* Summary cards — ABOVE tabs, always visible */}
      {!loading && hasData && summary && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <SummaryCard title="Revenue" value={fmt(summary.total_revenue)} icon={DollarSign} delta={mom?.revenue_pct} tooltip="Total sales value (net of cancellations) for the selected period" />
          <SummaryCard title="COGS" value={fmt(summary.total_cogs)} icon={Package} delta={mom?.cogs_pct} tooltip="Cost of Goods Sold — what you paid to buy/produce these products (purchase price + freight + packaging + shrinkage)" />
          <SummaryCard title="Platform Fees" value={fmt(Math.abs(summary.total_platform_fees))} icon={DollarSign} delta={mom?.platform_fees_pct} tooltip="Commission, collection fees, and fixed fees charged by the marketplace" />
          <SummaryCard title="Logistics" value={fmt(Math.abs(summary.total_logistics))} icon={DollarSign} delta={mom?.logistics_pct} tooltip="Shipping costs — pick & pack, forward delivery, and reverse shipping for returns" />
          <SummaryCard
            title="Contribution Margin"
            value={fmt(summary.total_true_profit)}
            icon={summary.total_true_profit >= 0 ? TrendingUp : TrendingDown}
            color={summary.total_true_profit >= 0 ? 'text-green-600' : 'text-red-600'}
            delta={mom?.true_profit_pct}
            tooltip="Your profit after deducting all variable costs (COGS + fees + logistics) from revenue. This is what you keep before fixed costs like rent and salaries"
          />
          <SummaryCard
            title="Overall Margin"
            value={`${summary.overall_margin_pct.toFixed(1)}%`}
            icon={TrendingUp}
            color={summary.overall_margin_pct > 20 ? 'text-green-600' : summary.overall_margin_pct >= 0 ? 'text-yellow-600' : 'text-red-600'}
            delta={mom?.margin_delta}
            deltaType="margin"
            tooltip="Contribution Margin as a percentage of Revenue. Higher is better. Above 20% is healthy, below 0% means you're losing money"
          />
          {dashboardData && dashboardData.overheads_total > 0 && (
            <SummaryCard
              title="Operating Profit"
              value={fmt(dashboardData.operating_profit)}
              icon={dashboardData.operating_profit >= 0 ? TrendingUp : TrendingDown}
              color={dashboardData.operating_profit >= 0 ? 'text-green-600' : 'text-red-600'}
              delta={mom?.operating_profit_pct}
              tooltip="Contribution Margin minus your monthly fixed costs (rent, salaries, software). This is your actual profit or loss for the month"
            />
          )}
        </div>
      )}

      {/* Action Dashboard */}
      {!loading && hasData && dashboardData && dashboardData.insights.length > 0 && (
        <ActionDashboard
          insights={dashboardData.insights}
          onDismiss={handleDismiss}
          onSwitchTab={setActiveTab}
        />
      )}

      {/* 4 Tabs */}
      {!loading && hasData && (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="products">Products</TabsTrigger>
            <TabsTrigger value="cashflow">Cash Flow</TabsTrigger>
            <TabsTrigger value="insights">
              Insights
              {dashboardData && dashboardData.insights.length > 0 && (
                <span className="ml-1.5 rounded-full bg-red-100 text-red-700 text-xs px-1.5 py-0.5 font-medium">
                  {dashboardData.insights.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            {dashboardData ? (
              <PnlOverviewTab
                waterfall={dashboardData.waterfall}
                topProfitable={dashboardData.top_profitable}
                topLosing={dashboardData.top_losing}
                highReturn={dashboardData.high_return}
                onSwitchTab={setActiveTab}
                overheadsTotal={dashboardData.overheads_total}
                operatingProfit={dashboardData.operating_profit}
                breakEvenPct={dashboardData.break_even_pct}
              />
            ) : (
              <div className="py-8 text-center text-muted-foreground">Loading overview...</div>
            )}
          </TabsContent>

          <TabsContent value="products">
            <div className="flex items-center gap-1 mb-4">
              <button
                onClick={() => setViewMode('current')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md border transition-colors ${
                  viewMode === 'current'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-input hover:bg-muted'
                }`}
              >
                Current Month
              </button>
              <button
                onClick={() => setViewMode('compare')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md border transition-colors ${
                  viewMode === 'compare'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-input hover:bg-muted'
                }`}
              >
                Compare (3mo)
              </button>
            </div>

            {viewMode === 'current' && (
              <PnlProductTable
                productRows={productData?.rows ?? []}
                channelRows={channelData?.rows ?? []}
                accountRows={accountData?.rows ?? []}
                recoveryMap={productData?.recoveryMap
                  ? new Map(Object.entries(productData.recoveryMap) as [string, RecoveryMetrics][])
                  : undefined
                }
              />
            )}

            {viewMode === 'compare' && comparisonLoading && (
              <div className="py-12 text-center text-muted-foreground">Loading comparison data...</div>
            )}

            {viewMode === 'compare' && !comparisonLoading && comparisonData && (
              <PnlComparisonTable months={comparisonData} />
            )}
          </TabsContent>

          <TabsContent value="cashflow">
            {dashboardData ? (
              <PnlCashFlowTab cashflow={dashboardData.cashflow} />
            ) : (
              <div className="py-8 text-center text-muted-foreground">Loading cash flow...</div>
            )}
          </TabsContent>

          <TabsContent value="insights">
            {dashboardData ? (
              <PnlInsightsTab
                insights={dashboardData.insights}
                onDismiss={handleDismiss}
                dismissingKey={dismissingKey}
              />
            ) : (
              <div className="py-8 text-center text-muted-foreground">Loading insights...</div>
            )}
          </TabsContent>
        </Tabs>
      )}

      <PnlImportDialog
        open={showImport}
        onOpenChange={setShowImport}
        onImportComplete={() => {
          setShowImport(false)
          loadAll()
        }}
      />
      <AnomalyRulesPanel open={showRules} onOpenChange={setShowRules} />
      <OverheadsDialog
        open={showOverheads}
        onOpenChange={setShowOverheads}
        month={selectedMonth}
        onSaved={loadAll}
      />
    </div>
  )
}
