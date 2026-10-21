//! Ordered, versioned schema migrations.
//!
//! Each migration runs inside its own transaction. If one fails, the
//! transaction rolls back and the database stays at the last version that
//! applied cleanly, so a failed startup can never leave a half-built schema.
//!
//! Released migrations are immutable. A change to the schema is a new forward
//! migration with a higher version. Each applied migration records a checksum
//! so an edited migration file is detected instead of silently re-running.

use rusqlite::{Connection, OptionalExtension};

pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub sql: &'static str,
}

pub const MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    name: "initial_schema",
    sql: r#"
-- Companies ---------------------------------------------------------------
CREATE TABLE companies (
    id                 TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    legal_name         TEXT,
    country            TEXT NOT NULL,
    state              TEXT,
    base_currency      TEXT NOT NULL,
    fiscal_year_start  TEXT NOT NULL,
    fiscal_year_end    TEXT NOT NULL,
    gstin              TEXT,
    pan                TEXT,
    address            TEXT,
    phone              TEXT,
    email              TEXT,
    industry           TEXT,
    is_demo            INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
    created_at         TEXT NOT NULL
);

CREATE TABLE financial_years (
    id          TEXT PRIMARY KEY,
    company_id  TEXT NOT NULL,
    label       TEXT NOT NULL,
    start_date  TEXT NOT NULL,
    end_date    TEXT NOT NULL,
    is_closed   INTEGER NOT NULL DEFAULT 0 CHECK (is_closed IN (0, 1)),
    UNIQUE (company_id, id),
    UNIQUE (company_id, label),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- Chart of accounts --------------------------------------------------------
CREATE TABLE ledgers (
    id               TEXT PRIMARY KEY,
    company_id       TEXT NOT NULL,
    name             TEXT NOT NULL,
    group_name       TEXT NOT NULL,
    kind             TEXT NOT NULL,
    parent_id        TEXT,
    opening_balance  INTEGER NOT NULL DEFAULT 0,
    opening_date     TEXT NOT NULL,
    party_kind       TEXT,
    currency         TEXT NOT NULL,
    tax_number       TEXT,
    email            TEXT,
    phone            TEXT,
    address          TEXT,
    is_system        INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
    is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at       TEXT NOT NULL,
    UNIQUE (id, company_id),
    UNIQUE (company_id, name),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);
CREATE INDEX idx_ledgers_company ON ledgers(company_id);
CREATE INDEX idx_ledgers_company_group ON ledgers(company_id, group_name);
CREATE INDEX idx_ledgers_company_party ON ledgers(company_id, party_kind);

-- Inventory masters -------------------------------------------------------
CREATE TABLE stock_groups (
    id          TEXT PRIMARY KEY,
    company_id  TEXT NOT NULL,
    name        TEXT NOT NULL,
    parent_id   TEXT,
    UNIQUE (company_id, id),
    UNIQUE (company_id, name),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE TABLE units (
    id              TEXT PRIMARY KEY,
    company_id      TEXT NOT NULL,
    name            TEXT NOT NULL,
    decimal_places  INTEGER NOT NULL DEFAULT 0,
    UNIQUE (company_id, id),
    UNIQUE (company_id, name),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE TABLE godowns (
    id          TEXT PRIMARY KEY,
    company_id  TEXT NOT NULL,
    name        TEXT NOT NULL,
    location    TEXT,
    UNIQUE (company_id, id),
    UNIQUE (company_id, name),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE TABLE items (
    id                TEXT PRIMARY KEY,
    company_id        TEXT NOT NULL,
    name              TEXT NOT NULL,
    stock_group_id    TEXT,
    unit_id           TEXT,
    is_inventory      INTEGER NOT NULL DEFAULT 0 CHECK (is_inventory IN (0, 1)),
    is_service        INTEGER NOT NULL DEFAULT 0 CHECK (is_service IN (0, 1)),
    purchase_price    INTEGER NOT NULL DEFAULT 0,
    sales_price       INTEGER NOT NULL DEFAULT 0,
    hsn               TEXT,
    tax_category_id   TEXT,
    opening_quantity  REAL NOT NULL DEFAULT 0,
    opening_value     INTEGER NOT NULL DEFAULT 0,
    reorder_level     REAL NOT NULL DEFAULT 0,
    is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at        TEXT NOT NULL,
    UNIQUE (id, company_id),
    UNIQUE (company_id, name),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);
CREATE INDEX idx_items_company ON items(company_id);

-- Tax configuration -------------------------------------------------------
CREATE TABLE tax_categories (
    id               TEXT PRIMARY KEY,
    company_id       TEXT NOT NULL,
    name             TEXT NOT NULL,
    rate             REAL NOT NULL,
    kind             TEXT NOT NULL,
    hsn              TEXT,
    ledger_id        TEXT,
    input_ledger_id  TEXT,
    is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    UNIQUE (id, company_id),
    UNIQUE (company_id, name),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- Supporting masters ------------------------------------------------------
CREATE TABLE cost_centres (
    id          TEXT PRIMARY KEY,
    company_id  TEXT NOT NULL,
    name        TEXT NOT NULL,
    parent_id   TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    UNIQUE (company_id, id),
    UNIQUE (company_id, name),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE TABLE employees (
    id               TEXT PRIMARY KEY,
    company_id       TEXT NOT NULL,
    name             TEXT NOT NULL,
    code             TEXT NOT NULL,
    department       TEXT NOT NULL,
    designation      TEXT NOT NULL,
    date_of_joining  TEXT NOT NULL,
    monthly_gross    INTEGER NOT NULL DEFAULT 0,
    is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    UNIQUE (company_id, id),
    UNIQUE (company_id, code),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE TABLE currencies (
    id          TEXT PRIMARY KEY,
    company_id  TEXT NOT NULL,
    code        TEXT NOT NULL,
    name        TEXT NOT NULL,
    rate        REAL NOT NULL DEFAULT 1,
    symbol      TEXT NOT NULL,
    UNIQUE (company_id, id),
    UNIQUE (company_id, code),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE TABLE price_lists (
    id           TEXT PRIMARY KEY,
    company_id   TEXT NOT NULL,
    name         TEXT NOT NULL,
    is_default   INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    UNIQUE (company_id, id),
    UNIQUE (company_id, name),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE TABLE price_list_entries (
    price_list_id  TEXT NOT NULL,
    item_id        TEXT NOT NULL,
    company_id     TEXT NOT NULL,
    rate           INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (price_list_id, item_id),
    FOREIGN KEY (price_list_id, company_id) REFERENCES price_lists(id, company_id) ON DELETE CASCADE,
    FOREIGN KEY (item_id, company_id) REFERENCES items(id, company_id) ON DELETE CASCADE
);

CREATE TABLE payment_terms (
    id          TEXT PRIMARY KEY,
    company_id  TEXT NOT NULL,
    name        TEXT NOT NULL,
    days        INTEGER NOT NULL DEFAULT 0,
    UNIQUE (company_id, id),
    UNIQUE (company_id, name),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- Vouchers ----------------------------------------------------------------
CREATE TABLE vouchers (
    id                       TEXT PRIMARY KEY,
    company_id               TEXT NOT NULL,
    kind                     TEXT NOT NULL,
    number                   TEXT NOT NULL,
    date                     TEXT NOT NULL,
    party_id                 TEXT,
    narration                TEXT NOT NULL DEFAULT '',
    reference                TEXT NOT NULL DEFAULT '',
    status                   TEXT NOT NULL,
    linked_voucher_id        TEXT,
    reversed_by_voucher_id   TEXT,
    is_locked                INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
    created_at               TEXT NOT NULL,
    updated_at               TEXT NOT NULL,
    UNIQUE (id, company_id),
    UNIQUE (company_id, number),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);
CREATE INDEX idx_vouchers_company_date ON vouchers(company_id, date);
CREATE INDEX idx_vouchers_company_kind ON vouchers(company_id, kind);
CREATE INDEX idx_vouchers_company_status ON vouchers(company_id, status);
CREATE INDEX idx_vouchers_company_party ON vouchers(company_id, party_id);
CREATE INDEX idx_vouchers_number ON vouchers(number);

CREATE TABLE voucher_entries (
    id               TEXT PRIMARY KEY,
    voucher_id       TEXT NOT NULL,
    company_id       TEXT NOT NULL,
    ledger_id        TEXT NOT NULL,
    debit            INTEGER NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit          INTEGER NOT NULL DEFAULT 0 CHECK (credit >= 0),
    narration        TEXT,
    cost_centre_id   TEXT,
    FOREIGN KEY (voucher_id, company_id) REFERENCES vouchers(id, company_id) ON DELETE CASCADE,
    FOREIGN KEY (ledger_id, company_id) REFERENCES ledgers(id, company_id)
);
CREATE INDEX idx_voucher_entries_voucher ON voucher_entries(voucher_id);
CREATE INDEX idx_voucher_entries_ledger ON voucher_entries(ledger_id);
CREATE INDEX idx_voucher_entries_company ON voucher_entries(company_id);

CREATE TABLE voucher_items (
    id                TEXT PRIMARY KEY,
    voucher_id        TEXT NOT NULL,
    company_id        TEXT NOT NULL,
    item_id           TEXT NOT NULL,
    quantity          REAL NOT NULL DEFAULT 0,
    rate              INTEGER NOT NULL DEFAULT 0,
    discount          INTEGER NOT NULL DEFAULT 0,
    tax_category_id   TEXT,
    amount            INTEGER NOT NULL DEFAULT 0,
    godown_id         TEXT,
    batch             TEXT,
    FOREIGN KEY (voucher_id, company_id) REFERENCES vouchers(id, company_id) ON DELETE CASCADE,
    FOREIGN KEY (item_id, company_id) REFERENCES items(id, company_id)
);
CREATE INDEX idx_voucher_items_voucher ON voucher_items(voucher_id);
CREATE INDEX idx_voucher_items_item ON voucher_items(item_id);

CREATE TABLE voucher_taxes (
    id                TEXT PRIMARY KEY,
    voucher_id        TEXT NOT NULL,
    company_id        TEXT NOT NULL,
    tax_category_id   TEXT NOT NULL,
    taxable           INTEGER NOT NULL DEFAULT 0,
    amount            INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (voucher_id, company_id) REFERENCES vouchers(id, company_id) ON DELETE CASCADE,
    FOREIGN KEY (tax_category_id, company_id) REFERENCES tax_categories(id, company_id)
);
CREATE INDEX idx_voucher_taxes_voucher ON voucher_taxes(voucher_id);
CREATE INDEX idx_voucher_taxes_category ON voucher_taxes(tax_category_id);

-- Inventory and banking records -------------------------------------------
CREATE TABLE stock_movements (
    id             TEXT PRIMARY KEY,
    company_id     TEXT NOT NULL,
    voucher_id     TEXT NOT NULL,
    voucher_number TEXT NOT NULL,
    date           TEXT NOT NULL,
    item_id        TEXT NOT NULL,
    godown_id      TEXT,
    quantity       REAL NOT NULL DEFAULT 0,
    rate           INTEGER NOT NULL DEFAULT 0,
    value          INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (voucher_id, company_id) REFERENCES vouchers(id, company_id) ON DELETE CASCADE,
    FOREIGN KEY (item_id, company_id) REFERENCES items(id, company_id)
);
CREATE INDEX idx_stock_movements_company_date ON stock_movements(company_id, date);
CREATE INDEX idx_stock_movements_item ON stock_movements(item_id);

CREATE TABLE statement_lines (
    id                 TEXT PRIMARY KEY,
    company_id         TEXT NOT NULL,
    ledger_id          TEXT NOT NULL,
    date               TEXT NOT NULL,
    description        TEXT NOT NULL,
    reference          TEXT NOT NULL DEFAULT '',
    amount             INTEGER NOT NULL DEFAULT 0,
    matched_voucher_id TEXT,
    confidence         REAL NOT NULL DEFAULT 0,
    match_reason       TEXT NOT NULL DEFAULT '',
    is_reconciled      INTEGER NOT NULL DEFAULT 0 CHECK (is_reconciled IN (0, 1)),
    UNIQUE (company_id, id),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (ledger_id, company_id) REFERENCES ledgers(id, company_id)
);
CREATE INDEX idx_statement_lines_company_date ON statement_lines(company_id, date);
CREATE INDEX idx_statement_lines_ledger ON statement_lines(ledger_id);

-- Audit trail -------------------------------------------------------------
CREATE TABLE audit_events (
    id            TEXT PRIMARY KEY,
    company_id    TEXT NOT NULL,
    actor         TEXT NOT NULL,
    action        TEXT NOT NULL,
    record_type   TEXT NOT NULL,
    record_id     TEXT NOT NULL,
    record_label  TEXT NOT NULL DEFAULT '',
    timestamp     TEXT NOT NULL,
    detail        TEXT,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);
CREATE INDEX idx_audit_events_company_time ON audit_events(company_id, timestamp);
CREATE INDEX idx_audit_events_action ON audit_events(company_id, action);
"#,
},
Migration {
    version: 2,
    name: "allocations_and_numbering",
    sql: r#"
-- Bill-wise allocation ---------------------------------------------------
-- Which payment settled which invoice. The records are written by the domain
-- layer and stored so the effect can be reconstructed and audited.
CREATE TABLE payment_allocations (
    id                  TEXT PRIMARY KEY,
    company_id          TEXT NOT NULL,
    side                TEXT NOT NULL CHECK (side IN ('receivable', 'payable')),
    payment_voucher_id  TEXT NOT NULL,
    payment_entry_id    TEXT NOT NULL,
    invoice_voucher_id  TEXT NOT NULL,
    invoice_entry_id    TEXT NOT NULL,
    party_id            TEXT NOT NULL,
    amount              INTEGER NOT NULL CHECK (amount > 0),
    created_at          TEXT NOT NULL,
    UNIQUE (company_id, id),
    UNIQUE (company_id, payment_entry_id, invoice_entry_id),
    FOREIGN KEY (payment_voucher_id, company_id) REFERENCES vouchers(id, company_id) ON DELETE CASCADE,
    FOREIGN KEY (invoice_voucher_id, company_id) REFERENCES vouchers(id, company_id) ON DELETE CASCADE,
    FOREIGN KEY (party_id, company_id) REFERENCES ledgers(id, company_id)
);
CREATE INDEX idx_payment_allocations_company ON payment_allocations(company_id);
CREATE INDEX idx_payment_allocations_invoice ON payment_allocations(invoice_voucher_id);
CREATE INDEX idx_payment_allocations_payment ON payment_allocations(payment_voucher_id);

-- Money received or paid that no invoice has settled yet.
CREATE TABLE advances (
    id          TEXT PRIMARY KEY,
    company_id  TEXT NOT NULL,
    side        TEXT NOT NULL CHECK (side IN ('receivable', 'payable')),
    voucher_id  TEXT NOT NULL,
    entry_id    TEXT NOT NULL,
    party_id    TEXT NOT NULL,
    amount      INTEGER NOT NULL CHECK (amount > 0),
    date        TEXT NOT NULL,
    UNIQUE (company_id, id),
    UNIQUE (company_id, voucher_id, entry_id),
    FOREIGN KEY (voucher_id, company_id) REFERENCES vouchers(id, company_id) ON DELETE CASCADE,
    FOREIGN KEY (party_id, company_id) REFERENCES ledgers(id, company_id)
);
CREATE INDEX idx_advances_company ON advances(company_id);

-- Invoice terms -----------------------------------------------------------
ALTER TABLE vouchers ADD COLUMN due_date TEXT;
ALTER TABLE vouchers ADD COLUMN payment_term_id TEXT REFERENCES payment_terms(id);

-- Voucher numbering -------------------------------------------------------
CREATE TABLE voucher_numbering (
    id                    TEXT PRIMARY KEY,
    company_id            TEXT NOT NULL UNIQUE,
    sales_prefix          TEXT NOT NULL DEFAULT 'INV',
    purchase_prefix       TEXT NOT NULL DEFAULT 'PUR',
    payment_prefix        TEXT NOT NULL DEFAULT 'PAY',
    receipt_prefix        TEXT NOT NULL DEFAULT 'RCP',
    contra_prefix         TEXT NOT NULL DEFAULT 'CNT',
    journal_prefix        TEXT NOT NULL DEFAULT 'JNL',
    credit_note_prefix    TEXT NOT NULL DEFAULT 'CN',
    debit_note_prefix     TEXT NOT NULL DEFAULT 'DN',
    sales_order_prefix    TEXT NOT NULL DEFAULT 'SO',
    purchase_order_prefix TEXT NOT NULL DEFAULT 'PO',
    padding               INTEGER NOT NULL DEFAULT 4,
    updated_at            TEXT NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);
"#,
},
Migration {
    version: 3,
    name: "inventory_engine",
    sql: r#"
-- Inventory configuration -------------------------------------------------
CREATE TABLE inventory_accounts (
    id                   TEXT PRIMARY KEY,
    company_id           TEXT NOT NULL UNIQUE,
    inventory_ledger_id  TEXT NOT NULL,
    cogs_ledger_id       TEXT NOT NULL,
    variance_ledger_id   TEXT NOT NULL,
    purchases_ledger_id  TEXT NOT NULL,
    valuation_method     TEXT NOT NULL DEFAULT 'moving-weighted-average',
    input_tax_recoverable INTEGER NOT NULL DEFAULT 1,
    activated_at         TEXT,
    created_at           TEXT NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- A unique index on the parent key columns, so the composite foreign keys
-- below are enforceable.
CREATE UNIQUE INDEX idx_items_id_company ON items(id, company_id);
CREATE UNIQUE INDEX idx_godowns_id_company ON godowns(id, company_id);

-- The durable movement ledger ----------------------------------------------
ALTER TABLE stock_movements ADD COLUMN voucher_item_id TEXT;
ALTER TABLE stock_movements ADD COLUMN movement_type TEXT;
ALTER TABLE stock_movements ADD COLUMN sequence_no INTEGER;
ALTER TABLE stock_movements ADD COLUMN quantity_milli INTEGER;
ALTER TABLE stock_movements ADD COLUMN cost INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stock_movements ADD COLUMN valuation_method TEXT;
ALTER TABLE stock_movements ADD COLUMN resulting_quantity_milli INTEGER;
ALTER TABLE stock_movements ADD COLUMN resulting_carrying_value INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stock_movements ADD COLUMN reverses_movement_id TEXT;
ALTER TABLE stock_movements ADD COLUMN created_at TEXT;

-- Backfill the derived columns of the movements the earlier version wrote.
-- This is a safe, explicit backfill of derived data: it does not change any
-- financial record.
UPDATE stock_movements
   SET quantity_milli = CAST(ROUND(quantity * 1000) AS INTEGER),
       movement_type = CASE WHEN quantity < 0 THEN 'issue' ELSE 'receipt' END,
       valuation_method = 'moving-weighted-average',
       cost = ABS(value),
       resulting_quantity_milli = 0,
       resulting_carrying_value = 0,
       created_at = datetime('now')
 WHERE quantity_milli IS NULL;

-- One movement per voucher line and movement type, so a retry cannot
-- duplicate it.
CREATE UNIQUE INDEX idx_stock_movements_line
    ON stock_movements(company_id, voucher_item_id, movement_type)
    WHERE voucher_item_id IS NOT NULL;

-- The earlier schema already created these two index names: one on the same
-- columns and one on the item alone. Every read of the movement ledger is
-- scoped to a company, so the company-scoped index replaces the narrower one.
DROP INDEX IF EXISTS idx_stock_movements_company_date;
DROP INDEX IF EXISTS idx_stock_movements_item;

CREATE INDEX idx_stock_movements_company_date ON stock_movements(company_id, date);
CREATE INDEX idx_stock_movements_item ON stock_movements(company_id, item_id);

-- The quantity of an item line, of an opening balance and of a reorder level
-- is an exact number of milli-units. The unit-based columns beside them are
-- kept for the screens that display a quantity, and are derived from these.
ALTER TABLE voucher_items ADD COLUMN quantity_milli INTEGER;
ALTER TABLE items ADD COLUMN opening_quantity_milli INTEGER;
ALTER TABLE items ADD COLUMN reorder_level_milli INTEGER;

-- Backfill the derived columns from the figures the earlier version wrote.
-- This is a safe, explicit backfill of derived data: it does not change any
-- financial record.
UPDATE voucher_items
   SET quantity_milli = CAST(ROUND(quantity * 1000) AS INTEGER)
 WHERE quantity_milli IS NULL;

UPDATE items
   SET opening_quantity_milli = CAST(ROUND(opening_quantity * 1000) AS INTEGER),
       reorder_level_milli = CAST(ROUND(reorder_level * 1000) AS INTEGER)
 WHERE opening_quantity_milli IS NULL;

-- The costing pool and the quantity held at each location -----------------
-- The child key columns are listed in the order of the parent key, which is
-- the convention the earlier tables use: the item and the company must match
-- an item row of that company.
CREATE TABLE stock_pools (
    company_id      TEXT NOT NULL,
    item_id         TEXT NOT NULL,
    quantity_milli  INTEGER NOT NULL DEFAULT 0,
    carrying_value  INTEGER NOT NULL DEFAULT 0,
    revision        INTEGER NOT NULL DEFAULT 0,
    updated_at      TEXT NOT NULL,
    PRIMARY KEY (company_id, item_id),
    FOREIGN KEY (item_id, company_id) REFERENCES items(id, company_id) ON DELETE CASCADE
);

CREATE TABLE stock_balances (
    company_id      TEXT NOT NULL,
    item_id         TEXT NOT NULL,
    godown_id       TEXT NOT NULL,
    quantity_milli  INTEGER NOT NULL DEFAULT 0,
    revision        INTEGER NOT NULL DEFAULT 0,
    updated_at      TEXT NOT NULL,
    PRIMARY KEY (company_id, item_id, godown_id),
    FOREIGN KEY (item_id, company_id) REFERENCES items(id, company_id) ON DELETE CASCADE,
    FOREIGN KEY (godown_id, company_id) REFERENCES godowns(id, company_id) ON DELETE CASCADE
);
"#,
},
Migration {
    version: 4,
    name: "orders_and_fulfilment",
    sql: r#"
-- Orders --------------------------------------------------------------------
-- What the customer ordered, or what the company ordered from a supplier. The
-- header carries the state of the order; what has been delivered is read back
-- from the fulfilment rows, so a stored copy cannot drift from the invoices
-- that caused it.
CREATE TABLE orders (
    id               TEXT PRIMARY KEY,
    company_id       TEXT NOT NULL,
    kind             TEXT NOT NULL,
    number           TEXT NOT NULL,
    date             TEXT NOT NULL,
    expected_date    TEXT,
    party_id         TEXT NOT NULL,
    narration        TEXT NOT NULL DEFAULT '',
    reference        TEXT NOT NULL DEFAULT '',
    status           TEXT NOT NULL,
    payment_term_id  TEXT,
    revision         INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    UNIQUE (id, company_id),
    UNIQUE (company_id, number),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);
CREATE INDEX idx_orders_company_date ON orders(company_id, date);
CREATE INDEX idx_orders_company_kind ON orders(company_id, kind);

-- The lines of an order. The quantity is an exact number of milli-units and
-- every amount is in minor units, like every other quantity and figure here.
CREATE TABLE order_lines (
    id               TEXT PRIMARY KEY,
    company_id       TEXT NOT NULL,
    order_id         TEXT NOT NULL,
    item_id          TEXT NOT NULL,
    quantity_milli   INTEGER NOT NULL,
    rate             INTEGER NOT NULL DEFAULT 0,
    discount         INTEGER NOT NULL DEFAULT 0,
    tax_category_id  TEXT,
    amount           INTEGER NOT NULL DEFAULT 0,
    UNIQUE (id, company_id),
    FOREIGN KEY (order_id, company_id) REFERENCES orders(id, company_id) ON DELETE CASCADE,
    FOREIGN KEY (item_id, company_id) REFERENCES items(id, company_id)
);
CREATE INDEX idx_order_lines_order ON order_lines(order_id);

-- What has been delivered against an order line, and by which voucher. The
-- rows are written in the same transaction as the voucher that delivers them,
-- so the two can never disagree. One voucher line can fulfil an order line
-- only once, which is what makes a repeated posting fail instead of
-- delivering twice.
CREATE TABLE order_fulfilments (
    id               TEXT PRIMARY KEY,
    company_id       TEXT NOT NULL,
    order_id         TEXT NOT NULL,
    order_line_id    TEXT NOT NULL,
    voucher_id       TEXT NOT NULL,
    voucher_item_id  TEXT NOT NULL,
    quantity_milli   INTEGER NOT NULL,
    amount           INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL,
    UNIQUE (id, company_id),
    UNIQUE (company_id, order_line_id, voucher_item_id),
    FOREIGN KEY (order_id, company_id) REFERENCES orders(id, company_id) ON DELETE CASCADE,
    FOREIGN KEY (order_line_id, company_id) REFERENCES order_lines(id, company_id) ON DELETE CASCADE
);
CREATE INDEX idx_order_fulfilments_order ON order_fulfilments(order_id);
CREATE INDEX idx_order_fulfilments_line ON order_fulfilments(order_line_id);

-- The history of an order. An amendment keeps the lines as they stood, so the
-- previous quantities are never deleted when the order changes.
CREATE TABLE order_revisions (
    id               TEXT PRIMARY KEY,
    company_id       TEXT NOT NULL,
    order_id         TEXT NOT NULL,
    revision         INTEGER NOT NULL,
    reason           TEXT NOT NULL,
    actor            TEXT NOT NULL DEFAULT '',
    created_at       TEXT NOT NULL,
    UNIQUE (id, company_id),
    FOREIGN KEY (order_id, company_id) REFERENCES orders(id, company_id) ON DELETE CASCADE
);
CREATE INDEX idx_order_revisions_order ON order_revisions(order_id);

CREATE TABLE order_revision_lines (
    id               TEXT PRIMARY KEY,
    company_id       TEXT NOT NULL,
    revision_id      TEXT NOT NULL,
    order_line_id    TEXT NOT NULL,
    item_id          TEXT NOT NULL,
    quantity_milli   INTEGER NOT NULL,
    rate             INTEGER NOT NULL DEFAULT 0,
    discount         INTEGER NOT NULL DEFAULT 0,
    tax_category_id  TEXT,
    amount           INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (revision_id, company_id) REFERENCES order_revisions(id, company_id) ON DELETE CASCADE
);
CREATE INDEX idx_order_revision_lines_revision ON order_revision_lines(revision_id);

-- A unique index on the parent key columns, so the composite foreign keys
-- above are enforceable.
CREATE UNIQUE INDEX idx_orders_id_company ON orders(id, company_id);
CREATE UNIQUE INDEX idx_order_lines_id_company ON order_lines(id, company_id);
CREATE UNIQUE INDEX idx_order_revisions_id_company ON order_revisions(id, company_id);

-- The voucher line that fulfils an order line, and the work in progress
-- account a production order needs.
ALTER TABLE voucher_items ADD COLUMN order_line_id TEXT;
ALTER TABLE inventory_accounts ADD COLUMN production_ledger_id TEXT;
"#,
},
Migration {
    version: 5,
    name: "bom_and_production",
    sql: r#"
-- Bills of materials ---------------------------------------------------------
-- What a finished item is made of. A released structure is immutable, so a
-- change is a new version of the same item.
CREATE TABLE boms (
    id                      TEXT PRIMARY KEY,
    company_id              TEXT NOT NULL,
    item_id                 TEXT NOT NULL,
    version                 INTEGER NOT NULL,
    output_quantity_milli   INTEGER NOT NULL,
    status                  TEXT NOT NULL,
    effective_from          TEXT,
    narration               TEXT NOT NULL DEFAULT '',
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL,
    UNIQUE (id, company_id),
    UNIQUE (company_id, item_id, version),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id, company_id) REFERENCES items(id, company_id)
);
CREATE INDEX idx_boms_company_item ON boms(company_id, item_id);

CREATE TABLE bom_lines (
    id               TEXT PRIMARY KEY,
    company_id       TEXT NOT NULL,
    bom_id           TEXT NOT NULL,
    item_id          TEXT NOT NULL,
    quantity_milli   INTEGER NOT NULL,
    conversion_milli INTEGER NOT NULL DEFAULT 1000,
    created_at       TEXT NOT NULL,
    FOREIGN KEY (bom_id, company_id) REFERENCES boms(id, company_id) ON DELETE CASCADE,
    FOREIGN KEY (item_id, company_id) REFERENCES items(id, company_id)
);
CREATE INDEX idx_bom_lines_bom ON bom_lines(bom_id);

-- Production orders ----------------------------------------------------------
CREATE TABLE production_orders (
    id                        TEXT PRIMARY KEY,
    company_id                TEXT NOT NULL,
    number                    TEXT NOT NULL,
    item_id                   TEXT NOT NULL,
    bom_id                    TEXT NOT NULL,
    bom_version               INTEGER NOT NULL,
    planned_quantity_milli    INTEGER NOT NULL,
    status                    TEXT NOT NULL,
    godown_id                 TEXT NOT NULL,
    planned_at                TEXT NOT NULL,
    narration                 TEXT NOT NULL DEFAULT '',
    revision                  INTEGER NOT NULL DEFAULT 0,
    created_at                TEXT NOT NULL,
    updated_at                TEXT NOT NULL,
    UNIQUE (id, company_id),
    UNIQUE (company_id, number),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id, company_id) REFERENCES items(id, company_id),
    FOREIGN KEY (godown_id, company_id) REFERENCES godowns(id, company_id),
    FOREIGN KEY (bom_id, company_id) REFERENCES boms(id, company_id)
);
CREATE INDEX idx_production_orders_company_date ON production_orders(company_id, planned_at);

-- The components a production order needs, snapshotted when the order was
-- released, so that a later version of the structure cannot change them.
CREATE TABLE production_requirements (
    id                         TEXT PRIMARY KEY,
    company_id                 TEXT NOT NULL,
    production_order_id        TEXT NOT NULL,
    item_id                    TEXT NOT NULL,
    requirement_quantity_milli INTEGER NOT NULL,
    conversion_milli           INTEGER NOT NULL DEFAULT 1000,
    required_quantity_milli    INTEGER NOT NULL,
    issued_quantity_milli      INTEGER NOT NULL DEFAULT 0,
    created_at                 TEXT NOT NULL,
    UNIQUE (id, company_id),
    FOREIGN KEY (production_order_id, company_id) REFERENCES production_orders(id, company_id) ON DELETE CASCADE,
    FOREIGN KEY (item_id, company_id) REFERENCES items(id, company_id)
);
CREATE INDEX idx_production_requirements_order ON production_requirements(production_order_id);

-- One issue of components against a production order. The requirement and the
-- voucher line together identify the issue, so the same line cannot be issued
-- twice.
CREATE TABLE production_issues (
    id                   TEXT PRIMARY KEY,
    company_id           TEXT NOT NULL,
    production_order_id  TEXT NOT NULL,
    requirement_id       TEXT NOT NULL,
    item_id              TEXT NOT NULL,
    godown_id            TEXT NOT NULL,
    quantity_milli       INTEGER NOT NULL,
    rate                 INTEGER NOT NULL DEFAULT 0,
    cost                 INTEGER NOT NULL DEFAULT 0,
    voucher_id           TEXT NOT NULL,
    voucher_item_id      TEXT NOT NULL,
    created_at           TEXT NOT NULL,
    UNIQUE (id, company_id),
    UNIQUE (company_id, requirement_id, voucher_item_id),
    FOREIGN KEY (production_order_id, company_id) REFERENCES production_orders(id, company_id) ON DELETE CASCADE,
    FOREIGN KEY (requirement_id, company_id) REFERENCES production_requirements(id, company_id) ON DELETE CASCADE,
    FOREIGN KEY (item_id, company_id) REFERENCES items(id, company_id),
    FOREIGN KEY (godown_id, company_id) REFERENCES godowns(id, company_id)
);
CREATE INDEX idx_production_issues_order ON production_issues(production_order_id);

-- The receipt of finished goods into stock.
CREATE TABLE production_completions (
    id                   TEXT PRIMARY KEY,
    company_id           TEXT NOT NULL,
    production_order_id  TEXT NOT NULL,
    item_id              TEXT NOT NULL,
    godown_id            TEXT NOT NULL,
    quantity_milli       INTEGER NOT NULL,
    rate                 INTEGER NOT NULL DEFAULT 0,
    cost                 INTEGER NOT NULL DEFAULT 0,
    voucher_id           TEXT NOT NULL,
    voucher_item_id      TEXT NOT NULL,
    created_at           TEXT NOT NULL,
    UNIQUE (id, company_id),
    UNIQUE (company_id, production_order_id, voucher_item_id),
    FOREIGN KEY (production_order_id, company_id) REFERENCES production_orders(id, company_id) ON DELETE CASCADE,
    FOREIGN KEY (item_id, company_id) REFERENCES items(id, company_id),
    FOREIGN KEY (godown_id, company_id) REFERENCES godowns(id, company_id)
);
CREATE INDEX idx_production_completions_order ON production_completions(production_order_id);

-- A unique index on the parent key columns, so the composite foreign keys
-- above are enforceable.
CREATE UNIQUE INDEX idx_boms_id_company ON boms(id, company_id);
CREATE UNIQUE INDEX idx_production_orders_id_company ON production_orders(id, company_id);
CREATE UNIQUE INDEX idx_production_requirements_id_company ON production_requirements(id, company_id);

-- The voucher line that consumes a production requirement, the cost directly
-- attributable to a line, and the destination of a stock transfer.
ALTER TABLE voucher_items ADD COLUMN production_requirement_id TEXT;
ALTER TABLE voucher_items ADD COLUMN direct_cost INTEGER;
ALTER TABLE voucher_items ADD COLUMN to_godown_id TEXT;

-- The direct cost of an item, kept beside the stock it belongs to.
ALTER TABLE items ADD COLUMN direct_cost INTEGER;
"#,
},
Migration {
    version: 6,
    name: "payroll",
    sql: r#"
-- Salary structures -------------------------------------------------------
-- What an employee is paid, versioned and effective-dated. A version that has
-- been used is never edited: a change is a new version of the same structure.
CREATE TABLE salary_structures (
    id              TEXT PRIMARY KEY,
    company_id      TEXT NOT NULL,
    name            TEXT NOT NULL,
    version         INTEGER NOT NULL,
    effective_from  TEXT NOT NULL,
    effective_to    TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    UNIQUE (company_id, id),
    UNIQUE (company_id, name, version),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);
CREATE INDEX idx_salary_structures_company_name
    ON salary_structures(company_id, name, effective_from);

-- The components of a structure. The calculation is a JSON document and the
-- bases are a JSON array, so the shape the domain uses survives the round trip
-- unchanged.
CREATE TABLE salary_structure_components (
    id            TEXT PRIMARY KEY,
    company_id    TEXT NOT NULL,
    structure_id  TEXT NOT NULL,
    code          TEXT NOT NULL,
    name          TEXT NOT NULL,
    kind          TEXT NOT NULL,
    calculation   TEXT NOT NULL,
    bases         TEXT NOT NULL,
    position      INTEGER NOT NULL,
    created_at    TEXT NOT NULL,
    UNIQUE (company_id, id),
    UNIQUE (company_id, structure_id, code),
    FOREIGN KEY (structure_id, company_id) REFERENCES salary_structures(id, company_id) ON DELETE CASCADE
);
CREATE INDEX idx_salary_structure_components_structure
    ON salary_structure_components(structure_id);

-- Which structure an employee is on, from a date.
CREATE TABLE salary_assignments (
    id              TEXT PRIMARY KEY,
    company_id      TEXT NOT NULL,
    employee_id     TEXT NOT NULL,
    structure_id    TEXT NOT NULL,
    effective_from  TEXT NOT NULL,
    effective_to    TEXT,
    created_at      TEXT NOT NULL,
    UNIQUE (company_id, id),
    FOREIGN KEY (employee_id, company_id) REFERENCES employees(id, company_id) ON DELETE CASCADE,
    FOREIGN KEY (structure_id, company_id) REFERENCES salary_structures(id, company_id)
);
CREATE INDEX idx_salary_assignments_employee
    ON salary_assignments(company_id, employee_id, effective_from);

-- What happened in a period for one employee.
CREATE TABLE payroll_attendance (
    id                TEXT PRIMARY KEY,
    company_id        TEXT NOT NULL,
    employee_id       TEXT NOT NULL,
    period            TEXT NOT NULL,
    payable_days      INTEGER NOT NULL DEFAULT 0,
    lop_days          INTEGER NOT NULL DEFAULT 0,
    extra_days        INTEGER NOT NULL DEFAULT 0,
    other_deductions  INTEGER NOT NULL DEFAULT 0,
    note              TEXT NOT NULL DEFAULT '',
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    UNIQUE (company_id, id),
    UNIQUE (company_id, employee_id, period),
    FOREIGN KEY (employee_id, company_id) REFERENCES employees(id, company_id) ON DELETE CASCADE
);
CREATE INDEX idx_payroll_attendance_period ON payroll_attendance(company_id, period);

-- A payroll run -------------------------------------------------------------
-- The calculation and the posting of one period's pay. It is a record of its
-- own, with a lifecycle, so it carries its state and the journal it produced.
CREATE TABLE payroll_runs (
    id                      TEXT PRIMARY KEY,
    company_id              TEXT NOT NULL,
    number                  TEXT NOT NULL,
    period                  TEXT NOT NULL,
    period_start            TEXT NOT NULL,
    period_end              TEXT NOT NULL,
    payment_date            TEXT NOT NULL,
    status                  TEXT NOT NULL,
    employee_count          INTEGER NOT NULL DEFAULT 0,
    gross_earnings          INTEGER NOT NULL DEFAULT 0,
    employee_deductions     INTEGER NOT NULL DEFAULT 0,
    statutory_deductions    INTEGER NOT NULL DEFAULT 0,
    employer_contributions  INTEGER NOT NULL DEFAULT 0,
    net_pay                 INTEGER NOT NULL DEFAULT 0,
    journal_voucher_id      TEXT,
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL,
    revision                INTEGER NOT NULL DEFAULT 0,
    UNIQUE (company_id, id),
    UNIQUE (company_id, number),
    UNIQUE (company_id, journal_voucher_id),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);
CREATE INDEX idx_payroll_runs_company_period ON payroll_runs(company_id, period);

-- The snapshot of one employee's pay. It is never recomputed, so the payslip
-- says what it said when it was issued.
CREATE TABLE payroll_run_snapshots (
    id           TEXT PRIMARY KEY,
    company_id   TEXT NOT NULL,
    run_id       TEXT NOT NULL,
    employee_id  TEXT NOT NULL,
    snapshot     TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    UNIQUE (company_id, id),
    UNIQUE (company_id, run_id, employee_id),
    FOREIGN KEY (run_id, company_id) REFERENCES payroll_runs(id, company_id) ON DELETE CASCADE
);
CREATE INDEX idx_payroll_run_snapshots_run ON payroll_run_snapshots(run_id);

-- A payment of salary, settled by a payment voucher.
CREATE TABLE payroll_payments (
    id                 TEXT PRIMARY KEY,
    company_id         TEXT NOT NULL,
    run_id             TEXT NOT NULL,
    employee_id        TEXT NOT NULL,
    amount             INTEGER NOT NULL DEFAULT 0,
    payment_voucher_id TEXT,
    paid_on            TEXT NOT NULL,
    created_at         TEXT NOT NULL,
    UNIQUE (company_id, id),
    FOREIGN KEY (run_id, company_id) REFERENCES payroll_runs(id, company_id) ON DELETE CASCADE
);
CREATE INDEX idx_payroll_payments_run ON payroll_payments(run_id);

-- The company's payroll accounts. They are configured once, in the same way
-- the inventory accounts are, so that no ledger identifier is ever invented.
CREATE TABLE payroll_accounts (
    id                                    TEXT PRIMARY KEY,
    company_id                            TEXT NOT NULL UNIQUE,
    salary_expense_ledger_id              TEXT NOT NULL,
    net_salary_payable_ledger_id          TEXT NOT NULL,
    employee_deductions_payable_ledger_id TEXT NOT NULL,
    statutory_deductions_payable_ledger_id TEXT NOT NULL,
    employer_contributions_payable_ledger_id TEXT NOT NULL,
    created_at                            TEXT NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- Statutory rules ------------------------------------------------------------
-- Each rule is effective-dated and carries its source, so a person running
-- the payroll can see where a figure came from.
CREATE TABLE statutory_rule_versions (
    id               TEXT PRIMARY KEY,
    company_id       TEXT NOT NULL,
    rule_set         TEXT NOT NULL,
    effective_from   TEXT NOT NULL,
    effective_to     TEXT,
    status           TEXT NOT NULL,
    source           TEXT NOT NULL,
    summary          TEXT NOT NULL DEFAULT '',
    parameters       TEXT NOT NULL,
    acknowledged     INTEGER NOT NULL DEFAULT 0 CHECK (acknowledged IN (0, 1)),
    acknowledged_by  TEXT,
    acknowledged_at  TEXT,
    created_at       TEXT NOT NULL,
    UNIQUE (company_id, id),
    UNIQUE (company_id, rule_set, effective_from),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);
CREATE INDEX idx_statutory_rule_versions_company
    ON statutory_rule_versions(company_id, rule_set, effective_from);

-- A unique index on the parent key columns, so the composite foreign keys
-- above are enforceable.
CREATE UNIQUE INDEX idx_employees_id_company ON employees(id, company_id);
CREATE UNIQUE INDEX idx_salary_structures_id_company ON salary_structures(id, company_id);
CREATE UNIQUE INDEX idx_payroll_runs_id_company ON payroll_runs(id, company_id);

-- The employee, as the payroll needs them: the cost centre they belong to,
-- their tax number and regime, the schemes they contribute to, the state
-- whose professional tax applies and the bank the salary is paid to.
ALTER TABLE employees ADD COLUMN cost_centre_id TEXT;
ALTER TABLE employees ADD COLUMN pan TEXT;
ALTER TABLE employees ADD COLUMN tax_regime TEXT;
ALTER TABLE employees ADD COLUMN is_provident_fund_member INTEGER NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN is_state_insurance_member INTEGER NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN is_person_with_disability INTEGER NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN professional_tax_jurisdiction TEXT;
ALTER TABLE employees ADD COLUMN bank_name TEXT;
ALTER TABLE employees ADD COLUMN bank_account_number TEXT;
ALTER TABLE employees ADD COLUMN bank_ifsc TEXT;
"#,
}];

/// Latest schema version this build understands.
pub fn latest_version() -> i64 {
    MIGRATIONS.iter().map(|m| m.version).max().unwrap_or(0)
}

fn checksum(sql: &str) -> String {
    // A small, stable, non-cryptographic digest is enough to notice that a
    // released migration file was edited.
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in sql.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn ensure_migration_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            name       TEXT NOT NULL,
            checksum   TEXT NOT NULL,
            applied_at TEXT NOT NULL
        );",
    )
}

/// Result of preparing the database for use.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MigrationOutcome {
    pub from_version: i64,
    pub to_version: i64,
    pub applied: Vec<i64>,
}

pub fn migrate(conn: &mut Connection) -> Result<MigrationOutcome, String> {
    ensure_migration_table(conn).map_err(|error| error.to_string())?;

    let current: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;

    let latest = latest_version();
    if current > latest {
        return Err(format!(
            "This database uses schema version {current}, which is newer than this build understands ({latest}). \
             Upgrade LedgerFy before opening these books."
        ));
    }

    // Detect a released migration that was edited after it shipped.
    let mut statement = conn
        .prepare("SELECT version, checksum FROM schema_migrations")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;

    for row in rows {
        let (version, recorded) =
            row.map_err(|error| format!("The migration history could not be read: {error}"))?;
        if let Some(migration) = MIGRATIONS.iter().find(|m| m.version == version) {
            let expected = checksum(migration.sql);
            if expected != recorded {
                return Err(format!(
                    "Migration {version} ('{}') was changed after it was applied. \
                     Released migrations must not be edited; add a new migration instead.",
                    migration.name
                ));
            }
        }
    }
    drop(statement);

    let mut applied = Vec::new();
    for migration in MIGRATIONS.iter().filter(|m| m.version > current) {
        let transaction = conn
            .transaction()
            .map_err(|error| format!("Could not start migration {}: {error}", migration.version))?;

        transaction
            .execute_batch(migration.sql)
            .map_err(|error| {
                format!(
                    "Migration {} ('{}') failed and was rolled back: {error}",
                    migration.version, migration.name
                )
            })?;

        transaction
            .execute(
                "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![
                    migration.version,
                    migration.name,
                    checksum(migration.sql),
                    now_iso()
                ],
            )
            .map_err(|error| format!("Migration {} could not be recorded: {error}", migration.version))?;

        transaction
            .commit()
            .map_err(|error| format!("Migration {} could not be committed: {error}", migration.version))?;

        applied.push(migration.version);
    }

    Ok(MigrationOutcome {
        from_version: current,
        to_version: latest,
        applied,
    })
}

/// Current schema version recorded in the database.
pub fn current_version(conn: &Connection) -> Option<i64> {
    conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )
    .optional()
    .ok()
    .flatten()
}

pub fn now_iso() -> String {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0);
    crate::iso_from_epoch(seconds)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        conn
    }

    #[test]
    fn applies_the_initial_schema_to_an_empty_database() {
        let mut conn = memory();
        let outcome = migrate(&mut conn).unwrap();
        assert_eq!(outcome.from_version, 0);
        assert_eq!(outcome.to_version, latest_version());
        assert_eq!(
            outcome.applied,
            (1..=latest_version()).collect::<Vec<i64>>(),
            "every released migration must be applied in order"
        );

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'vouchers'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn is_idempotent_when_run_twice() {
        let mut conn = memory();
        migrate(&mut conn).unwrap();
        let second = migrate(&mut conn).unwrap();
        assert!(second.applied.is_empty());
        assert_eq!(second.from_version, latest_version());
    }

    #[test]
    fn brings_an_existing_database_up_to_the_latest_version() {
        let mut conn = memory();
        // A database as an earlier build left it: the migrations it was built
        // with are applied and recorded, with rows that must survive the
        // upgrade.
        ensure_migration_table(&conn).unwrap();
        for migration in MIGRATIONS.iter().filter(|m| m.version <= 3) {
            conn.execute_batch(migration.sql).unwrap();
            conn.execute(
                "INSERT INTO schema_migrations (version, name, checksum, applied_at)
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![
                    migration.version,
                    migration.name,
                    checksum(migration.sql),
                    now_iso()
                ],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO companies (id, name, country, base_currency, fiscal_year_start, fiscal_year_end, created_at)
             VALUES ('c1', 'Earlier build', 'India', 'INR', '2026-04-01', '2027-03-31', 'now')",
            [],
        )
        .unwrap();

        let outcome = migrate(&mut conn).unwrap();
        assert_eq!(outcome.from_version, 3);
        assert_eq!(outcome.to_version, latest_version());
        assert_eq!(
            outcome.applied,
            (4..=latest_version()).collect::<Vec<i64>>(),
            "every migration after the earlier build must be applied, in order"
        );

        // The company of the earlier build is still there.
        let name: String = conn
            .query_row("SELECT name FROM companies WHERE id = 'c1'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(name, "Earlier build");

        // The tables of the new migrations are there.
        for table in [
            "orders",
            "order_lines",
            "order_fulfilments",
            "order_revisions",
            "order_revision_lines",
            "boms",
            "bom_lines",
            "production_orders",
            "production_requirements",
            "production_issues",
            "production_completions",
            "salary_structures",
            "salary_structure_components",
            "salary_assignments",
            "payroll_attendance",
            "payroll_runs",
            "payroll_run_snapshots",
            "payroll_payments",
            "payroll_accounts",
            "statutory_rule_versions",
        ] {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    rusqlite::params![table],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "the table {table} must exist after the upgrade");
        }
    }

    #[test]
    fn refuses_a_database_from_a_newer_build() {
        let mut conn = memory();
        migrate(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (99, 'future', 'x', 'now')",
            [],
        )
        .unwrap();
        let error = migrate(&mut conn).unwrap_err();
        assert!(error.contains("newer than this build"));
    }

    #[test]
    fn detects_an_edited_released_migration() {
        let mut conn = memory();
        migrate(&mut conn).unwrap();
        conn.execute(
            "UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1",
            [],
        )
        .unwrap();
        let error = migrate(&mut conn).unwrap_err();
        assert!(error.contains("must not be edited"));
    }

    #[test]
    fn a_failed_migration_leaves_the_previous_version_in_place() {
        let mut conn = memory();
        conn.execute_batch(
            "CREATE TABLE schema_migrations (
                version INTEGER PRIMARY KEY, name TEXT NOT NULL,
                checksum TEXT NOT NULL, applied_at TEXT NOT NULL);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO schema_migrations VALUES (1, 'initial_schema', 'wrong', 'now')",
            [],
        )
        .unwrap();
        // The checksum guard fires before any DDL runs.
        let error = migrate(&mut conn).unwrap_err();
        assert!(error.contains("must not be edited"));
    }

    #[test]
    fn foreign_keys_are_enforced() {
        let mut conn = memory();
        migrate(&mut conn).unwrap();
        let result = conn.execute(
            "INSERT INTO vouchers (id, company_id, kind, number, date, narration, reference, status, created_at, updated_at)
             VALUES ('v1', 'missing-company', 'sales', 'INV-1', '2026-04-01', '', '', 'posted', 'now', 'now')",
            [],
        );
        assert!(result.is_err(), "a voucher for an unknown company must be rejected");
    }
}
