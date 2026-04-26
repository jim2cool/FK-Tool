# Editable Marketplace Account Names — Design Spec

**Date:** 2026-04-25
**Status:** Draft v2 (reviewed and revised)

## Goal

Allow users to rename a marketplace account (e.g. `NuvioStore` → `NuvioStore Premium`) while preserving the previous name(s) on record so finance reconciliations against older reports remain traceable.

## Why

Account names change for branding, segmentation, or organisational reasons. All historical data is keyed on a stable `id` (UUID), so renames don't break joins — only the display label changes. Deleting + recreating to "rename" is destructive (loses linked data via `ON DELETE CASCADE`). A rename with append-only history is the right tool.

## Scope

**In scope:**
- "Edit" affordance per account row in Settings
- Append-only history of previous names with timestamps
- Show previous names in the edit modal and inline next to renamed accounts
- Cache invalidation across all surfaces that show account names
- Concurrent-edit protection (stale-write detection)
- DB-level uniqueness + length constraints

**Out of scope:**
- Renaming any other entity (organisations, master SKUs)
- Changing `marketplace_accounts.id` (UUID is stable; never editable)
- Audit log of *who* renamed (no actor on `marketplace_accounts` schema currently)
- Undo / one-click revert (v2 candidate)
- CSV/export historical-name handling (v2 candidate; called out below)
- Detecting visually-similar Unicode names (homoglyph attacks); trusted-user assumption

## Architecture

### DB schema change

Single migration adds the `previous_names` column AND tightens existing constraints. **The migration is order-sensitive** — duplicates must be resolved BEFORE the unique index is added, otherwise the index creation will abort the entire migration:

```sql
-- Step 1: add the new column (always safe)
ALTER TABLE marketplace_accounts
  ADD COLUMN previous_names JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Step 2: pre-flight duplicate check.
-- If any duplicates exist, abort with a clear message; manual cleanup needed
-- (the alternative — auto-renaming — is too magical for a destructive operation).
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

-- Step 3: length check (covers both new entries and any legacy data)
ALTER TABLE marketplace_accounts
  ADD CONSTRAINT account_name_length_check
    CHECK (char_length(account_name) BETWEEN 1 AND 100);

-- Step 4: case-insensitive uniqueness per (tenant, platform).
-- Now safe because duplicates were caught above.
CREATE UNIQUE INDEX marketplace_accounts_unique_name_per_platform
  ON marketplace_accounts (tenant_id, platform, lower(account_name));
```

**Pre-deployment manual step:** before applying this migration, run the duplicate-check query (Step 2 alone) on production. If it reports `dup_count > 0`, ask the user to rename the duplicates via existing UI (the existing POST endpoint still allows it before the index exists) before re-running the migration.

Each entry in `previous_names` has shape `{ "name": string, "changed_at": ISO8601 string }`. Append-only — rename appends, never edits.

The shape is **forward-compatible** with later additions like `changed_by`: JSONB tolerates the optional field, so when audit attribution is added in a future spec, no migration is needed.

Example after two renames:
```json
[
  { "name": "NuvioStore",     "changed_at": "2026-01-12T08:30:00Z" },
  { "name": "NuvioStore Old", "changed_at": "2026-04-15T14:22:00Z" }
]
```

### API endpoint

`PATCH /api/marketplace-accounts/:id`

**Request body:**
```typescript
{
  account_name: string
  expected_current_name: string   // stale-write protection
  force_recycle?: boolean         // set true after user confirms recycle-name warning
}
```

**Behavior:**
1. Validate `id` belongs to caller's tenant.
2. Normalize the input: `trim()` then collapse internal multi-whitespace to single space.
3. Validate length (1–100) and non-empty after normalization.
4. Read current row.
5. **Stale-write check:** if `expected_current_name` (also normalized) ≠ current `account_name`, return `409 Conflict` with body `{ error: "stale_edit", current_name: <actualCurrent> }`. The UI re-fetches and prompts user to retry.
6. If normalized new name equals current `account_name`, return 200 with the unchanged row (idempotent).
7. **Recycle-name warning** (non-blocking; gated on `force_recycle`):
   - If `force_recycle !== true` AND the new name matches any name in `previous_names` of *another active account* on the same platform, server returns `200` with `{ warning: "name_recently_used_by_another_account", conflicting_account_name: "X", expected_current_name }`. The row is **NOT** updated. UI shows confirm dialog. On confirm, UI re-PATCHes with `force_recycle: true`.
   - If `force_recycle === true`, skip the recycle check entirely.
8. Otherwise update in a single SQL statement (which the unique index enforces concurrency-safely):

```sql
UPDATE marketplace_accounts
SET account_name = $newName,
    previous_names = previous_names || jsonb_build_object(
      'name', $oldName,
      'changed_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
WHERE id = $id AND tenant_id = $tenantId
RETURNING *;
```

If the unique index throws (race with another rename), return 409 with `{ error: "name_already_in_use" }`.

**Response:** updated `marketplace_account` row (matches GET shape).

### POST endpoint update (required, same migration)

The existing `POST /api/marketplace-accounts` does no uniqueness check today (relies on app-level POSTs not colliding). Once the unique index is added, naive POSTs will throw a cryptic Postgres unique-violation error. **The POST handler must be updated in the same PR** to:

1. Catch the unique-violation Postgres error code (`23505` with constraint `marketplace_accounts_unique_name_per_platform`)
2. Return a friendly `409 Conflict` with `{ error: "name_already_in_use", account_name: "X" }`
3. The Settings UI must surface this with a clear toast: "An account named 'X' already exists on Flipkart"

This is non-optional — without it, normal account creation breaks the moment the migration runs.

### Cache invalidation

Renaming MUST invalidate every surface showing account names. The PATCH success handler (in `EditAccountDialog.tsx`) calls:

```typescript
// Predicate handles BOTH string keys and array keys (SWR best practice
// for parameterised queries is `[url, params]` array form)
const isAffectedKey = (key: unknown): boolean => {
  const str = Array.isArray(key) && typeof key[0] === 'string'
    ? key[0]
    : typeof key === 'string' ? key : null
  if (!str) return false
  return (
    str.startsWith('/api/marketplace-accounts') ||
    str.startsWith('/api/pnl/') ||
    str.startsWith('/api/daily-pnl/') ||
    str.startsWith('/api/dispatches') ||
    str.startsWith('/api/labels/')
  )
}

// During implementation: confirm whether the codebase uses SWR or React Query;
// SWR uses mutate(predicate); React Query uses queryClient.invalidateQueries({ predicate }).
// Both accept the same predicate signature.
mutate(isAffectedKey)
```

Surfaces verified to update on rename:
- Settings → Marketplace Accounts list (the source view)
- AppSidebar (no account names rendered, but the underlying list)
- P&L tab → Products table (account column)
- P&L tab → ImportDialog account dropdown
- Daily P&L Estimator → Account selector + per-account upload sections + Results accordion
- Bulk P&L Importer → Account dropdown in Step 3

Acceptance test: rename in Settings, immediately navigate to `/daily-pnl` without page refresh — new name visible in account selector.

### File map

| File | Change |
|---|---|
| `supabase/migrations/<timestamp>_marketplace_account_history.sql` (new) | Migration above (incl. duplicate pre-flight) |
| `src/app/api/marketplace-accounts/route.ts` | Add `PATCH` handler (with normalization + stale-write + recycle); ALSO update `POST` to map unique-violation 23505 to friendly 409 |
| `src/types/database.ts` | Add `previous_names: PreviousName[]` to `MarketplaceAccount` type |
| `src/components/settings/MarketplaceAccountsSettings.tsx` (or current path; confirm during planning) | Edit pencil per row, render `<InfoTooltip>` on renamed accounts; surface POST 409 with toast |
| `src/components/settings/EditAccountDialog.tsx` (new) | Modal with name input, previous-names list, recycle-warning confirm (sends `force_recycle: true` on confirm) |

## UI / UX

### Accounts list — additions

Each row gets an Edit pencil next to the existing Delete icon. If `previous_names.length > 0`, an `<InfoTooltip>` appears **immediately right of the account name** (not at row-end where it'd compete with action icons).

```
┌───────────────────────────────────────────────────────────────┐
│  NuvioCentral · Flipkart · E4A (Gurgaon)              ✏️  🗑  │
│  NuvioStore Premium ⓘ · Flipkart · ESS Collective    ✏️  🗑  │
│                       ↑ tooltip: "Previously: NuvioStore     │
│                          (until Apr 15, 2026)"               │
└───────────────────────────────────────────────────────────────┘
```

Tooltip uses the existing `<InfoTooltip>` component (per CLAUDE.md product standards) — works on both hover and tap.

### Edit modal

```
┌──────────────────────────────────────┐
│ Edit Account                         │
├──────────────────────────────────────┤
│ Account name                         │
│ ┌──────────────────────────────────┐ │
│ │ NuvioStore Premium               │ │  (auto-focused on open)
│ └──────────────────────────────────┘ │
│ Old names are kept on record so      │  ← always-visible helper
│ historical reports stay traceable.   │
│                                      │
│ Channel: Flipkart  (not editable)    │
│                                      │
│ Previously known as:                 │
│  • NuvioStore (until Apr 15, 2026)   │  ← max 5 visible
│  • NuvioStore Old (until Jan 12,     │     "Show all (12)" link below
│    2026)                             │     when more exist
│                                      │
│         [Cancel]   [Save]            │
└──────────────────────────────────────┘
```

**Always-visible helper text** under the name input: "Old names are kept on record so historical reports stay traceable." Removes the first-time-user mystery — they understand the feature on their first interaction.

**Long history overflow:** the previous-names `<ul>` is wrapped in `max-h-40 overflow-y-auto`. If `previous_names.length > 5`, only the 5 most recent are shown by default with a "Show all (N)" disclosure link.

**Recycle-name confirm dialog:** if PATCH returns `warning: "name_recently_used_by_another_account"`, instead of immediately saving, show a confirm:
```
This name was used by another account ("Account X")
until Mar 12, 2026. Reusing it may make older reports
ambiguous when matched by name.

  [Go back]   [Use it anyway]
```

**Loading state on Save:** Save button disables and renders `<Loader2 />` + "Saving…" while PATCH is in flight. No optimistic update — the conflict response is the whole point of waiting.

**Re-using own past name** is allowed. After A → B → A, `previous_names` contains `[A, B]` (chronological), and tooltip dedupes display via a Set.

### Accessibility

- **Focus management:** Modal auto-focuses the name input on open. On close (Save success, Cancel, Esc), focus returns to the pencil button that triggered it.
- **Keyboard:** Enter submits (when valid + dirty), Esc cancels. Standard shadcn `Dialog` primitive provides this; verify in smoke test.
- **Screen-reader semantics:** previous-names list rendered as `<ul aria-label="Previous names for this account">`. Status icons paired with `aria-label`. Form labels properly bound to inputs.
- **Touch:** `<InfoTooltip>` on the accounts list works on tap (not hover-only).

## Error handling

| Scenario | Behavior |
|---|---|
| Empty / whitespace-only name | Save disabled; inline message "Name is required" |
| Name unchanged (after normalization) | Save is no-op; modal closes silently |
| Name conflicts with another active account on same platform | Inline error from server: "An account named 'X' already exists on Flipkart" |
| Name recycle warning (matches another account's previous name on same platform) | Confirm dialog (see above); user can proceed or cancel |
| Stale edit (someone else renamed first) | 409 `stale_edit`; toast "This account was changed by someone else. Refresh to continue." Modal stays open with current value re-fetched |
| Network / server 500 | Toast error; modal stays open with field still populated |
| Unauthorized (tenant mismatch / session expired) | 401 → toast "Your session expired. Please sign in again." |

## Testing strategy

### Unit
- `normalizeAccountName(input)` → `trim` + collapse whitespace + length check
- API PATCH: accepts valid input; rejects empty, too long; idempotent on no-change
- API PATCH: stale-write check returns 409 when `expected_current_name` mismatches
- API PATCH: appends correctly to `previous_names` JSONB (chronological)
- API PATCH: surfaces recycle warning when name was previously used by another active account on same platform
- DB: unique index rejects duplicate names case-insensitively per (tenant, platform)

### Integration
- Rename A → B; verify name updated, `previous_names` has one entry with old name + timestamp
- Rename twice (A → B → C); verify `previous_names` has two entries chronologically
- Rename loop (A → B → A); verify `previous_names` = [A, B]; tooltip dedupes display
- Rename to name already used by another active account on same platform → rejected via unique index
- Rename to name in another active account's `previous_names` → recycle confirm shown; "Use it anyway" succeeds
- Concurrent edit: open modal in two tabs; save in tab 1; tab 2's save returns 409 with current name
- Cache invalidation: rename in Settings, navigate to `/daily-pnl` without refresh, verify new name visible in account selector and any rendered Results accordion

### Manual smoke test
1. Settings → click pencil on an account
2. Verify name input auto-focuses; helper text visible
3. Change name → Save → verify list shows new name + ⓘ tooltip appears
4. Hover/tap ⓘ → verify tooltip shows old name + date
5. Re-open edit modal → verify "Previously known as" populated
6. Open same account in two browser tabs → save in tab 1 → save in tab 2 → verify stale-edit toast in tab 2
7. Try saving an empty name → verify Save disabled + inline error
8. Rename to a name another account previously used → verify recycle confirm dialog
9. Navigate to `/daily-pnl` and `/pnl` after rename → verify new name visible everywhere

## Implementation budget

- Migration + type update: ~30 min
- PATCH endpoint with normalization + stale-write + recycle warning + tests: ~2 hr
- EditAccountDialog component (with all states): ~2 hr
- Cache invalidation wiring + smoke testing: ~1 hr
- Accessibility verification + tooltip on accounts list: ~30 min

**Estimated total: ~6 hours (~3/4 day).**

## Resolved design points (from review)

1. **DB-level enforcement** of length and uniqueness — added (single migration).
2. **Whitespace normalization** — server trims + collapses internal multi-whitespace before write.
3. **Cache invalidation** — explicit list of surfaces; mutate calls in PATCH success handler.
4. **Stale-write detection** — `expected_current_name` in PATCH body; 409 on mismatch.
5. **Recycle warning** — non-blocking confirm dialog; user can proceed.
6. **Long history** — 5 most recent visible; "Show all" disclosure for more.
7. **Loading state** — explicit Saving spinner; no optimistic update.
8. **Accessibility** — focus management, keyboard, screen-reader semantics specified.
9. **Tooltip discoverability** — uses existing `<InfoTooltip>` for hover + tap support.
10. **Re-using own past name** — allowed; tooltip dedupes display.
11. **`changed_by` deferral** — JSONB shape is forward-compatible with later addition.

## Corrections from implementation-readiness review

The following issues were found in a second adversarial review pass and corrected in this spec:

1. **Migration would fail on existing duplicates** — the unique index would abort the deploy if any duplicate `(tenant_id, platform, lower(account_name))` exists today. Migration now includes a pre-flight check that fails loudly with a clear remediation message.

2. **Existing POST endpoint missing uniqueness handling** — once the unique index exists, the existing `POST /api/marketplace-accounts` would throw cryptic Postgres errors on duplicate inserts. POST handler must be updated in the same PR with friendly error mapping. Now explicit.

3. **Recycle-name confirmation flow had no bypass mechanism** — without a `force_recycle: true` flag, the user clicking "Use it anyway" would just re-trigger the same warning in an infinite loop. PATCH body now includes `force_recycle?: boolean`.

4. **Cache invalidation predicate broke on array keys** — SWR best practice uses array keys for parameterised queries; the original string-prefix predicate would miss them. Predicate now handles both string and array key forms.

## Future enhancements (v2 candidates)

- Undo / one-click revert from the previous-names list
- CSV/export name resolution at "as-of-date"
- Audit log integration (`changed_by` user_id, IP, etc.)
- Visually-similar Unicode detection (homoglyph protection)
