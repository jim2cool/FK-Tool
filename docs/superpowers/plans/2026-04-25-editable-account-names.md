# Editable Account Names Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the ability to rename a marketplace account from Settings while keeping the previous name(s) on record, with concurrent-edit detection and DB-level uniqueness enforcement.

**Architecture:** One Supabase migration (column + length check + unique index, gated by a duplicate pre-flight). One PATCH endpoint with normalisation, stale-write protection, and recycle-name confirmation. One existing POST endpoint updated to map Postgres 23505 to friendly 409. New `EditAccountDialog` component with previous-names history list. Pencil icon added to the existing accounts list.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (Postgres), shadcn/ui (Dialog, Input, Tooltip), existing `<InfoTooltip>` component, sonner toasts. No new dependencies. No test framework currently in repo — verification is type-check + manual smoke test on live site (matches the Daily P&L v1 deployment pattern).

**Spec source of truth:** `docs/superpowers/specs/2026-04-25-editable-account-names-design.md`

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `supabase/migrations/<timestamp>_marketplace_account_history.sql` | DB column + length check + unique index, with duplicate pre-flight |
| `src/lib/marketplace-accounts/normalize.ts` | Pure function: trim + collapse internal whitespace; small enough to live in one focused file |
| `src/components/settings/EditAccountDialog.tsx` | Modal: name input, previous-names list, recycle-warning confirm, error states |

### Existing files to modify

| File | Change |
|---|---|
| `src/types/database.ts` | Add `previous_names: PreviousName[]` to `MarketplaceAccount`; add `PreviousName` type |
| `src/app/api/marketplace-accounts/route.ts` | Add `PATCH` handler; map POST 23505 errors to friendly 409 |
| `src/app/(dashboard)/settings/page.tsx` | Pencil icon + dialog wiring + `<InfoTooltip>` next to renamed accounts |

### File-size note

The current `route.ts` is small (43 lines). Adding PATCH brings it to ~120 lines — still focused, no need to split.
The Settings `page.tsx` is ~220 lines today. Adding the pencil + dialog import brings it to ~250 — acceptable; matches existing pattern.

---

## Chunk 1: DB migration + types

### Task 1: Pre-flight duplicate check on production

**Manual step — do BEFORE running the migration.** Confirms there are no existing duplicates that would block the unique-index creation.

- [ ] **Step 1: Run the duplicate-check SQL via Supabase MCP**

```sql
SELECT tenant_id, platform, lower(account_name) AS normalized_name, COUNT(*) AS dup_count
FROM marketplace_accounts
GROUP BY tenant_id, platform, lower(account_name)
HAVING COUNT(*) > 1;
```

Expected output: zero rows. If any rows are returned, STOP and surface the conflicts to the user (they need to manually rename one of each duplicate group via the existing add/delete flow before this migration can run).

- [ ] **Step 2: Confirm clear or escalate**

If clear, proceed to Task 2. If duplicates found, halt with a clear message: "Migration blocked: <N> duplicate name groups in marketplace_accounts. List: ..."

### Task 2: Create the migration

**Files:**
- Create: `supabase/migrations/<timestamp>_marketplace_account_history.sql` (run via Supabase MCP `apply_migration`)

- [ ] **Step 1: Apply the migration via Supabase MCP**

Use `mcp__7503a887-f115-435f-8429-f7341857e2a4__apply_migration` (project `aorcopafrixqlbgckrpu`) with name `marketplace_account_history` and the following SQL:

```sql
-- Step 1: add the new column
ALTER TABLE marketplace_accounts
  ADD COLUMN previous_names JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Step 2: pre-flight duplicate check (defensive — should already be clean from Task 1)
DO $$
DECLARE dup_count INT;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT 1 FROM marketplace_accounts
    GROUP BY tenant_id, platform, lower(account_name)
    HAVING COUNT(*) > 1
  ) d;

  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add unique index: % duplicate (tenant_id, platform, lower(account_name)) groups exist. Resolve manually before running this migration.',
      dup_count;
  END IF;
END $$;

-- Step 3: length check
ALTER TABLE marketplace_accounts
  ADD CONSTRAINT account_name_length_check
    CHECK (char_length(account_name) BETWEEN 1 AND 100);

-- Step 4: case-insensitive uniqueness per (tenant, platform)
CREATE UNIQUE INDEX marketplace_accounts_unique_name_per_platform
  ON marketplace_accounts (tenant_id, platform, lower(account_name));
```

- [ ] **Step 2: Verify the column was added**

Use `mcp__7503a887-f115-435f-8429-f7341857e2a4__list_tables` filtering on `marketplace_accounts`. Confirm `previous_names` column exists with type `jsonb`, default `[]`.

- [ ] **Step 3: Verify the unique index exists**

Use `mcp__7503a887-f115-435f-8429-f7341857e2a4__execute_sql`:
```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'marketplace_accounts'
  AND indexname = 'marketplace_accounts_unique_name_per_platform';
```

Expected: one row with the index definition matching `(tenant_id, platform, lower(account_name))`.

> **No commit for this task** — DB migrations don't live in the repo's git history (they live in Supabase's migration log).

### Task 3: Update TypeScript types

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Read the current file to find the MarketplaceAccount interface**

Use Grep to locate `interface MarketplaceAccount` in `src/types/database.ts`.

- [ ] **Step 2: Add `PreviousName` type and `previous_names` field**

Modify the file. Insert this type definition immediately above the `MarketplaceAccount` interface:

```typescript
export interface PreviousName {
  name: string
  changed_at: string  // ISO 8601 UTC timestamp
}
```

Inside the `MarketplaceAccount` interface, add this field after `created_at`:

```typescript
  previous_names: PreviousName[]
```

The full updated interface should be:

```typescript
export interface MarketplaceAccount {
  id: string
  tenant_id: string
  platform: Platform
  account_name: string
  mode: ConnectorMode
  organization_id: string | null
  created_at: string
  previous_names: PreviousName[]
}
```

- [ ] **Step 3: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: no errors. (The new field is on a server-fetched object that's already type-asserted via `MarketplaceAccount`; existing code that doesn't reference `previous_names` is unaffected.)

- [ ] **Step 4: Commit**

```bash
git add src/types/database.ts
git commit -m "types: add previous_names to MarketplaceAccount + new PreviousName type"
```

---

## Chunk 2: Server-side — normalize helper, PATCH endpoint, POST friendly errors

### Task 4: Name normalization helper

**Files:**
- Create: `src/lib/marketplace-accounts/normalize.ts`

- [ ] **Step 1: Create the helper file**

Write the full content of `src/lib/marketplace-accounts/normalize.ts`:

```typescript
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
```

- [ ] **Step 2: Verify type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Smoke-test the helper from a Node REPL**

Run an inline Node script to verify behaviour:
```bash
node -e "
const { normalizeAccountName } = require('./src/lib/marketplace-accounts/normalize.ts');
console.log(normalizeAccountName('  NuvioStore  '));   // 'NuvioStore'
console.log(normalizeAccountName('Nuvio  Store'));     // 'Nuvio Store'
console.log(normalizeAccountName('   '));              // null
console.log(normalizeAccountName(''));                 // null
console.log(normalizeAccountName('a'.repeat(101)));    // null
console.log(normalizeAccountName('a'.repeat(100)));    // 'aaaa...' (100 chars)
"
```

> **Note:** if running TS directly via node fails, transpile via `npx tsx` or skip this step and rely on the type-check + manual smoke test in Task 11 to validate. Don't add a test framework just for this — matches the codebase pattern.

- [ ] **Step 4: Commit**

```bash
git add src/lib/marketplace-accounts/normalize.ts
git commit -m "feat(accounts): add normalizeAccountName helper (trim + collapse + length)"
```

### Task 5: Add PATCH endpoint with stale-write + recycle confirmation

**Files:**
- Modify: `src/app/api/marketplace-accounts/route.ts`

- [ ] **Step 1: Read the current file**

Use Read on `src/app/api/marketplace-accounts/route.ts` to see the existing GET/POST/DELETE handlers.

- [ ] **Step 2: Add the PATCH handler**

Append to the bottom of `src/app/api/marketplace-accounts/route.ts`:

```typescript
import { normalizeAccountName } from '@/lib/marketplace-accounts/normalize'

interface PatchBody {
  id?: string
  account_name?: string
  expected_current_name?: string
  force_recycle?: boolean
}

export async function PATCH(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const body = (await request.json()) as PatchBody

    // Validation
    if (!body.id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }
    const normalizedNew = normalizeAccountName(body.account_name)
    if (!normalizedNew) {
      return NextResponse.json(
        { error: 'account_name is required and must be 1–100 characters after normalization' },
        { status: 400 },
      )
    }
    const normalizedExpected = normalizeAccountName(body.expected_current_name)
    if (!normalizedExpected) {
      return NextResponse.json(
        { error: 'expected_current_name is required for stale-write detection' },
        { status: 400 },
      )
    }

    // Read current row, scoped to tenant
    const { data: current, error: readErr } = await supabase
      .from('marketplace_accounts')
      .select('id, tenant_id, platform, account_name, previous_names')
      .eq('id', body.id)
      .eq('tenant_id', tenantId)
      .single()

    if (readErr || !current) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    // Stale-write check
    const currentName = current.account_name
    if (normalizeAccountName(currentName) !== normalizedExpected) {
      return NextResponse.json(
        { error: 'stale_edit', current_name: currentName },
        { status: 409 },
      )
    }

    // Idempotent: if normalized new name == current, just return current row
    if (normalizedNew === normalizeAccountName(currentName)) {
      return NextResponse.json(current)
    }

    // Recycle-name warning (skip if force_recycle)
    if (!body.force_recycle) {
      const { data: recycleConflicts } = await supabase
        .from('marketplace_accounts')
        .select('id, account_name, previous_names')
        .eq('tenant_id', tenantId)
        .eq('platform', current.platform)
        .neq('id', body.id)

      type Row = { id: string; account_name: string; previous_names: { name: string; changed_at: string }[] }
      const conflict = (recycleConflicts as Row[] | null)?.find(r =>
        (r.previous_names ?? []).some(prev =>
          normalizeAccountName(prev.name) === normalizedNew,
        ),
      )
      if (conflict) {
        return NextResponse.json(
          {
            warning: 'name_recently_used_by_another_account',
            conflicting_account_name: conflict.account_name,
            expected_current_name: currentName,
          },
          { status: 200 },
        )
      }
    }

    // Append old name + update; the unique index enforces concurrency safety
    const newPreviousNames = [
      ...(current.previous_names ?? []),
      { name: currentName, changed_at: new Date().toISOString() },
    ]

    const { data: updated, error: updateErr } = await supabase
      .from('marketplace_accounts')
      .update({ account_name: normalizedNew, previous_names: newPreviousNames })
      .eq('id', body.id)
      .eq('tenant_id', tenantId)
      .select()
      .single()

    if (updateErr) {
      // Postgres unique-violation = 23505
      if ((updateErr as { code?: string }).code === '23505') {
        return NextResponse.json(
          { error: 'name_already_in_use', account_name: normalizedNew },
          { status: 409 },
        )
      }
      throw updateErr
    }

    return NextResponse.json(updated)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
```

- [ ] **Step 3: Verify type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/marketplace-accounts/route.ts
git commit -m "feat(accounts): PATCH endpoint with stale-write + recycle-name protection"
```

### Task 6: Update POST endpoint for friendly unique-violation errors

**Files:**
- Modify: `src/app/api/marketplace-accounts/route.ts`

- [ ] **Step 1: Update the POST handler**

Replace the existing POST handler in `src/app/api/marketplace-accounts/route.ts` with:

```typescript
export async function POST(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { platform, account_name }: { platform: Platform; account_name: string } = await request.json()

    const normalized = normalizeAccountName(account_name)
    if (!normalized) {
      return NextResponse.json(
        { error: 'account_name is required and must be 1–100 characters' },
        { status: 400 },
      )
    }

    const { data, error } = await supabase.from('marketplace_accounts')
      .insert({ tenant_id: tenantId, platform, account_name: normalized, mode: 'csv' })
      .select().single()
    if (error) {
      if ((error as { code?: string }).code === '23505') {
        return NextResponse.json(
          { error: 'name_already_in_use', account_name: normalized },
          { status: 409 },
        )
      }
      throw error
    }
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/marketplace-accounts/route.ts
git commit -m "feat(accounts): POST normalizes account_name + maps 23505 to friendly 409"
```

---

## Chunk 3: Client-side — EditAccountDialog component

### Task 7: Create EditAccountDialog component

**Files:**
- Create: `src/components/settings/EditAccountDialog.tsx`

- [ ] **Step 1: Create the file**

Write the full content of `src/components/settings/EditAccountDialog.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { MarketplaceAccount, Platform } from '@/types'

const PLATFORM_LABELS: Record<Platform, string> = {
  flipkart: 'Flipkart',
  amazon: 'Amazon India',
  d2c: 'D2C',
}

interface Props {
  account: MarketplaceAccount | null
  onClose: () => void
  onRenamed: () => void
}

const MAX_VISIBLE_HISTORY = 5

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

export function EditAccountDialog({ account, onClose, onRenamed }: Props) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAllHistory, setShowAllHistory] = useState(false)
  const [recycleConfirm, setRecycleConfirm] = useState<{ conflicting: string; expected: string } | null>(null)

  // Re-init state whenever a new account is opened in the dialog
  useEffect(() => {
    if (account) {
      setName(account.account_name)
      setError(null)
      setSaving(false)
      setShowAllHistory(false)
      setRecycleConfirm(null)
    }
  }, [account])

  if (!account) return null

  const trimmedName = name.trim().replace(/\s+/g, ' ')
  const isDirty = trimmedName !== account.account_name && trimmedName.length > 0
  const canSave = isDirty && !saving

  const previous = (account.previous_names ?? []).slice().reverse()  // most recent first
  const historyToShow = showAllHistory ? previous : previous.slice(0, MAX_VISIBLE_HISTORY)

  async function attemptSave(forceRecycle = false) {
    if (!account) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/marketplace-accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: account.id,
          account_name: name,
          expected_current_name: account.account_name,
          force_recycle: forceRecycle || undefined,
        }),
      })

      const body = await res.json().catch(() => ({}))

      if (res.status === 200 && body.warning === 'name_recently_used_by_another_account') {
        // Recycle-name warning — show confirm dialog
        setRecycleConfirm({
          conflicting: body.conflicting_account_name,
          expected: body.expected_current_name,
        })
        setSaving(false)
        return
      }

      if (!res.ok) {
        if (res.status === 409 && body.error === 'stale_edit') {
          setError(`This account was changed by someone else. Current name is now "${body.current_name}". Refresh and try again.`)
        } else if (res.status === 409 && body.error === 'name_already_in_use') {
          setError(`An account named "${body.account_name}" already exists on ${PLATFORM_LABELS[account.platform]}.`)
        } else {
          setError(body.error ?? 'Save failed. Please try again.')
        }
        setSaving(false)
        return
      }

      toast.success('Account renamed')
      onRenamed()
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  function handleConfirmRecycle() {
    setRecycleConfirm(null)
    attemptSave(true)
  }

  return (
    <Dialog open={!!account} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Account</DialogTitle>
        </DialogHeader>

        {recycleConfirm ? (
          <div className="space-y-4 text-sm">
            <p>
              The name <span className="font-medium">{trimmedName}</span> was previously used by another account
              {' '}<span className="font-medium">{recycleConfirm.conflicting}</span>.
              Reusing it may make older reports ambiguous when matched by name.
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRecycleConfirm(null)}>Go back</Button>
              <Button onClick={handleConfirmRecycle}>Use it anyway</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="account-name-input">Account name</Label>
              <Input
                id="account-name-input"
                autoFocus
                value={name}
                onChange={(e) => { setName(e.target.value); setError(null) }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSave) attemptSave()
                  if (e.key === 'Escape') onClose()
                }}
                disabled={saving}
              />
              <p className="text-xs text-muted-foreground">
                Old names are kept on record so historical reports stay traceable.
              </p>
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Channel</Label>
              <p className="text-sm">{PLATFORM_LABELS[account.platform]} <span className="text-xs text-muted-foreground">(not editable)</span></p>
            </div>

            {previous.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Previously known as</Label>
                <ul className="text-sm space-y-1 max-h-40 overflow-y-auto" aria-label="Previous names for this account">
                  {historyToShow.map((p, i) => (
                    <li key={`${p.name}-${p.changed_at}-${i}`} className="text-muted-foreground">
                      • {p.name} <span className="text-xs">(until {fmtDate(p.changed_at)})</span>
                    </li>
                  ))}
                </ul>
                {previous.length > MAX_VISIBLE_HISTORY && !showAllHistory && (
                  <button
                    type="button"
                    className="text-xs text-primary underline"
                    onClick={() => setShowAllHistory(true)}
                  >
                    Show all ({previous.length})
                  </button>
                )}
              </div>
            )}

            <DialogFooter>
              <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button onClick={() => attemptSave()} disabled={!canSave}>
                {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : 'Save'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Verify type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/EditAccountDialog.tsx
git commit -m "feat(accounts): EditAccountDialog component (rename + previous-names history)"
```

---

## Chunk 4: Wire into Settings page

### Task 8: Add Edit pencil and dialog wiring to Settings

**Files:**
- Modify: `src/app/(dashboard)/settings/page.tsx`

- [ ] **Step 1: Update imports**

Add these to the existing imports at the top of `src/app/(dashboard)/settings/page.tsx`:

```typescript
import { Pencil } from 'lucide-react'
import { EditAccountDialog } from '@/components/settings/EditAccountDialog'
import { InfoTooltip } from '@/components/ui/info-tooltip'
```

- [ ] **Step 2: Add edit state**

Inside the `SettingsPage` component function (next to the existing `useState` calls), add:

```typescript
const [editingAccount, setEditingAccount] = useState<MarketplaceAccount | null>(null)
```

- [ ] **Step 3: Modify the account row rendering**

Find the existing account row JSX (around the `accounts.map(acct => …)` block in the Marketplace Accounts card). Replace the entire row with:

```tsx
{accounts.map(acct => {
  const previousCount = (acct.previous_names ?? []).length
  const mostRecentPrev = previousCount > 0 ? acct.previous_names[acct.previous_names.length - 1] : null
  const tooltipContent = mostRecentPrev
    ? `Previously: ${mostRecentPrev.name}${previousCount > 1 ? ` (+${previousCount - 1} earlier)` : ''}`
    : ''
  return (
    <div key={acct.id} className="flex items-center justify-between py-1">
      <div className="flex items-center gap-2">
        <Badge variant="outline">{PLATFORM_LABELS[acct.platform]}</Badge>
        <span className="text-sm">{acct.account_name}</span>
        {tooltipContent && <InfoTooltip content={tooltipContent} />}
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setEditingAccount(acct)}
          aria-label={`Rename ${acct.account_name}`}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          onClick={() => deleteAccount(acct.id)}
        >
          Remove
        </Button>
      </div>
    </div>
  )
})}
```

- [ ] **Step 4: Update `addAccount` function for friendly POST 409 errors**

Find the existing `addAccount` function. Replace the `else` branch in its response handling with:

```typescript
} else {
  const body = await res.json().catch(() => ({}))
  if (res.status === 409 && body.error === 'name_already_in_use') {
    toast.error(`An account named "${body.account_name}" already exists on ${PLATFORM_LABELS[acctPlatform]}.`)
  } else {
    toast.error(body.error ?? 'Failed to add account')
  }
}
```

- [ ] **Step 5: Render the dialog**

At the very bottom of the `return (...)` JSX, immediately before the closing `</div>` of the outermost wrapper, add:

```tsx
<EditAccountDialog
  account={editingAccount}
  onClose={() => setEditingAccount(null)}
  onRenamed={() => loadAccounts()}
/>
```

- [ ] **Step 6: Verify type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/\(dashboard\)/settings/page.tsx
git commit -m "feat(accounts): rename pencil + dialog wiring + previous-names tooltip on accounts list"
```

---

## Chunk 5: Deploy + smoke test

### Task 9: Type-check, push, deploy

- [ ] **Step 1: Final type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Push**

```bash
git push origin main
```

- [ ] **Step 3: Deploy**

```bash
ssh -i ~/.ssh/id_ed25519 -o StrictHostKeyChecking=no root@46.225.117.86 "cd /opt/fk-tool && bash deploy.sh"
```

Expected: Docker image rebuilds and container restarts. Tail end of output should show "Container fk-tool Started".

### Task 10: Smoke test on live site

Open https://ecommerceforall.in/settings (logged in).

- [ ] **Step 1: Verify pencil icon appears**

Each account row now shows a pencil icon next to the Remove button. No layout regressions.

- [ ] **Step 2: Rename an account (happy path)**

- Click pencil on one account (pick one you don't mind editing — e.g., create a test account named "Test Rename" first via the existing Add Account form).
- Verify modal opens; name input is auto-focused with current value.
- Verify helper text "Old names are kept on record…" is visible.
- Verify "Channel: Flipkart (not editable)" is shown.
- Verify "Previously known as" section is HIDDEN (this account has never been renamed).
- Change name to "Test Rename Updated", click Save.
- Verify saving spinner appears briefly.
- Verify modal closes; toast "Account renamed" appears.
- Verify accounts list shows the new name.
- Verify an `ⓘ` info icon now appears next to the new name.
- Hover the icon — tooltip shows "Previously: Test Rename".

- [ ] **Step 3: Rename again (history accumulation)**

- Click pencil on the renamed account.
- Verify "Previously known as" now lists "Test Rename" with the timestamp.
- Change name to "Test Rename V3", Save.
- Re-open the dialog. Verify "Previously known as" now lists both prior names in reverse-chronological order.

- [ ] **Step 4: Validation errors**

- Open edit modal. Clear the name field entirely. Verify Save button is disabled.
- Type only spaces. Verify Save button is still disabled (after normalization the name is empty).
- Type a valid name → Save button enables.

- [ ] **Step 5: Duplicate-name conflict**

- Add a new account named "Conflict Test" (any platform).
- Try to rename the previously-renamed account to "Conflict Test" on the same platform.
- Verify inline error: "An account named 'Conflict Test' already exists on Flipkart."

- [ ] **Step 6: Add-account friendly error**

- Try to add a new account with a name that already exists (same platform).
- Verify toast error: "An account named 'X' already exists on Flipkart."

- [ ] **Step 7: Recycle-name warning**

- Create account A "Foo", account B "Bar" (same platform).
- Rename A from "Foo" to "Foo Old".
- Try renaming B from "Bar" to "Foo".
- Verify the modal switches to the recycle-name confirm view: "The name 'Foo' was previously used by another account 'Foo Old'…"
- Click "Go back" — verify it returns to the edit view with name still in the field.
- Click pencil again, change to "Foo", click Save → confirm dialog appears again.
- Click "Use it anyway" — verify the rename succeeds.

- [ ] **Step 8: Stale-edit detection**

- Open the same account in two browser tabs.
- In tab 1, rename to "Stale Test 1", Save.
- In tab 2 (still showing the OLD name), try renaming to "Stale Test 2", Save.
- Verify inline error: "This account was changed by someone else. Current name is now 'Stale Test 1'. Refresh and try again."

- [ ] **Step 9: Cross-page propagation**

- Rename an account.
- Navigate to `/daily-pnl` — verify the account selector shows the new name.
- Navigate to `/pnl` and open the import dialog — verify the account dropdown shows the new name.

- [ ] **Step 10: Long history capping**

(Optional — if any account has been renamed > 5 times during testing.)
- Open edit dialog on an account with > 5 historical names.
- Verify only 5 most recent are shown by default, with "Show all (N)" link.
- Click the link — verify all entries appear in a scrollable list.

- [ ] **Step 11: Cleanup**

- Delete the test accounts created during this smoke test.

---

## Done

If all 11 smoke-test steps pass, the feature is shipped. Mark the spec status as **shipped** in the design doc:

`docs/superpowers/specs/2026-04-25-editable-account-names-design.md` — change `Status: Draft v2 (reviewed and revised)` to `Status: Shipped 2026-04-25` and commit.

```bash
git add docs/superpowers/specs/2026-04-25-editable-account-names-design.md
git commit -m "docs: mark editable account names spec as shipped"
git push origin main
```
