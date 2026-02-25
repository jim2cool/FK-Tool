'use client'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CheckCircle, AlertTriangle, XCircle } from 'lucide-react'
import type { Platform, ReportType } from '@/types'

interface DetectionResult {
  platform: Platform | null
  reportType: ReportType | null
  confidence: number
  headerRow: string[]
}

interface Props {
  importId: string
  detection: DetectionResult
  preview: string[][]
  totalRows: number
  marketplaceAccounts: { id: string; platform: Platform; account_name: string }[]
  onConfirm: (marketplace: Platform, reportType: ReportType, accountId: string) => void
  confirming: boolean
}

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: 'flipkart', label: 'Flipkart' },
  { value: 'amazon', label: 'Amazon' },
  { value: 'd2c', label: 'D2C' },
]

const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: 'dispatch_report', label: 'Dispatch Report' },
  { value: 'listings_settlement', label: 'Listings / Settlement' },
  { value: 'historical_orders', label: 'Historical Orders' },
  { value: 'sku_mapping', label: 'SKU Mapping' },
  { value: 'procurement', label: 'Procurement' },
]

export function DetectionCard({ importId, detection, preview, totalRows, marketplaceAccounts, onConfirm, confirming }: Props) {
  const [marketplace, setMarketplace] = useState<Platform>(detection.platform ?? 'flipkart')
  const [reportType, setReportType] = useState<ReportType>(detection.reportType ?? 'dispatch_report')
  const [accountId, setAccountId] = useState('')

  const accountsForPlatform = marketplaceAccounts.filter(a => a.platform === marketplace)

  const confidence = detection.confidence
  const confidenceColor = confidence >= 90 ? 'text-green-600' : confidence >= 50 ? 'text-yellow-600' : 'text-destructive'
  const ConfidenceIcon = confidence >= 90 ? CheckCircle : confidence >= 50 ? AlertTriangle : XCircle
  const confidenceBadge = confidence >= 90 ? 'default' : confidence >= 50 ? 'secondary' : 'destructive'

  return (
    <div className="space-y-4">
      {/* Detection result */}
      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40">
        <ConfidenceIcon className={`h-5 w-5 flex-shrink-0 ${confidenceColor}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">
            {confidence >= 90 ? 'Auto-detected' : confidence >= 50 ? 'Please confirm detection' : 'Could not detect — select manually'}
          </p>
          <p className="text-xs text-muted-foreground">{totalRows} rows · {detection.headerRow.length} columns</p>
        </div>
        <Badge variant={confidenceBadge as 'default' | 'secondary' | 'destructive'}>{confidence}% confidence</Badge>
      </div>

      {/* Editable marketplace / report type */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Marketplace</Label>
          <Select value={marketplace} onValueChange={v => { setMarketplace(v as Platform); setAccountId('') }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PLATFORMS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Report Type</Label>
          <Select value={reportType} onValueChange={v => setReportType(v as ReportType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {REPORT_TYPES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {accountsForPlatform.length > 0 && (
        <div className="space-y-1">
          <Label className="text-xs">Marketplace Account <span className="text-muted-foreground">(optional)</span></Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger><SelectValue placeholder="Any account" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">Any account</SelectItem>
              {accountsForPlatform.map(a => <SelectItem key={a.id} value={a.id}>{a.account_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Preview table */}
      {preview.length > 1 && (
        <div className="rounded-md border overflow-auto max-h-52">
          <Table>
            <TableHeader>
              <TableRow>
                {preview[0].map((h, i) => <TableHead key={i} className="text-xs whitespace-nowrap">{h}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.slice(1, 6).map((row, ri) => (
                <TableRow key={ri}>
                  {row.map((cell, ci) => (
                    <TableCell key={ci} className="text-xs whitespace-nowrap max-w-[120px] truncate">{cell}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Button
        className="w-full"
        onClick={() => onConfirm(marketplace, reportType, accountId)}
        disabled={confirming}
      >
        {confirming ? 'Importing…' : 'Confirm & Import'}
      </Button>
    </div>
  )
}

// Need useState in this component
import { useState } from 'react'
