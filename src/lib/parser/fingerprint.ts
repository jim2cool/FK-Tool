import { SIGNATURES, normalise, type FileSignature } from './signatures'
import type { Platform, ReportType } from '@/types'

export interface DetectionResult {
  platform: Platform | null
  reportType: ReportType | null
  confidence: number  // 0–100
  matchedSignature: FileSignature | null
  headerRow: string[]
}

export function detectFileType(headers: string[]): DetectionResult {
  const normHeaders = headers.map(normalise)

  let bestScore = 0
  let bestSig: FileSignature | null = null

  for (const sig of SIGNATURES) {
    const requiredMatches = sig.requiredColumns.filter(col =>
      normHeaders.some(h => h.includes(col) || col.includes(h))
    ).length
    const optionalMatches = sig.optionalColumns.filter(col =>
      normHeaders.some(h => h.includes(col) || col.includes(h))
    ).length

    const requiredScore = (requiredMatches / sig.requiredColumns.length) * 70
    const optionalScore = sig.optionalColumns.length > 0
      ? (optionalMatches / sig.optionalColumns.length) * 30
      : 30

    const score = requiredScore + optionalScore

    if (score > bestScore) {
      bestScore = score
      bestSig = sig
    }
  }

  return {
    platform: bestSig?.platform ?? null,
    reportType: bestSig?.reportType ?? null,
    confidence: Math.round(bestScore),
    matchedSignature: bestSig,
    headerRow: headers,
  }
}
