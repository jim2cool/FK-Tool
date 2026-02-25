# FK Tool — Design Document
**Date:** 2026-02-25
**Status:** Approved
**Scope:** Phase 1 — Modules 1–5

---

## 1. Problem Statement

The team currently manages inventory and financial tracking across Flipkart, Amazon India, and D2C through a manual, multi-file spreadsheet workflow. This is time-consuming, error-prone, and produces no actionable intelligence.

### Current Manual Workflow

| Step | What happens today | Pain |
|------|-------------------|------|
| 1 | Team tracks dispatches manually + receives a daily dispatch/pickup report for previous dates | Manual effort, reconciliation lag |
| 2 | A "listings file" maps expected bank settlement per SKU for orders on a given date (approximate) | Approximation, not exact |
| 3 | A master SKU mapping file is applied to convert platform SKUs → internal Master SKU | Done manually every time |
| 4 | COGS is derived from procurement sheet + packaging + other costs per Master SKU | Manual calculation |
| 5 | Historical return rates are calculated from historical orders report (only customer returns cause deductions; logistics returns and cancellations do not) | Manual, slow, error-prone |
| 6 | All this effort produces just two outputs: (a) stock levels per warehouse/SKU as of today, (b) projected bank settlement and expected margin for yesterday / last 3 / 7 / 30 days | No intelligence, no insights, no trends |

### Target State

FK Tool replaces every manual step above. Upload files, the system does the rest — and adds graphs, trends, projections, and actionable insights on top.

**Primary platform:** Flipkart (90% of orders). Build for all 3 platforms but validate and tune with Flipkart data first.

---

## 2. Architecture

### Stack
- **Frontend + Backend:** Next.js (App Router) + TypeScript — single Docker container on Hetzner
- **Database + Auth + Storage:** Supabase (PostgreSQL, Supabase Auth, Supabase Storage, pg_cron)
- **Hosting:** Hetzner VPS (~€5–10/month), Docker Compose
- **Cost principle:** Zero paid third-party services in Phase 1

### Architectural Pattern: Modular Monolith

The system is structured as a **modular monolith** — one deployed unit but with clean internal seams so any module can be extracted into its own service later without touching others.

```
┌──────────────────────────────────────────────────────────┐
│                  Next.js App (Docker / Hetzner)           │
│                                                          │
│  ┌────────────┐  ┌─────────────┐  ┌──────────────────┐  │
│  │  Inventory │  │  Settlement │  │    Analytics      │  │
│  │   Module   │  │   Module    │  │    Module         │  │
│  └─────┬──────┘  └──────┬──────┘  └────────┬──────────┘  │
│        └────────────────┴───────────────────┘            │
│                          │                               │
│          ┌───────────────▼────────────────┐              │
│          │     Connector Abstraction Layer │              │
│          │  ┌────────────┐ ┌────────────┐ │              │
│          │  │  Flipkart  │ │   Amazon   │ │              │
│          │  │ Connector  │ │ Connector  │ │              │
│          │  │ CSV → API  │ │ CSV → API  │ │              │
│          │  └────────────┘ └────────────┘ │              │
│          └───────────────┬────────────────┘              │
│                          │                               │
│          ┌───────────────▼────────────────┐              │
│          │        Job Queue Layer          │              │
│          │   pg_cron now → BullMQ later    │              │
│          └────────────────────────────────┘              │
└──────────────────────────────────────────────────────────┘
                           │
               ┌───────────▼───────────┐
               │       Supabase         │
               │  PostgreSQL + Auth     │
               │  Storage (raw files)   │
               │  pg_cron (scheduler)   │
               └───────────────────────┘
```

### Evolution Path
- **Connector Layer:** Every marketplace implements a common interface (`getOrders()`, `getInventory()`, `getListings()`). Phase 1: reads from imported CSV data. Phase 2: calls live APIs. New marketplace = new connector file only.
- **Job Queue:** `JobQueue` interface wraps pg_cron today. Swap to BullMQ + Redis later with zero changes to automation rules.
- **Multi-tenancy:** Every DB row is scoped to `tenant_id`. Phase 1 = one tenant (your own accounts). Phase 2 = open sign-ups for other sellers.

---

## 3. File Types & Their Roles

These are the input files the system must understand and process:

| File | Source | Trigger | Maps to |
|------|---------|---------|---------|
| Daily Handover / Dispatch Report | Flipkart / Warehouse | Daily upload (morning) | `dispatches` |
| Listings File | Flipkart seller panel export | Daily upload | `orders`, `order_financials` |
| Master SKU Mapping File | Internal | One-time upload, updatable | `sku_mappings` |
| Procurement / Purchase Sheet | Internal | On new purchase | `purchases` |
| Historical Orders Report | Flipkart / Amazon export | Bulk historical upload | `orders`, `returns`, `sku_financial_profiles` |

---

## 4. Data Model

### Core Tables

```sql
-- Multi-tenancy root
tenants (id, name, created_at)

-- Users
users (id, tenant_id, email, role, created_at)

-- Warehouses
warehouses (id, tenant_id, name, location, created_at)

-- Marketplace accounts (multiple per platform per tenant)
marketplace_accounts (id, tenant_id, platform [flipkart|amazon|d2c],
                      account_name, api_key_enc, api_secret_enc,
                      mode [csv|api], created_at)

-- Master product catalog
master_skus (id, tenant_id, name, description, created_at)

-- Cross-platform SKU mapping
sku_mappings (id, tenant_id, master_sku_id, platform, platform_sku,
              marketplace_account_id, created_at)

-- Inbound stock purchases (stock-in ledger)
purchases (id, tenant_id, master_sku_id, warehouse_id,
           quantity, unit_cost, packaging_cost, other_cost,
           total_cogs,  -- unit_cost + packaging_cost + other_cost
           supplier, purchase_date, received_date, created_at)

-- Daily dispatch records (stock-out ledger)
dispatches (id, tenant_id, master_sku_id, warehouse_id,
            marketplace_account_id, order_id, platform_sku,
            quantity, dispatch_date, created_at)

-- Orders (from listings file + historical report)
orders (id, tenant_id, platform_order_id, master_sku_id,
        marketplace_account_id, quantity, sale_price,
        order_date, status [pending|dispatched|delivered|returned|cancelled],
        created_at)

-- Financial data per order
order_financials (id, tenant_id, order_id,
                  sale_price,
                  commission_amount, commission_rate,
                  logistics_cost,
                  other_deductions,
                  projected_settlement,  -- sale_price - commission - logistics - deductions
                  actual_settlement,     -- filled when marketplace pays out
                  settlement_variance,   -- actual - projected
                  created_at)

-- Returns (customer returns only — these cause deductions)
returns (id, tenant_id, order_id, master_sku_id, warehouse_id,
         return_type [customer|logistics|cancellation],
         causes_deduction BOOLEAN,  -- true only for customer returns
         deduction_amount, return_date, created_at)

-- Per-SKU financial intelligence (computed from historical data)
sku_financial_profiles (id, tenant_id, master_sku_id, platform,
                         avg_commission_rate, avg_logistics_cost,
                         avg_return_rate, avg_net_settlement_pct,
                         sample_size,  -- how many orders this is based on
                         last_computed_at, created_at)

-- File import log
imports (id, tenant_id, file_name, file_path,  -- Supabase Storage path
         detected_marketplace, detected_report_type,
         status [pending|processing|complete|failed],
         rows_processed, rows_failed, error_log,
         imported_by, created_at)
```

### Key Calculations

```
Stock Level (per Master SKU, per Warehouse, as of date D):
  = SUM(purchases.quantity WHERE received_date <= D)
  - SUM(dispatches.quantity WHERE dispatch_date <= D)
  - SUM(returns.quantity WHERE return_type = 'customer' AND return_date <= D)

Projected Settlement (per Order):
  = sale_price
  - commission_amount        (from listings file, or sku_financial_profiles if missing)
  - logistics_cost           (from listings file, or sku_financial_profiles if missing)
  - return_provision         (sale_price × avg_return_rate from sku_financial_profiles)

Expected Margin (per Order):
  = Projected Settlement - COGS (from purchases.total_cogs for that Master SKU)

Return Deduction Rule:
  - customer returns       → causes_deduction = TRUE  → deducted from settlement
  - logistics returns      → causes_deduction = FALSE → no deduction
  - cancellations          → causes_deduction = FALSE → no deduction
```

---

## 5. Module Breakdown

### Module 1 — Foundation
- Supabase Auth (email/password)
- Tenant creation on first login
- Warehouse setup (add/edit/delete warehouses)
- Marketplace account setup (Flipkart, Amazon, D2C — name, mode: CSV/API, credentials placeholder)
- Sidebar navigation shell
- **Output:** Working login → dashboard skeleton with warehouse and account config

### Module 2 — Master Catalog & SKU Mapping
- Master SKU CRUD (create, edit, archive)
- SKU Mapping table: link each Master SKU to Flipkart SKU, Amazon SKU, D2C SKU per account
- Bulk import via CSV upload (the existing master SKU mapping file)
- Search and filter
- **Output:** The reference table that all other modules join on

### Module 3 — Purchase Tracking
- Record inbound stock: Master SKU, warehouse, quantity, unit cost, packaging cost, other costs → auto-compute total COGS
- Edit/delete purchases
- View purchase history per SKU per warehouse
- **Output:** Stock-in ledger, COGS per Master SKU

### Module 4 — Sheet Intelligence Engine
Handles all file uploads with intelligent detection.

**Fingerprinting Logic:**
1. Read first 5 rows of uploaded file
2. Extract column headers
3. Match against known signature registry (per marketplace × report type)
4. Score match confidence (%)
5. If confidence > 90%: auto-detect, show confirmation banner
6. If confidence 50–90%: show detected type, ask user to confirm
7. If confidence < 50%: show column mapping UI for manual assignment

**Signature Registry (Phase 1 — Flipkart-first):**

| Report Type | Key Fingerprint Columns |
|-------------|------------------------|
| FK Dispatch/Handover | Order ID, Tracking ID, Dispatch Date, SKU, Warehouse |
| FK Listings/Settlement | Order ID, SKU, Sale Price, Commission, Logistics, Settlement |
| FK Historical Orders | Order ID, FSN, Sub-order ID, Order Date, Status, Return Type |
| Master SKU Mapping | Master SKU, FK SKU, Amazon SKU, D2C SKU |
| Procurement Sheet | Master SKU, Quantity, Unit Cost, Packaging Cost, Date |

**Upload Flow:**
```
Drag & Drop / Browse
       ↓
Upload to Supabase Storage (raw file preserved)
       ↓
Fingerprint engine runs (server-side, Next.js API route)
       ↓
Show detected type + preview of first 10 rows
       ↓
User confirms (or corrects)
       ↓
Parse & import into Postgres
       ↓
Show import summary (rows processed, rows failed, errors)
```

### Module 5 — Daily Inventory + Settlement Intelligence Dashboard

Two views, one dashboard:

**Inventory View**
- Date selector (default: today)
- Table: Master SKU × Warehouse → Opening Stock, Dispatched, Purchased, Customer Returns, Closing Stock
- Filters: warehouse, platform, date range
- Alerts: SKUs below reorder threshold (configurable per SKU)
- Trend chart: stock level over last 30 days per SKU

**Settlement Intelligence View**
- Date range selector (yesterday / last 3 days / last 7 days / last 30 days)
- Table: Order → SKU → Sale Price → Commission → Logistics → Return Provision → Projected Settlement → COGS → Expected Margin
- Aggregate cards: Total Orders, Total Projected Settlement, Total Expected Margin, Avg Margin %
- Per-SKU performance: best/worst margin SKUs
- Confidence indicator on projections (based on sample_size in sku_financial_profiles)
- Trend charts: margin trend per SKU, settlement trend over time

**Intelligence Layer (runs on imported historical data)**
- Auto-builds sku_financial_profiles after each historical import
- Flags SKUs with deteriorating margins
- Flags unusually high return rates per SKU
- Highlights variance between projected and actual settlement when actuals arrive

---

## 6. Phase 1 Build Sequence

Each module is completed, tested with real Flipkart data, and handed to the team before the next begins.

```
Week 1:  Module 1 — Foundation
Week 2:  Module 2 — Master Catalog & SKU Mapping
Week 3:  Module 3 — Purchase Tracking
Week 4:  Module 4 — Sheet Intelligence Engine
Week 5+: Module 5 — Daily Inventory + Settlement Intelligence Dashboard
```

Primary test data: Flipkart exports. Amazon and D2C connectors are built in parallel but validated after Flipkart is confirmed working.

---

## 7. Phase 2 Preview (Out of Scope Now)

- Flipkart SP-API + Amazon SP-API integration (connector switches from CSV → API mode)
- Automation rules engine (repricing, low-stock alerts, order routing)
- Module 6: Orders management
- Module 7: Listings management
- Module 8: Analytics (extended)
- Multi-tenant SaaS (sign-up flow, billing)

---

## 8. Non-Goals (Phase 1)

- No mobile app
- No direct marketplace API calls (CSV only)
- No automated repricing
- No customer-facing features
- No billing/subscription management
