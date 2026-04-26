/**
 * Normalize a marketplace account name for storage and comparison:
 *   - trim leading/trailing whitespace
 *   - collapse runs of internal whitespace into a single space
 *
 * Returns null if the result is empty or out of length range.
 *
 * Examples:
 *   normalizeAccountName('  NuvioStore  ') === 'NuvioStore'
 *   normalizeAccountName('Nuvio  Store') === 'Nuvio Store'
 *   normalizeAccountName('   ') === null
 *   normalizeAccountName('') === null
 *   normalizeAccountName('a'.repeat(101)) === null
 */
export function normalizeAccountName(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null
  const collapsed = input.trim().replace(/\s+/g, ' ')
  if (collapsed.length < 1 || collapsed.length > 100) return null
  return collapsed
}
