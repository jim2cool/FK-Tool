import type { ParsedPnlRow } from '@/lib/importers/pnl-xlsx-parser'
import type { ParsedOrderRow } from '@/lib/importers/orders-report-parser'
import type { ParsedReturnRow } from '@/lib/importers/returns-report-parser'
import type { ParsedSettlementRow } from '@/lib/importers/settlement-report-parser'

export type ReportType = 'orders' | 'returns' | 'pnl' | 'settlement'

export type AnyParsedRow = ParsedPnlRow | ParsedOrderRow | ParsedReturnRow | ParsedSettlementRow

export type FileStatus =
  | { kind: 'parsing' }
  | { kind: 'ready'; rowCount: number; dateRange: { from: string; to: string }; sampleSkus: string[] }
  | { kind: 'parse-error'; reason: string }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'too-large'; reason: string }
  | { kind: 'empty'; reason: string }
  | { kind: 'uploading' }
  | { kind: 'imported'; imported: number; skipped: number; mismatchedAccount: number; failed: number }
  | { kind: 'failed'; reason: string }

export interface FileEntry {
  fileKey: string                          // stable client-side ID (uuid v4)
  fileName: string
  fileSize: number
  fileLastModified: number                 // for dup-drop detection
  rows: AnyParsedRow[] | null              // null until parsed
  status: FileStatus
  marketplaceAccountId: string | null      // inherited from session-level selectedAccountId
  includeInImport: boolean                 // checkbox state
}

export type Step = 'reportType' | 'dropFiles' | 'fileTable' | 'confirm' | 'progress' | 'results'

export interface BulkImportState {
  step: Step
  reportType: ReportType | null
  selectedAccountId: string | null          // session-wide account selection (P&L + Orders only)
  files: FileEntry[]                        // valid + main-table files
  skippedFiles: FileEntry[]                 // wrong-type, parse-error, empty, too-large
  showSkippedPanel: boolean                 // collapsible panel state
  overlapsByFileKey: Record<string, { existingRowCount: number; sampleExistingDate?: string }> | null
  isCheckingOverlap: boolean
  overlapCheckError: string | null
  verifiedAccountAssignment: boolean        // confirm-modal checkbox
  importInFlight: boolean
  importStartedAt: number | null            // ms epoch, for ETA
  currentImportingFileKey: string | null
  finalSummary: { imported: number; skippedDup: number; failed: number; mismatched: number; perAccount: Record<string, { files: number; rows: number }> } | null
}

export interface MarketplaceAccountLite {
  id: string
  account_name: string
  platform: string
}
