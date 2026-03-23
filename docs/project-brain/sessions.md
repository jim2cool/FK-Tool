# FK-Tool — Session Log

> Append-only. Most recent session at top.

---

## Session 2026-03-23 — Duplicate Detection + Memory System

**What was built:**
- `POST /api/purchases/check-duplicates` — resolves names→IDs, fingerprints, DB-wide dedup + within-file dedup
- `PurchasesImportDialog` — yellow row warning, "Duplicate" badge, "skip N duplicates" in import button
- `import-csv/route.ts` + `purchases-import-server.ts` — `skipRowIndices` support
- `POST /api/catalog/master-skus` — 409 on duplicate name before insert
- `master-skus/route.ts` — warehouse aggregation fix: `[sku.id, ...variants]` in `aggregateSummaries`
- FK-Tool memory system restructured to match Easy-D2C pattern (ACTIVE.md, BUILD-TRACKER.md, sessions.md + typed memory files)

**Key commits:**
- `95bbb8a` — feat: purchases CSV duplicate detection
- `3edaf15` — fix: prevent duplicate master SKUs on manual add
- `780056e` — fix: include parent SKU's own purchases in warehouse aggregation
- `6f132df` — docs: update CLAUDE.md with session learnings

**Deployed:** ✅ 2026-03-23 ~08:01 UTC

**Revert if needed:**
```bash
git revert 780056e 3edaf15 95bbb8a --no-commit && git commit -m "revert: undo duplicate detection session"
```

---

## Pre-session history
See `CLAUDE.md` "Completed Features" section for full history before session log was introduced.
