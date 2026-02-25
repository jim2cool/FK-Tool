import * as XLSX from 'xlsx'
import Papa from 'papaparse'

export interface ParsedFile {
  headers: string[]
  rows: Record<string, string>[]
  rawPreview: string[][]  // first 10 rows for preview
}

export async function parseFile(buffer: Buffer, filename: string): Promise<ParsedFile> {
  const ext = filename.split('.').pop()?.toLowerCase()

  if (ext === 'csv') {
    return parseCsv(buffer.toString('utf-8'))
  } else if (ext === 'xlsx' || ext === 'xls') {
    return parseExcel(buffer)
  }
  throw new Error(`Unsupported file type: .${ext}`)
}

function parseCsv(text: string): ParsedFile {
  const { data } = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  })
  const headers = data.length > 0 ? Object.keys(data[0]) : []
  return {
    headers,
    rows: data,
    rawPreview: [headers, ...data.slice(0, 10).map(r => headers.map(h => r[h] ?? ''))],
  }
}

function parseExcel(buffer: Buffer): ParsedFile {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const raw: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })
  if (raw.length === 0) return { headers: [], rows: [], rawPreview: [] }
  const headers = raw[0].map(String)
  const rows = raw.slice(1).map(row =>
    Object.fromEntries(headers.map((h, i) => [h, String(row[i] ?? '')]))
  )
  return {
    headers,
    rows,
    rawPreview: raw.slice(0, 11).map(r => r.map(String)),
  }
}
