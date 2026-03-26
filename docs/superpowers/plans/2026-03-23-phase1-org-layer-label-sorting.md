# Phase 1: Org Layer + Label Sorting — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight organization layer, then build a Label Sorting module that parses Flipkart shipping label PDFs, sorts labels by master product, outputs print-ready PDFs, and auto-ingests order + dispatch data.

**Architecture:** Phase 1.0 adds an `organizations` table and links it to `marketplace_accounts` + `user_profiles`. Phase 1 adds a new `/labels` page where warehouse staff upload Flipkart label PDFs. Browser-side pdf.js extracts text from each page, resolves platform SKU → master SKU via `sku_mappings`, then pdf-lib crops and regroups labels into per-product PDFs. As a side effect, parsed order/dispatch data is saved to the existing (empty) `orders` and `dispatches` tables via a new API endpoint.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (PostgreSQL), pdf.js (text extraction), pdf-lib (PDF manipulation), react-dropzone (file upload), shadcn/ui components, Tailwind CSS v4.

**Spec document:** `docs/superpowers/specs/2026-03-23-fktool-vision-and-roadmap.md`

---

## File Structure

### Phase 1.0: Org Layer
| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/types/database.ts` (modify) | Add `Organization` type |
| Modify | `src/types/database.ts` | Add `organization_id` to `MarketplaceAccount`, `UserProfile` types |
| Migration | (via Supabase MCP) | `organizations` table, alter `marketplace_accounts`, alter `user_profiles` |

### Phase 1: Label Sorting
| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/lib/labels/pdf-parser.ts` | Extract text fields from a single Flipkart label PDF page |
| Create | `src/lib/labels/pdf-cropper.ts` | Crop label (top half) from each page, group into per-product PDFs |
| Create | `src/lib/labels/types.ts` | Types for parsed label data, grouping output |
| Create | `src/app/api/labels/ingest/route.ts` | POST: receive parsed label data, resolve SKUs, create orders + dispatches |
| Create | `src/app/api/labels/resolve-skus/route.ts` | POST: batch-resolve platform SKUs → master SKU IDs via sku_mappings |
| Create | `src/app/(dashboard)/labels/page.tsx` | Label Sorting page — upload, preview, download sorted PDFs |
| Create | `src/components/labels/LabelUploadZone.tsx` | Dropzone for PDF files + warehouse selector |
| Create | `src/components/labels/LabelPreviewTable.tsx` | Preview table showing parsed labels grouped by product |
| Create | `src/components/labels/UnmappedSkuPanel.tsx` | Inline SKU mapping UI for unknown platform SKUs |
| Modify | `src/components/layout/AppSidebar.tsx` | Add "Labels" nav item |
| Modify | `src/types/database.ts` | Add `ParsedLabel`, `LabelGroup` types |

---

## Chunk 1: Phase 1.0 — Org Layer

### Task 1: Create organizations table (migration)

**Files:**
- Migration via Supabase MCP
- Modify: `src/types/database.ts`

- [ ] **Step 1: Run migration to create organizations table**

Execute via Supabase MCP `apply_migration`:
```sql
-- Create organizations table
CREATE TABLE organizations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  legal_name      TEXT,
  gst_number      TEXT,
  billing_address TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON organizations
  USING (tenant_id = (
    SELECT tenant_id FROM user_profiles WHERE id = auth.uid()
  ));

-- Add organization_id to marketplace_accounts
ALTER TABLE marketplace_accounts
  ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

-- Add organization_id and role update to user_profiles
ALTER TABLE user_profiles
  ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

-- Update role check constraint (replace existing default 'member' with proper roles)
-- First check current constraint
ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_role_check;

ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('owner', 'admin', 'manager', 'staff', 'member'));

-- Migrate existing 'admin' users to 'owner' (admin is kept for backwards compat)
UPDATE user_profiles SET role = 'owner' WHERE role = 'admin';

-- Add unique constraint on orders to prevent duplicate ingestion under concurrency
CREATE UNIQUE INDEX IF NOT EXISTS orders_tenant_platform_order_id_unique
  ON orders (tenant_id, platform_order_id);
```

- [ ] **Step 2: Verify migration applied**

Run via Supabase MCP `execute_sql`:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'organizations' ORDER BY ordinal_position;
```
Expected: id, tenant_id, name, legal_name, gst_number, billing_address, created_at

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'marketplace_accounts' AND column_name = 'organization_id';
```
Expected: 1 row with `organization_id`

- [ ] **Step 3: Seed existing organizations**

Run via Supabase MCP `execute_sql`:
```sql
-- Get the tenant_id first
SELECT id, name FROM tenants;
```

Then insert orgs (use actual tenant_id from above):
```sql
INSERT INTO organizations (tenant_id, name, legal_name, gst_number) VALUES
  ('<tenant_id>', 'E4A', 'E4A Partner Private Limited', '06AAICE3494R1ZV'),
  ('<tenant_id>', 'ESS1', 'ESS Collective', '06AQVPM0300Q1ZH'),
  ('<tenant_id>', 'ESS2', 'ESS2', NULL);
```

Then link marketplace accounts to orgs:
```sql
-- Link accounts to orgs based on account_name patterns
-- First, check what accounts exist
SELECT id, account_name, platform FROM marketplace_accounts;
```

Then update each account's `organization_id` based on the results. The GSTIN on the label matches the org's `gst_number`, so this mapping will be used by Label Sorting.

- [ ] **Step 4: Update TypeScript types**

Modify `src/types/database.ts` — add Organization type and update existing types:

```typescript
// Add after Tenant interface
export interface Organization {
  id: string
  tenant_id: string
  name: string
  legal_name: string | null
  gst_number: string | null
  billing_address: string | null
  created_at: string
}

// CREATE this interface (does not exist yet)
export interface UserProfile {
  id: string
  tenant_id: string
  email: string
  role: 'owner' | 'admin' | 'manager' | 'staff' | 'member'
  organization_id: string | null
  created_at: string
}

// Update MarketplaceAccount — add organization_id field after 'mode':
//   organization_id: string | null
```

Also update `src/app/api/setup/route.ts` to use `'owner'` instead of `'admin'` for new user creation.

- [ ] **Step 5: Commit**

```bash
git add src/types/database.ts
git commit -m "feat: add organizations table and link to marketplace_accounts + user_profiles"
```

### Task 2: Create organizations API

**Files:**
- Create: `src/app/api/organizations/route.ts`

- [ ] **Step 1: Create GET/POST API route**

Create `src/app/api/organizations/route.ts`:
```typescript
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('name')

    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const body = await request.json()

    if (!body.name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('organizations')
      .insert({ tenant_id: tenantId, ...body })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify API works**

Start dev server, call:
```
GET /api/organizations
```
Expected: array with seeded orgs (E4A, ESS1, ESS2)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/organizations/route.ts
git commit -m "feat: add organizations API (GET/POST)"
```

---

## Chunk 2: Phase 1 — Label Sorting Core (PDF parsing + cropping)

### Task 3: Install PDF dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install pdf.js and pdf-lib**

```bash
npm install pdfjs-dist pdf-lib
```

- [ ] **Step 2: Verify installation**

```bash
node -e "require('pdfjs-dist'); require('pdf-lib'); console.log('OK')"
```
Expected: "OK"

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add pdfjs-dist and pdf-lib for label sorting"
```

### Task 4: Define label types

**Files:**
- Create: `src/lib/labels/types.ts`

- [ ] **Step 1: Create types file**

```typescript
/** Data extracted from a single Flipkart label PDF page */
export interface ParsedLabel {
  /** Index of the source file in the uploaded files array */
  fileIndex: number
  /** Page index in the source PDF (0-based) */
  pageIndex: number
  /** Flipkart order ID (e.g., OD437024786226306100) */
  orderId: string
  /** Platform SKU ID as printed on label */
  platformSku: string
  /** Product description as printed on label */
  productDescription: string
  /** Seller/org name from "Sold By" field */
  sellerName: string
  /** GSTIN from label */
  gstin: string
  /** Courier name (e.g., "Expressbees E2E COD") */
  courier: string
  /** AWB tracking number */
  awbNumber: string
  /** Payment type */
  paymentType: 'COD' | 'PREPAID' | 'UNKNOWN'
  /** Handover By Date (HBD) */
  hbd: string | null
  /** Customer Promise Date (CPD) */
  cpd: string | null
  /** Customer pincode (extracted from address) */
  customerPincode: string | null
  /** Sale price from invoice section */
  salePrice: number | null
  /** Source PDF file name */
  sourceFile: string
}

/** Result of resolving a platform SKU to a master SKU */
export interface ResolvedLabel extends ParsedLabel {
  /** Resolved master SKU ID (null if unmapped) */
  masterSkuId: string | null
  /** Resolved master SKU name (null if unmapped) */
  masterSkuName: string | null
  /** Resolved marketplace account ID (null if not found) */
  marketplaceAccountId: string | null
  /** Resolved organization ID (null if not found) */
  organizationId: string | null
}

/** Group of labels for the same master product */
export interface LabelGroup {
  /** Master SKU ID */
  masterSkuId: string
  /** Master SKU name (what staff sees) */
  masterSkuName: string
  /** Number of labels in this group */
  count: number
  /** Page indices from source PDFs (for cropping) */
  pages: Array<{ fileIndex: number; pageIndex: number }>
  /** Breakdown by org */
  orgBreakdown: Array<{ orgName: string; count: number }>
  /** COD vs PREPAID counts */
  codCount: number
  prepaidCount: number
}

/** Labels that couldn't be matched to a master SKU */
export interface UnmappedSku {
  /** The platform SKU string from the label */
  platformSku: string
  /** Product description from the label */
  productDescription: string
  /** How many labels have this SKU */
  count: number
  /** Page indices */
  pages: Array<{ fileIndex: number; pageIndex: number }>
}

/** Full result of parsing + resolving a batch of label PDFs */
export interface LabelSortResult {
  /** Groups of labels sorted by master product */
  groups: LabelGroup[]
  /** SKUs that couldn't be resolved */
  unmapped: UnmappedSku[]
  /** Total labels parsed */
  totalLabels: number
  /** Summary stats */
  stats: {
    totalOrders: number
    codCount: number
    prepaidCount: number
    orgBreakdown: Array<{ orgName: string; count: number }>
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/labels/types.ts
git commit -m "feat: add label sorting types"
```

### Task 5: Build PDF text parser

**Files:**
- Create: `src/lib/labels/pdf-parser.ts`

This is the core parsing logic. It extracts structured data from each page of a Flipkart label PDF using pdf.js text extraction (no OCR).

- [ ] **Step 1: Create the parser**

Create `src/lib/labels/pdf-parser.ts`:
```typescript
import * as pdfjsLib from 'pdfjs-dist'
import type { ParsedLabel } from './types'

// Set worker source for pdf.js (needed in browser)
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`
}

/**
 * Parse all pages of a Flipkart label PDF and extract structured data.
 * Each page = 1 order (label on top, invoice on bottom).
 */
export async function parseLabelPdf(
  file: File,
  fileIndex: number = 0,
): Promise<ParsedLabel[]> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const labels: ParsedLabel[] = []

  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1) // pdf.js pages are 1-indexed
    const textContent = await page.getTextContent()
    const text = textContent.items
      .map((item: { str?: string }) => item.str ?? '')
      .join(' ')

    const label = extractLabelFields(text, fileIndex, i, file.name)
    if (label) {
      labels.push(label)
    }
  }

  return labels
}

/**
 * Extract structured fields from the raw text of a single label page.
 *
 * Flipkart label layout (verified from sample):
 * - Line 1: "STD [Courier Name] [SURFACE/EXPRESS] E"
 * - Line 2: "[Order ID] [COD/PREPAID]"
 * - Seller: "Sold By [Org Name], [address]"
 * - GSTIN: "GSTIN: [number]"
 * - SKU row: "[qty] [platform_sku] | [product description] [qty]"
 * - AWB: numeric string near bottom of label section
 * - HBD/CPD: "HBD: DD - MM" / "CPD: DD - MM"
 */
function extractLabelFields(
  text: string,
  fileIndex: number,
  pageIndex: number,
  sourceFile: string,
): ParsedLabel | null {
  // Order ID: starts with OD followed by digits
  const orderIdMatch = text.match(/OD\d{15,25}/)
  if (!orderIdMatch) return null // Not a valid Flipkart label page
  const orderId = orderIdMatch[0]

  // Payment type: COD or PREPAID appears near the order ID
  const paymentType = text.includes('PREPAID')
    ? 'PREPAID' as const
    : text.includes('COD')
      ? 'COD' as const
      : 'UNKNOWN' as const

  // Courier: appears right after "STD" at the start
  const courierMatch = text.match(/STD\s+(.+?)(?:\s+SURFACE|\s+EXPRESS)/)
  const courier = courierMatch?.[1]?.trim() ?? 'Unknown'

  // Seller name: "Sold By [NAME]," or "Sold By:[NAME],"
  const sellerMatch = text.match(/Sold [Bb]y[:\s]*([A-Z][A-Z0-9\s&.]+?)(?:,|\s+first|\s+Ground|\s+Floor)/)
  const sellerName = sellerMatch?.[1]?.trim() ?? 'Unknown'

  // GSTIN: "GSTIN: XXXXXXXXXXXX" (15 chars)
  const gstinMatch = text.match(/GSTIN:\s*([A-Z0-9]{15})/)
  const gstin = gstinMatch?.[1] ?? ''

  // SKU ID and Description: appears in "SKU ID | Description" section
  // Format: "[qty] [sku_id] | [description] [qty]"
  // The SKU row typically has format: "1 sku-name-here | Full Product Description 1"
  const skuMatch = text.match(/SKU ID\s*\|\s*Description\s*QTY\s*(\d+)\s*(.+?)\s*\|\s*(.+?)(?:\s+\d+\s|$)/)
  let platformSku = ''
  let productDescription = ''
  if (skuMatch) {
    platformSku = skuMatch[2]?.trim() ?? ''
    productDescription = skuMatch[3]?.trim() ?? ''
  } else {
    // Fallback: try to find the SKU row without header
    const skuFallback = text.match(/\d\s+([^\|]+?)\s*\|\s*([^\d]+?)(?:\s+\d)/)
    if (skuFallback) {
      platformSku = skuFallback[1]?.trim() ?? ''
      productDescription = skuFallback[2]?.trim() ?? ''
    }
  }

  // AWB Number: long numeric string (10-15 digits) that appears after the SKU section
  const awbMatch = text.match(/\b(\d{10,15})\b/)
  const awbNumber = awbMatch?.[1] ?? ''

  // HBD and CPD: "HBD: DD - MM" format
  const hbdMatch = text.match(/HBD:\s*(\d{2}\s*-\s*\d{2})/)
  const hbd = hbdMatch?.[1]?.replace(/\s/g, '') ?? null

  const cpdMatch = text.match(/CPD:\s*(\d{2}\s*-\s*\d{2})/)
  const cpd = cpdMatch?.[1]?.replace(/\s/g, '') ?? null

  // Customer pincode: 6-digit Indian pincode from address section
  const pincodeMatches = text.match(/\b(\d{6})\b/g)
  // The customer pincode is usually in the shipping address (right side of label)
  // Take the first 6-digit number that appears in the address area
  const customerPincode = pincodeMatches && pincodeMatches.length > 0
    ? pincodeMatches[0]
    : null

  // Sale price: from invoice section, look for "Total" column value
  // Format varies but typically: "TOTAL PRICE: 1900.00"
  const priceMatch = text.match(/TOTAL PRICE:\s*([\d,.]+)/)
  const salePrice = priceMatch
    ? parseFloat(priceMatch[1].replace(/,/g, ''))
    : null

  return {
    fileIndex,
    pageIndex,
    orderId,
    platformSku,
    productDescription,
    sellerName,
    gstin,
    courier,
    awbNumber,
    paymentType,
    hbd,
    cpd,
    customerPincode,
    salePrice,
    sourceFile,
  }
}
```

- [ ] **Step 2: Verify parser compiles**

```bash
npx tsc --noEmit src/lib/labels/pdf-parser.ts
```
Expected: no errors (may need to adjust imports based on pdf.js typings)

- [ ] **Step 3: Commit**

```bash
git add src/lib/labels/pdf-parser.ts
git commit -m "feat: add Flipkart label PDF text parser"
```

### Task 6: Build PDF cropper

**Files:**
- Create: `src/lib/labels/pdf-cropper.ts`

This takes parsed + resolved labels, groups them by master product, and produces cropped label-only PDFs (top half of each page).

- [ ] **Step 1: Create the cropper**

Create `src/lib/labels/pdf-cropper.ts`:
```typescript
import { PDFDocument } from 'pdf-lib'
import type { ResolvedLabel, LabelGroup } from './types'

/**
 * Given resolved labels and the source PDF files, produce one cropped PDF per product group.
 * Each output PDF contains only the label portion (top half) of each page.
 *
 * @param labels - Parsed and SKU-resolved labels
 * @param sourceFiles - Original uploaded PDF File objects (indexed by fileIndex)
 * @returns Map of masterSkuName → Uint8Array (PDF bytes)
 */
export async function cropAndGroupLabels(
  groups: LabelGroup[],
  sourceFiles: File[],
): Promise<Map<string, Uint8Array>> {
  // Load all source PDFs into pdf-lib documents
  const sourceDocs: PDFDocument[] = []
  for (const file of sourceFiles) {
    const bytes = await file.arrayBuffer()
    const doc = await PDFDocument.load(bytes)
    sourceDocs.push(doc)
  }

  const result = new Map<string, Uint8Array>()

  for (const group of groups) {
    const outputDoc = await PDFDocument.create()

    for (const pageRef of group.pages) {
      const sourceDoc = sourceDocs[pageRef.fileIndex]
      if (!sourceDoc) continue

      const sourcePage = sourceDoc.getPage(pageRef.pageIndex)
      const { width, height } = sourcePage.getSize()

      // Copy the page to our output document
      const [copiedPage] = await outputDoc.copyPages(sourceDoc, [pageRef.pageIndex])

      // Crop to top half only (the shipping label)
      // The dashed line separator is roughly at the midpoint of the page
      // pdf-lib setCropBox(x, y, width, height) — y is from bottom edge
      copiedPage.setCropBox(0, height / 2, width, height / 2)
      copiedPage.setMediaBox(0, height / 2, width, height / 2)

      outputDoc.addPage(copiedPage)
    }

    const pdfBytes = await outputDoc.save()
    const fileName = `${group.masterSkuName} — ${group.count} labels`
    result.set(fileName, pdfBytes)
  }

  return result
}

/**
 * Group resolved labels by master SKU.
 * Unmapped labels are excluded (handled separately by UnmappedSkuPanel).
 */
export function groupLabelsByProduct(labels: ResolvedLabel[]): LabelGroup[] {
  const groups = new Map<string, LabelGroup>()

  for (const label of labels) {
    if (!label.masterSkuId || !label.masterSkuName) continue

    const existing = groups.get(label.masterSkuId)
    if (existing) {
      existing.count++
      existing.pages.push({ fileIndex: label.fileIndex, pageIndex: label.pageIndex })
      if (label.paymentType === 'COD') existing.codCount++
      if (label.paymentType === 'PREPAID') existing.prepaidCount++

      // Update org breakdown
      const orgName = label.sellerName || 'Unknown'
      const orgEntry = existing.orgBreakdown.find(o => o.orgName === orgName)
      if (orgEntry) orgEntry.count++
      else existing.orgBreakdown.push({ orgName, count: 1 })
    } else {
      groups.set(label.masterSkuId, {
        masterSkuId: label.masterSkuId,
        masterSkuName: label.masterSkuName,
        count: 1,
        pages: [{ fileIndex: label.fileIndex, pageIndex: label.pageIndex }],
        orgBreakdown: [{ orgName: label.sellerName || 'Unknown', count: 1 }],
        codCount: label.paymentType === 'COD' ? 1 : 0,
        prepaidCount: label.paymentType === 'PREPAID' ? 1 : 0,
      })
    }
  }

  // Sort groups by count (most labels first)
  return Array.from(groups.values()).sort((a, b) => b.count - a.count)
}
```

- [ ] **Step 2: Verify cropper compiles**

```bash
npx tsc --noEmit src/lib/labels/pdf-cropper.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/labels/pdf-cropper.ts
git commit -m "feat: add label PDF cropper and product grouping"
```

---

## Chunk 3: Phase 1 — SKU Resolution API + Order Ingestion

### Task 7: Create SKU resolution API

**Files:**
- Create: `src/app/api/labels/resolve-skus/route.ts`

This endpoint takes an array of platform SKUs + GSTINs and returns master SKU IDs + org IDs.

- [ ] **Step 1: Create the resolve-skus endpoint**

Create `src/app/api/labels/resolve-skus/route.ts`:
```typescript
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'

interface ResolveRequest {
  /** Array of { platformSku, gstin } pairs to resolve */
  items: Array<{
    platformSku: string
    gstin: string
  }>
}

interface ResolvedItem {
  platformSku: string
  masterSkuId: string | null
  masterSkuName: string | null
  marketplaceAccountId: string | null
  organizationId: string | null
}

export async function POST(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const body: ResolveRequest = await request.json()

    if (!body.items?.length) {
      return NextResponse.json({ error: 'items array is required' }, { status: 400 })
    }

    // Load all sku_mappings for this tenant
    const { data: mappings, error: mappingError } = await supabase
      .from('sku_mappings')
      .select('platform_sku, master_sku_id, marketplace_account_id')
      .eq('tenant_id', tenantId)

    if (mappingError) throw mappingError

    // Load master SKU names
    const { data: skus, error: skuError } = await supabase
      .from('master_skus')
      .select('id, name')
      .eq('tenant_id', tenantId)

    if (skuError) throw skuError
    const skuNameMap = new Map(skus?.map(s => [s.id, s.name]) ?? [])

    // Load marketplace accounts with org links
    const { data: accounts, error: accountError } = await supabase
      .from('marketplace_accounts')
      .select('id, organization_id')
      .eq('tenant_id', tenantId)

    if (accountError) throw accountError
    const accountOrgMap = new Map(accounts?.map(a => [a.id, a.organization_id]) ?? [])

    // Load organizations by GSTIN for org resolution
    const { data: orgs, error: orgError } = await supabase
      .from('organizations')
      .select('id, gst_number')
      .eq('tenant_id', tenantId)

    if (orgError) throw orgError
    const gstinOrgMap = new Map(
      orgs?.filter(o => o.gst_number).map(o => [o.gst_number!, o.id]) ?? []
    )

    // Build platform_sku → mapping lookup (case-insensitive)
    const skuLookup = new Map<string, { master_sku_id: string; marketplace_account_id: string | null }>()
    for (const m of mappings ?? []) {
      skuLookup.set(m.platform_sku.toLowerCase(), {
        master_sku_id: m.master_sku_id,
        marketplace_account_id: m.marketplace_account_id,
      })
    }

    // Resolve each item
    const resolved: ResolvedItem[] = body.items.map(item => {
      const mapping = skuLookup.get(item.platformSku.toLowerCase())
      const orgId = gstinOrgMap.get(item.gstin) ?? null

      if (!mapping) {
        return {
          platformSku: item.platformSku,
          masterSkuId: null,
          masterSkuName: null,
          marketplaceAccountId: null,
          organizationId: orgId,
        }
      }

      return {
        platformSku: item.platformSku,
        masterSkuId: mapping.master_sku_id,
        masterSkuName: skuNameMap.get(mapping.master_sku_id) ?? null,
        marketplaceAccountId: mapping.marketplace_account_id,
        organizationId: orgId ?? (mapping.marketplace_account_id
          ? accountOrgMap.get(mapping.marketplace_account_id) ?? null
          : null),
      }
    })

    return NextResponse.json({ resolved })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify endpoint compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/labels/resolve-skus/route.ts
git commit -m "feat: add SKU resolution API for label sorting"
```

### Task 8: Create order + dispatch ingestion API

**Files:**
- Create: `src/app/api/labels/ingest/route.ts`

This endpoint receives parsed label data and creates order + dispatch records.

- [ ] **Step 1: Create the ingest endpoint**

Create `src/app/api/labels/ingest/route.ts`:
```typescript
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'

interface IngestRequest {
  warehouseId: string
  labels: Array<{
    orderId: string
    masterSkuId: string
    marketplaceAccountId: string | null
    quantity: number
    salePrice: number | null
    paymentType: 'COD' | 'PREPAID' | 'UNKNOWN'
    platformSku: string
    dispatchDate: string // ISO date string
    courier: string
    awbNumber: string
  }>
}

export async function POST(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const body: IngestRequest = await request.json()

    if (!body.warehouseId || !body.labels?.length) {
      return NextResponse.json(
        { error: 'warehouseId and labels array are required' },
        { status: 400 }
      )
    }

    // Check for existing orders to avoid duplicates (by platform_order_id)
    const orderIds = body.labels.map(l => l.orderId)
    const { data: existingOrders } = await supabase
      .from('orders')
      .select('platform_order_id')
      .eq('tenant_id', tenantId)
      .in('platform_order_id', orderIds)

    const existingSet = new Set(existingOrders?.map(o => o.platform_order_id) ?? [])

    let created = 0
    let skipped = 0

    for (const label of body.labels) {
      // Skip if order already exists
      if (existingSet.has(label.orderId)) {
        skipped++
        continue
      }

      // Create order
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          tenant_id: tenantId,
          platform_order_id: label.orderId,
          master_sku_id: label.masterSkuId,
          marketplace_account_id: label.marketplaceAccountId,
          quantity: label.quantity || 1,
          sale_price: label.salePrice ?? 0,
          order_date: label.dispatchDate,
          status: 'dispatched',
        })
        .select('id')
        .single()

      if (orderError) {
        console.error(`[labels/ingest] order error for ${label.orderId}:`, orderError)
        skipped++
        continue
      }

      // Create dispatch (linked to order via UUID, not Flipkart order ID)
      const { error: dispatchError } = await supabase
        .from('dispatches')
        .insert({
          tenant_id: tenantId,
          master_sku_id: label.masterSkuId,
          warehouse_id: body.warehouseId,
          marketplace_account_id: label.marketplaceAccountId,
          order_id: order.id, // UUID from created order row, NOT Flipkart order ID string
          platform_sku: label.platformSku,
          quantity: label.quantity || 1,
          dispatch_date: label.dispatchDate,
        })

      if (dispatchError) {
        console.error(`[labels/ingest] dispatch error for ${label.orderId}:`, dispatchError)
      }

      created++
    }

    return NextResponse.json({ created, skipped, total: body.labels.length })
  } catch (e: unknown) {
    console.error('[labels/ingest] error:', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify endpoint compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/labels/ingest/route.ts
git commit -m "feat: add label ingestion API (creates orders + dispatches)"
```

---

## Chunk 4: Phase 1 — Label Sorting UI

### Task 9: Create Label Upload Zone component

**Files:**
- Create: `src/components/labels/LabelUploadZone.tsx`

- [ ] **Step 1: Create the upload zone component**

Create `src/components/labels/LabelUploadZone.tsx`:
```typescript
'use client'

import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload } from 'lucide-react'

interface LabelUploadZoneProps {
  onFilesSelected: (files: File[]) => void
  disabled?: boolean
}

export function LabelUploadZone({ onFilesSelected, disabled }: LabelUploadZoneProps) {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      onFilesSelected(acceptedFiles)
    }
  }, [onFilesSelected])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: true,
    disabled,
  })

  return (
    <div
      {...getRootProps()}
      className={`
        border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
        transition-colors duration-200
        ${isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      <input {...getInputProps()} />
      <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
      <p className="text-sm font-medium">
        {isDragActive ? 'Drop label PDFs here' : 'Drop Flipkart label PDFs here or click to select'}
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        Upload one or more PDFs from Flipkart Seller Hub. Labels will be sorted by product.
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/labels/LabelUploadZone.tsx
git commit -m "feat: add LabelUploadZone component"
```

### Task 10: Create Label Preview Table component

**Files:**
- Create: `src/components/labels/LabelPreviewTable.tsx`

- [ ] **Step 1: Create the preview table**

Create `src/components/labels/LabelPreviewTable.tsx`:
```typescript
'use client'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Download } from 'lucide-react'
import type { LabelGroup, LabelSortResult } from '@/lib/labels/types'

interface LabelPreviewTableProps {
  result: LabelSortResult
  onDownloadGroup: (group: LabelGroup) => void
  onDownloadAll: () => void
}

export function LabelPreviewTable({ result, onDownloadGroup, onDownloadAll }: LabelPreviewTableProps) {
  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="flex gap-4 text-sm">
        <span className="font-medium">{result.totalLabels} labels</span>
        <span className="text-muted-foreground">
          {result.stats.codCount} COD / {result.stats.prepaidCount} Prepaid
        </span>
        <span className="text-muted-foreground">
          {result.groups.length} products
        </span>
        {result.unmapped.length > 0 && (
          <Badge variant="destructive">{result.unmapped.length} unmapped SKUs</Badge>
        )}
      </div>

      {/* Grouped labels table */}
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
              <TableCell className="text-center">
                {group.codCount > 0 && <Badge variant="outline">{group.codCount}</Badge>}
              </TableCell>
              <TableCell className="text-center">
                {group.prepaidCount > 0 && <Badge variant="secondary">{group.prepaidCount}</Badge>}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {group.orgBreakdown.map(o => `${o.orgName} (${o.count})`).join(', ')}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDownloadGroup(group)}
                >
                  <Download className="h-4 w-4 mr-1" />
                  PDF
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Download all button */}
      {result.groups.length > 1 && (
        <div className="flex justify-end">
          <Button onClick={onDownloadAll}>
            <Download className="h-4 w-4 mr-2" />
            Download All ({result.groups.length} PDFs)
          </Button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/labels/LabelPreviewTable.tsx
git commit -m "feat: add LabelPreviewTable component"
```

### Task 11: Create Unmapped SKU Panel component

**Files:**
- Create: `src/components/labels/UnmappedSkuPanel.tsx`

- [ ] **Step 1: Create the unmapped SKU panel**

Create `src/components/labels/UnmappedSkuPanel.tsx`:
```typescript
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import type { UnmappedSku } from '@/lib/labels/types'

interface MasterSkuOption {
  id: string
  name: string
}

interface UnmappedSkuPanelProps {
  unmapped: UnmappedSku[]
  masterSkus: MasterSkuOption[]
  userRole: 'owner' | 'manager' | 'staff' | 'member'
  onMapped: (platformSku: string, masterSkuId: string) => void
}

export function UnmappedSkuPanel({ unmapped, masterSkus, userRole, onMapped }: UnmappedSkuPanelProps) {
  const [mappingSelections, setMappingSelections] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)

  const canMap = userRole === 'owner' || userRole === 'manager'

  async function handleSaveMapping(platformSku: string) {
    const masterSkuId = mappingSelections[platformSku]
    if (!masterSkuId) return

    setSaving(platformSku)
    try {
      const res = await fetch('/api/catalog/sku-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform_sku: platformSku, master_sku_id: masterSkuId, platform: 'flipkart' }),
      })
      if (!res.ok) throw new Error(await res.text())
      toast.success(`Mapped "${platformSku}" successfully`)
      onMapped(platformSku, masterSkuId)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(null)
    }
  }

  if (unmapped.length === 0) return null

  return (
    <div className="border border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="h-4 w-4 text-yellow-600" />
        <span className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
          {unmapped.length} unknown SKU{unmapped.length > 1 ? 's' : ''} — labels not sorted
        </span>
      </div>

      {!canMap && (
        <p className="text-xs text-muted-foreground mb-3">
          Contact your manager to map these SKUs to master products.
        </p>
      )}

      <div className="space-y-2">
        {unmapped.map(item => (
          <div key={item.platformSku} className="flex items-center gap-3 text-sm">
            <Badge variant="outline" className="shrink-0">{item.count}</Badge>
            <span className="font-mono text-xs truncate max-w-[200px]" title={item.platformSku}>
              {item.platformSku}
            </span>
            <span className="text-xs text-muted-foreground truncate max-w-[200px]" title={item.productDescription}>
              {item.productDescription}
            </span>

            {canMap && (
              <>
                <Select
                  value={mappingSelections[item.platformSku] ?? ''}
                  onValueChange={v => setMappingSelections(prev => ({ ...prev, [item.platformSku]: v }))}
                >
                  <SelectTrigger className="w-[200px] h-8 text-xs">
                    <SelectValue placeholder="Map to product..." />
                  </SelectTrigger>
                  <SelectContent>
                    {masterSkus.map(sku => (
                      <SelectItem key={sku.id} value={sku.id}>
                        {sku.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!mappingSelections[item.platformSku] || saving === item.platformSku}
                  onClick={() => handleSaveMapping(item.platformSku)}
                >
                  {saving === item.platformSku ? 'Saving...' : 'Map'}
                </Button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/labels/UnmappedSkuPanel.tsx
git commit -m "feat: add UnmappedSkuPanel for inline SKU mapping"
```

### Task 12: Verify SKU mappings API supports POST

**Files:**
- Verify (DO NOT OVERWRITE): `src/app/api/catalog/sku-mappings/route.ts`

> **IMPORTANT:** This file likely already exists with GET/DELETE/PATCH handlers. Do NOT overwrite it. Only add a POST handler if one doesn't exist.

- [ ] **Step 1: Check if sku-mappings API exists and has POST**

```bash
ls src/app/api/catalog/sku-mappings/ 2>/dev/null || echo "DOES NOT EXIST"
grep -l "export async function POST" src/app/api/catalog/sku-mappings/route.ts 2>/dev/null || echo "NO POST HANDLER"
```

- [ ] **Step 2: Add POST handler only if missing (append to existing file, do not overwrite)**

Create `src/app/api/catalog/sku-mappings/route.ts`:
```typescript
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const body = await request.json()

    const { platform_sku, master_sku_id, platform, marketplace_account_id } = body

    if (!platform_sku || !master_sku_id || !platform) {
      return NextResponse.json(
        { error: 'platform_sku, master_sku_id, and platform are required' },
        { status: 400 }
      )
    }

    // Check for existing mapping
    const { data: existing } = await supabase
      .from('sku_mappings')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('platform_sku', platform_sku)
      .eq('platform', platform)
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        { error: `Mapping for "${platform_sku}" already exists` },
        { status: 409 }
      )
    }

    const { data, error } = await supabase
      .from('sku_mappings')
      .insert({
        tenant_id: tenantId,
        platform_sku,
        master_sku_id,
        platform,
        marketplace_account_id: marketplace_account_id ?? null,
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/catalog/sku-mappings/route.ts
git commit -m "feat: add SKU mappings API for inline mapping from label sorting"
```

### Task 13: Create the Label Sorting page

**Files:**
- Create: `src/app/(dashboard)/labels/page.tsx`
- Modify: `src/components/layout/AppSidebar.tsx`

This is the main page tying everything together.

- [ ] **Step 1: Create the labels page**

Create `src/app/(dashboard)/labels/page.tsx`:
```typescript
'use client'

import { useState, useEffect, useCallback } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { InfoTooltip } from '@/components/ui/info-tooltip'
import { toast } from 'sonner'
import { LabelUploadZone } from '@/components/labels/LabelUploadZone'
import { LabelPreviewTable } from '@/components/labels/LabelPreviewTable'
import { UnmappedSkuPanel } from '@/components/labels/UnmappedSkuPanel'
import { parseLabelPdf } from '@/lib/labels/pdf-parser'
import { cropAndGroupLabels, groupLabelsByProduct } from '@/lib/labels/pdf-cropper'
import type { ParsedLabel, ResolvedLabel, LabelGroup, LabelSortResult, UnmappedSku } from '@/lib/labels/types'

interface Warehouse {
  id: string
  name: string
}

interface MasterSkuOption {
  id: string
  name: string
}

type PageState = 'idle' | 'parsing' | 'resolving' | 'ready' | 'ingesting'

export default function LabelsPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [masterSkus, setMasterSkus] = useState<MasterSkuOption[]>([])
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('')
  const [state, setState] = useState<PageState>('idle')
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([])
  const [resolvedLabels, setResolvedLabels] = useState<ResolvedLabel[]>([])
  const [sortResult, setSortResult] = useState<LabelSortResult | null>(null)
  const [userRole] = useState<'owner' | 'manager' | 'staff' | 'member'>('owner') // TODO: get from user profile

  // Load warehouses and master SKUs on mount
  useEffect(() => {
    Promise.all([
      fetch('/api/warehouses').then(r => r.json()),
      fetch('/api/catalog/master-skus').then(r => r.json()),
    ]).then(([wh, skus]) => {
      setWarehouses(wh)
      // Flatten master SKUs (parent + variants)
      const flat = (skus ?? []).flatMap((s: { id: string; name: string; variants?: Array<{ id: string; name: string }> }) =>
        [{ id: s.id, name: s.name }, ...(s.variants ?? []).map((v: { id: string; name: string }) => ({ id: v.id, name: v.name }))]
      )
      setMasterSkus(flat)
    }).catch(() => {
      toast.error('Failed to load reference data')
    })
  }, [])

  // Handle file upload
  const handleFilesSelected = useCallback(async (files: File[]) => {
    if (!selectedWarehouse) {
      toast.error('Please select a warehouse first')
      return
    }

    setUploadedFiles(files)
    setState('parsing')

    try {
      // Step 1: Parse all PDFs (pass fileIndex so cropper knows which source file)
      const allLabels: ParsedLabel[] = []
      for (let fi = 0; fi < files.length; fi++) {
        const labels = await parseLabelPdf(files[fi], fi)
        allLabels.push(...labels)
      }

      if (allLabels.length === 0) {
        toast.error('No valid Flipkart labels found in the uploaded PDFs')
        setState('idle')
        return
      }

      toast.success(`Parsed ${allLabels.length} labels from ${files.length} file(s)`)
      setState('resolving')

      // Step 2: Resolve SKUs via API
      const uniqueItems = Array.from(
        new Map(allLabels.map(l => [l.platformSku, { platformSku: l.platformSku, gstin: l.gstin }])).values()
      )

      const res = await fetch('/api/labels/resolve-skus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: uniqueItems }),
      })

      if (!res.ok) throw new Error('Failed to resolve SKUs')
      const { resolved: resolvedMap } = await res.json()

      // Build lookup from resolved items
      const skuLookup = new Map<string, {
        masterSkuId: string | null
        masterSkuName: string | null
        marketplaceAccountId: string | null
        organizationId: string | null
      }>()
      for (const r of resolvedMap) {
        skuLookup.set(r.platformSku, r)
      }

      // Step 3: Merge parsed labels with resolution data
      const resolved: ResolvedLabel[] = allLabels.map(label => {
        const match = skuLookup.get(label.platformSku)
        return {
          ...label,
          masterSkuId: match?.masterSkuId ?? null,
          masterSkuName: match?.masterSkuName ?? null,
          marketplaceAccountId: match?.marketplaceAccountId ?? null,
          organizationId: match?.organizationId ?? null,
        }
      })

      setResolvedLabels(resolved)

      // Step 4: Group by product
      const groups = groupLabelsByProduct(resolved)

      // Step 5: Collect unmapped
      const unmappedMap = new Map<string, UnmappedSku>()
      for (const label of resolved) {
        if (!label.masterSkuId) {
          const existing = unmappedMap.get(label.platformSku)
          if (existing) {
            existing.count++
            existing.pages.push({ fileIndex: label.fileIndex, pageIndex: label.pageIndex })
          } else {
            unmappedMap.set(label.platformSku, {
              platformSku: label.platformSku,
              productDescription: label.productDescription,
              count: 1,
              pages: [{ fileIndex: 0, pageIndex: label.pageIndex }],
            })
          }
        }
      }

      const result: LabelSortResult = {
        groups,
        unmapped: Array.from(unmappedMap.values()),
        totalLabels: resolved.length,
        stats: {
          totalOrders: resolved.length,
          codCount: resolved.filter(l => l.paymentType === 'COD').length,
          prepaidCount: resolved.filter(l => l.paymentType === 'PREPAID').length,
          orgBreakdown: Object.entries(
            resolved.reduce((acc, l) => {
              const name = l.sellerName || 'Unknown'
              acc[name] = (acc[name] || 0) + 1
              return acc
            }, {} as Record<string, number>)
          ).map(([orgName, count]) => ({ orgName, count })),
        },
      }

      setSortResult(result)
      setState('ready')
    } catch (e) {
      toast.error((e as Error).message)
      setState('idle')
    }
  }, [selectedWarehouse])

  // Download a single product group as cropped PDF
  async function handleDownloadGroup(group: LabelGroup) {
    try {
      const croppedPdfs = await cropAndGroupLabels([group], uploadedFiles)
      for (const [fileName, bytes] of croppedPdfs) {
        downloadPdf(bytes, `${fileName}.pdf`)
      }
    } catch (e) {
      toast.error('Failed to generate PDF')
    }
  }

  // Download all groups
  async function handleDownloadAll() {
    if (!sortResult) return
    try {
      const croppedPdfs = await cropAndGroupLabels(sortResult.groups, uploadedFiles)
      for (const [fileName, bytes] of croppedPdfs) {
        downloadPdf(bytes, `${fileName}.pdf`)
      }
      toast.success(`Downloaded ${croppedPdfs.size} PDFs`)
    } catch (e) {
      toast.error('Failed to generate PDFs')
    }
  }

  // Save order + dispatch data to DB
  async function handleIngest() {
    if (!sortResult || !selectedWarehouse) return

    setState('ingesting')
    try {
      const mappedLabels = resolvedLabels.filter(l => l.masterSkuId)
      const today = new Date().toISOString().split('T')[0]

      const res = await fetch('/api/labels/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouseId: selectedWarehouse,
          labels: mappedLabels.map(l => ({
            orderId: l.orderId,
            masterSkuId: l.masterSkuId,
            marketplaceAccountId: l.marketplaceAccountId,
            quantity: 1,
            salePrice: l.salePrice,
            paymentType: l.paymentType,
            platformSku: l.platformSku,
            dispatchDate: today,
            courier: l.courier,
            awbNumber: l.awbNumber,
          })),
        }),
      })

      if (!res.ok) throw new Error('Failed to save order data')
      const { created, skipped } = await res.json()
      toast.success(`Saved ${created} orders (${skipped} already existed)`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setState('ready')
    }
  }

  // Handle SKU mapping from unmapped panel
  function handleSkuMapped(platformSku: string, masterSkuId: string) {
    // Re-resolve: update the resolved labels and re-group
    const skuName = masterSkus.find(s => s.id === masterSkuId)?.name ?? ''
    const updated = resolvedLabels.map(l =>
      l.platformSku === platformSku
        ? { ...l, masterSkuId, masterSkuName: skuName }
        : l
    )
    setResolvedLabels(updated)

    // Re-group
    const groups = groupLabelsByProduct(updated)
    const unmappedMap = new Map<string, UnmappedSku>()
    for (const label of updated) {
      if (!label.masterSkuId) {
        const existing = unmappedMap.get(label.platformSku)
        if (existing) {
          existing.count++
        } else {
          unmappedMap.set(label.platformSku, {
            platformSku: label.platformSku,
            productDescription: label.productDescription,
            count: 1,
            pages: [{ fileIndex: label.fileIndex, pageIndex: label.pageIndex }],
          })
        }
      }
    }

    setSortResult(prev => prev ? {
      ...prev,
      groups,
      unmapped: Array.from(unmappedMap.values()),
    } : null)
  }

  // Reset to upload new files
  function handleReset() {
    setState('idle')
    setUploadedFiles([])
    setResolvedLabels([])
    setSortResult(null)
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Label Sorting</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload Flipkart label PDFs to sort by product for dispatch. Labels are cropped and grouped automatically.
          <InfoTooltip content="Upload the label PDFs you download from Flipkart Seller Hub. The system parses each label, matches it to your master catalog, and outputs sorted PDFs — one per product — ready for your label printer." />
        </p>
      </div>

      {/* Warehouse selector */}
      <div className="mb-6 max-w-xs">
        <label className="text-sm font-medium mb-1.5 block">
          Warehouse
          <InfoTooltip content="Select the warehouse these labels are being dispatched from. This info is not on the labels so you need to select it." />
        </label>
        <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse} disabled={state !== 'idle'}>
          <SelectTrigger>
            <SelectValue placeholder="Select warehouse..." />
          </SelectTrigger>
          <SelectContent>
            {warehouses.map(w => (
              <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Upload zone — only show when idle */}
      {state === 'idle' && (
        <LabelUploadZone
          onFilesSelected={handleFilesSelected}
          disabled={!selectedWarehouse}
        />
      )}

      {/* Loading states */}
      {state === 'parsing' && (
        <div className="text-center py-8 text-muted-foreground">
          Parsing label PDFs...
        </div>
      )}
      {state === 'resolving' && (
        <div className="text-center py-8 text-muted-foreground">
          Matching SKUs to master catalog...
        </div>
      )}

      {/* Results */}
      {(state === 'ready' || state === 'ingesting') && sortResult && (
        <div className="space-y-6">
          {/* Unmapped SKUs panel */}
          <UnmappedSkuPanel
            unmapped={sortResult.unmapped}
            masterSkus={masterSkus}
            userRole={userRole}
            onMapped={handleSkuMapped}
          />

          {/* Grouped labels table */}
          {sortResult.groups.length > 0 ? (
            <LabelPreviewTable
              result={sortResult}
              onDownloadGroup={handleDownloadGroup}
              onDownloadAll={handleDownloadAll}
            />
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No labels could be matched to products. Map the unknown SKUs above first.
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={handleReset}>
              Upload New Files
            </Button>
            {sortResult.groups.length > 0 && (
              <Button onClick={handleIngest} disabled={state === 'ingesting'}>
                {state === 'ingesting' ? 'Saving...' : `Save ${sortResult.groups.reduce((s, g) => s + g.count, 0)} Orders to Database`}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {state === 'idle' && !selectedWarehouse && (
        <div className="text-center py-8 text-muted-foreground text-sm mt-4">
          Select a warehouse above, then upload your Flipkart label PDFs to get started.
        </div>
      )}
    </div>
  )
}

/** Helper: trigger browser download of PDF bytes */
function downloadPdf(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 2: Add Labels nav item to sidebar**

Modify `src/components/layout/AppSidebar.tsx` — add a "Labels" entry between Packaging and COGS:
```typescript
// Add to imports:
import { Tags } from 'lucide-react'

// Add to navItems array after the Packaging entry:
{ href: '/labels', label: 'Labels', icon: Tags },
```

- [ ] **Step 3: Verify page compiles and renders**

```bash
npx tsc --noEmit
npm run dev
```
Navigate to `/labels`. Expected: warehouse dropdown + upload zone visible.

- [ ] **Step 4: Commit**

```bash
git add src/app/(dashboard)/labels/page.tsx src/components/layout/AppSidebar.tsx
git commit -m "feat: add Label Sorting page with full upload → parse → sort → download workflow"
```

---

## Chunk 5: Integration Testing + Deploy

### Task 14: End-to-end test with real PDF

- [ ] **Step 1: Test the full flow locally**

1. Start dev server: `npm run dev`
2. Navigate to `/labels`
3. Select a warehouse
4. Upload the sample Flipkart label PDF (`C:\Users\shash\Desktop\ilovepdf_merged.pdf`)
5. Verify: labels are parsed (check count matches 8 pages)
6. Verify: SKUs are resolved (check mapped vs unmapped)
7. Download a product group PDF — verify it contains only cropped labels (top half)
8. Click "Save Orders to Database" — verify orders appear in Supabase `orders` table
9. Re-upload the same PDF — verify duplicates are skipped ("N already existed")

- [ ] **Step 2: Fix any parsing issues**

The regex patterns in `pdf-parser.ts` were written based on the sample PDF. If parsing fails:
- Add `console.log(text)` in `extractLabelFields` to see raw text from pdf.js
- Adjust regex patterns to match actual text output
- Common issues: pdf.js may insert extra spaces, merge words, or reorder text

- [ ] **Step 3: Fix any PDF cropping issues**

If the cropped label includes part of the invoice or cuts off the label:
- Adjust the `height / 2` ratio in `pdf-cropper.ts`
- The dashed line separator position may not be exactly at 50% — check with the sample PDF and adjust the crop coordinates

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: adjust label parsing and cropping for Flipkart format"
```

### Task 15: Deploy

- [ ] **Step 1: Push to origin**

```bash
git push origin main
```

- [ ] **Step 2: Deploy to Hetzner**

```bash
ssh -i ~/.ssh/id_ed25519 -o StrictHostKeyChecking=no root@46.225.117.86 "cd /opt/fk-tool && bash deploy.sh"
```

- [ ] **Step 3: Verify on live site**

Navigate to https://ecommerceforall.in/labels and test with the sample PDF.

- [ ] **Step 4: Update project docs**

Update `docs/project-brain/ACTIVE.md` and `docs/project-brain/BUILD-TRACKER.md` to mark Phase 1.0 and Phase 1 as complete.

---

## Pre-flight Checks

### Warehouses API (likely already exists — DO NOT OVERWRITE)

The labels page calls `GET /api/warehouses`. Verify this endpoint exists:
```bash
ls src/app/api/warehouses/ 2>/dev/null || echo "NEEDS CREATION"
```

If it doesn't exist (unlikely), create `src/app/api/warehouses/route.ts` following the standard API pattern:
```typescript
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('warehouses')
      .select('id, name, location')
      .eq('tenant_id', tenantId)
      .order('name')
    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
```
