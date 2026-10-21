//! Typed data-transfer objects for the persistence layer.
//!
//! These mirror the TypeScript domain types in `src/domain/types.ts` exactly.
//! Field names are serialised in camelCase so the frontend contract does not
//! change when the backing store changes.
//!
//! Money is always an integer count of minor units. The supported range is
//! bounded by JavaScript's safe integer limit, because amounts cross the
//! JavaScript / Rust / JSON boundary as numbers. Anything outside that range
//! is rejected rather than silently rounded.

use serde::{Deserialize, Serialize};

/// Largest amount that survives a round trip through a JavaScript number.
pub const MAX_MONEY_MINOR: i64 = 9_007_199_254_740_991; // 2^53 - 1

/// Quantities and rates are stored as SQLite REAL. This is the number of
/// decimal places kept when a quantity is written.
pub const QUANTITY_PRECISION: f64 = 1_000.0;

pub fn check_money(value: i64, field: &str) -> Result<(), String> {
    // Compared without `abs`, because `i64::MIN.abs()` overflows.
    if value > MAX_MONEY_MINOR || value < -MAX_MONEY_MINOR {
        return Err(format!(
            "{field} is outside the supported range. The maximum amount is {MAX_MONEY_MINOR} minor units."
        ));
    }
    Ok(())
}

/// Round a quantity to the stored precision.
pub fn round_quantity(value: f64) -> f64 {
    (value * QUANTITY_PRECISION).round() / QUANTITY_PRECISION
}

macro_rules! dto {
    (
        $(#[$meta:meta])*
        pub struct $name:ident { $( $(#[$field_meta:meta])* pub $field:ident : $ty:ty, )* }
    ) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
        #[serde(rename_all = "camelCase")]
        pub struct $name {
            $( $(#[$field_meta])* pub $field: $ty, )*
        }
    };
}

dto! {
    /// A business whose books are held locally.
    pub struct Company {
        pub id: String,
        pub name: String,
        pub legal_name: Option<String>,
        pub country: String,
        pub state: Option<String>,
        pub base_currency: String,
        pub fiscal_year_start: String,
        pub fiscal_year_end: String,
        pub gstin: Option<String>,
        pub pan: Option<String>,
        pub address: Option<String>,
        pub phone: Option<String>,
        pub email: Option<String>,
        pub industry: Option<String>,
        pub is_demo: bool,
        pub created_at: String,
    }
}

dto! {
    pub struct FinancialYear {
        pub id: String,
        pub company_id: String,
        pub label: String,
        pub start: String,
        pub end: String,
        pub is_closed: bool,
    }
}

dto! {
    /// A chart of accounts entry. Parties are ledgers with a party kind.
    pub struct Ledger {
        pub id: String,
        pub company_id: String,
        pub name: String,
        #[serde(rename = "group")]
        pub group_name: String,
        #[serde(rename = "type")]
        pub kind: String,
        pub parent_id: Option<String>,
        pub opening_balance: i64,
        pub opening_date: String,
        pub party_kind: Option<String>,
        pub currency: String,
        pub tax_number: Option<String>,
        pub email: Option<String>,
        pub phone: Option<String>,
        pub address: Option<String>,
        pub is_system: bool,
        pub is_active: bool,
        pub created_at: String,
    }
}

dto! {
    pub struct StockGroup {
        pub id: String,
        pub company_id: String,
        pub name: String,
        pub parent_id: Option<String>,
    }
}

dto! {
    pub struct Unit {
        pub id: String,
        pub company_id: String,
        pub name: String,
        pub decimal_places: i64,
    }
}

dto! {
    pub struct Godown {
        pub id: String,
        pub company_id: String,
        pub name: String,
        pub location: Option<String>,
    }
}

dto! {
    pub struct Item {
        pub id: String,
        pub company_id: String,
        pub name: String,
        pub stock_group_id: String,
        pub unit_id: String,
        pub is_inventory: bool,
        pub is_service: bool,
        pub purchase_price: i64,
        pub sales_price: i64,
        pub hsn: Option<String>,
        pub tax_category_id: Option<String>,
        pub opening_quantity_milli: i64,
        pub opening_value: i64,
        pub reorder_level_milli: i64,
        pub is_active: bool,
        pub created_at: String,
    }
}

dto! {
    pub struct TaxCategory {
        pub id: String,
        pub company_id: String,
        pub name: String,
        pub rate: f64,
        #[serde(rename = "type")]
        pub kind: String,
        pub hsn: Option<String>,
        pub ledger_id: Option<String>,
        pub input_ledger_id: Option<String>,
        pub is_active: bool,
    }
}

dto! {
    pub struct CostCentre {
        pub id: String,
        pub company_id: String,
        pub name: String,
        pub parent_id: Option<String>,
        pub is_active: bool,
    }
}

dto! {
    pub struct Employee {
        pub id: String,
        pub company_id: String,
        pub name: String,
        pub code: String,
        pub department: String,
        pub designation: String,
        pub date_of_joining: String,
        pub monthly_gross: i64,
        pub is_active: bool,
        /// The cost centre the employee belongs to.
        pub cost_centre_id: Option<String>,
        /// The employee's tax number, needed to remit the tax deducted at
        /// source. It is never shown in full and never logged.
        pub pan: Option<String>,
        /// The tax regime the employee has chosen, which decides the slabs.
        pub tax_regime: Option<String>,
        /// Whether the employee contributes to the provident fund.
        #[serde(default)]
        pub is_provident_fund_member: bool,
        /// Whether the employee is covered by the state insurance scheme.
        #[serde(default)]
        pub is_state_insurance_member: bool,
        /// Whether the employee is a person with a disability, whose state
        /// insurance wage ceiling is higher.
        #[serde(default)]
        pub is_person_with_disability: bool,
        /// The state or territory whose professional tax applies.
        pub professional_tax_jurisdiction: Option<String>,
        /// The bank the salary is paid to.
        pub bank_name: Option<String>,
        /// The account the salary is paid to. Never shown in full.
        pub bank_account_number: Option<String>,
        /// The branch identifier of the account. Never shown in full.
        pub bank_ifsc: Option<String>,
    }
}

dto! {
    pub struct Currency {
        pub id: String,
        pub company_id: String,
        pub code: String,
        pub name: String,
        pub rate: f64,
        pub symbol: String,
    }
}

dto! {
    pub struct PriceList {
        pub id: String,
        pub company_id: String,
        pub name: String,
        pub is_default: bool,
    }
}

dto! {
    pub struct PriceListEntry {
        pub price_list_id: String,
        pub item_id: String,
        pub rate: i64,
    }
}

dto! {
    pub struct PaymentTerm {
        pub id: String,
        pub company_id: String,
        pub name: String,
        pub days: i64,
    }
}

dto! {
    pub struct VoucherEntry {
        pub id: String,
        pub ledger_id: String,
        pub debit: i64,
        pub credit: i64,
        pub narration: Option<String>,
        pub cost_centre_id: Option<String>,
    }
}

dto! {
    pub struct VoucherItemLine {
        pub id: String,
        pub item_id: String,
        /// The quantity, in exact milli-units.
        pub quantity_milli: i64,
        pub rate: i64,
        pub discount: i64,
        /// The cost directly attributable to this line.
        pub direct_cost: Option<i64>,
        pub tax_category_id: Option<String>,
        pub amount: i64,
        pub godown_id: Option<String>,
        /// The destination location, used by a stock transfer.
        pub to_godown_id: Option<String>,
        /// The order line this line fulfils.
        pub order_line_id: Option<String>,
        /// The production requirement this line consumes.
        pub production_requirement_id: Option<String>,
        pub batch: Option<String>,
    }
}

dto! {
    pub struct VoucherTaxLine {
        pub id: String,
        pub tax_category_id: String,
        pub taxable: i64,
        pub amount: i64,
    }
}

dto! {
    pub struct Voucher {
        pub id: String,
        pub company_id: String,
        #[serde(rename = "type")]
        pub kind: String,
        pub number: String,
        pub date: String,
        /// The date the invoice falls due, fixed when the voucher was created.
        pub due_date: Option<String>,
        /// The payment term the voucher was created under.
        pub payment_term_id: Option<String>,
        pub party_id: Option<String>,
        pub narration: String,
        pub reference: String,
        pub status: String,
        pub entries: Vec<VoucherEntry>,
        pub items: Vec<VoucherItemLine>,
        pub taxes: Vec<VoucherTaxLine>,
        pub linked_voucher_id: Option<String>,
        pub reversed_by_voucher_id: Option<String>,
        pub is_locked: bool,
        pub created_at: String,
        pub updated_at: String,
    }
}

dto! {
    /// Which payment settled which invoice.
    pub struct AllocationRecord {
        pub id: String,
        pub company_id: String,
        pub side: String,
        pub payment_voucher_id: String,
        pub payment_entry_id: String,
        pub invoice_voucher_id: String,
        pub invoice_entry_id: String,
        pub party_id: String,
        pub amount: i64,
        pub created_at: String,
    }
}

dto! {
    /// Money received or paid that no invoice has settled yet.
    pub struct AdvanceRecord {
        pub id: String,
        pub company_id: String,
        pub side: String,
        pub voucher_id: String,
        pub entry_id: String,
        pub party_id: String,
        pub amount: i64,
        pub date: String,
    }
}

dto! {
    /// The prefixes and padding used for voucher numbers.
    pub struct VoucherNumbering {
        pub id: String,
        pub company_id: String,
        pub sales_prefix: String,
        pub purchase_prefix: String,
        pub payment_prefix: String,
        pub receipt_prefix: String,
        pub contra_prefix: String,
        pub journal_prefix: String,
        pub credit_note_prefix: String,
        pub debit_note_prefix: String,
        pub sales_order_prefix: String,
        pub purchase_order_prefix: String,
        pub padding: i64,
        pub updated_at: String,
    }
}

/// A complete posting: the voucher and every record it implies.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostingPayload {
    pub voucher: Voucher,
    pub entries: Vec<VoucherEntry>,
    pub items: Vec<VoucherItemLine>,
    pub taxes: Vec<VoucherTaxLine>,
    pub allocations: Vec<AllocationRecord>,
    pub advances: Vec<AdvanceRecord>,
    /// The parties whose stored allocations are replaced by this posting.
    pub affected_party_ids: Vec<String>,
    /// The stock movements the voucher causes.
    #[serde(default)]
    pub movements: Vec<PlannedMovement>,
    /// The costing pools after the voucher.
    #[serde(default)]
    pub stock_pools: Vec<StockPoolState>,
    /// The location balances after the voucher.
    #[serde(default)]
    pub stock_locations: Vec<StockLocationState>,
    /// The order lines this voucher fulfils.
    #[serde(default)]
    pub order_fulfilments: Vec<OrderFulfilment>,
    /// The components this voucher issues against production orders.
    #[serde(default)]
    pub production_issues: Vec<ProductionIssue>,
    /// The finished goods this voucher receives into stock.
    #[serde(default)]
    pub production_completions: Vec<ProductionCompletion>,
    pub audit_events: Vec<AuditEvent>,
    pub actor: Option<String>,
}

dto! {
    /// A stock movement that is ready to be written.
    ///
    /// The movement is computed by the domain layer. This layer stores it and
    /// never re-derives a quantity, a rate or a cost.
    pub struct PlannedMovement {
        pub id: String,
        pub company_id: String,
        pub item_id: String,
        pub godown_id: Option<String>,
        pub voucher_id: String,
        /// The voucher line that caused the movement.
        pub voucher_item_id: Option<String>,
        pub movement_type: String,
        pub date: String,
        /// `in` or `out`.
        pub direction: String,
        /// The quantity moved, in exact milli-units.
        pub quantity_milli: i64,
        /// The unit rate: the purchase cost for a receipt, the average cost for an issue.
        pub rate: i64,
        /// The value of the movement.
        pub value: i64,
        /// The calculated cost of an issue. Zero for a receipt.
        pub cost: i64,
        pub valuation_method: String,
        /// The pool quantity after the movement.
        pub resulting_quantity_milli: i64,
        /// The pool carrying value after the movement.
        pub resulting_carrying_value: i64,
        /// The movement this one reverses, for a cancellation.
        pub reverses_movement_id: Option<String>,
        pub created_at: String,
    }
}

dto! {
    /// The costing pool for one item within one company.
    pub struct StockPoolState {
        pub company_id: String,
        pub item_id: String,
        /// The pool quantity, in exact milli-units.
        pub quantity_milli: i64,
        /// The pool carrying value, in minor units.
        pub carrying_value: i64,
        /// Incremented on every change, so a stale plan can be detected.
        pub revision: i64,
        pub updated_at: String,
    }
}

dto! {
    /// The quantity held at one location.
    pub struct StockLocationState {
        pub company_id: String,
        pub item_id: String,
        pub godown_id: String,
        /// The quantity at this location, in exact milli-units.
        pub quantity_milli: i64,
        pub revision: i64,
        pub updated_at: String,
    }
}

dto! {
    /// The accounts a company uses for inventory, and the policy in force.
    pub struct InventoryAccounts {
        pub id: String,
        pub company_id: String,
        /// The inventory asset account.
        pub inventory_ledger_id: String,
        /// The cost of goods sold account.
        pub cogs_ledger_id: String,
        /// The stock adjustment and variance account.
        pub variance_ledger_id: String,
        /// The purchase expense account, used for non-stock and service purchases.
        pub purchases_ledger_id: String,
        /// The work in progress account, which carries the cost of the materials
        /// issued to production until the finished goods are received.
        pub production_ledger_id: Option<String>,
        /// The valuation method in force.
        pub valuation_method: String,
        /// Whether input tax is recoverable and therefore excluded from stock cost.
        pub input_tax_recoverable: bool,
        /// The date from which stock movements exist.
        pub activated_at: Option<String>,
        pub created_at: String,
    }
}

dto! {
    /// A stored stock movement, as the domain reads it.
    pub struct StockMovementRecord {
        pub id: String,
        pub company_id: String,
        pub voucher_id: String,
        /// The voucher line that caused the movement.
        pub voucher_item_id: Option<String>,
        pub voucher_number: String,
        pub date: String,
        pub item_id: String,
        pub godown_id: Option<String>,
        pub movement_type: String,
        /// `in` or `out`.
        pub direction: String,
        /// The quantity moved, in exact milli-units.
        pub quantity_milli: i64,
        /// The unit rate: the purchase cost, or the average cost for an issue.
        pub rate: i64,
        /// The value of the movement.
        pub value: i64,
        /// The calculated cost of an issue. Zero for a receipt.
        pub cost: i64,
        pub valuation_method: String,
        /// The pool quantity after the movement.
        pub resulting_quantity_milli: i64,
        /// The pool carrying value after the movement.
        pub resulting_carrying_value: i64,
        /// The movement this one reverses, for a cancellation.
        pub reverses_movement_id: Option<String>,
        /// The posting sequence, which fixes the order of the ledger.
        ///
        /// It is assigned by the database when the movement is written, so a
        /// movement that is being seeded does not carry one.
        #[serde(default)]
        pub sequence_no: i64,
        pub created_at: String,
    }
}

dto! {
    /// One opening balance: a quantity and a carrying value held at a location.
    pub struct OpeningStockLine {
        pub item_id: String,
        pub godown_id: String,
        /// The quantity, in exact milli-units.
        pub quantity_milli: i64,
        /// The carrying value, in minor units.
        pub carrying_value: i64,
    }
}

dto! {
    /// The request to open a company's stock books at a cutover date.
    ///
    /// It carries the accounts to use, the opening balances to record and the
    /// decision that is being taken, so the write can be audited as one
    /// operation.
    pub struct OpeningStockRequest {
        pub company_id: String,
        /// The date stock tracking starts from.
        pub cutover_date: String,
        pub accounts: InventoryAccounts,
        pub lines: Vec<OpeningStockLine>,
        /// The items the company treats as stock-tracked from the cutover date.
        pub stock_item_ids: Vec<String>,
        /// Why the cutover date was chosen. Recorded in the audit trail.
        pub reason: String,
        pub actor: String,
    }
}

dto! {
    /// What the activation wrote.
    pub struct OpeningStockResult {
        pub accounts: InventoryAccounts,
        pub movements: Vec<StockMovementRecord>,
        pub pools: Vec<StockPoolState>,
        pub locations: Vec<StockLocationState>,
        pub audit_event: AuditEvent,
    }
}

dto! {
    /// The balances the movement ledger implies, and the movements themselves.
    ///
    /// This is what a rebuild produces. It never overwrites the stored
    /// projection and never posts a financial entry.
    pub struct StockRebuildResult {
        pub pools: Vec<StockPoolState>,
        pub locations: Vec<StockLocationState>,
        pub movements: Vec<StockMovementRecord>,
    }
}

dto! {
    pub struct StatementLine {
        pub id: String,
        pub company_id: String,
        pub ledger_id: String,
        pub date: String,
        pub description: String,
        pub reference: String,
        pub amount: i64,
        pub matched_voucher_id: Option<String>,
        pub confidence: f64,
        pub match_reason: String,
        pub is_reconciled: bool,
    }
}

dto! {
    pub struct AuditEvent {
        pub id: String,
        pub company_id: String,
        pub actor: String,
        pub action: String,
        pub record_type: String,
        pub record_id: String,
        pub record_label: String,
        pub timestamp: String,
        pub detail: Option<String>,
    }
}

/// Filters for listing vouchers, mirroring the repository contract.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoucherFilters {
    pub from: Option<String>,
    pub to: Option<String>,
    /// The voucher type. The field is named `type` in the contract.
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub status: Option<String>,
    pub party_id: Option<String>,
    pub ledger_id: Option<String>,
    pub search: Option<String>,
}

// ---------------------------------------------------------------------------
// Orders, bills of materials and production
// ---------------------------------------------------------------------------

dto! {
    /// A sales or purchase order: what was ordered, and in which state it is.
    ///
    /// The state of the order is stored here. What has been delivered is read
    /// back from the fulfilment rows, so a stored copy cannot drift from the
    /// invoices that caused it.
    pub struct Order {
        pub id: String,
        pub company_id: String,
        /// `sales` or `purchase`.
        pub kind: String,
        pub number: String,
        pub date: String,
        /// The date the goods are expected on.
        pub expected_date: Option<String>,
        /// The customer or the supplier the order is with.
        pub party_id: String,
        pub narration: String,
        pub reference: String,
        /// `draft`, `confirmed` or `cancelled`.
        pub status: String,
        pub payment_term_id: Option<String>,
        /// Incremented on every change, so a stale write can be detected.
        pub revision: i64,
        pub created_at: String,
        pub updated_at: String,
    }
}

dto! {
    /// One line of an order: what was ordered, and at what price.
    pub struct OrderLine {
        pub id: String,
        pub company_id: String,
        pub order_id: String,
        pub item_id: String,
        /// The ordered quantity, in exact milli-units.
        pub quantity_milli: i64,
        pub rate: i64,
        pub discount: i64,
        pub tax_category_id: Option<String>,
        /// Gross line value after discount, before tax.
        pub amount: i64,
    }
}

dto! {
    /// What has been delivered against an order line, and by which voucher.
    ///
    /// The rows are written in the same transaction as the voucher that
    /// delivers them, so the two can never disagree.
    pub struct OrderFulfilment {
        pub id: String,
        pub company_id: String,
        pub order_id: String,
        pub order_line_id: String,
        pub voucher_id: String,
        pub voucher_item_id: String,
        /// The delivered quantity, in exact milli-units.
        pub quantity_milli: i64,
        pub amount: i64,
        pub created_at: String,
    }
}

dto! {
    /// The order as it stood at one revision, so an amendment is not a deletion.
    pub struct OrderRevision {
        pub id: String,
        pub company_id: String,
        pub order_id: String,
        pub revision: i64,
        pub reason: String,
        pub actor: String,
        pub created_at: String,
    }
}

dto! {
    /// One line of an order, as it stood before an amendment.
    pub struct OrderRevisionLine {
        pub id: String,
        pub company_id: String,
        pub revision_id: String,
        pub order_line_id: String,
        pub item_id: String,
        /// The quantity, in exact milli-units.
        pub quantity_milli: i64,
        pub rate: i64,
        pub discount: i64,
        pub tax_category_id: Option<String>,
        pub amount: i64,
    }
}

dto! {
    /// An order with its lines, as the order list reads it.
    pub struct OrderSummary {
        pub order: Order,
        pub lines: Vec<OrderLine>,
    }
}

dto! {
    /// An order with everything known about it: its lines, what has been
    /// delivered against them, and the history of its amendments.
    pub struct OrderDetail {
        pub order: Order,
        pub lines: Vec<OrderLine>,
        pub fulfilments: Vec<OrderFulfilment>,
        pub revisions: Vec<OrderRevision>,
        pub revision_lines: Vec<OrderRevisionLine>,
    }
}

dto! {
    /// What a finished item is made of.
    ///
    /// A released structure is immutable. A change means a new version.
    pub struct Bom {
        pub id: String,
        pub company_id: String,
        /// The item the structure produces.
        pub item_id: String,
        pub version: i64,
        /// How many units of the finished item the structure makes.
        pub output_quantity_milli: i64,
        /// `draft`, `released` or `superseded`.
        pub status: String,
        pub effective_from: Option<String>,
        pub narration: String,
        pub created_at: String,
        pub updated_at: String,
    }
}

dto! {
    /// One component of a bill of materials.
    pub struct BomLine {
        pub id: String,
        pub company_id: String,
        pub bom_id: String,
        /// The component consumed.
        pub item_id: String,
        /// The quantity of the component required, per the structure's output
        /// quantity, in exact milli-units of the component's own stock unit.
        pub quantity_milli: i64,
        /// How many milli-units of the component's stock unit one unit of the
        /// stated quantity is worth. One thousand is one to one.
        pub conversion_milli: i64,
        pub created_at: String,
    }
}

dto! {
    /// A bill of materials with its component lines.
    pub struct BomDetail {
        pub bom: Bom,
        pub lines: Vec<BomLine>,
    }
}

dto! {
    /// An order to make something, against a released structure.
    pub struct ProductionOrder {
        pub id: String,
        pub company_id: String,
        /// Human-facing production order number, e.g. PRD-0007.
        pub number: String,
        /// The item being made.
        pub item_id: String,
        /// The structure the order was released against.
        pub bom_id: String,
        pub bom_version: i64,
        /// How many units are to be made.
        pub planned_quantity_milli: i64,
        /// `draft`, `released` or `cancelled`.
        pub status: String,
        /// The location the finished goods are received into.
        pub godown_id: String,
        pub planned_at: String,
        pub narration: String,
        /// Incremented on every change, so a stale write can be detected.
        pub revision: i64,
        pub created_at: String,
        pub updated_at: String,
    }
}

dto! {
    /// A component of a production order, snapshotted when the order was
    /// released so that a later revision of the structure cannot change it.
    pub struct ProductionRequirement {
        pub id: String,
        pub company_id: String,
        pub production_order_id: String,
        pub item_id: String,
        /// The quantity required per unit of output.
        pub requirement_quantity_milli: i64,
        pub conversion_milli: i64,
        /// The quantity required for the whole planned output.
        pub required_quantity_milli: i64,
        /// How much has been issued against it.
        pub issued_quantity_milli: i64,
        pub created_at: String,
    }
}

dto! {
    /// One issue of components against a production order.
    pub struct ProductionIssue {
        pub id: String,
        pub company_id: String,
        pub production_order_id: String,
        pub requirement_id: String,
        pub item_id: String,
        pub godown_id: String,
        /// The issued quantity, in exact milli-units.
        pub quantity_milli: i64,
        pub rate: i64,
        /// The cost of the issue, at the moving average of the day.
        pub cost: i64,
        pub voucher_id: String,
        pub voucher_item_id: String,
        pub created_at: String,
    }
}

dto! {
    /// The receipt of finished goods into stock.
    pub struct ProductionCompletion {
        pub id: String,
        pub company_id: String,
        pub production_order_id: String,
        pub item_id: String,
        pub godown_id: String,
        /// The received quantity, in exact milli-units.
        pub quantity_milli: i64,
        pub rate: i64,
        /// The production cost transferred to the finished goods.
        pub cost: i64,
        pub voucher_id: String,
        pub voucher_item_id: String,
        pub created_at: String,
    }
}

dto! {
    /// A production order with its requirements, its issues and its
    /// completions.
    pub struct ProductionOrderDetail {
        pub order: ProductionOrder,
        pub requirements: Vec<ProductionRequirement>,
        pub issues: Vec<ProductionIssue>,
        pub completions: Vec<ProductionCompletion>,
    }
}

/// Filters for listing audit events.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditFilters {
    pub from: Option<String>,
    pub to: Option<String>,
    pub actor: Option<String>,
    pub action: Option<String>,
    pub record_type: Option<String>,
}

/// Where the database lives and what state it is in.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseStatus {
    pub path: String,
    pub initialized: bool,
    pub schema_version: i64,
    pub company_count: i64,
    pub error: Option<String>,
}

/// A verified backup of the local database.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub created_at: String,
    /// True when the snapshot was reopened and its contents verified.
    pub verified: bool,
}

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------

dto! {
    /// One component of a salary structure.
    ///
    /// A component of a released structure never changes; a change means a new
    /// version of the structure.
    pub struct SalaryComponent {
        pub id: String,
        pub company_id: String,
        pub structure_id: String,
        /// The component's code, unique within the structure.
        pub code: String,
        pub name: String,
        /// What the component does to the pay: `earning`,
        /// `employer-contribution`, `employee-deduction` or `reimbursement`.
        pub kind: String,
        /// How the component is computed, as a JSON document.
        #[serde(default)]
        pub calculation: serde_json::Value,
        /// The statutory bases this component counts towards, as a JSON array.
        #[serde(default)]
        pub bases: serde_json::Value,
        /// The order the component is calculated in.
        pub position: i64,
    }
}

dto! {
    /// A salary structure, versioned and effective-dated.
    pub struct SalaryStructure {
        pub id: String,
        pub company_id: String,
        pub name: String,
        pub version: i64,
        /// The date from which this version applies.
        pub effective_from: String,
        /// The date after which it no longer applies. Null while it is the
        /// current one.
        pub effective_to: Option<String>,
        pub is_active: bool,
        pub created_at: String,
        pub updated_at: String,
    }
}

dto! {
    /// A salary structure and the components it is made of.
    pub struct SalaryStructureDetail {
        pub structure: SalaryStructure,
        pub components: Vec<SalaryComponent>,
    }
}

dto! {
    /// An employee's assignment to a salary structure, from a date.
    pub struct SalaryAssignment {
        pub id: String,
        pub company_id: String,
        pub employee_id: String,
        pub structure_id: String,
        pub effective_from: String,
        pub effective_to: Option<String>,
        pub created_at: String,
    }
}

dto! {
    /// What happened in a period for one employee.
    pub struct PayrollAttendance {
        pub id: String,
        pub company_id: String,
        pub employee_id: String,
        /// The period, as `YYYY-MM`.
        pub period: String,
        /// The days the employee is paid for.
        pub payable_days: i64,
        /// The days lost without pay.
        pub lop_days: i64,
        /// Days paid at a different rate, such as overtime.
        pub extra_days: i64,
        /// Other deductions recovered from the employee, in minor units.
        pub other_deductions: i64,
        pub note: String,
        pub created_at: String,
        pub updated_at: String,
    }
}

dto! {
    /// A payroll run: the calculation and the posting of one period's pay.
    pub struct PayrollRun {
        pub id: String,
        pub company_id: String,
        /// The run number, e.g. `PR-2026-04`.
        pub number: String,
        /// The period, as `YYYY-MM`.
        pub period: String,
        pub period_start: String,
        pub period_end: String,
        /// The date the salary is paid, which the tax rule is chosen by.
        pub payment_date: String,
        /// `draft`, `calculated`, `approved`, `posted`, `paid`, `cancelled` or
        /// `reversed`.
        pub status: String,
        /// The employees in the run.
        pub employee_count: i64,
        /// The totals, in minor units.
        pub gross_earnings: i64,
        pub employee_deductions: i64,
        pub statutory_deductions: i64,
        pub employer_contributions: i64,
        pub net_pay: i64,
        /// The journal voucher that carries the payroll, once it is posted.
        pub journal_voucher_id: Option<String>,
        pub created_at: String,
        pub updated_at: String,
        pub revision: i64,
    }
}

dto! {
    /// One employee's pay, as it was calculated.
    ///
    /// The snapshot is never recomputed, so the payslip is rendered from it.
    pub struct PayrollSnapshot {
        pub id: String,
        pub company_id: String,
        pub run_id: String,
        pub employee_id: String,
        /// The figures, exactly as they were calculated, as a JSON document.
        #[serde(default)]
        pub snapshot: serde_json::Value,
        pub created_at: String,
    }
}

dto! {
    /// A payroll run and the snapshots it carries.
    pub struct PayrollRunDetail {
        pub run: PayrollRun,
        pub snapshots: Vec<PayrollSnapshot>,
    }
}

dto! {
    /// A payment of salary, settled by a payment voucher.
    pub struct PayrollPayment {
        pub id: String,
        pub company_id: String,
        pub run_id: String,
        pub employee_id: String,
        /// The amount paid.
        pub amount: i64,
        /// The payment voucher that settled it.
        pub payment_voucher_id: Option<String>,
        /// The date it was paid.
        pub paid_on: String,
        pub created_at: String,
    }
}

dto! {
    /// The company's payroll accounts.
    pub struct PayrollAccounts {
        pub id: String,
        pub company_id: String,
        /// The cost of employment: the earnings and the employer's
        /// contributions.
        pub salary_expense_ledger_id: String,
        /// What is owed to the employees.
        pub net_salary_payable_ledger_id: String,
        /// The employees' own provident fund and state insurance.
        pub employee_deductions_payable_ledger_id: String,
        /// Professional tax and salary tax deducted at source.
        pub statutory_deductions_payable_ledger_id: String,
        /// The employer's provident fund and state insurance.
        pub employer_contributions_payable_ledger_id: String,
        pub created_at: String,
    }
}

dto! {
    /// One version of a statutory rule, effective-dated.
    ///
    /// A rule carries its source and its status. A rule that is not in force
    /// blocks the run until a person with the authority to decide
    /// acknowledges it, and the acknowledgement is recorded.
    pub struct StatutoryRuleVersion {
        pub id: String,
        pub company_id: String,
        /// The rule set: `epf`, `esic`, `professional-tax` or `salary-tds`.
        pub rule_set: String,
        /// The date from which this version applies.
        pub effective_from: String,
        /// The date after which it no longer applies. Null for the current one.
        pub effective_to: Option<String>,
        /// `in-force`, `proposed` or `out-of-scope`.
        pub status: String,
        /// Where the rule came from.
        pub source: String,
        /// A short statement of what the rule says.
        pub summary: String,
        /// The parameters of the rule, as a JSON document.
        #[serde(default)]
        pub parameters: serde_json::Value,
        /// True when a person has acknowledged a rule that is not in force.
        pub acknowledged: bool,
        pub acknowledged_by: Option<String>,
        pub acknowledged_at: Option<String>,
        pub created_at: String,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn money_range_is_enforced() {
        assert!(check_money(0, "amount").is_ok());
        assert!(check_money(MAX_MONEY_MINOR, "amount").is_ok());
        assert!(check_money(-MAX_MONEY_MINOR, "amount").is_ok());
        assert!(check_money(MAX_MONEY_MINOR + 1, "amount").is_err());
        assert!(check_money(i64::MIN, "amount").is_err());
    }

    #[test]
    fn quantities_are_rounded_to_the_stored_precision() {
        assert_eq!(round_quantity(1.23456), 1.235);
        assert_eq!(round_quantity(10.0), 10.0);
        assert_eq!(round_quantity(-2.5), -2.5);
    }

    #[test]
    fn voucher_serialises_with_the_domain_field_names() {
        let voucher = Voucher {
            id: "v1".into(),
            company_id: "c1".into(),
            kind: "sales".into(),
            number: "INV-0001".into(),
            date: "2026-04-01".into(),
            due_date: None,
            payment_term_id: None,
            party_id: None,
            narration: "Test".into(),
            reference: String::new(),
            status: "posted".into(),
            entries: vec![VoucherEntry {
                id: "e1".into(),
                ledger_id: "l1".into(),
                debit: 100,
                credit: 0,
                narration: None,
                cost_centre_id: None,
            }],
            items: vec![],
            taxes: vec![],
            linked_voucher_id: None,
            reversed_by_voucher_id: None,
            is_locked: false,
            created_at: "2026-04-01T00:00:00.000Z".into(),
            updated_at: "2026-04-01T00:00:00.000Z".into(),
        };

        let json = serde_json::to_value(&voucher).unwrap();
        assert_eq!(json["type"], "sales");
        assert_eq!(json["companyId"], "c1");
        assert_eq!(json["entries"][0]["ledgerId"], "l1");
        assert!(json.get("kind").is_none());
    }

    #[test]
    fn a_voucher_item_line_reads_the_optional_fields_the_application_leaves_out() {
        // The application sends the fields it has. The optional ones are
        // absent, not null, so they must read as empty rather than fail.
        let json = r#"{
            "id": "i1",
            "itemId": "item-1",
            "quantityMilli": 1000,
            "rate": 10000,
            "discount": 0,
            "taxCategoryId": null,
            "amount": 10000,
            "godownId": "g1"
        }"#;

        let line: VoucherItemLine = serde_json::from_str(json).unwrap();
        assert_eq!(line.id, "i1");
        assert_eq!(line.quantity_milli, 1_000);
        assert_eq!(line.direct_cost, None);
        assert_eq!(line.to_godown_id, None);
        assert_eq!(line.order_line_id, None);
        assert_eq!(line.production_requirement_id, None);
        assert_eq!(line.batch, None);
    }

    #[test]
    fn a_posting_payload_reads_the_new_records_as_empty_when_they_are_absent() {
        // An application that knows nothing of orders or production still
        // posts a voucher, so the new lists are optional.
        let json = r#"{
            "voucher": {
                "id": "v1", "companyId": "c1", "type": "sales", "number": "INV-0001",
                "date": "2026-04-01", "partyId": null, "narration": "", "reference": "",
                "status": "posted", "entries": [], "items": [], "taxes": [],
                "linkedVoucherId": null, "reversedByVoucherId": null, "isLocked": false,
                "createdAt": "2026-04-01", "updatedAt": "2026-04-01"
            },
            "entries": [], "items": [], "taxes": [], "allocations": [], "advances": [],
            "affectedPartyIds": [], "auditEvents": []
        }"#;

        let payload: PostingPayload = serde_json::from_str(json).unwrap();
        assert!(payload.order_fulfilments.is_empty());
        assert!(payload.production_issues.is_empty());
        assert!(payload.production_completions.is_empty());
    }
}
