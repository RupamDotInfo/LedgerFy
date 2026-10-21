/**
 * LedgerFy domain model.
 *
 * These types describe accounting concepts only. They carry no framework or
 * persistence concerns so that the same contracts can back the demo
 * repository today and a local SQLite repository later.
 *
 * All monetary values are integers in minor units (paise for INR).
 */

import type { Money } from '@/lib/money'

// ---------------------------------------------------------------------------
// Organisation
// ---------------------------------------------------------------------------

export interface Company {
  id: string
  name: string
  legalName?: string
  country: string
  state?: string
  baseCurrency: string
  /** ISO date, e.g. 2026-04-01 */
  fiscalYearStart: string
  /** ISO date, e.g. 2027-03-31 */
  fiscalYearEnd: string
  gstin?: string
  pan?: string
  address?: string
  phone?: string
  email?: string
  industry?: string
  /** True when the company exists only inside the demo repository. */
  isDemo: boolean
  createdAt: string
}

export interface FinancialYear {
  id: string
  companyId: string
  label: string
  start: string
  end: string
  isClosed: boolean
}

// ---------------------------------------------------------------------------
// Chart of accounts
// ---------------------------------------------------------------------------

export type AccountGroup = 'assets' | 'liabilities' | 'equity' | 'income' | 'expenses'

export type AccountType =
  | 'capital'
  | 'bank'
  | 'cash'
  | 'receivable'
  | 'payable'
  | 'inventory'
  | 'work-in-progress'
  | 'current-assets'
  | 'fixed-assets'
  | 'current-liabilities'
  | 'sales'
  | 'purchase'
  | 'expenses'
  | 'tax'
  | 'contra'

export type PartyKind = 'customer' | 'supplier' | 'both' | null

export interface Ledger {
  id: string
  companyId: string
  name: string
  group: AccountGroup
  type: AccountType
  parentId: string | null
  /**
   * Signed opening balance in minor units. Debit positive, credit negative.
   * This is the amount before any voucher is posted.
   */
  openingBalance: Money
  openingDate: string
  partyKind: PartyKind
  currency: string
  taxNumber?: string
  email?: string
  phone?: string
  address?: string
  /** System ledgers cannot be deleted (cash, bank control accounts, sales ...). */
  isSystem: boolean
  isActive: boolean
  createdAt: string
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export interface StockGroup {
  id: string
  companyId: string
  name: string
  parentId: string | null
}

export interface Unit {
  id: string
  companyId: string
  name: string
  decimalPlaces: number
}

export interface Godown {
  id: string
  companyId: string
  name: string
  location?: string
}

export interface Item {
  id: string
  companyId: string
  name: string
  stockGroupId: string
  unitId: string
  /** Physical goods tracked in quantity. */
  isInventory: boolean
  /** Services carry no stock but can be invoiced. */
  isService: boolean
  purchasePrice: Money
  salesPrice: Money
  hsn?: string
  taxCategoryId: string | null
  /** Opening quantity, in exact milli-units. */
  openingQuantityMilli: number
  openingValue: Money
  /** Reorder level, in exact milli-units. */
  reorderLevelMilli: number
  isActive: boolean
  createdAt: string
}

/**
 * A durable stock movement.
 *
 * The movement ledger is the source of truth for stock history. Every field
 * needed to reconstruct and audit the movement is kept, including the costing
 * result and the balance that followed it.
 */
export interface StockMovement {
  id: string
  companyId: string
  voucherId: string
  /** The voucher line that caused the movement. */
  voucherItemId: string | null
  voucherNumber: string
  date: string
  itemId: string
  godownId: string | null
  movementType:
    | 'opening'
    | 'receipt'
    | 'issue'
    | 'return-in'
    | 'return-out'
    | 'transfer-in'
    | 'transfer-out'
    | 'adjustment-in'
    | 'adjustment-out'
    | 'reversal-in'
    | 'reversal-out'
  direction: 'in' | 'out'
  /** The quantity moved, always positive, in exact milli-units. */
  quantityMilli: number
  /** The unit rate: the purchase cost, or the average cost for an issue. */
  rate: Money
  /** The value of the movement. */
  value: Money
  /** The calculated cost of an issue. Zero for a receipt. */
  cost: Money
  valuationMethod: string
  /** The pool quantity after the movement. */
  resultingQuantityMilli: number
  /** The pool carrying value after the movement. */
  resultingCarryingValue: Money
  /** The movement this one reverses, for a cancellation. */
  reversesMovementId: string | null
  /**
   * The posting sequence, which fixes the order of the ledger.
   *
   * It is assigned by the database when the movement is written, so a movement
   * that has not been written yet does not have one.
   */
  sequenceNo?: number
  createdAt: string
}

/** The costing pool for one item within one company. */
export interface StockPoolBalance {
  companyId: string
  itemId: string
  /** The pool quantity, in exact milli-units. */
  quantityMilli: number
  /** The pool carrying value in minor units. */
  carryingValue: Money
  /** Incremented on every change, so a stale plan can be detected. */
  revision: number
  updatedAt: string
}

/** The quantity held at one location. */
export interface StockLocationBalance {
  companyId: string
  itemId: string
  godownId: string
  /** The quantity at this location, in exact milli-units. */
  quantityMilli: number
  revision: number
  updatedAt: string
}

/**
 * The accounts a company uses for inventory, and the policy in force.
 *
 * The accounts are configured per company rather than hard-coded, so the
 * posting never invents a ledger identifier.
 */
export interface InventoryAccounts {
  id: string
  companyId: string
  /** The inventory asset account. */
  inventoryLedgerId: string
  /** The cost of goods sold account. */
  cogsLedgerId: string
  /** The stock adjustment and variance account. */
  varianceLedgerId: string
  /** The purchase expense account, used for non-stock and service purchases. */
  purchasesLedgerId: string
  /**
   * The work in progress account, which carries the cost of the materials
   * issued to production until the finished goods are received.
   *
   * It is null until a company chooses one, and production cannot be posted
   * until it is chosen.
   */
  productionLedgerId: string | null
  /** The valuation method in force. */
  valuationMethod: string
  /** Whether input tax is recoverable and therefore excluded from stock cost. */
  inputTaxRecoverable: boolean
  /**
   * The date from which stock movements exist. Vouchers dated before it were
   * posted before inventory was activated and have no movement.
   */
  activatedAt: string | null
  createdAt: string
}

// ---------------------------------------------------------------------------
// Taxes
// ---------------------------------------------------------------------------

export type TaxType = 'cgst' | 'sgst' | 'igst' | 'cess' | 'tds' | 'tcs'

export interface TaxCategory {
  id: string
  companyId: string
  name: string
  /** Percentage, e.g. 9 for CGST 9%. */
  rate: number
  type: TaxType
  hsn?: string
  /**
   * Ledger that carries this tax on sales (for example "Output CGST 9%").
   */
  ledgerId: string | null
  /**
   * Ledger that carries this tax on purchases (for example "Input CGST 9%").
   * Falls back to `ledgerId` when the business has no separate input ledger.
   */
  inputLedgerId: string | null
  isActive: boolean
}

// ---------------------------------------------------------------------------
// Vouchers
// ---------------------------------------------------------------------------

export type VoucherType =
  | 'sales'
  | 'purchase'
  | 'payment'
  | 'receipt'
  | 'contra'
  | 'journal'
  | 'credit-note'
  | 'debit-note'
  | 'sales-order'
  | 'purchase-order'
  | 'delivery-note'
  | 'receipt-note'
  | 'stock-journal'

export type VoucherStatus = 'draft' | 'posted' | 'cancelled'

export interface VoucherEntry {
  id: string
  ledgerId: string
  /** Debit amount in minor units. Zero when this is a credit line. */
  debit: Money
  /** Credit amount in minor units. Zero when this is a debit line. */
  credit: Money
  narration?: string
  costCentreId?: string | null
}

export interface VoucherItemLine {
  id: string
  itemId: string
  /**
   * The quantity, in exact milli-units (thousandths of a unit).
   * A quantity is never a binary floating-point value.
   */
  quantityMilli: number
  /** Unit rate in minor units. */
  rate: Money
  /** Absolute discount amount in minor units. */
  discount: Money
  /** Directly attributable acquisition cost captured on the line. */
  directCost?: Money
  taxCategoryId: string | null
  /** Gross line value after discount, before tax. */
  amount: Money
  godownId: string | null
  /** The destination location, used by a stock transfer. */
  toGodownId?: string | null
  /**
   * The order line this line fulfils, when the voucher is an invoice or a
   * purchase voucher raised from an order.
   */
  orderLineId?: string | null
  /**
   * The production requirement this line consumes, when the voucher is a
   * material issue against a production order.
   */
  productionRequirementId?: string | null
  batch?: string
}

export interface VoucherTaxLine {
  id: string
  taxCategoryId: string
  /** Taxable amount the tax was computed on. */
  taxable: Money
  /** Tax amount in minor units. */
  amount: Money
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/** Whether an order is placed with a customer or with a supplier. */
export type OrderKind = 'sales' | 'purchase'

/**
 * The state of the order itself.
 *
 * The fulfilment state is not stored, because it is derived from the
 * fulfilment rows and a stored copy would drift.
 */
export type OrderStatus = 'draft' | 'confirmed' | 'cancelled'

/** The state the application shows, which is always derived. */
export type OrderState =
  | 'draft'
  | 'open'
  | 'partially-fulfilled'
  | 'fulfilled'
  | 'cancelled'

export interface Order {
  id: string
  companyId: string
  kind: OrderKind
  /** Human-facing order number, e.g. SO-0042. */
  number: string
  date: string
  /** The date the goods are expected on. */
  expectedDate: string | null
  /** The customer or the supplier the order is with. */
  partyId: string
  narration: string
  reference: string
  status: OrderStatus
  paymentTermId: string | null
  /** Incremented on every change, so a stale write can be detected. */
  revision: number
  createdAt: string
  updatedAt: string
}

export interface OrderLine {
  id: string
  companyId: string
  orderId: string
  itemId: string
  /** The ordered quantity, in exact milli-units. */
  quantityMilli: number
  rate: Money
  discount: Money
  taxCategoryId: string | null
  /** Gross line value after discount, before tax. */
  amount: Money
}

/**
 * What has been delivered against an order line, and by which voucher.
 *
 * The rows are written in the same transaction as the voucher that delivers
 * them, so the two can never disagree.
 */
export interface OrderFulfilment {
  id: string
  companyId: string
  orderId: string
  orderLineId: string
  voucherId: string
  voucherItemId: string
  quantityMilli: number
  amount: Money
  createdAt: string
}

/** The order as it stood at one revision, so an amendment is not a deletion. */
export interface OrderRevision {
  id: string
  companyId: string
  orderId: string
  revision: number
  reason: string
  actor: string
  createdAt: string
}

export interface OrderRevisionLine {
  id: string
  companyId: string
  revisionId: string
  orderLineId: string
  itemId: string
  quantityMilli: number
  rate: Money
  discount: Money
  taxCategoryId: string | null
  amount: Money
}

// ---------------------------------------------------------------------------
// Bills of materials
// ---------------------------------------------------------------------------

export type BomStatus = 'draft' | 'released' | 'superseded'

/**
 * What a finished item is made of.
 *
 * A released structure is immutable. A change means a new version.
 */
export interface Bom {
  id: string
  companyId: string
  /** The item the structure produces. */
  itemId: string
  version: number
  /** How many units of the finished item the structure makes. */
  outputQuantityMilli: number
  status: BomStatus
  effectiveFrom: string | null
  narration: string
  createdAt: string
  updatedAt: string
}

export interface BomLine {
  id: string
  companyId: string
  bomId: string
  /** The component consumed. */
  itemId: string
  /**
   * The quantity of the component required, per the BOM's output quantity,
   * in exact milli-units of the component's own stock unit.
   */
  quantityMilli: number
  /**
   * How many milli-units of the component's stock unit one unit of the
   * stated quantity is worth. One thousand is one to one.
   */
  conversionMilli: number
  createdAt: string
}

// ---------------------------------------------------------------------------
// Production
// ---------------------------------------------------------------------------

export type ProductionOrderStatus = 'draft' | 'released' | 'completed' | 'cancelled'

/** The state the application shows, which is always derived. */
export type ProductionOrderState =
  | 'draft'
  | 'released'
  | 'in-production'
  | 'completed'
  | 'cancelled'

export interface ProductionOrder {
  id: string
  companyId: string
  /** Human-facing production order number, e.g. PRD-0007. */
  number: string
  /** The item being made. */
  itemId: string
  /** The structure the order was released against. */
  bomId: string
  bomVersion: number
  /** How many units are to be made. */
  plannedQuantityMilli: number
  status: ProductionOrderStatus
  /** The location the finished goods are received into. */
  godownId: string
  plannedAt: string
  narration: string
  /** Incremented on every change, so a stale write can be detected. */
  revision: number
  createdAt: string
  updatedAt: string
}

/**
 * A component of a production order, snapshotted when the order was
 * released so that a later revision of the structure cannot change it.
 */
export interface ProductionRequirement {
  id: string
  companyId: string
  productionOrderId: string
  itemId: string
  /** The quantity required per unit of output. */
  requirementQuantityMilli: number
  conversionMilli: number
  /** The quantity required for the whole planned output. */
  requiredQuantityMilli: number
  /** How much has been issued against it. */
  issuedQuantityMilli: number
  createdAt: string
}

/** One issue of components against a production order. */
export interface ProductionIssue {
  id: string
  companyId: string
  productionOrderId: string
  requirementId: string
  itemId: string
  godownId: string
  quantityMilli: number
  rate: Money
  /** The cost of the issue, at the moving average of the day. */
  cost: Money
  voucherId: string
  voucherItemId: string
  createdAt: string
}

/** The receipt of finished goods into stock. */
export interface ProductionCompletion {
  id: string
  companyId: string
  productionOrderId: string
  itemId: string
  godownId: string
  quantityMilli: number
  rate: Money
  /** The production cost transferred to the finished goods. */
  cost: Money
  voucherId: string
  voucherItemId: string
  createdAt: string
}

export interface Voucher {
  id: string
  companyId: string
  type: VoucherType
  /** Human-facing voucher number, e.g. INV-0042. */
  number: string
  date: string
  /**
   * The date this invoice falls due, derived from the payment term when the
   * voucher was created. Kept on the voucher so a later change to the term
   * cannot silently restate an old invoice.
   */
  dueDate?: string | null
  /** The payment term this voucher was created under, when one was chosen. */
  paymentTermId?: string | null
  partyId: string | null
  narration: string
  /** External reference such as an invoice number or cheque number. */
  reference: string
  status: VoucherStatus
  /** Authoritative double-entry lines. */
  entries: VoucherEntry[]
  /** Item lines, populated for stock-bearing vouchers. */
  items: VoucherItemLine[]
  /** Tax breakup for the voucher. */
  taxes: VoucherTaxLine[]
  /** Set for vouchers linked to an order or another voucher. */
  linkedVoucherId: string | null
  reversedByVoucherId: string | null
  /** True once a voucher has been included in a filed or locked period. */
  isLocked: boolean
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Supporting masters
// ---------------------------------------------------------------------------

export interface CostCentre {
  id: string
  companyId: string
  name: string
  parentId: string | null
  isActive: boolean
}

export interface Employee {
  id: string
  companyId: string
  name: string
  code: string
  department: string
  designation: string
  dateOfJoining: string
  monthlyGross: Money
  isActive: boolean
}

export interface Currency {
  id: string
  companyId: string
  code: string
  name: string
  /** Exchange rate against the base currency. */
  rate: number
  symbol: string
}

export interface PriceList {
  id: string
  companyId: string
  name: string
  isDefault: boolean
}

export interface PriceListEntry {
  priceListId: string
  itemId: string
  rate: Money
}

export interface PaymentTerm {
  id: string
  companyId: string
  name: string
  days: number
}

// ---------------------------------------------------------------------------
// Bank statements and reconciliation
// ---------------------------------------------------------------------------

export interface StatementLine {
  id: string
  companyId: string
  /** Bank ledger the line belongs to. */
  ledgerId: string
  date: string
  description: string
  /** Bank generated reference, e.g. a UTR or cheque number. */
  reference: string
  /** Positive when money came in, negative when money went out. */
  amount: Money
  /** Voucher this line was matched against, when it is reconciled. */
  matchedVoucherId: string | null
  /**
   * Match confidence between 0 and 1 for suggested matches.
   * One means the amount, date and party agree exactly.
   */
  confidence: number
  /** Why the suggestion was made. Shown to the user before confirming. */
  matchReason: string
  /** True when the line has been reconciled and posted. */
  isReconciled: boolean
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditEvent {
  id: string
  companyId: string
  actor: string
  action: string
  recordType: string
  recordId: string
  recordLabel: string
  timestamp: string
  detail?: string
}
