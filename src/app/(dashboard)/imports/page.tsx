'use client'
import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { UploadZone } from '@/components/imports/UploadZone'
import { DetectionCard } from '@/components/imports/DetectionCard'
import { ImportHistory } from '@/components/imports/ImportHistory'
import { toast } from 'sonner'
import type { Platform, ReportType } from '@/types'

interface DetectionResult {
  platform: Platform | null
  reportType: ReportType | null
  confidence: number
  headerRow: string[]
}

interface UploadResponse {
  importId: string
  detection: DetectionResult
  preview: string[][]
  totalRows: number
}

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

interface MarketplaceAccount {
  id: string
  platform: Platform
  account_name: string
}

export default function ImportsPage() {
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [imports, setImports] = useState<ImportRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [accounts, setAccounts] = useState<MarketplaceAccount[]>([])

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const res = await fetch('/api/imports')
      if (res.ok) setImports(await res.json())
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchHistory()
    fetch('/api/marketplace-accounts').then(r => r.json()).then(setAccounts).catch(() => {})
  }, [fetchHistory])

  async function handleFile(file: File) {
    setUploading(true)
    setUploadResult(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/imports/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Upload failed')
        return
      }
      setUploadResult(data)
    } finally {
      setUploading(false)
    }
  }

  async function handleConfirm(marketplace: Platform, reportType: ReportType, accountId: string) {
    if (!uploadResult) return
    setConfirming(true)
    try {
      const res = await fetch('/api/imports/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          importId: uploadResult.importId,
          marketplace,
          reportType,
          marketplaceAccountId: accountId || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Import failed')
        return
      }
      toast.success(
        `Import complete: ${data.processed} rows processed${data.failed > 0 ? `, ${data.failed} failed` : ''}`
      )
      setUploadResult(null)
      fetchHistory()
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Import Data</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Upload Flipkart or Amazon reports — auto-detected and imported
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upload card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Upload Report</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <UploadZone onFile={handleFile} uploading={uploading} />

            {uploadResult && !uploading && (
              <>
                <Separator />
                <DetectionCard
                  importId={uploadResult.importId}
                  detection={uploadResult.detection}
                  preview={uploadResult.preview}
                  totalRows={uploadResult.totalRows}
                  marketplaceAccounts={accounts}
                  onConfirm={handleConfirm}
                  confirming={confirming}
                />
              </>
            )}
          </CardContent>
        </Card>

        {/* Info card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Supported Formats</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm">
              <div>
                <p className="font-medium text-yellow-700 dark:text-yellow-400">Flipkart</p>
                <ul className="mt-1 space-y-0.5 text-muted-foreground list-disc list-inside text-xs">
                  <li>Dispatch Report (Order ID, Tracking ID, SKU, Dispatch Date)</li>
                  <li>Listings / Settlement (Sale Price, Commission, Logistics)</li>
                  <li>Historical Orders (Order ID, FSN, Order Date, Status)</li>
                </ul>
              </div>
              <Separator />
              <div>
                <p className="font-medium text-orange-700 dark:text-orange-400">Amazon</p>
                <ul className="mt-1 space-y-0.5 text-muted-foreground list-disc list-inside text-xs">
                  <li>Dispatch Report (amazon-order-id, SKU, quantity-shipped)</li>
                  <li>Historical Orders (amazon-order-id, ASIN, purchase-date)</li>
                </ul>
              </div>
              <Separator />
              <p className="text-xs text-muted-foreground">
                Files are matched by column headers. Confidence ≥ 90% auto-detects; lower confidence shows a confirmation step.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Import history */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Import History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ImportHistory imports={imports} loading={historyLoading} />
        </CardContent>
      </Card>
    </div>
  )
}
