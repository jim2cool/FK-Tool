/**
 * Client-side CSV export utility.
 * Builds a CSV string from rows and triggers a browser download.
 */
export function exportCsv(headers: string[], rows: string[][], filename: string): void {
  const escape = (v: string) => {
    const s = v ?? ''
    // Wrap in quotes if value contains comma, quote, or newline
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }

  const lines = [
    headers.map(escape).join(','),
    ...rows.map(row => row.map(escape).join(',')),
  ]

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function todayString(): string {
  return new Date().toISOString().slice(0, 10)
}
