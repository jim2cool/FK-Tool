'use client'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Download, FileText } from 'lucide-react'
import type { LabelGroup, LabelSortResult } from '@/lib/labels/types'

interface LabelPreviewTableProps {
  result: LabelSortResult
  hasInvoice?: boolean
  onDownloadGroup: (group: LabelGroup) => void
  onDownloadInvoiceGroup?: (group: LabelGroup) => void
  onDownloadAll: () => void
  onDownloadAllInvoices?: () => void
}

export function LabelPreviewTable({ result, hasInvoice, onDownloadGroup, onDownloadInvoiceGroup, onDownloadAll, onDownloadAllInvoices }: LabelPreviewTableProps) {
  return (
    <div className="space-y-4">
      <div className="flex gap-4 text-sm">
        <span className="font-medium">{result.totalLabels} labels</span>
        <span className="text-muted-foreground">{result.stats.codCount} COD / {result.stats.prepaidCount} Prepaid</span>
        <span className="text-muted-foreground">{result.groups.length} products</span>
        {result.unmapped.length > 0 && <Badge variant="destructive">{result.unmapped.length} unmapped SKUs</Badge>}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead className="text-center">Labels</TableHead>
            <TableHead className="text-center">COD</TableHead>
            <TableHead className="text-center">Prepaid</TableHead>
            <TableHead>Orgs</TableHead>
            <TableHead className="text-right">Download</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.groups.map(group => (
            <TableRow key={group.masterSkuId}>
              <TableCell className="font-medium">{group.masterSkuName}</TableCell>
              <TableCell className="text-center">{group.count}</TableCell>
              <TableCell className="text-center">{group.codCount > 0 && <Badge variant="outline">{group.codCount}</Badge>}</TableCell>
              <TableCell className="text-center">{group.prepaidCount > 0 && <Badge variant="secondary">{group.prepaidCount}</Badge>}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{group.orgBreakdown.map(o => `${o.orgName} (${o.count})`).join(', ')}</TableCell>
              <TableCell className="text-right space-x-1">
                <Button variant="ghost" size="sm" onClick={() => onDownloadGroup(group)}>
                  <Download className="h-4 w-4 mr-1" />Labels
                </Button>
                {hasInvoice && onDownloadInvoiceGroup && (
                  <Button variant="ghost" size="sm" onClick={() => onDownloadInvoiceGroup(group)}>
                    <FileText className="h-4 w-4 mr-1" />Invoices
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex justify-end gap-2">
        {result.groups.length > 1 && (
          <Button onClick={onDownloadAll}><Download className="h-4 w-4 mr-2" />All Labels ({result.groups.length} PDFs)</Button>
        )}
        {hasInvoice && onDownloadAllInvoices && result.groups.length > 1 && (
          <Button variant="outline" onClick={onDownloadAllInvoices}><FileText className="h-4 w-4 mr-2" />All Invoices ({result.groups.length} PDFs)</Button>
        )}
      </div>
    </div>
  )
}
