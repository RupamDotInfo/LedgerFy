/**
 * LedgerFy repository contracts.
 *
 * The UI talks to these interfaces only. The demo repository and the future
 * local SQLite repository are interchangeable behind them, which is what lets
 * the interface be validated now and rewired to real persistence later.
 */

import type { Money } from '@/lib/money'
import type {
  AuditEvent,
  Bom,
  BomLine,
  Company,
  CostCentre,
  Currency,
  Employee,
  FinancialYear,
  Godown,
  InventoryAccounts,
  Item,
  Ledger,
  Order,
  OrderFulfilment,
  OrderKind,
  OrderLine,
  OrderRevision,
  OrderRevisionLine,
  PaymentTerm,
  PayrollAccounts,
  PayrollAttendance,
  PayrollPayment,
  PayrollRun,
  PayrollSnapshot,
  PriceList,
  PriceListEntry,
  ProductionCompletion,
  ProductionIssue,
  ProductionOrder,
  ProductionRequirement,
  SalaryAssignment,
  SalaryComponent,
  SalaryStructure,
  StatementLine,
  StatutoryRuleVersion,
  StockGroup,
  StockLocationBalance,
  StockMovement,
  StockPoolBalance,
  TaxCategory,
  Unit,
  Voucher,
  VoucherEntry,
  VoucherStatus,
  VoucherType,
} from '@/domain/types'
import type { AdvanceRecord, AllocationRecord } from '@/domain/allocations'
import type { ProductionIssueInput } from '@/domain/production'

/**
 * One opening balance: a quantity and a carrying value held at a location.
 *
 * The quantity is in exact milli-units and the carrying value in minor units.
 */
export interface OpeningStockLine {
  itemId: string
  godownId: string
  quantityMilli: number
  carryingValue: number
}

/**
 * The request to open a company's stock books at a cutover date.
 *
 * It carries the accounts to use, the opening balances to record and the
 * decision that is being taken, so the write can be audited as one operation.
 */
export interface OpeningStockRequest {
  companyId: string
  /** The date stock tracking starts from. */
  cutoverDate: string
  accounts: InventoryAccounts
  lines: OpeningStockLine[]
  /** The items the company treats as stock-tracked from the cutover date. */
  stockItemIds: string[]
  /** Why the cutover date was chosen. Recorded in the audit trail. */
  reason: string
  actor: string
}

/** What the activation wrote. */
export interface OpeningStockResult {
  accounts: InventoryAccounts
  movements: StockMovement[]
  pools: StockPoolBalance[]
  locations: StockLocationBalance[]
  auditEvent: AuditEvent
}

export interface VoucherNumbering {
  id: string
  companyId: string
  salesPrefix: string
  purchasePrefix: string
  paymentPrefix: string
  receiptPrefix: string
  contraPrefix: string
  journalPrefix: string
  creditNotePrefix: string
  debitNotePrefix: string
  salesOrderPrefix: string
  purchaseOrderPrefix: string
  padding: number
  updatedAt: string
}

export type RepositoryKind = 'demo' | 'local'

export interface RepositoryInfo {
  kind: RepositoryKind
  label: string
  /** True when records are examples rather than a customer's own books. */
  isSampleData: boolean
}

export interface NewCompanyInput {
  name: string
  legalName?: string
  country: string
  state?: string
  baseCurrency: string
  fiscalYearStart: string
  fiscalYearEnd: string
  gstin?: string
  pan?: string
  address?: string
  phone?: string
  email?: string
  industry?: string
}

export interface VoucherFilters {
  from?: string
  to?: string
  type?: VoucherType | 'all'
  status?: VoucherStatus | 'all'
  partyId?: string | null
  ledgerId?: string | null
  search?: string
}

export interface AuditFilters {
  from?: string
  to?: string
  actor?: string
  action?: string
  recordType?: string
}

export interface DateRange {
  from: string
  to: string
}

/**
 * An order with everything that hangs off it.
 *
 * The fulfilments and the revision history are part of the order, because
 * the state the application shows is derived from them.
 */
export interface OrderWithLines {
  order: Order
  lines: OrderLine[]
  fulfilments: OrderFulfilment[]
  revisions: OrderRevision[]
  revisionLines: OrderRevisionLine[]
}

export interface BomWithLines {
  bom: Bom
  lines: BomLine[]
}

/** A production order with its requirements, issues and completions. */
export interface ProductionOrderWithDetail {
  order: ProductionOrder
  requirements: ProductionRequirement[]
  issues: ProductionIssue[]
  completions: ProductionCompletion[]
}

/** What a material issue produced. */
export interface ProductionIssueResult {
  voucher: Voucher
  issues: ProductionIssue[]
  requirements: ProductionRequirement[]
}

/** What a completion produced. */
export interface ProductionCompletionResult {
  voucher: Voucher
  completions: ProductionCompletion[]
  requirements: ProductionRequirement[]
}

/**
 * A salary structure with the components that make it up.
 *
 * A structure is versioned, so the components belong to the version and are
 * never edited under a run that has already used them.
 */
export interface SalaryStructureDetail {
  structure: SalaryStructure
  components: SalaryComponent[]
}

/**
 * A payroll run with the snapshot each employee's pay was taken from.
 *
 * The snapshot is the record of the calculation. The payslip is rendered from
 * it and is never recomputed, so a payslip issued last month still says what
 * it said.
 */
export interface PayrollRunDetail {
  run: PayrollRun
  snapshots: PayrollSnapshot[]
}

export interface OutstandingSummary {
  count: number
  amount: Money
}

export interface MonthlyPoint {
  label: string
  income: Money
  expense: Money
}

export interface AttentionItem {
  id: string
  title: string
  detail: string
  tone: 'warning' | 'danger' | 'info' | 'positive'
  route?: string
}

export interface PartyExposure {
  ledgerId: string
  name: string
  amount: Money
  count: number
}

export interface StockAlert {
  itemId: string
  name: string
  unit: string
  quantity: number
  reorderLevel: number
}

export interface GstSnapshot {
  /** Tax period the summary covers, e.g. "2026-10". */
  period: string
  /** Tax on sales for the period. */
  outputTax: Money
  /** Tax paid on purchases, available as input credit. */
  inputTax: Money
  /** Input credit that can actually be claimed, after the eligible portion. */
  itcEligible: Money
  /** Output tax less eligible input credit. */
  cashChallanDue: Money
  salesVoucherCount: number
  purchaseVoucherCount: number
  /** Sales invoices above the statutory e-way bill threshold. */
  invoicesAboveEwayThreshold: number
  ewayThreshold: Money
}

export interface CashPositionLine {
  ledgerId: string
  name: string
  amount: Money
  kind: 'cash' | 'bank'
}

export interface DashboardSnapshot {
  range: DateRange
  cash: { cash: Money; bank: Money; total: Money }
  cashBreakdown: CashPositionLine[]
  receivables: Money
  payables: Money
  sales: Money
  purchases: Money
  expenses: Money
  profit: Money
  marginPercent: number
  pendingBills: OutstandingSummary
  overdueReceivables: OutstandingSummary
  /** Customer invoices still awaiting payment in the period. */
  openInvoices: OutstandingSummary
  recentVouchers: Voucher[]
  monthly: MonthlyPoint[]
  topReceivables: PartyExposure[]
  topPayables: PartyExposure[]
  lowStock: StockAlert[]
  attention: AttentionItem[]
  bankReconciliation: BankReconciliationSummary[]
  gst: GstSnapshot
}

export interface BankReconciliationSummary {
  ledgerId: string
  ledgerName: string
  total: number
  reconciled: number
  unmatched: number
  reconciledAmount: Money
  unmatchedAmount: Money
  percentage: number
}

export interface LedgerFyRepository {
  readonly info: RepositoryInfo

  listCompanies(): Promise<Company[]>
  getCompany(id: string): Promise<Company | null>
  createCompany(input: NewCompanyInput): Promise<Company>
  listFinancialYears(companyId: string): Promise<FinancialYear[]>

  listLedgers(companyId: string): Promise<Ledger[]>
  saveLedger(ledger: Ledger): Promise<Ledger>
  /** Mark a ledger inactive instead of deleting a record that has history. */
  deactivateLedger(companyId: string, id: string): Promise<void>
  listItems(companyId: string): Promise<Item[]>
  saveItem(item: Item): Promise<Item>
  listStockGroups(companyId: string): Promise<StockGroup[]>
  saveStockGroup(group: StockGroup): Promise<StockGroup>
  listUnits(companyId: string): Promise<Unit[]>
  saveUnit(unit: Unit): Promise<Unit>
  listGodowns(companyId: string): Promise<Godown[]>
  saveGodown(godown: Godown): Promise<Godown>
  listTaxCategories(companyId: string): Promise<TaxCategory[]>
  saveTaxCategory(tax: TaxCategory): Promise<TaxCategory>
  listCostCentres(companyId: string): Promise<CostCentre[]>
  saveCostCentre(centre: CostCentre): Promise<CostCentre>
  listEmployees(companyId: string): Promise<Employee[]>
  saveEmployee(employee: Employee): Promise<Employee>
  listCurrencies(companyId: string): Promise<Currency[]>
  saveCurrency(currency: Currency): Promise<Currency>
  listPriceLists(companyId: string): Promise<PriceList[]>
  savePriceList(priceList: PriceList): Promise<PriceList>
  listPriceListEntries(companyId: string, priceListId: string): Promise<PriceListEntry[]>
  savePriceListEntries(
    companyId: string,
    priceListId: string,
    entries: PriceListEntry[],
  ): Promise<PriceListEntry[]>
  listPaymentTerms(companyId: string): Promise<PaymentTerm[]>
  savePaymentTerm(term: PaymentTerm): Promise<PaymentTerm>

  listVouchers(companyId: string, filters?: VoucherFilters): Promise<Voucher[]>
  getVoucher(companyId: string, id: string): Promise<Voucher | null>
  /**
   * Save a voucher without any financial effect. A draft does not allocate,
   * does not move stock and does not appear in reports.
   */
  saveVoucher(voucher: Voucher): Promise<Voucher>
  /**
   * Post a voucher and everything it implies in one transaction: the
   * entries, the tax lines, the bill-wise allocations it settles and the
   * audit event.
   */
  postVoucher(voucher: Voucher): Promise<Voucher>
  /**
   * Cancel a voucher, withdrawing its financial effect and releasing the
   * allocations it held so the outstanding balances are restored.
   */
  cancelVoucher(voucher: Voucher): Promise<Voucher>
  deleteVoucher(companyId: string, id: string): Promise<void>
  nextVoucherNumber(companyId: string, type: VoucherType): Promise<string>
  listAllocations(companyId: string): Promise<AllocationRecord[]>
  listAdvances(companyId: string): Promise<AdvanceRecord[]>
  updateCompany(company: Company): Promise<Company>
  getVoucherNumbering(companyId: string): Promise<VoucherNumbering>
  saveVoucherNumbering(numbering: VoucherNumbering): Promise<VoucherNumbering>

  listStockMovements(companyId: string, filters?: { itemId?: string }): Promise<StockMovement[]>
  /**
   * The inventory accounts a company uses and the valuation policy in force.
   *
   * `null` means the company has not activated inventory: its vouchers keep
   * their periodic treatment and no stock movement exists.
   */
  getInventoryAccounts(companyId: string): Promise<InventoryAccounts | null>
  /**
   * Save the inventory accounts. The accounts are configured per company, so
   * the posting never invents a ledger identifier.
   */
  saveInventoryAccounts(accounts: InventoryAccounts): Promise<InventoryAccounts>
  /** The costing pool per item: the quantity held and the carrying value. */
  listStockPools(companyId: string): Promise<StockPoolBalance[]>
  /** The quantity held per item and location. */
  listStockBalances(companyId: string, itemId?: string): Promise<StockLocationBalance[]>
  /**
   * Open the company's stock books at a cutover date.
   *
   * The accounts, the opening balances, the movements they create and the
   * audit event are written together, or not at all.
   */
  createOpeningStock(request: OpeningStockRequest): Promise<OpeningStockResult>
  listAuditEvents(companyId: string, filters?: AuditFilters): Promise<AuditEvent[]>

  listStatementLines(
    companyId: string,
    filters?: { ledgerId?: string; reconciled?: boolean; from?: string; to?: string },
  ): Promise<StatementLine[]>
  reconcileStatementLine(companyId: string, lineId: string, voucherId: string | null): Promise<StatementLine>

  getDashboard(companyId: string, range: DateRange): Promise<DashboardSnapshot>

  // -- Orders ---------------------------------------------------------------

  /** The orders of a company, with their lines and what has been delivered. */
  listOrders(companyId: string, kind?: OrderKind): Promise<OrderWithLines[]>
  /** One order, with its lines, its deliveries and its history. */
  getOrder(companyId: string, id: string): Promise<OrderWithLines | null>
  /** Save a new order or replace the lines of an existing one. */
  saveOrder(order: Order, lines: OrderLine[]): Promise<OrderWithLines>
  /** Confirm an order, so its quantities become a commitment. */
  confirmOrder(companyId: string, id: string): Promise<Order>
  /** Withdraw an order. Refused when something has already been delivered. */
  cancelOrder(companyId: string, id: string, reason: string): Promise<Order>
  /** Change the quantities of a confirmed order, keeping the previous ones. */
  amendOrder(
    companyId: string,
    id: string,
    lines: OrderLine[],
    reason: string,
  ): Promise<OrderWithLines>
  /** The next number for an order of the given kind. */
  nextOrderNumber(companyId: string, kind: OrderKind): Promise<string>

  // -- Bills of materials ---------------------------------------------------

  listBoms(companyId: string, itemId?: string): Promise<BomWithLines[]>
  getBom(companyId: string, id: string): Promise<BomWithLines | null>
  saveBom(bom: Bom, lines: BomLine[]): Promise<BomWithLines>
  /** Release a structure. A released structure cannot be edited afterwards. */
  releaseBom(companyId: string, id: string): Promise<BomWithLines>

  // -- Production -----------------------------------------------------------

  listProductionOrders(companyId: string): Promise<ProductionOrderWithDetail[]>
  getProductionOrder(companyId: string, id: string): Promise<ProductionOrderWithDetail | null>
  saveProductionOrder(
    order: ProductionOrder,
    requirements: ProductionRequirement[],
  ): Promise<ProductionOrderWithDetail>
  /** Release a production order, snapshotting the structure it uses. */
  releaseProductionOrder(companyId: string, id: string): Promise<ProductionOrderWithDetail>
  /** Issue materials against a production order, in one transaction. */
  postProductionIssue(
    order: ProductionOrder,
    requirements: ProductionRequirement[],
    inputs: ProductionIssueInput[],
  ): Promise<ProductionIssueResult>
  /** Receive the finished goods, transferring the production cost. */
  postProductionCompletion(
    order: ProductionOrder,
    requirements: ProductionRequirement[],
    issues: ProductionIssue[],
  ): Promise<ProductionCompletionResult>

  // -- Payroll ---------------------------------------------------------------

  /** The salary structures of a company, one row per version. */
  listSalaryStructures(companyId: string): Promise<SalaryStructure[]>
  /** One structure with the components that make it up. */
  getSalaryStructure(companyId: string, id: string): Promise<SalaryStructureDetail | null>
  /**
   * Save a structure and the components that make it up.
   *
   * A released version is never edited: a change is a new version.
   */
  saveSalaryStructure(
    structure: SalaryStructure,
    components: SalaryComponent[],
  ): Promise<SalaryStructure>
  /** The employees' assignments to a salary structure, with their dates. */
  listSalaryAssignments(companyId: string): Promise<SalaryAssignment[]>
  saveSalaryAssignment(assignment: SalaryAssignment): Promise<SalaryAssignment>
  /** What happened in a period for each employee. */
  listAttendance(companyId: string, period: string): Promise<PayrollAttendance[]>
  saveAttendance(attendance: PayrollAttendance): Promise<PayrollAttendance>

  /** The payroll runs of a company. */
  listPayrollRuns(companyId: string): Promise<PayrollRun[]>
  /** One run with the snapshot each employee's pay was taken from. */
  getPayrollRun(companyId: string, id: string): Promise<PayrollRunDetail | null>
  /**
   * Save a run and the snapshot it carries.
   *
   * The run is the header and the snapshots are its children. The snapshot is
   * computed by the domain and is stored as it is, so a calculated run and its
   * figures can never drift apart.
   */
  savePayrollRun(run: PayrollRun, snapshots?: PayrollSnapshot[]): Promise<PayrollRun>
  /** Remove a run that has no financial effect. */
  deletePayrollRun(companyId: string, id: string): Promise<void>
  /**
   * Post a run: the journal it carries, its entries and the run's own state
   * are written together or not at all.
   */
  postPayrollRun(
    companyId: string,
    id: string,
    run: PayrollRun,
    journal: Voucher,
    entries: VoucherEntry[],
  ): Promise<PayrollRun>
  /** The payments that have settled a run. */
  listPayrollPayments(companyId: string, runId: string): Promise<PayrollPayment[]>
  savePayrollPayment(payment: PayrollPayment): Promise<PayrollPayment>

  /**
   * The company's payroll accounts.
   *
   * `null` means the company has not mapped them: no payroll run can be
   * posted until it has, and no ledger identifier is ever invented.
   */
  getPayrollAccounts(companyId: string): Promise<PayrollAccounts | null>
  savePayrollAccounts(accounts: PayrollAccounts): Promise<PayrollAccounts>

  /** The statutory rules the company holds, with their status and source. */
  listStatutoryRules(companyId: string): Promise<StatutoryRuleVersion[]>
  saveStatutoryRule(rule: StatutoryRuleVersion): Promise<StatutoryRuleVersion>

  /** The next number for a payroll run of the given period. */
  nextPayrollNumber(companyId: string, period: string): Promise<string>
}
