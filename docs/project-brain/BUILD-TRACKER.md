# FK-Tool — Build Tracker

> Single source of truth for ALL remaining work.
> Update after every brainstorm, plan, and session.
> Last updated: 2026-03-24
> Vision doc: `docs/superpowers/specs/2026-03-23-fktool-vision-and-roadmap.md`

---

## Guiding Principle

**Build for the cohort, not the individual.** FK-Tool is dog-fooded on one seller's setup, but every feature must generalize to any Indian ecommerce seller — whether they have 1 org or 10, 1 warehouse or 20, shared procurement or strict per-org separation.

---

## Completed (Layer 0 — Procurement Foundation)

| Feature | Session | Notes |
|---------|---------|-------|
| Master Catalog (CSV import + manual add) | Pre-memory | 271 SKUs, parent/variant structure, column mapping |
| Platform SKU Mappings | Pre-memory | 1,610 mappings across 10 marketplace accounts |
| Purchases page (CSV import, filters, pagination) | Pre-memory | 411 purchases, month accordions, GST columns, bulk delete |
| Freight Invoices | Pre-memory | Inward freight tracking |
| Packaging Materials + SKU Specs | Pre-memory | 22 materials, SKU packaging config |
| COGS Engine (WAC + freight + dispatch + shrinkage) | Pre-memory | Expandable breakdown, editable rates |
| Duplicate detection — purchases CSV | 2026-03-23 | Preview warning + skip |
| Duplicate detection — catalog manual add | 2026-03-23 | 409 on duplicate name |
| Catalog warehouse aggregation fix | 2026-03-23 | Includes parent-ID purchases |
| Organizations seeded | 2026-03-23 | 3 orgs (E4A, ESS Collective, ESS Collectives) linked to 10 marketplace accounts |
| Merged tenants — single shared tenant | 2026-03-24 | Both users (shashwat + finance) now share tenant "Nuvio". Test tenant deleted. |
| Fixed Nuvio D2C org assignment | 2026-03-24 | Was ESS Collectives, corrected to E4A |
| Label Sorting — 2-tab system | 2026-03-24 | Sort Labels + Crop Profiles. Upload → parse → match SKU → group by product → crop → 4x6 PDF output |
| User-guided crop selector | 2026-03-24 | Draw rectangle on PDF, aspect-ratio locked to label size, named profiles |
| Label order/dispatch ingestion | 2026-03-24 | Auto-creates orders + dispatches from label data |
| Local PDF.js worker | 2026-03-24 | CDN fails in Docker, now served from public/ |

---

## Build Roadmap

### Phase 1: Label Sorting — COMPLETE

> Full feature shipped with all polish. Demo passed.

- [x] ~~Label PDF upload page~~ ✅
- [x] ~~PDF parser (pdf.js text extraction)~~ ✅
- [x] ~~SKU matching via sku_mappings~~ ✅
- [x] ~~Org matching via GSTIN~~ ✅
- [x] ~~Unknown SKU flagging with inline mapping~~ ✅
- [x] ~~User-guided label cropping~~ ✅
- [x] ~~Group & sort by master product~~ ✅
- [x] ~~Output sorted PDFs (label size, proportional scaling)~~ ✅
- [x] ~~Crop profiles (save/load/delete/rename)~~ ✅
- [x] ~~Label size selector (4x6, 4x4, 3x5, 2x1, A4, Custom)~~ ✅
- [x] ~~2-tab layout (Sort Labels + Crop Profiles)~~ ✅
- [x] ~~Auto-create orders + dispatches~~ ✅
- [x] ~~Edit crop profiles (pencil icon, full re-crop flow)~~ ✅
- [x] ~~Inline profile rename (click name in table)~~ ✅
- [x] ~~Invoice cropping (freeform, A4 output, proportional scaling)~~ ✅
- [x] ~~Custom label sizes (user-defined W x H)~~ ✅
- [x] ~~Platform-agnostic text (removed Flipkart-specific wording)~~ ✅
- [ ] **Move profiles to DB** — currently localStorage only, needs DB for multi-device/multi-user
- [ ] **User roles (basic)** — owner / manager / warehouse-staff on `user_profiles`
- [ ] **Daily summary view** — dispatch counts per product/account/warehouse, COD vs PREPAID breakdown
- [ ] **Add `location` column to marketplace_accounts** — city/region for each account

### Phase 2: P&L per SKU

> "I finally know my real profit per SKU — and I know what to do about it."
> Needs: COGS (done) + order data (Phase 1) + settlement imports.

- [ ] **Settlement CSV import** — parse Flipkart payment/settlement reports
- [ ] **Match settlements → orders** — by order ID
- [ ] **Populate order_financials** — commission, logistics cost, deductions, actual settlement
- [ ] **P&L calculation** — Revenue - COGS - Platform Fees - Returns Cost = True Profit per SKU
- [ ] **P&L dashboard** — per-SKU, per-account, per-org views
- [ ] **Actionable insights** — flag losing SKUs, explain why, suggest actions (raise price / stop ads / switch warehouse / discontinue)
- [ ] **Forecasted settlements** — project today's sales settlements based on historical data
- [ ] **Import Data page** — centralized import history, re-import, error review (uses existing `imports` table)

### Phase 3: Inventory Pipeline

> Complete operational tracking. Sub-modules in dependency order.

**3a. Returns & Grading** (must come first)
- [ ] **Schema changes** — add grading columns to `returns`: condition (usable/damaged/parts_missing/packaging_damaged), graded_by, graded_at
- [ ] **Returns import** — ingest Flipkart daily returns list CSV
- [ ] **Staff grading UI** — mobile-friendly, phone camera scan return + assign condition
- [ ] **Returns dashboard** — quality metrics, return rates by SKU/account, damage patterns

**3b. Live Inventory**
- [ ] **Inventory calculation** — purchases_in - dispatches_out + usable_returns, by warehouse, by condition
- [ ] **Inventory page** — stock levels by SKU, by warehouse, low stock alerts
- [ ] **Reorder points** — configurable thresholds per SKU

**3c. Claims Management**
- [ ] **Claims table** — new table for claim lifecycle tracking
- [ ] **Auto-flag claimable returns** — based on grading data + return type + Flipkart policy rules
- [ ] **Guided claim filing** — Hindi-friendly interface, step-by-step (staff struggle with English on FK seller hub)
- [ ] **Claims tracking** — flagged → filed → pending → approved → rejected → amount recovered
- [ ] **Missed claims alerts** — catch returns that qualify for claims but haven't been filed

**3d. Warehouse Management**
- [ ] **Stock by location + condition** — warehouse-level inventory views
- [ ] **Stock transfer tracking** — between warehouses
- [ ] **Dead stock identification** — items not moving for N days

### Phase 4: Accounting & Compliance (FUTURE)

> Only when Phase 1-3 are solid. Requires org layer to be mature.

- [ ] **GST filing support** — per-org tax liability, input credit tracking
- [ ] **Billing & invoicing** — generate invoices per org
- [ ] **Per-org procurement** — optional hard partition of inventory by org (add `organization_id` to `purchases`/`master_skus`)
- [ ] **Demand forecasting** — projected sales, reorder points, stock-out alerts (needs enough historical data from Phase 1-2)

---

## Ongoing (apply with every module)

- [ ] **Onboarding Checklist** — update dashboard getting-started checklist as each module ships
- [ ] **Info Icons** — `<InfoTooltip>` on every non-obvious field in new modules
- [ ] **Page subtitles + empty states + data-missing banners** — per product standards in CLAUDE.md

---

## Quality of Life (fit in when convenient)

- [ ] **Fuzzy SKU matching on catalog import** — conflict-review dialog when incoming name ~ existing name
- [ ] **Tax liability section** — use `tax_paid` + `gst_rate_slab` data for GST reporting
- [ ] **Received date tracking** — make it part of COGS lot calculation
- [ ] **Hindi UI support** — for warehouse staff workflows (Returns grading, Claims filing, Label Sorting)
- [ ] **Test tenant + dummy data** — shared test account for dev/QA

---

## Known Bugs / Tech Debt
- ESS Collectives GSTIN is a placeholder — needs real value
- E4A has two GST registrations (GGN + BLR) — only GGN GSTIN stored. May need `gst_registrations` child table or second org row.
- `marketplace_accounts` missing `location` column
- DB has "The Gentle Co" — brand name is "Gentle"
- DB has "Bodhnest" — brand name is "BodhNest"
