# Editable Marketplace Account Names — Design Spec

**Date:** 2026-04-25
**Status:** Draft, awaiting review

## Goal

Allow users to rename a marketplace account (e.g., `NuvioStore` → `NuvioStore Premium`) while preserving the previous name(s) on record so finance reconciliations against older reports remain traceable.

## Why

Account names change for branding, segmentation, or organisational reasons. All historical data referencing a marketplace account is keyed on a stable `id` (UUID), so renames don't break joins — only the display label needs to change. Deleting + recreating to "rename" is destructive (loses all linked data via `ON DELETE CASCADE`) and is the wrong tool. A rename with history is the right tool.

## Scope

**In scope:**
- Add an "Edit" affordance to each marketplace account row in Settings
- Persist a history of previous names with timestamps
- Show previous names as context in the edit modal and (optionally) on hover/info-tooltip in the accounts list

**Out of scope:**
- Renaming any other entity (organisations, master SKUs, etc.). Same pattern can be applied later if needed.
- Changing the underlying `marketplace_accounts.id` (UUID is stable; never editable)
- Audit log of *who* renamed (no user attribution in v1; current schema has no actor on `marketplace_accounts`)

## Architecture

### DB schema change

Single additive column on `marketplace_accounts`:

```sql
ALTER TABLE marketplace_accounts
  ADD COLUMN previous_names JSONB NOT NULL DEFAULT '[]'::jsonb;
```

Each entry is shape `{ "name": string, "changed_at": ISO8601 string }`. Append-only — rename appends, never edits.

Example value after two renames:
```json
[
  { "name": "NuvioStore", "changed_at": "2026-01-12T08:30:00Z" },
  { "name": "NuvioStore Old", "changed_at": "2026-04-15T14:22:00Z" }
]
```

The current name lives in `account_name` as it does today; only the prior names live in `previous_names`.

### API endpoint

`PATCH /api/marketplace-accounts/:id`

**Request body:**
```typescript
{ account_name: string }
```

**Behavior:**
1. Validate `id` belongs to the caller's tenant (existing tenant-scoping pattern).
2. Read current `account_name`.
3. If the new `account_name` matches the current value (after `.trim()`), return 200 with no DB write (idempotent).
4. Otherwise, update in a single SQL statement:

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

5. Return the updated row.

**Validation:**
- `account_name` must be non-empty after trim
- `account_name` length 1–100 characters (matching existing `account_name` constraints if any)
- Reject if another account in the same tenant already uses the new name on the same platform (mirrors existing uniqueness check in POST)

**Response:** updated `marketplace_account` row (same shape as GET).

### File map

| File | Change |
|---|---|
| `supabase migration` (new) | Add `previous_names` column |
| `src/app/api/marketplace-accounts/route.ts` | Add `PATCH` handler |
| `src/types/database.ts` | Add `previous_names` field to `MarketplaceAccount` type |
| `src/components/settings/MarketplaceAccountsSettings.tsx` (or whichever component renders the list — confirm during planning) | Add Edit button per row, EditAccountDialog component |
| `src/components/settings/EditAccountDialog.tsx` (new) | Modal: name input + previous-names list + Save/Cancel |

## UI / UX

### Accounts list — additions

Each row in the marketplace accounts list (Settings page) gets an "Edit" pencil icon, sitting alongside the existing "Delete" icon.

```
┌────────────────────────────────────────────────────────┐
│  NuvioCentral · Flipkart · E4A (Gurgaon)        ✏️  🗑 │
│  BodhNest · Flipkart · E4A (Bangalore)          ✏️  🗑 │
│  ...                                                   │
└────────────────────────────────────────────────────────┘
```

If `previous_names.length > 0`, the account name shows a small info icon with a tooltip:
> Previously known as: NuvioStore (until Apr 15, 2026)

### Edit modal

Click the pencil opens a small modal:

```
┌──────────────────────────────────────┐
│ Edit Account                         │
├──────────────────────────────────────┤
│ Account name                         │
│ ┌──────────────────────────────────┐ │
│ │ NuvioStore Premium               │ │
│ └──────────────────────────────────┘ │
│                                      │
│ Previously known as:                 │
│  • NuvioStore (until Apr 15, 2026)   │
│  • NuvioStore Old (until Jan 12,     │
│    2026)                             │
│                                      │
│ Channel: Flipkart  (not editable)    │
│                                      │
│         [Cancel]   [Save]            │
└──────────────────────────────────────┘
```

- Name field pre-populated with current value.
- "Previously known as" list reverse-chronological (most recent rename first). Hidden if `previous_names` is empty.
- `Channel` shown read-only; we never edit platform on an existing account (data integrity).
- "Save" button disabled until the name has been modified and is non-empty.
- On Save: PATCH call → success toast → list refreshes → modal closes.
- On error (e.g., name conflict): inline error below the name input, modal stays open.

## Error handling

| Scenario | Behavior |
|---|---|
| Empty name | Save button disabled; inline message "Name is required" |
| Name unchanged from current | Save is a no-op; modal closes silently |
| Name conflicts with another account on same platform | Inline error from server: "An account named 'X' already exists on Flipkart" |
| Network/server error | Toast error; modal stays open with field still populated |
| Unauthorized (tenant mismatch) | 401 → toast "Account not found" (existing pattern) |

## Testing strategy

### Unit
- API: PATCH validates tenant ownership, validates non-empty name, appends to `previous_names`, idempotent on no-change.
- API: unique-name conflict returns proper error.

### Integration
- Rename an account → verify name updated, `previous_names` has one entry with old name + timestamp.
- Rename twice → verify `previous_names` has two entries in chronological order.
- Try to rename to a name already used by another account on same platform → verify rejected.
- Rename works under both owner and admin roles (existing role-based access patterns).

### Manual smoke test
1. Settings → click pencil on an account
2. Change name → Save → verify list shows new name
3. Re-open edit modal → verify "Previously known as" shows the old name with timestamp
4. Hover info icon on the renamed account row in the list → verify tooltip shows previous names
5. Verify all places that reference the account (Daily P&L, P&L tab, etc.) immediately show the new name

## Implementation budget

- Migration + type update: ~30 min
- PATCH endpoint + tests: ~1 hr
- EditAccountDialog component: ~1.5 hr
- Wiring to accounts list + tooltip + smoke test: ~1 hr

**Estimated total: ~half a day.**

## Open design points (please confirm during review)

1. **Show previous-names tooltip on the accounts list?**
   - **Default chosen:** yes — small info icon next to renamed accounts, tooltip lists prior names.
   - Alternative: hide entirely from the list, only show inside the edit modal (less discoverable).

2. **Validation on rename target name:**
   - **Default chosen:** reject if another *active* account on the same platform already uses that name.
   - Alternative: also reject if it appears anywhere in any account's `previous_names` history (more conservative — prevents recycling old names that finance reports might still reference). Probably overkill but worth flagging.

3. **No "actor" field on the rename event:**
   - **Default chosen:** keep the timestamp only; no `changed_by` user_id. The current `marketplace_accounts` schema doesn't track creators either.
   - Alternative: add `changed_by` later if/when a full audit log is added across the app.
