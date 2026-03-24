# FK-Tool — Product Vision & Build Roadmap

> Exploratory brainstorm output. Captures the full product vision, module landscape, and build sequence.
> Date: 2026-03-23 (updated 2026-03-24)

---

## Important: Build for the Cohort, Not the Individual

FK-Tool is being dog-fooded on one seller's setup, but **everything must work for ANY Indian ecommerce seller.** The seed data below is one use case. Other sellers may:
- Have one org and one account, or 20 of each
- Operate from a single warehouse or ten
- Keep procurement strictly per-org instead of a shared pool
- Sell on platforms we haven't seen yet

Every feature must be flexible enough to handle these variations without hard-coded assumptions about a specific business structure.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Organization** | A legal entity (e.g., E4A Partner Pvt Ltd, ESS Collective). Has its own GSTIN, PAN, bank account. |
| **Marketplace Account** | A seller account on a platform (e.g., "NuvioCentral on Flipkart"). Belongs to one organization. |
| **Tenant** | An operational unit in FK-Tool. Currently 1 tenant = 1 user's entire business (all orgs, all accounts). |
| **Master SKU** | The standardized internal product name/code. Staff knows these. |
| **Platform SKU** | The listing-specific SKU on a marketplace. Mapped to a master SKU via `sku_mappings`. |

---

## The Problem

Indian ecommerce sellers operating across multiple platforms (Flipkart, Amazon, D2C), multiple seller accounts, multiple legal entities, and multiple warehouse locations have no single tool to manage operations and see unified business intelligence. Existing tools (OMS Guru, Evanik) are too complex, too expensive, and unreliable.

## The Vision

FK-Tool is a **simple, modular ecommerce operating system** for Indian sellers. Flipkart-first, platform-agnostic architecture. Each module solves one real problem well. Built for three user types: owner (full visibility), warehouse staff (simple mobile workflows, Hindi-friendly), and manager/accountant (reconciliation, reports, claims).

**Core value proposition:** "I finally know my real profit per SKU — and I know exactly what to do with it."

**Design principles:**
- Simple > feature-rich. Each module does one thing well.
- Modular — sellers only use (and eventually pay for) what they need.
- Build for API, survive on CSV — Flipkart API access pending, CSV import is primary ingestion for now.
- Organization is a labeling layer, not a hard partition — shared inventory pool by default, org boundaries enforced only where legally required (tax, accounting, settlements). Some sellers may want strict per-org separation — support both modes.
- **Build for the cohort** — every feature must generalize to any Indian ecommerce seller, not just the dog-food account.

**Long-term:** Monetize as a SaaS platform for Indian ecommerce sellers.

---

## Current State (What Exists)

### Procurement Layer (Complete)
- **Master Catalog** — 271 SKUs, parent/variant structure, 1,610 platform SKU mappings across 10 marketplace accounts
- **Purchases** — 411 purchase records, CSV import with duplicate detection
- **Freight Invoices** — inward freight tracking
- **Packaging** — 22 materials, SKU packaging config, packaging purchases
- **COGS Engine** — WAC + allocated freight + dispatch packaging + shrinkage, expandable breakdown, editable rates

### Active But Not Yet Used in Workflows
- `marketplace_accounts` — 10 accounts configured with org links. Mode (csv/api), api_key_enc fields ready.
- `sku_mappings` — 1,610 platform-to-master mappings. Used by Label Sorting to resolve SKUs.
- `organizations` — 3 orgs seeded (E4A, ESS Collective, ESS Collectives) with GSTIN.

### Schema Ready, Empty (0 rows)
- `orders` — platform_order_id, marketplace_account_id, status, sale_price
- `dispatches` — order_id, warehouse_id, marketplace_account_id, dispatch_date
- `returns` — return_type (customer/logistics/cancellation), causes_deduction, deduction_amount
- `order_financials` — commission, logistics cost, projected vs actual settlement, variance
- `sku_financial_profiles` — avg commission/logistics/return rate per platform per SKU
- `imports` — centralized import tracking with auto-detect marketplace/report type

### Infrastructure
- 1 tenant ("Nuvio"), 2 user profiles (both owners), 5 warehouses, 3 organizations
- Multi-tenant with RLS on all tables
- Supabase Auth, Next.js App Router, Docker on Hetzner

---

## Organization Model

### Dog-Food Entities (Seed Data)

| Org | Type | Location | GSTIN |
|-----|------|----------|-------|
| E4A Partner Private Limited | Pvt Ltd | GGN + BLR (two GST registrations) | 06AAICE3494R1ZV (GGN) + BLR TBD |
| ESS Collective | Sole Proprietorship | Gurgaon | 06AQVPM0300Q1ZH |
| ESS Collectives | Sole Proprietorship | Bangalore | PLACEHOLDER |
| Nuvio Ecom (coming soon) | TBD | TBD | TBD — will replace ESS Collective & ESS Collectives |

### Dog-Food Marketplace Accounts (10)

| Account | Platform | Org | Location |
|---------|----------|-----|----------|
| NuvioCentral | Flipkart | E4A Partner Pvt Ltd | Gurgaon |
| BodhNest | Flipkart | E4A Partner Pvt Ltd | Bangalore |
| NuvioStore | Flipkart | ESS Collective | Gurgaon |
| NuvioShop | Flipkart | ESS Collectives | Bangalore |
| Gentle | D2C | E4A Partner Pvt Ltd | Gurgaon |
| Livee | D2C | ESS Collectives | Bangalore |
| Nuvio | D2C | E4A Partner Pvt Ltd | GGN + BLR |
| Devaara | D2C | E4A Partner Pvt Ltd | GGN + BLR |
| Nuvio | Amazon | ESS Collectives | Bangalore |
| Devaara | Amazon | E4A Partner Pvt Ltd | Gurgaon |

> Note: "The Gentle Co" in DB = "Gentle" brand. "Bodhnest" in DB = "BodhNest" brand.

### Architecture Decision
- Procurement is org-agnostic by default: one entity buys, all orgs sell from the shared pool. But the system must also support sellers who keep procurement strictly per-org.
- Sales are org/account-specific: tracked per marketplace_account, which belongs to an org
- `marketplace_accounts` has `organization_id` FK (already linked)
- Organization layer needed for: tax/GST filing, legal entity accounting, settlement tracking
- **All orgs share the same COGS figures** — COGS is computed at the shared pool level, not per-org. This is correct for the dog-food account (E4A does all procurement). Per-org COGS is a future option.
- One org can have **multiple GST registrations** (e.g., E4A has GGN + BLR). The `organizations` table may need a child `gst_registrations` table in the future, or simply allow multiple org rows with the same `legal_name` but different GSTINs.

### Schema Status
- `organizations` table: **EXISTS** — `id, tenant_id, name, legal_name, gst_number, billing_address, created_at`
- `marketplace_accounts.organization_id`: **EXISTS** — FK linked for all 10 accounts
- `user_profiles.organization_id`: NOT YET — nullable column needed (null = access all orgs)
- `marketplace_accounts` needs a `location` column (city/region) — not yet added
- All existing procurement tables stay untouched — shared pool
- Future: optionally add `organization_id` to `purchases`/`master_skus` for per-org procurement if needed

---

## Module Map

### Layer 0: Foundation (EXISTS)
| Module | Status | Notes |
|--------|--------|-------|
| Master Catalog | Complete | 271 SKUs, parent/variant, SKU mappings |
| Procurement (Purchases + Freight + Packaging) | Complete | 411 purchases, CSV import with dedup |
| COGS Engine | Complete | WAC + freight + dispatch + shrinkage |
| Auth + Multi-tenant | Complete | Supabase Auth, RLS everywhere |
| Organizations | Seeded | 3 orgs linked to 10 marketplace accounts |

### Layer 1: Infrastructure (BUILD SOON)
| Module | Status | Notes |
|--------|--------|-------|
| User Roles | To Build | Owner / manager-accountant / warehouse staff. Scoped per tenant, optionally per org. |
| Import Engine | Schema Ready | `imports` table exists. Centralized import with auto-detect. |

### Layer 2: Daily Operations
| Module | Status | Notes |
|--------|--------|-------|
| **Label Sorting** | To Build (PRIORITY 1) | Upload label PDFs → parse SKU → group by master product → crop labels → output sorted PDFs. Replaces Quick Labels. |
| Order Ingestion | Schema Ready | `orders` table exists. Side effect of label parsing — order data extracted automatically. |
| Dispatch Tracking | Schema Ready | `dispatches` table exists. Daily dispatch summary. |
| Returns & Grading | Partial Schema | `returns` table exists but needs grading columns (condition: usable/damaged/parts_missing/packaging_damaged, graded_by, graded_at). |
| Claims Management | To Build | Auto-flag claimable returns, guided filing (Hindi-friendly), track status + outcomes. New table needed. |

### Layer 3: Intelligence
| Module | Status | Notes |
|--------|--------|-------|
| P&L per SKU | Schema Ready | `order_financials` + `sku_financial_profiles` exist. Needs sales data flowing first. |
| Live Inventory | Derived | purchases_in - dispatches_out + usable_returns, by warehouse, by condition |
| Payment Reconciliation | Schema Ready | `order_financials` has projected vs actual settlement + variance |
| Demand Forecasting | To Build | Projected sales, reorder points, stock-out alerts |

### Layer 4: Accounting & Compliance (FUTURE)
| Module | Status | Notes |
|--------|--------|-------|
| GST Filing | Future | Per-org tax liability, input credit tracking |
| Billing & Invoicing | Future | Generate invoices per org |
| Per-Org Procurement | Future | Optional hard partition of inventory by org |

---

## Build Sequence

### Phase 1: Label Sorting (NEXT)
**The "replace Quick Labels + fix mislabeling" module.**

> Org layer already exists in DB (seeded). User roles (owner/manager/staff) needed for Label Sorting access control — build inline.

**The mislabeling problem:**
Currently, staff downloads labels from Flipkart, crops invoices using Quick Labels, prints all labels, then manually reads each label to find the right product. With hundreds of labels across multiple accounts, wrong products get labeled → wrong item shipped → returns → penalties → claims.

**The fix — sort by product, not by order:**
Instead of "grab label → find product → hope it's right," the system groups all labels by master product. Staff handles one product at a time: pick 12 units of Product X → apply 12 labels → impossible to mislabel.

**Workflow:**
1. Staff at each warehouse opens FK-Tool in the morning
2. Selects their warehouse from dropdown
3. Uploads one or more label PDFs (from different FK accounts)
4. System parses every page:
   - Extracts: Order ID, SKU ID, product description, seller/org (from "Sold By"), GSTIN, courier, AWB, COD/PREPAID, HBD/CPD dates
   - Crops label (top half) from invoice (bottom half) — dashed line separator
   - Matches platform SKU → master_sku via `sku_mappings`
   - Identifies org from GSTIN (matched against `organizations.gst_number`)
   - Flags unknown SKUs for mapping
5. Groups cropped labels by **master product name** (the name staff recognizes)
6. Outputs downloadable PDFs: "Master Product Name — N labels.pdf" (formatted for label printers)
7. Staff prints one product at a time → picks units → sticks labels → no mislabeling

**Unknown SKU handling:**
- If a platform SKU from a label isn't in `sku_mappings`, it's flagged in a "Map These SKUs" panel
- Staff sees: "3 labels have unknown SKUs" with a list showing the platform SKU text
- Owner/manager can map them to master SKUs from a dropdown (same page, inline)
- Warehouse staff cannot map SKUs — they see "Contact manager to map: [SKU name]"
- With 1,610 existing mappings across 271 master SKUs, most labels should match on day one. New listings or variants will surface here naturally.

**Side effects (free data):**
- Orders auto-created in `orders` table (one order per label page)
- Dispatches auto-created in `dispatches` table (atomic with order creation)
- Daily dispatch counts per product/account/warehouse
- COD vs PREPAID breakdown
- Org-level order tracking (via GSTIN on label → org match)

**Technical approach:**
- PDF parsing: browser-side using pdf.js (text extraction, no OCR needed — text is embedded)
- PDF cropping/generation: browser-side using pdf-lib
- V1 is browser-only. Server-side processing deferred until performance testing shows it's needed at scale (500+ labels).
- Label format: consistent Flipkart layout, 1 page = 1 order. Multi-item orders still produce separate label pages per item on Flipkart.
- Target: upload 200 labels → sorted PDFs ready in under 30 seconds

**Volume:** 50-200 labels/day normally, up to 500 in season.

**Device profile:** Staff uploads from desktop/laptop browsers at the warehouse. Mobile is not in scope for V1 label sorting.

### Phase 2: P&L per SKU
**"I finally know my real profit per SKU — and I know exactly what to do with it."**

Builds on:
- COGS (done) — cost side
- Label Sorting / Order Ingestion (Phase 1) — revenue side
- `order_financials` schema (exists) — platform fees, commission, logistics

**What's needed:**
- Import Flipkart settlement/payment reports (CSV)
- Match settlements to orders
- Calculate: Revenue - COGS - Platform Fees - Returns Cost = True Profit per SKU
- Dashboard with actionable insights: "this SKU is losing money because..."
- Forecasted settlements based on historical data for today's sales

### Phase 3: Inventory Pipeline
**Complete operational tracking.**

Builds on:
- Purchases (done) — inbound
- Dispatches (Phase 1) — outbound
- Returns (needs grading columns)

**Sub-modules (in dependency order):**

**3a. Returns & Grading** (must come first)
- Flipkart sends daily list of returns coming today
- Staff scans each return when it physically arrives
- Staff grades condition: usable / damaged / parts missing / packaging damaged
- This feeds: inventory (what's back in stock, in what condition) AND claim eligibility
- Quality metrics: return rates by SKU, by account, damage patterns

**3b. Live Inventory**
- Derived view: purchases - dispatches + usable returns, by warehouse, by condition
- Low stock alerts, reorder points
- Depends on returns grading for accurate "usable" stock

**3c. Claims Management**
- Auto-flag claimable returns based on grading data + return reason
- Guided claim filing — Hindi-friendly interface, step-by-step (staff struggle with English on FK seller hub)
- Track lifecycle: flagged → filed → pending → approved/rejected → amount recovered
- Catch missed claims — currently ad-hoc, many slip through

**3d. Warehouse Management**
- Stock by location + condition
- Stock transfer tracking between warehouses
- Dead stock identification

### Phase 4: Accounting & Compliance (FUTURE)
> Only when Phase 1-3 are solid. Requires org layer to be mature.

- GST filing support — per-org tax liability, input credit tracking
- Billing & invoicing — generate invoices per org
- Per-org procurement — optional hard partition of inventory by org
- Demand forecasting — projected sales, reorder points (needs historical data from Phase 1-2)

---

## Flipkart Label PDF Format (Reference)

Verified from sample PDF (consistent format across E4A and ESS accounts):

**Each page = 1 order, split into two halves:**

### Top Half — Shipping Label
- Courier name + type (Expressbees E2E COD, Delhivery E2E COD, etc.)
- Order ID (e.g., OD437024786226306100)
- Flipkart logo
- Vertical barcode (left side)
- AWB barcode (large, right side) + AWB number
- Shipping/Customer address + pincode
- HBD (Handover By Date) / CPD (Customer Promise Date)
- **Sold By: [Org Name]** + registered address + **GSTIN**
- **SKU ID | Description** — platform SKU + product name
- Tracking number barcode + bin code (B10, etc.)
- "Not for resale" + print timestamp

### Bottom Half — Tax Invoice (separated by dashed line)
- Order ID, Invoice No, Order Date, Invoice Date
- GSTIN + PAN
- Sold By address, Billing Address, Shipping Address
- QR code
- Product table: Product name, Description (HSN + GST), Qty, Gross Amount, Discount, Taxable Value, IGST, CESS, Total
- Handling Fee row
- Total Price + signature block

### Extractable Fields (embedded text, no OCR)
| Field | Location | Use |
|-------|----------|-----|
| Order ID | Label header | Order tracking |
| Platform SKU | "SKU ID \| Description" row | Product matching via sku_mappings |
| Org/Seller | "Sold By" on label OR invoice | Organization identification |
| GSTIN | Below "Sold By" | Org verification (match against `organizations.gst_number`) |
| Courier | Label header (e.g., "Expressbees E2E COD") | Logistics tracking |
| Payment type | Label header ("COD" / "PREPAID") | Cash flow tracking |
| AWB Number | Below AWB barcode | Shipment tracking |
| HBD / CPD | Left side of label | SLA tracking |
| Customer address | Right side of label | Delivery zone analysis |
| Sale price | Invoice product table | Revenue tracking |
| GST details | Invoice product table | Tax tracking |

---

## Key Decisions Made

1. **Build for the cohort** — every feature must work for any Indian ecommerce seller, not just the dog-food account. The seed data is one use case; the system must generalize.
2. **Org layer is lightweight** — labeling/grouping only, not a hard data partition. But support sellers who want strict per-org separation too.
3. **Procurement stays shared by default** — all orgs sell from one inventory pool; per-org procurement is a future option (just add `organization_id` to `purchases`/`master_skus`)
4. **Label Sorting is Phase 1** — solves immediate operational pain (mislabeling) + ingests order data as a side effect
5. **Build for API, survive on CSV** — architecture assumes API access coming, CSV is primary for now
6. **Staff selects warehouse at upload** — warehouse info is not on Flipkart labels. Org IS on the label (via "Sold By" / GSTIN).
7. **Browser-side PDF processing** — pdf.js for text extraction, pdf-lib for cropping/generation; server fallback for high volume
8. **Master SKU names on output** — sorted PDFs show standardized product names staff recognizes, not platform listing titles
9. **Unknown SKU flagging** — if a platform SKU isn't mapped, system flags it for mapping (keeps sku_mappings growing organically)
10. **All orgs share COGS by default** — COGS is computed at the shared pool level. Per-org COGS attribution is a future option if procurement is ever split by org.
11. **Desktop-first for Label Sorting** — warehouse staff uploads from desktop/laptop. Mobile label sorting is not V1 scope.
12. **One page = one order** — each Flipkart label page represents one order item. Multi-item orders produce separate pages.
13. **Three user types** — owner (full access, dashboards, decisions), warehouse staff (simple mobile workflows, Hindi-friendly, scan/grade/sort), manager/accountant (claims, reconciliation, reports)
14. **Phone camera scanning as default** — for returns grading and future dispatch confirmation. No hardware dependency.
15. **Build sequence: C > A > B** — Label Sorting (immediate pain relief) → P&L (the "shut up and take my money" hook) → Inventory Pipeline (full ops tracking)

---

## Relationship to Existing Backlog

The BUILD-TRACKER P1 items (User Roles, Onboarding Checklist, Info Icons) from `docs/plans/2026-03-06-user-roles-onboarding-info-design.md` are **subsumed by this roadmap:**
- **User Roles** → needed for Phase 1 (staff vs owner access to SKU mapping) and all subsequent phases. Build inline with Phase 1.
- **Onboarding Checklist + Info Icons** → apply incrementally as each new module ships. Not a standalone phase.
- **Import Data page** → feeds into Phase 2 (settlement CSV import). The `imports` table already exists for tracking.
- **Demand Forecasting** → deferred to Phase 4. Will be its own module once sales + inventory data has accumulated enough history.
