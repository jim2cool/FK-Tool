# FK-Tool — Active Context

> READ THIS FIRST every session. Keep it current.
> Last updated: 2026-03-23

---

## Current Focus
**Brainstorming next features.** No active implementation in progress.

## Last Session (2026-03-23)
**What was built:**
- Purchases CSV import duplicate detection — yellow row preview, skip on import, DB-wide fingerprint check
- Catalog manual add: 409 on duplicate product/variant name
- Catalog warehouse aggregation fix: parent-level purchases now included (legacy wrong-ID saves visible)
- Persistent memory system restructured to match Easy-D2C pattern

**Commits:** `780056e`, `3edaf15`, `95bbb8a` (+ `6f132df` CLAUDE.md)
**Deployed:** ✅ 2026-03-23

## What's Next (from BUILD-TRACKER)
See `docs/project-brain/BUILD-TRACKER.md` for full list. Top candidates:
1. User roles + onboarding checklist (design doc exists: `docs/plans/2026-03-06-user-roles-onboarding-info-design.md`)
2. Inventory & P&L page
3. Fuzzy SKU matching on catalog import

## Active Decisions
- No worktrees. Work directly on `main`.
- FK-Tool is on port 3001 on Hetzner (Easy-D2C is 3000).
- Always deploy after push — no auto-deploy.
