// ── Page-level access control ─────────────────────────────────────────────────
// Single source of truth. Used by middleware (Edge), API routes (Node), and client.

export const ALL_PAGES = [
  'dashboard',
  'pnl',
  'orders-view',
  'dispatches',
  'returns',
  'labels',
  'catalog',
  'purchases',
  'invoices',
  'packaging',
  'cogs',
  'imports',
  'settings',
] as const

export type PageSlug = (typeof ALL_PAGES)[number]

export const PAGE_LABELS: Record<PageSlug, string> = {
  dashboard: 'Dashboard',
  pnl: 'Profit & Loss',
  'orders-view': 'Orders',
  dispatches: 'Dispatches',
  returns: 'Returns & Claims',
  labels: 'Labels',
  catalog: 'Master Catalog',
  purchases: 'Purchases',
  invoices: 'Invoices',
  packaging: 'Packaging',
  cogs: 'COGS',
  imports: 'Import Data',
  settings: 'Settings',
}

export const ROLE_PRESETS: Record<string, PageSlug[]> = {
  'Full Access': [...ALL_PAGES],
  Manager: ALL_PAGES.filter(p => p !== 'settings') as PageSlug[],
  Finance: ['dashboard', 'pnl', 'purchases', 'invoices', 'cogs', 'orders-view'],
  'Warehouse Staff': ['dashboard', 'labels', 'dispatches'],
}

// ── Access check ──────────────────────────────────────────────────────────────

/** NULL = unrestricted (owner). Dashboard is always accessible. */
export function hasPageAccess(allowedPages: string[] | null, page: string): boolean {
  if (allowedPages === null) return true
  if (page === 'dashboard') return true
  return allowedPages.includes(page)
}

// ── URL → page slug resolution ────────────────────────────────────────────────

/** Extracts page slug from a pathname like `/pnl` → 'pnl', `/catalog` → 'catalog'. */
export function pageSlugFromPath(pathname: string): string | null {
  // Remove leading slash, take first segment
  const slug = pathname.replace(/^\//, '').split('/')[0]
  if (!slug) return null
  if ((ALL_PAGES as readonly string[]).includes(slug)) return slug
  return null
}

/** Maps API route prefix → owning page slug. */
const API_PAGE_MAP: Array<[string, string]> = [
  ['/api/pnl', 'pnl'],
  ['/api/orders-view', 'orders-view'],
  ['/api/labels', 'labels'],
  ['/api/catalog', 'catalog'],
  ['/api/purchases', 'purchases'],
  ['/api/freight-invoices', 'invoices'],
  ['/api/packaging', 'packaging'],
  ['/api/cogs', 'cogs'],
  ['/api/imports', 'imports'],
  ['/api/warehouses', 'settings'],
  ['/api/marketplace-accounts', 'settings'],
  ['/api/organizations', 'settings'],
  ['/api/team', 'settings'],
]

/** Returns the page slug that owns an API route, or null if always allowed. */
export function pageForApiRoute(pathname: string): string | null {
  for (const [prefix, page] of API_PAGE_MAP) {
    if (pathname.startsWith(prefix)) return page
  }
  return null // /api/me, /api/setup, /api/dashboard — always allowed
}
