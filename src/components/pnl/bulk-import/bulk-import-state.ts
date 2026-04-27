import type { BulkImportState, FileEntry, ReportType, Step } from './types'

export const MAX_FILES_PER_SESSION = 50
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024  // 50 MB

export type Action =
  | { type: 'reset' }
  | { type: 'setStep'; step: Step }
  | { type: 'setReportType'; reportType: ReportType }
  | { type: 'setSelectedAccount'; accountId: string }
  | { type: 'addFile'; file: FileEntry }
  | { type: 'addSkipped'; file: FileEntry }
  | { type: 'fileParsed'; fileKey: string; rowCount: number; dateRange: { from: string; to: string }; sampleSkus: string[]; rows: FileEntry['rows'] }
  | { type: 'fileParseError'; fileKey: string; reason: string }
  | { type: 'fileEmpty'; fileKey: string }
  | { type: 'reincludeSkipped'; fileKey: string }
  | { type: 'removeFile'; fileKey: string }
  | { type: 'setIncludeInImport'; fileKey: string; include: boolean }
  | { type: 'setShowSkippedPanel'; show: boolean }
  | { type: 'startOverlapCheck' }
  | { type: 'overlapCheckSuccess'; overlaps: BulkImportState['overlapsByFileKey'] }
  | { type: 'overlapCheckError'; reason: string }
  | { type: 'setVerifiedAccountAssignment'; verified: boolean }
  | { type: 'startImport' }
  | { type: 'startImportingFile'; fileKey: string }
  | { type: 'fileImportSuccess'; fileKey: string; imported: number; skipped: number; mismatchedAccount: number; failed: number }
  | { type: 'fileImportFailed'; fileKey: string; reason: string }
  | { type: 'finishImport'; summary: NonNullable<BulkImportState['finalSummary']> }

export const initialState: BulkImportState = {
  step: 'reportType',
  reportType: null,
  selectedAccountId: null,
  files: [],
  skippedFiles: [],
  showSkippedPanel: true,
  overlapsByFileKey: null,
  isCheckingOverlap: false,
  overlapCheckError: null,
  verifiedAccountAssignment: false,
  importInFlight: false,
  importStartedAt: null,
  currentImportingFileKey: null,
  finalSummary: null,
}

export function reducer(state: BulkImportState, action: Action): BulkImportState {
  switch (action.type) {
    case 'reset':
      return initialState
    case 'setStep':
      return { ...state, step: action.step }
    case 'setReportType':
      return { ...state, reportType: action.reportType }
    case 'setSelectedAccount':
      return {
        ...state,
        selectedAccountId: action.accountId,
        files: state.files.map(f => ({ ...f, marketplaceAccountId: action.accountId })),
      }
    case 'addFile':
      return { ...state, files: [...state.files, action.file] }
    case 'addSkipped':
      return { ...state, skippedFiles: [...state.skippedFiles, action.file] }
    case 'fileParsed':
      return {
        ...state,
        files: state.files.map(f =>
          f.fileKey === action.fileKey
            ? { ...f, status: { kind: 'ready', rowCount: action.rowCount, dateRange: action.dateRange, sampleSkus: action.sampleSkus }, rows: action.rows, includeInImport: true }
            : f,
        ),
      }
    case 'fileParseError': {
      const file = state.files.find(f => f.fileKey === action.fileKey)
      if (!file) return state
      const updated: FileEntry = { ...file, status: { kind: 'parse-error', reason: action.reason }, includeInImport: false }
      return {
        ...state,
        files: state.files.filter(f => f.fileKey !== action.fileKey),
        skippedFiles: [...state.skippedFiles, updated],
      }
    }
    case 'fileEmpty': {
      const file = state.files.find(f => f.fileKey === action.fileKey)
      if (!file) return state
      const updated: FileEntry = { ...file, status: { kind: 'empty', reason: '0 rows — likely wrong date range' }, includeInImport: false }
      return {
        ...state,
        files: state.files.filter(f => f.fileKey !== action.fileKey),
        skippedFiles: [...state.skippedFiles, updated],
      }
    }
    case 'reincludeSkipped': {
      const file = state.skippedFiles.find(f => f.fileKey === action.fileKey)
      if (!file) return state
      return {
        ...state,
        skippedFiles: state.skippedFiles.filter(f => f.fileKey !== action.fileKey),
        files: [...state.files, { ...file, includeInImport: false }],
      }
    }
    case 'removeFile':
      return {
        ...state,
        files: state.files.filter(f => f.fileKey !== action.fileKey),
        skippedFiles: state.skippedFiles.filter(f => f.fileKey !== action.fileKey),
      }
    case 'setIncludeInImport':
      return {
        ...state,
        files: state.files.map(f => f.fileKey === action.fileKey ? { ...f, includeInImport: action.include } : f),
      }
    case 'setShowSkippedPanel':
      return { ...state, showSkippedPanel: action.show }
    case 'startOverlapCheck':
      return { ...state, isCheckingOverlap: true, overlapCheckError: null }
    case 'overlapCheckSuccess':
      return { ...state, isCheckingOverlap: false, overlapsByFileKey: action.overlaps }
    case 'overlapCheckError':
      return { ...state, isCheckingOverlap: false, overlapCheckError: action.reason }
    case 'setVerifiedAccountAssignment':
      return { ...state, verifiedAccountAssignment: action.verified }
    case 'startImport':
      return { ...state, importInFlight: true, importStartedAt: Date.now(), step: 'progress' }
    case 'startImportingFile':
      return {
        ...state,
        currentImportingFileKey: action.fileKey,
        files: state.files.map(f => f.fileKey === action.fileKey ? { ...f, status: { kind: 'uploading' } } : f),
      }
    case 'fileImportSuccess':
      return {
        ...state,
        files: state.files.map(f => f.fileKey === action.fileKey
          ? { ...f, status: { kind: 'imported', imported: action.imported, skipped: action.skipped, mismatchedAccount: action.mismatchedAccount, failed: action.failed } }
          : f,
        ),
      }
    case 'fileImportFailed':
      return {
        ...state,
        files: state.files.map(f => f.fileKey === action.fileKey ? { ...f, status: { kind: 'failed', reason: action.reason } } : f),
      }
    case 'finishImport':
      return { ...state, importInFlight: false, currentImportingFileKey: null, finalSummary: action.summary, step: 'results' }
    default:
      return state
  }
}
