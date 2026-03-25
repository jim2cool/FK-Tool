# FK-Tool — Session Log

> Append-only. Most recent session at top.

---

## Session 2026-03-25 (session 2) — Crop Profiles DB Migration

**What happened:**
- Built CRUD API for crop profiles at `/api/labels/crop-profiles`
- Replaced all localStorage usage with API calls in LabelCropSelector + labels page
- Auto-migration: on first load, localStorage profiles are pushed to DB, then localStorage cleared
- Both profiles migrated successfully, verified on live site
- Label Sorting feature is now fully complete

**Commits:** `ba171e0`
**Deployed:** Yes

**Next:** Fix combo SKU mapping reassignment bug, then P&L per SKU

---

## Session 2026-03-23 (evening) — Product Vision Brainstorm

**What happened:**
- Exploratory brainstorm on FK-Tool's future direction
- Identified core pain: multi-platform, multi-account, multi-org ecommerce with no single view
- Mapped existing tools tried (OMS Guru, Evanik) — too complex, too expensive, unreliable
- Established FK-Tool as a simpler, modular alternative. Flipkart-first, platform-agnostic.
- Core value prop: "I finally know my real profit per SKU — and I know what to do about it"
- Analyzed Flipkart label PDF format in detail (sample PDF, 8 pages)
- Discovered: labels have embedded text (no OCR needed), SKU ID extractable, org identifiable from "Sold By" field
- Established build sequence: Label Sorting (C) → P&L (A) → Inventory Pipeline (B)
- Label Sorting replaces Quick Labels + fixes mislabeling + auto-ingests order/dispatch data
- Org model: lightweight layer above tenant. Procurement shared, sales per-org/account.
- Current orgs: E4A (main, procures), ESS1, ESS2 (sole props, closing), Nuvio Ecom (registering)

**Key artifacts:**
- Vision doc: `docs/superpowers/specs/2026-03-23-fktool-vision-and-roadmap.md`
- BUILD-TRACKER rewritten with phased roadmap

**No code written. No commits. No deploy.**

---

## Session 2026-03-23 (morning) — Duplicate Detection + Memory System

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
