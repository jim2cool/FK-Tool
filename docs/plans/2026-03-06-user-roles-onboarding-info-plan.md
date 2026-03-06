# User Roles, Onboarding Checklist & Info Icons — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add team invites + roles, a getting-started checklist on the dashboard, and info-icon tooltips + helper text throughout the app.

**Architecture:** Three independent phases executed in order. Phase 1 (info icons) has zero DB changes. Phase 2 (checklist) needs one new column. Phase 3 (roles) needs one new table + auth callback route. No existing queries change in any phase — all additions are additive.

**Tech Stack:** Next.js 16 App Router, Supabase (postgres + supabase-js admin client), Radix UI Tooltip (already installed), Tailwind CSS v4, shadcn/ui components.

---

## Phase 1 — Info Icons & Helper Text

### Task 1: Create `InfoTooltip` component

**Files:**
- Create: `src/components/ui/info-tooltip.tsx`

**Step 1: Write the component**

```tsx
// src/components/ui/info-tooltip.tsx
'use client'
import { Info } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface InfoTooltipProps {
  content: string
  side?: 'top' | 'right' | 'bottom' | 'left'
}

export function InfoTooltip({ content, side = 'top' }: InfoTooltipProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help inline-block align-middle ml-1 shrink-0" />
        </TooltipTrigger>
        <TooltipContent side={side} className="max-w-xs text-xs leading-snug">
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
```

**Step 2: Type-check**
```bash
npx tsc --noEmit
```
Expected: no errors.

**Step 3: Commit**
```bash
git add src/components/ui/info-tooltip.tsx
git commit -m "feat(ui): add InfoTooltip component"
```

---

### Task 2: Add page subtitles and InfoTooltips to COGS page

**Files:**
- Modify: `src/app/(dashboard)/cogs/page.tsx`

**Step 1: Add subtitle under heading and data-missing banner**

Find the heading in the page (there will be an `<h2>` or similar). Add subtitle and a conditional banner. In `CogsPage`, after `cogsData` is loaded, add:

```tsx
// Near top of return, after the h2 heading block:
<div className="mb-6">
  <h2 className="text-2xl font-bold mb-1">COGS</h2>
  <p className="text-sm text-muted-foreground">
    Full cost per unit sold — built from purchases, freight, packaging and shrinkage.
  </p>
</div>

{cogsData.length === 0 && !loading && (
  <div className="rounded-md border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40 px-4 py-3 text-sm text-blue-800 dark:text-blue-300 mb-4">
    No purchases found. Import purchases under <strong>Purchases</strong> first to calculate COGS.
  </div>
)}
```

**Step 2: Add InfoTooltips to table headers and the expanded row**

Import `InfoTooltip` at the top of the file:
```tsx
import { InfoTooltip } from '@/components/ui/info-tooltip'
```

Add tooltips to table headers (in `<TableHead>` elements):
```tsx
// WAC Base column header
<TableHead className="text-right">
  WAC Base<InfoTooltip content="Weighted Average Cost base — purchase price averaged across all buy lots, weighted by quantity × price. Does not include freight." />
</TableHead>

// WAC Freight column header
<TableHead className="text-right">
  Freight/unit<InfoTooltip content="Inward freight allocated to this SKU's lots by proportional value, divided by units in the lot." />
</TableHead>

// Purchase COGS column header
<TableHead className="text-right">
  Purchase COGS<InfoTooltip content="WAC base + allocated freight/unit. Your landed cost before packaging and shrinkage." />
</TableHead>

// Dispatch COGS column header
<TableHead className="text-right">
  Dispatch COGS<InfoTooltip content="Packaging material cost per dispatch ÷ delivery rate. Accounts for packaging on orders that get returned." />
</TableHead>

// Shrinkage column header
<TableHead className="text-right">
  Shrinkage<InfoTooltip content="Expected stock loss (damage/spoilage/theft) expressed as a cost. Calculated as shrinkage rate × purchase COGS." />
</TableHead>
```

In the expanded row, add InfoTooltips next to the editable labels:
```tsx
// Next to "Delivery rate" label in the expanded breakdown:
<span className="text-muted-foreground flex items-center">
  Delivery rate
  <InfoTooltip content="Your historical ratio of dispatched orders that were successfully delivered (not returned). Edit to update — affects dispatch COGS for this SKU." side="right" />
</span>

// Next to "Shrinkage rate" label:
<span className="text-muted-foreground flex items-center">
  Shrinkage rate
  <InfoTooltip content="Expected % of purchased stock lost to damage, spoilage or theft. Edit to update — applied as a % of purchase COGS for this SKU." side="right" />
</span>
```

**Step 3: Type-check**
```bash
npx tsc --noEmit
```
Expected: no errors.

**Step 4: Commit**
```bash
git add src/app/\(dashboard\)/cogs/page.tsx
git commit -m "feat(cogs): add page subtitle, data-missing banner, InfoTooltips"
```

---

### Task 3: Add InfoTooltips to Purchases page

**Files:**
- Modify: `src/app/(dashboard)/purchases/page.tsx`

**Step 1: Read the file first to understand current structure**

The purchases page has a form for adding purchases. Find the "Unit purchase price" and "Tax paid" fields.

**Step 2: Add subtitle + InfoTooltips**

```tsx
// Subtitle under heading:
<p className="text-sm text-muted-foreground">
  Record inward stock purchases. These form the base of your COGS calculation.
</p>

// Next to Unit Purchase Price label:
<Label className="flex items-center">
  Unit Purchase Price (₹)
  <InfoTooltip content="Enter price excluding GST. You are GST-registered, so input tax credit means GST is not a cost — only the base price affects COGS." />
</Label>

// Next to Tax Paid label:
<Label className="flex items-center">
  Tax Paid
  <InfoTooltip content="Whether GST was charged on this invoice. Tracked for ITC reconciliation; does not affect COGS calculation." />
</Label>
```

**Step 3: Type-check and commit**
```bash
npx tsc --noEmit
git add src/app/\(dashboard\)/purchases/page.tsx
git commit -m "feat(purchases): add page subtitle and InfoTooltips"
```

---

### Task 4: Add InfoTooltips to Packaging page

**Files:**
- Modify: `src/app/(dashboard)/packaging/page.tsx`

**Step 1: Add subtitle + InfoTooltips**

```tsx
// Subtitle:
<p className="text-sm text-muted-foreground">
  Define packaging materials and configure how much each SKU uses per dispatch.
</p>

// Materials tab — next to Unit Cost label:
<Label className="flex items-center">
  Unit Cost (₹)
  <InfoTooltip content="Cost per unit of this material excluding GST. Used to compute dispatch COGS." />
</Label>

// SKU Specs tab — next to Qty per Dispatch label:
<Label className="flex items-center">
  Qty per Dispatch
  <InfoTooltip content="How many units of this material are consumed per single order dispatch for this SKU. Add one entry per material type." />
</Label>
```

**Step 2: Add empty state for materials tab** (if no materials yet):
```tsx
{materials.length === 0 && (
  <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
    No packaging materials defined yet. Add materials first, then configure how much each SKU uses per dispatch.
  </div>
)}
```

**Step 3: Type-check and commit**
```bash
npx tsc --noEmit
git add src/app/\(dashboard\)/packaging/page.tsx
git commit -m "feat(packaging): add subtitle, empty state banner, InfoTooltips"
```

---

### Task 5: Add InfoTooltips to Invoices page

**Files:**
- Modify: `src/app/(dashboard)/invoices/page.tsx`

**Step 1: Add subtitle + InfoTooltip on freight tab**

```tsx
// Subtitle:
<p className="text-sm text-muted-foreground">
  Log freight and packaging invoices. Freight is allocated to purchase lots to build accurate landed costs.
</p>

// Freight tab — next to "Purchase Invoice Number" label:
<Label className="flex items-center">
  Purchase Invoice Number
  <InfoTooltip content="Link this freight bill to a purchase invoice. The freight amount will be split across all lots in that purchase proportionally by their value." />
</Label>
```

**Step 2: Type-check and commit**
```bash
npx tsc --noEmit
git add src/app/\(dashboard\)/invoices/page.tsx
git commit -m "feat(invoices): add subtitle and InfoTooltips"
```

---

### Task 6: Add subtitles to remaining pages

**Files:**
- Modify: `src/app/(dashboard)/dashboard/page.tsx`
- Modify: `src/app/(dashboard)/catalog/page.tsx`
- Modify: `src/app/(dashboard)/imports/page.tsx`
- Modify: `src/app/(dashboard)/settings/page.tsx`

**Step 1: Add subtitles**

Dashboard:
```tsx
<h2 className="text-2xl font-bold mb-1">Dashboard</h2>
<p className="text-sm text-muted-foreground">Your workspace overview and setup progress.</p>
```

Catalog (read first to find the heading):
```tsx
<p className="text-sm text-muted-foreground">
  Define your products and variants. Everything else — purchases, COGS, orders — links back to these SKUs.
</p>
```

Imports:
```tsx
<p className="text-sm text-muted-foreground">
  Bulk-import orders and settlement data from your marketplace reports.
</p>
```

Settings (already has a subtitle — update it):
```tsx
<p className="text-muted-foreground text-sm">
  Manage warehouses, marketplace accounts, and your team.
</p>
```

**Step 2: Type-check and commit**
```bash
npx tsc --noEmit
git add src/app/\(dashboard\)/dashboard/page.tsx \
        src/app/\(dashboard\)/catalog/page.tsx \
        src/app/\(dashboard\)/imports/page.tsx \
        src/app/\(dashboard\)/settings/page.tsx
git commit -m "feat(pages): add page subtitles to all dashboard pages"
```

---

## Phase 2 — Getting Started Checklist

### Task 7: Add `onboarding_dismissed` to `user_profiles` (DB migration)

**Files:**
- Supabase migration (run in Supabase dashboard or via MCP tool)

**Step 1: Run migration**

```sql
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS onboarding_dismissed boolean NOT NULL DEFAULT false;
```

**Step 2: Update `database.ts` type**

In `src/types/database.ts`, add to the `UserProfile` interface (create it if it doesn't exist):
```ts
export interface UserProfile {
  id: string
  tenant_id: string
  email: string
  role: string
  onboarding_dismissed: boolean
  created_at: string
}
```

**Step 3: Type-check and commit**
```bash
npx tsc --noEmit
git add src/types/database.ts
git commit -m "feat(db): add onboarding_dismissed column to user_profiles"
```

---

### Task 8: Create checklist API route

**Files:**
- Create: `src/app/api/dashboard/checklist/route.ts`

**Step 1: Write the route**

```ts
// src/app/api/dashboard/checklist/route.ts
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()

    const [
      { count: skuCount },
      { count: purchaseCount },
      { count: warehouseCount },
      { count: accountCount },
      { count: freightCount },
      { count: materialCount },
      { count: skuConfigCount },
      { data: tenant },
      { data: profile },
    ] = await Promise.all([
      supabase.from('master_skus').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      supabase.from('purchases').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      supabase.from('warehouses').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      supabase.from('marketplace_accounts').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      supabase.from('freight_invoices').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      supabase.from('packaging_materials').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      supabase.from('sku_packaging_config').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      supabase.from('tenants').select('name').eq('id', tenantId).single(),
      supabase.from('user_profiles').select('onboarding_dismissed').eq('tenant_id', tenantId).maybeSingle(),
    ])

    return NextResponse.json({
      dismissed: profile?.onboarding_dismissed ?? false,
      steps: {
        workspace_named: tenant?.name !== 'My Workspace' && !!tenant?.name,
        has_accounts: (accountCount ?? 0) > 0,
        has_warehouse: (warehouseCount ?? 0) > 0,
        has_skus: (skuCount ?? 0) > 0,
        has_purchases: (purchaseCount ?? 0) > 0,
        has_freight: (freightCount ?? 0) > 0,
        has_materials: (materialCount ?? 0) > 0,
        has_sku_config: (skuConfigCount ?? 0) > 0,
      },
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 })
  }
}

export async function POST() {
  // Dismiss the checklist
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    await supabase.from('user_profiles')
      .update({ onboarding_dismissed: true })
      .eq('id', user.id)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 })
  }
}
```

**Step 2: Type-check and commit**
```bash
npx tsc --noEmit
git add src/app/api/dashboard/checklist/route.ts
git commit -m "feat(api): add dashboard checklist route"
```

---

### Task 9: Build the checklist card component

**Files:**
- Create: `src/components/dashboard/getting-started.tsx`

**Step 1: Write the component**

```tsx
// src/components/dashboard/getting-started.tsx
'use client'
import { useEffect, useState } from 'react'
import { CheckCircle2, Circle, ExternalLink, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

interface ChecklistSteps {
  workspace_named: boolean
  has_accounts: boolean
  has_warehouse: boolean
  has_skus: boolean
  has_purchases: boolean
  has_freight: boolean
  has_materials: boolean
  has_sku_config: boolean
}

const STEPS = [
  {
    key: 'workspace_named' as keyof ChecklistSteps,
    label: 'Name your workspace',
    description: 'Give your business a name in Settings.',
    href: '/settings',
    critical: true,
  },
  {
    key: 'has_accounts' as keyof ChecklistSteps,
    label: 'Add marketplace accounts',
    description: 'Connect your Flipkart, Amazon or D2C accounts.',
    href: '/settings',
    critical: true,
  },
  {
    key: 'has_warehouse' as keyof ChecklistSteps,
    label: 'Add a warehouse',
    description: 'At least one warehouse is needed to record purchases.',
    href: '/settings',
    critical: true,
  },
  {
    key: 'has_skus' as keyof ChecklistSteps,
    label: 'Add products to Master Catalog',
    description: 'Import or manually add your product SKUs.',
    href: '/catalog',
    critical: true,
  },
  {
    key: 'has_purchases' as keyof ChecklistSteps,
    label: 'Import purchases',
    description: 'Record your inward stock purchases to compute COGS.',
    href: '/purchases',
    critical: true,
  },
  {
    key: 'has_freight' as keyof ChecklistSteps,
    label: 'Add freight invoices',
    description: 'Optional — improves COGS accuracy with landed freight cost.',
    href: '/invoices',
    critical: false,
  },
  {
    key: 'has_materials' as keyof ChecklistSteps,
    label: 'Set up packaging materials',
    description: 'Optional — add packaging costs to dispatch COGS.',
    href: '/packaging',
    critical: false,
  },
  {
    key: 'has_sku_config' as keyof ChecklistSteps,
    label: 'Configure SKU packaging specs',
    description: 'Optional — specify which materials each SKU uses per dispatch.',
    href: '/packaging',
    critical: false,
  },
]

export function GettingStarted() {
  const [steps, setSteps] = useState<ChecklistSteps | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [dismissing, setDismissing] = useState(false)

  useEffect(() => {
    fetch('/api/dashboard/checklist')
      .then(r => r.json())
      .then(d => {
        setSteps(d.steps)
        setDismissed(d.dismissed)
      })
  }, [])

  async function dismiss() {
    setDismissing(true)
    await fetch('/api/dashboard/checklist', { method: 'POST' })
    setDismissed(true)
  }

  if (!steps || dismissed) return null

  const completedCount = Object.values(steps).filter(Boolean).length
  const criticalDone = STEPS.filter(s => s.critical).every(s => steps[s.key])
  const allDone = completedCount === STEPS.length

  return (
    <div className="rounded-lg border bg-card p-5 mb-6">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-base">Getting started</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            {completedCount} of {STEPS.length} steps complete
            {criticalDone && !allDone && ' · All critical steps done ✓'}
          </p>
        </div>
        <Button
          variant="ghost" size="sm"
          className="h-7 w-7 p-0 text-muted-foreground"
          onClick={dismiss}
          disabled={dismissing}
          title="Dismiss"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-muted rounded-full h-1.5 mb-4">
        <div
          className="bg-primary h-1.5 rounded-full transition-all"
          style={{ width: `${(completedCount / STEPS.length) * 100}%` }}
        />
      </div>

      <div className="space-y-2">
        {STEPS.map(step => {
          const done = steps[step.key]
          return (
            <div key={step.key} className="flex items-start gap-3">
              {done
                ? <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                : <Circle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              }
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm ${done ? 'line-through text-muted-foreground' : 'font-medium'}`}>
                    {step.label}
                    {!step.critical && <span className="ml-1 text-xs text-muted-foreground font-normal">(optional)</span>}
                  </span>
                  {!done && (
                    <Link href={step.href} className="text-primary text-xs flex items-center gap-0.5 hover:underline">
                      Go <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                </div>
                {!done && (
                  <p className="text-xs text-muted-foreground">{step.description}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

**Step 2: Type-check and commit**
```bash
npx tsc --noEmit
git add src/components/dashboard/getting-started.tsx
git commit -m "feat(dashboard): add GettingStarted checklist component"
```

---

### Task 10: Wire checklist into Dashboard page

**Files:**
- Modify: `src/app/(dashboard)/dashboard/page.tsx`

**Step 1: Replace dashboard page content**

```tsx
// src/app/(dashboard)/dashboard/page.tsx
import { GettingStarted } from '@/components/dashboard/getting-started'

export default function DashboardPage() {
  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-1">Dashboard</h2>
        <p className="text-sm text-muted-foreground">Your workspace overview and setup progress.</p>
      </div>
      <GettingStarted />
    </div>
  )
}
```

**Step 2: Type-check and commit**
```bash
npx tsc --noEmit
git add src/app/\(dashboard\)/dashboard/page.tsx
git commit -m "feat(dashboard): wire GettingStarted checklist into dashboard"
```

---

## Phase 3 — User Roles & Team Management

### Task 11: Create `workspace_members` table (DB migration)

**Step 1: Run the migration via Supabase MCP or dashboard**

```sql
CREATE TABLE workspace_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES auth.users(id),
  invited_email text NOT NULL,
  role          text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  status        text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'active')),
  invited_by    uuid NOT NULL REFERENCES auth.users(id),
  invited_at    timestamptz NOT NULL DEFAULT now(),
  joined_at     timestamptz,
  UNIQUE (tenant_id, invited_email)
);

-- RLS: authenticated users can read their own rows
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can read own workspace"
  ON workspace_members FOR SELECT
  USING (user_id = auth.uid() OR invited_email = (SELECT email FROM auth.users WHERE id = auth.uid()));
```

**Step 2: Backfill owner rows for existing users**

```sql
-- Every existing user_profile owner gets an 'active' workspace_members row
INSERT INTO workspace_members (tenant_id, user_id, invited_email, role, status, invited_by, joined_at)
SELECT
  up.tenant_id,
  up.id,
  up.email,
  'owner',
  'active',
  up.id,
  up.created_at
FROM user_profiles up
ON CONFLICT (tenant_id, invited_email) DO NOTHING;
```

**Step 3: Also insert owner row in the existing setup API**

Modify `src/app/api/setup/route.ts` — after creating the user_profile, add:
```ts
// After the user_profiles insert succeeds:
const { error: memberError } = await admin.from('workspace_members').insert({
  tenant_id: tenant.id,
  user_id: user.id,
  invited_email: user.email!,
  role: 'owner',
  status: 'active',
  invited_by: user.id,
  joined_at: new Date().toISOString(),
})
if (memberError) return NextResponse.json({ error: memberError.message }, { status: 500 })
```

**Step 4: Add `WorkspaceMember` type to `src/types/database.ts`**

```ts
export interface WorkspaceMember {
  id: string
  tenant_id: string
  user_id: string | null
  invited_email: string
  role: 'owner' | 'editor' | 'viewer'
  status: 'pending' | 'active'
  invited_by: string
  invited_at: string
  joined_at: string | null
}
```

**Step 5: Type-check and commit**
```bash
npx tsc --noEmit
git add src/app/api/setup/route.ts src/types/database.ts
git commit -m "feat(db): add workspace_members table + backfill owners + update setup API"
```

---

### Task 12: Create `getRole()` helper and `withRole()` wrapper

**Files:**
- Create: `src/lib/db/roles.ts`

**Step 1: Write the helper**

```ts
// src/lib/db/roles.ts
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'

export type Role = 'owner' | 'editor' | 'viewer'

const ROLE_RANK: Record<Role, number> = { owner: 3, editor: 2, viewer: 1 }

export async function getRole(): Promise<Role> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const tenantId = await getTenantId()
  const { data } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .single()

  return (data?.role as Role) ?? 'viewer'
}

type RouteHandler = (req: Request, ctx?: unknown) => Promise<NextResponse>

export function withRole(minRole: Role, handler: RouteHandler): RouteHandler {
  return async (req, ctx) => {
    try {
      const role = await getRole()
      if (ROLE_RANK[role] < ROLE_RANK[minRole]) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      return handler(req, ctx)
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
}
```

**Step 2: Apply `withRole('editor', ...)` wrapper to all write handlers**

Every API route that has `POST`, `PATCH`, or `DELETE` needs to be wrapped. The list of routes to update:

- `src/app/api/warehouses/route.ts` — wrap `POST` and `DELETE`
- `src/app/api/marketplace-accounts/route.ts` — wrap `POST` and `DELETE`
- `src/app/api/catalog/import-csv/route.ts` — wrap `POST`
- `src/app/api/purchases/route.ts` — wrap `POST`
- `src/app/api/purchases/import-csv/route.ts` — wrap `POST`
- `src/app/api/freight-invoices/route.ts` — wrap `POST`, `PATCH`, `DELETE`
- `src/app/api/packaging/materials/route.ts` — wrap `POST`, `PATCH`, `DELETE`
- `src/app/api/packaging/sku-config/route.ts` — wrap `POST`, `DELETE`
- `src/app/api/packaging/purchases/route.ts` — wrap `POST`, `DELETE`

**Pattern for each (example with warehouses):**

```ts
// Before:
export async function POST(request: Request) {
  try {
    // ... existing code
  } catch (e) { ... }
}

// After:
import { withRole } from '@/lib/db/roles'

export const POST = withRole('editor', async (request: Request) => {
  try {
    // ... exact same existing code, unchanged
  } catch (e) { ... }
})

export const DELETE = withRole('editor', async (request: Request) => {
  // ... same
})
```

**Step 3: Type-check and commit**
```bash
npx tsc --noEmit
git add src/lib/db/roles.ts src/app/api/
git commit -m "feat(roles): add getRole/withRole helpers; apply editor guard to all write routes"
```

---

### Task 13: Create `useRole()` client hook

**Files:**
- Create: `src/hooks/use-role.ts`

**Step 1: Write the hook**

```ts
// src/hooks/use-role.ts
'use client'
import { useEffect, useState } from 'react'
import type { Role } from '@/lib/db/roles'

export function useRole() {
  const [role, setRole] = useState<Role | null>(null)

  useEffect(() => {
    fetch('/api/me/role')
      .then(r => r.json())
      .then(d => setRole(d.role ?? 'viewer'))
      .catch(() => setRole('viewer'))
  }, [])

  return {
    role,
    isOwner: role === 'owner',
    canEdit: role === 'owner' || role === 'editor',
    isViewer: role === 'viewer',
  }
}
```

**Step 2: Create the `/api/me/role` route**

```ts
// src/app/api/me/role/route.ts
import { getRole } from '@/lib/db/roles'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const role = await getRole()
    return NextResponse.json({ role })
  } catch {
    return NextResponse.json({ role: 'viewer' })
  }
}
```

**Step 3: Type-check and commit**
```bash
npx tsc --noEmit
git add src/hooks/use-role.ts src/app/api/me/role/route.ts
git commit -m "feat(roles): add useRole hook and /api/me/role endpoint"
```

---

### Task 14: Add Team tab to Settings page

**Files:**
- Modify: `src/app/(dashboard)/settings/page.tsx`
- Create: `src/app/api/team/route.ts`

**Step 1: Create the team API route**

```ts
// src/app/api/team/route.ts
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTenantId } from '@/lib/db/tenant'
import { getRole, withRole } from '@/lib/db/roles'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { data } = await supabase
      .from('workspace_members')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('invited_at')
    return NextResponse.json(data ?? [])
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 })
  }
}

// POST: invite a new member — owner only
export const POST = withRole('owner', async (request: Request) => {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const admin = createAdminClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { email, role } = await request.json()
    if (!email || !['editor', 'viewer'].includes(role)) {
      return NextResponse.json({ error: 'Invalid email or role' }, { status: 400 })
    }

    // Check if already invited
    const { data: existing } = await supabase
      .from('workspace_members')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('invited_email', email)
      .maybeSingle()
    if (existing) return NextResponse.json({ error: 'This email has already been invited' }, { status: 400 })

    // Check if email already has their own workspace (block for now)
    const { data: existingProfile } = await admin
      .from('user_profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle()
    if (existingProfile) {
      return NextResponse.json(
        { error: 'This user already has a workspace. Multi-workspace support is coming soon.' },
        { status: 400 }
      )
    }

    // Insert pending member row
    await admin.from('workspace_members').insert({
      tenant_id: tenantId,
      invited_email: email,
      role,
      status: 'pending',
      invited_by: user.id,
    })

    // Send Supabase invite email with metadata
    const { data: tenant } = await supabase.from('tenants').select('name').eq('id', tenantId).single()
    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      data: {
        invited_tenant_id: tenantId,
        invited_role: role,
        workspace_name: tenant?.name ?? 'FK Tool',
      },
    })
    if (inviteError) {
      // Roll back the member row
      await admin.from('workspace_members').delete().eq('tenant_id', tenantId).eq('invited_email', email)
      return NextResponse.json({ error: inviteError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
})

// DELETE: remove a member — owner only
export const DELETE = withRole('owner', async (request: Request) => {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const admin = createAdminClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { memberId } = await request.json()

    const { data: member } = await supabase
      .from('workspace_members')
      .select('role, user_id')
      .eq('id', memberId)
      .eq('tenant_id', tenantId)
      .single()

    if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    if (member.role === 'owner') return NextResponse.json({ error: 'Cannot remove the owner' }, { status: 400 })

    await admin.from('workspace_members').delete().eq('id', memberId)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
})
```

**Step 2: Add Team tab to Settings page**

The settings page currently has two cards (Warehouses, Marketplace Accounts). Wrap the page in `Tabs` (already installed in shadcn/ui). Add a third tab "Team".

At the top of the file add imports:
```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useRole } from '@/hooks/use-role'
import type { WorkspaceMember } from '@/types/database'
```

Add state for team:
```tsx
const { isOwner } = useRole()
const [members, setMembers] = useState<WorkspaceMember[]>([])
const [inviteEmail, setInviteEmail] = useState('')
const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('editor')
const [inviting, setInviting] = useState(false)

const loadMembers = useCallback(async () => {
  const res = await fetch('/api/team')
  if (res.ok) setMembers(await res.json())
}, [])

// Add to useEffect: loadMembers()
```

Add invite and remove handlers:
```tsx
async function inviteMember(e: React.FormEvent) {
  e.preventDefault()
  setInviting(true)
  const res = await fetch('/api/team', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
  })
  const data = await res.json()
  if (res.ok) {
    toast.success('Invite sent!')
    setInviteEmail('')
    loadMembers()
  } else {
    toast.error(data.error)
  }
  setInviting(false)
}

async function removeMember(memberId: string) {
  const res = await fetch('/api/team', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memberId }),
  })
  if (res.ok) {
    toast.success('Member removed')
    loadMembers()
  }
}
```

Wrap the return in Tabs:
```tsx
return (
  <div className="max-w-2xl space-y-6">
    <div>
      <h2 className="text-2xl font-bold mb-1">Settings</h2>
      <p className="text-muted-foreground text-sm">Manage warehouses, marketplace accounts, and your team.</p>
    </div>

    <Tabs defaultValue="workspace">
      <TabsList>
        <TabsTrigger value="workspace">Workspace</TabsTrigger>
        <TabsTrigger value="team">Team</TabsTrigger>
      </TabsList>

      <TabsContent value="workspace" className="space-y-6 mt-4">
        {/* Existing Warehouses card */}
        {/* Existing Marketplace Accounts card */}
      </TabsContent>

      <TabsContent value="team" className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Team members</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {members.length === 0 && (
              <p className="text-sm text-muted-foreground">No team members yet.</p>
            )}
            {members.map(m => (
              <div key={m.id} className="flex items-center justify-between py-1">
                <div>
                  <p className="text-sm font-medium">{m.invited_email}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge variant={m.role === 'owner' ? 'default' : 'outline'} className="text-xs capitalize">
                      {m.role}
                    </Badge>
                    {m.status === 'pending' && (
                      <span className="text-xs text-muted-foreground">Invite pending</span>
                    )}
                  </div>
                </div>
                {isOwner && m.role !== 'owner' && (
                  <Button variant="ghost" size="sm" className="text-destructive"
                    onClick={() => removeMember(m.id)}>Remove</Button>
                )}
              </div>
            ))}

            {isOwner && (
              <>
                <Separator />
                <form onSubmit={inviteMember} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Email</Label>
                      <Input type="email" value={inviteEmail}
                        onChange={e => setInviteEmail(e.target.value)}
                        placeholder="colleague@example.com" required />
                    </div>
                    <div className="space-y-1">
                      <Label>Role</Label>
                      <select
                        value={inviteRole}
                        onChange={e => setInviteRole(e.target.value as 'editor' | 'viewer')}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                      >
                        <option value="editor">Editor — full data access</option>
                        <option value="viewer">Viewer — read only</option>
                      </select>
                    </div>
                  </div>
                  <Button type="submit" size="sm" disabled={inviting}>
                    {inviting ? 'Sending invite…' : 'Send invite'}
                  </Button>
                </form>
              </>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  </div>
)
```

**Step 3: Type-check and commit**
```bash
npx tsc --noEmit
git add src/app/api/team/route.ts src/app/\(dashboard\)/settings/page.tsx
git commit -m "feat(team): add Team tab to Settings with invite + member management"
```

---

### Task 15: Handle invite acceptance — auth callback route

When an invited user clicks their email link, Supabase redirects to `/auth/callback`. We need this route to:
1. Exchange the token
2. Read the invite metadata
3. Create `user_profiles` with the invited `tenant_id`
4. Update `workspace_members` to `active`
5. Redirect to dashboard

**Files:**
- Create: `src/app/auth/callback/route.ts`

**Step 1: Write the callback handler**

```ts
// src/app/auth/callback/route.ts
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  const user = data.user
  const meta = user.user_metadata as {
    invited_tenant_id?: string
    invited_role?: string
  }

  // If this was an invite, complete the workspace onboarding
  if (meta?.invited_tenant_id) {
    const admin = createAdminClient()

    // Create user_profiles pointing to the inviter's tenant
    const { error: profileError } = await admin.from('user_profiles').upsert({
      id: user.id,
      tenant_id: meta.invited_tenant_id,
      email: user.email!,
      role: meta.invited_role ?? 'viewer',
      onboarding_dismissed: true, // invited users skip the checklist
    })

    if (!profileError) {
      // Activate the workspace_members row
      await admin.from('workspace_members')
        .update({ user_id: user.id, status: 'active', joined_at: new Date().toISOString() })
        .eq('tenant_id', meta.invited_tenant_id)
        .eq('invited_email', user.email!)
    }
  }

  return NextResponse.redirect(`${origin}/dashboard`)
}
```

**Step 2: Update middleware to allow `/auth/callback`**

In `src/middleware.ts`, add to the unprotected routes:
```ts
const isAuthRoute = request.nextUrl.pathname.startsWith('/login') ||
                    request.nextUrl.pathname.startsWith('/auth/callback')
```

**Step 3: Type-check and commit**
```bash
npx tsc --noEmit
git add src/app/auth/callback/route.ts src/middleware.ts
git commit -m "feat(auth): add invite callback route; handle workspace onboarding for invited users"
```

---

### Task 16: Hide write actions for Viewers in UI

**Files:**
- Modify: key pages that have add/edit/delete buttons

The `useRole()` hook returns `canEdit`. Use it to conditionally render write actions.

**Pattern (apply to each page):**
```tsx
const { canEdit } = useRole()

// Wrap add/edit/delete buttons:
{canEdit && <Button onClick={...}>Add Item</Button>}
{canEdit && <Button variant="ghost" onClick={() => deleteItem(id)}>Remove</Button>}
```

**Pages to update:**
- `src/app/(dashboard)/purchases/page.tsx` — hide Add Purchase form, hide delete buttons
- `src/app/(dashboard)/catalog/page.tsx` — hide Import CSV, hide delete
- `src/app/(dashboard)/invoices/page.tsx` — hide Add Invoice forms
- `src/app/(dashboard)/packaging/page.tsx` — hide Add Material / Add Config forms
- `src/app/(dashboard)/settings/page.tsx` — Workspace tab: hide Add Warehouse / Add Account forms for non-owners (editors can still see but not modify settings; adjust to taste — owners only for settings makes sense)

**Step 2: Type-check and commit**
```bash
npx tsc --noEmit
git add src/app/\(dashboard\)/
git commit -m "feat(roles): hide write actions for Viewer role across all pages"
```

---

### Task 17: Final type-check, deploy

**Step 1: Full type-check**
```bash
npx tsc --noEmit
```
Expected: 0 errors.

**Step 2: Push and deploy**
```bash
git push origin main
ssh -i ~/.ssh/id_ed25519 -o StrictHostKeyChecking=no root@46.225.117.86 "cd /opt/fk-tool && bash deploy.sh"
```

**Step 3: Smoke test on live site**
- [ ] Visit `/dashboard` → checklist card visible with correct step statuses
- [ ] Visit `/cogs` → subtitle visible, info icons on table headers, tooltips show on hover
- [ ] Visit `/settings` → Team tab visible, invite form present
- [ ] Invite a test email → confirm "Invite sent" toast appears
- [ ] Visit any page as Viewer (set role directly in DB) → write buttons hidden

---

## Summary

| Phase | Tasks | Key files |
|-------|-------|-----------|
| Phase 1 — Info Icons | 1–6 | `info-tooltip.tsx`, all page files |
| Phase 2 — Checklist | 7–10 | `getting-started.tsx`, `api/dashboard/checklist/route.ts` |
| Phase 3 — Roles | 11–17 | `roles.ts`, `api/team/route.ts`, `settings/page.tsx`, `auth/callback/route.ts` |
