'use client'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface ImportRecord {
  id: string
  file_name: string
  confirmed_marketplace: string | null
  detected_marketplace: string | null
  confirmed_report_type: string | null
  detected_report_type: string | null
  status: 'pending' | 'processing' | 'complete' | 'failed'
  rows_processed: number
  rows_failed: number
  created_at: string
}

interface Props {
  imports: ImportRecord[]
  loading: boolean
}

const statusConfig = {
  pending: { icon: Clock, color: 'text-muted-foreground', badge: 'secondary' as const, label: 'Pending' },
  processing: { icon: Loader2, color: 'text-blue-500 animate-spin', badge: 'secondary' as const, label: 'Processing' },
  complete: { icon: CheckCircle, color: 'text-green-600', badge: 'default' as const, label: 'Complete' },
  failed: { icon: XCircle, color: 'text-destructive', badge: 'destructive' as const, label: 'Failed' },
}

const reportTypeLabels: Record<string, string> = {
  dispatch_report: 'Dispatch',
  listings_settlement: 'Settlement',
  historical_orders: 'Hist. Orders',
  sku_mapping: 'SKU Mapping',
  procurement: 'Procurement',
}

const platformLabels: Record<string, string> = {
  flipkart: 'Flipkart',
  amazon: 'Amazon',
  d2c: 'D2C',
}

export function ImportHistory({ imports, loading }: Props) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    )
  }

  if (imports.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-6">No imports yet.</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>File</TableHead>
          <TableHead>Marketplace</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Rows</TableHead>
          <TableHead>When</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {imports.map(imp => {
          const { icon: Icon, color, badge, label } = statusConfig[imp.status] ?? statusConfig.pending
          const marketplace = imp.confirmed_marketplace ?? imp.detected_marketplace
          const reportType = imp.confirmed_report_type ?? imp.detected_report_type
          return (
            <TableRow key={imp.id}>
              <TableCell className="font-mono text-xs max-w-[180px] truncate">{imp.file_name}</TableCell>
              <TableCell className="text-sm">{marketplace ? platformLabels[marketplace] ?? marketplace : '—'}</TableCell>
              <TableCell className="text-sm">{reportType ? reportTypeLabels[reportType] ?? reportType : '—'}</TableCell>
              <TableCell>
                <div className="flex items-center gap-1.5">
                  <Icon className={`h-3.5 w-3.5 ${color}`} />
                  <Badge variant={badge} className="text-xs">{label}</Badge>
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums text-sm">
                {imp.status === 'complete' || imp.status === 'failed' ? (
                  <span>
                    <span className="text-green-600">{imp.rows_processed}</span>
                    {imp.rows_failed > 0 && <span className="text-destructive"> / {imp.rows_failed} err</span>}
                  </span>
                ) : '—'}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(imp.created_at), { addSuffix: true })}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
