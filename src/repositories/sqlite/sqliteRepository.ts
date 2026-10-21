/**
 * The local SQLite repository.
 *
 * Every method maps to one Tauri command. The command layer owns the database
 * transaction, so a multi-record write is committed as a unit. No SQL reaches
 * the Vue layer, and no accounting rule is repeated here: the entries, tax
 * split and allocation are computed by the domain layer and only stored.
 */

import { invoke } from '@tauri-apps/api/core'

import { buildDashboardSnapshot } from '@/domain/dashboard'
import { locationKey, replayMovements, type InventoryContext } from '@/domain/inventory'
import {
  planProductionCompletion,
  planProductionIssue,
  type ProductionIssueInput,
} from '@/domain/production'
import { prepareCancellation, preparePosting } from '@/domain/posting'
import type { AdvanceRecord, AllocationRecord } from '@/domain/allocations'
import type {
  BomWithLines,
  OpeningStockRequest,
  OpeningStockResult,
  OrderWithLines,
  ProductionCompletionResult,
  ProductionIssueResult,
  ProductionOrderWithDetail,
} from '@/repositories/contracts'
import type {
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
  OrderKind,
  OrderLine,
  PaymentTerm,
  PayrollAccounts,
  PayrollAttendance,
  PayrollPayment,
  PayrollRun,
  PayrollSnapshot,
  PriceList,
  PriceListEntry,
  ProductionIssue,
  ProductionOrder,
  ProductionRequirement,
  SalaryAssignment,
  SalaryComponent,
  SalaryStructure,
  StatementLine,
  StockGroup,
  StockLocationBalance,
  StockMovement,
  StockPoolBalance,
  StatutoryRuleVersion,
  TaxCategory,
  Unit,
  Voucher,
  VoucherEntry,
  VoucherType,
} from '@/domain/types'
import type {
  AuditFilters,
  DashboardSnapshot,
  DateRange,
  LedgerFyRepository,
  NewCompanyInput,
  RepositoryInfo,
  SalaryStructureDetail,
  PayrollRunDetail,
  VoucherFilters,
  VoucherNumbering,
} from '@/repositories/contracts'
import { todayIso } from '@/lib/datetime'

/** Voucher numbering prefixes, matching the Rust implementation. */
const VOUCHER_PREFIX: Record<string, string> = {
  sales: 'INV',
  purchase: 'PUR',
  payment: 'PAY',
  receipt: 'RCP',
  contra: 'CNT',
  journal: 'JNL',
  'credit-note': 'CN',
  'debit-note': 'DN',
  'sales-order': 'SO',
  'purchase-order': 'PO',
  'delivery-note': 'DNL',
  'receipt-note': 'RCL',
  'stock-journal': 'STJ',
}

export class SqliteRepository implements LedgerFyRepository {
  readonly info: RepositoryInfo = {
    kind: 'local',
    label: 'Local workspace',
    isSampleData: false,
  }

  // -- Companies ---------------------------------------------------------

  async listCompanies(): Promise<Company[]> {
    return invoke<Company[]>('list_companies_cmd')
  }

  async getCompany(id: string): Promise<Company | null> {
    return invoke<Company | null>('get_company_cmd', { id })
  }

  async createCompany(input: NewCompanyInput): Promise<Company> {
    const id = `cmp-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
    const company: Company = {
      id,
      name: input.name,
      legalName: input.legalName,
      country: input.country,
      state: input.state,
      baseCurrency: input.baseCurrency,
      fiscalYearStart: input.fiscalYearStart,
      fiscalYearEnd: input.fiscalYearEnd,
      gstin: input.gstin,
      pan: input.pan,
      address: input.address,
      phone: input.phone,
      email: input.email,
      industry: input.industry,
      isDemo: false,
      createdAt: new Date().toISOString(),
    }

    await invoke<Company>('insert_company_cmd', { company })

    // A company always starts with the financial year it was created for.
    const year: FinancialYear = {
      id: `fy-${id}-1`,
      companyId: id,
      label: `${input.fiscalYearStart.slice(0, 4)}-${input.fiscalYearEnd.slice(2, 4)}`,
      start: input.fiscalYearStart,
      end: input.fiscalYearEnd,
      isClosed: false,
    }
    await invoke<FinancialYear>('insert_financial_year_cmd', { year })

    return company
  }

  async listFinancialYears(companyId: string): Promise<FinancialYear[]> {
    return invoke<FinancialYear[]>('list_financial_years_cmd', { companyId })
  }

  // -- Masters -----------------------------------------------------------

  async listLedgers(companyId: string): Promise<Ledger[]> {
    return invoke<Ledger[]>('list_ledgers_cmd', { companyId })
  }

  async saveLedger(ledger: Ledger): Promise<Ledger> {
    return invoke<Ledger>('save_ledger_cmd', { ledger })
  }

  async deactivateLedger(companyId: string, id: string): Promise<void> {
    await invoke<void>('deactivate_ledger_cmd', { companyId, id })
  }

  async listItems(companyId: string): Promise<Item[]> {
    return invoke<Item[]>('list_items_cmd', { companyId })
  }

  async saveItem(item: Item): Promise<Item> {
    return invoke<Item>('save_item_cmd', { item })
  }

  async listTaxCategories(companyId: string): Promise<TaxCategory[]> {
    return invoke<TaxCategory[]>('list_tax_categories_cmd', { companyId })
  }

  async saveTaxCategory(tax: TaxCategory): Promise<TaxCategory> {
    return invoke<TaxCategory>('save_tax_category_cmd', { tax })
  }

  async listStockGroups(companyId: string): Promise<StockGroup[]> {
    return invoke<StockGroup[]>('list_stock_groups_cmd', { companyId })
  }

  async saveStockGroup(group: StockGroup): Promise<StockGroup> {
    return invoke<StockGroup>('save_stock_group_cmd', { group })
  }

  async listUnits(companyId: string): Promise<Unit[]> {
    return invoke<Unit[]>('list_units_cmd', { companyId })
  }

  async saveUnit(unit: Unit): Promise<Unit> {
    return invoke<Unit>('save_unit_cmd', { unit })
  }

  async listGodowns(companyId: string): Promise<Godown[]> {
    return invoke<Godown[]>('list_godowns_cmd', { companyId })
  }

  async saveGodown(godown: Godown): Promise<Godown> {
    return invoke<Godown>('save_godown_cmd', { godown })
  }

  async listCostCentres(companyId: string): Promise<CostCentre[]> {
    return invoke<CostCentre[]>('list_cost_centres_cmd', { companyId })
  }

  async saveCostCentre(centre: CostCentre): Promise<CostCentre> {
    return invoke<CostCentre>('save_cost_centre_cmd', { centre })
  }

  async listEmployees(companyId: string): Promise<Employee[]> {
    return invoke<Employee[]>('list_employees_cmd', { companyId })
  }

  async saveEmployee(employee: Employee): Promise<Employee> {
    return invoke<Employee>('save_employee_cmd', { employee })
  }

  async listCurrencies(companyId: string): Promise<Currency[]> {
    return invoke<Currency[]>('list_currencies_cmd', { companyId })
  }

  async saveCurrency(currency: Currency): Promise<Currency> {
    return invoke<Currency>('save_currency_cmd', { currency })
  }

  async listPriceLists(companyId: string): Promise<PriceList[]> {
    return invoke<PriceList[]>('list_price_lists_cmd', { companyId })
  }

  async savePriceList(priceList: PriceList): Promise<PriceList> {
    return invoke<PriceList>('save_price_list_cmd', { priceList })
  }

  async listPriceListEntries(
    companyId: string,
    priceListId: string,
  ): Promise<PriceListEntry[]> {
    return invoke<PriceListEntry[]>('list_price_list_entries_cmd', { companyId, priceListId })
  }

  async savePriceListEntries(
    companyId: string,
    priceListId: string,
    entries: PriceListEntry[],
  ): Promise<PriceListEntry[]> {
    return invoke<PriceListEntry[]>('save_price_list_entries_cmd', {
      companyId,
      priceListId,
      entries,
    })
  }

  async listPaymentTerms(companyId: string): Promise<PaymentTerm[]> {
    return invoke<PaymentTerm[]>('list_payment_terms_cmd', { companyId })
  }

  async savePaymentTerm(term: PaymentTerm): Promise<PaymentTerm> {
    return invoke<PaymentTerm>('save_payment_term_cmd', { term })
  }

  // -- Vouchers ----------------------------------------------------------

  async listVouchers(companyId: string, filters: VoucherFilters = {}): Promise<Voucher[]> {
    return invoke<Voucher[]>('list_vouchers_cmd', { companyId, filters })
  }

  async getVoucher(companyId: string, id: string): Promise<Voucher | null> {
    return invoke<Voucher | null>('get_voucher_cmd', { companyId, id })
  }

  async saveVoucher(voucher: Voucher): Promise<Voucher> {
    return invoke<Voucher>('save_voucher_cmd', { voucher, actor: 'local.operator' })
  }

  /**
   * Post a voucher through the command layer, which writes the voucher, its
   * lines, the bill-wise allocations it settles and the audit event in one
   * transaction.
   */
  async postVoucher(voucher: Voucher): Promise<Voucher> {
    const package_ = await preparePosting(voucher, await this.postingContext(voucher))
    return invoke<Voucher>('post_voucher_cmd', {
      payload: {
        voucher: package_.voucher,
        entries: package_.entries,
        items: package_.items,
        taxes: package_.taxes,
        allocations: package_.allocations,
        advances: package_.advances,
        affectedPartyIds: package_.affectedPartyIds,
        movements: package_.movements,
        stockPools: package_.stockPools,
        stockLocations: package_.stockLocations,
        orderFulfilments: package_.orderFulfilments,
        productionIssues: package_.productionIssues,
        productionCompletions: package_.productionCompletions,
        auditEvents: package_.auditEvents,
        actor: 'local.operator',
      },
    })
  }

  /** The company context the domain needs to prepare a posting. */
  private async postingContext(voucher: Voucher) {
    const companyId = voucher.companyId
    const [ledgers, taxCategories, existingVouchers, years, items] = await Promise.all([
      this.listLedgers(companyId),
      this.listTaxCategories(companyId),
      this.listVouchers(companyId),
      this.listFinancialYears(companyId),
      this.listItems(companyId),
    ])
    let sequence = 0
    const idFactory = () => `posting-${Date.now().toString(36)}-${++sequence}`
    const inventory = await this.inventoryContext(companyId, ledgers, items, idFactory)
    // The order is loaded only when a line names one, so an ordinary voucher
    // costs nothing extra.
    const orderContext = await this.orderContext(voucher)
    return {
      companyId,
      ledgers,
      taxCategories,
      existingVouchers,
      closedPeriods: years
        .filter((year) => year.isClosed)
        .map((year) => ({ from: year.start, to: year.end, label: `Financial year ${year.label}` })),
      inventory,
      orderContext,
      actor: 'local.operator',
      idFactory,
      now: () => new Date().toISOString(),
    }
  }

  /**
   * The order a voucher delivers against, when its lines name order lines.
   *
   * The domain refuses to post a voucher that delivers against an order it
   * cannot find, so the order, its lines and what has already been delivered
   * are read here.
   */
  private async orderContext(voucher: Voucher) {
    const lineIds = voucher.items
      .map((item) => item.orderLineId)
      .filter((id): id is string => Boolean(id))
    if (!lineIds.length) return undefined

    const orders = await this.listOrders(voucher.companyId)
    const owner = orders.find((entry) =>
      entry.lines.some((line) => lineIds.includes(line.id)),
    )
    if (!owner) return undefined

    const detail = (await this.getOrder(voucher.companyId, owner.order.id)) ?? owner
    return {
      order: detail.order,
      lines: detail.lines,
      fulfilments: detail.fulfilments,
    }
  }

  /**
   * The inventory context, when the company has inventory activated.
   *
   * Without it the voucher keeps its periodic treatment, exactly as the policy
   * requires for a company that has not activated inventory.
   */
  private async inventoryContext(
    companyId: string,
    ledgers: Ledger[],
    items: Item[],
    idFactory: () => string,
  ): Promise<InventoryContext | undefined> {
    const configured = await this.getInventoryAccounts(companyId)
    if (!configured) return undefined

    const inventory = ledgers.find((ledger) => ledger.id === configured.inventoryLedgerId)
    const cogs = ledgers.find((ledger) => ledger.id === configured.cogsLedgerId)
    const variance = ledgers.find((ledger) => ledger.id === configured.varianceLedgerId)
    const purchases = ledgers.find((ledger) => ledger.id === configured.purchasesLedgerId)
    // An account that no longer exists leaves the company on its periodic
    // treatment rather than posting to a ledger that is not there.
    if (!inventory || !cogs || !variance || !purchases) return undefined

    const [pools, locations, movements] = await Promise.all([
      this.listStockPools(companyId),
      this.listStockBalances(companyId),
      this.listStockMovements(companyId),
    ])

    return {
      companyId,
      accounts: {
        inventory,
        cogs,
        variance,
        purchases,
        inputTaxRecoverable: configured.inputTaxRecoverable,
      },
      items: new Map(items.map((item) => [item.id, item])),
      pools: new Map(
        pools.map((pool) => [
          pool.itemId,
          {
            itemId: pool.itemId,
            quantityMilli: pool.quantityMilli,
            carryingValue: pool.carryingValue,
            revision: pool.revision,
          },
        ]),
      ),
      locations: new Map(
        locations.map((location) => [
          locationKey(location.itemId, location.godownId),
          {
            itemId: location.itemId,
            godownId: location.godownId,
            quantityMilli: location.quantityMilli,
            revision: location.revision,
          },
        ]),
      ),
      idFactory,
      now: () => new Date().toISOString(),
      movements,
    }
  }

  /**
   * Cancel a voucher through the command layer, which withdraws its entries
   * and rewrites the allocations of the affected party in the same
   * transaction.
   */
  async cancelVoucher(voucher: Voucher): Promise<Voucher> {
    const context = await this.postingContext(voucher)
    const package_ = prepareCancellation(voucher, context)
    return invoke<Voucher>('cancel_voucher_cmd', {
      payload: {
        voucher: package_.voucher,
        entries: package_.entries,
        items: package_.items,
        taxes: package_.taxes,
        allocations: package_.allocations,
        advances: package_.advances,
        affectedPartyIds: package_.affectedPartyIds,
        movements: package_.movements,
        stockPools: package_.stockPools,
        stockLocations: package_.stockLocations,
        orderFulfilments: package_.orderFulfilments,
        productionIssues: package_.productionIssues,
        productionCompletions: package_.productionCompletions,
        auditEvents: package_.auditEvents,
        actor: 'local.operator',
      },
    })
  }

  async listAllocations(companyId: string): Promise<AllocationRecord[]> {
    return invoke<AllocationRecord[]>('list_allocations_cmd', { companyId })
  }

  async listAdvances(companyId: string): Promise<AdvanceRecord[]> {
    return invoke<AdvanceRecord[]>('list_advances_cmd', { companyId })
  }

  async updateCompany(company: Company): Promise<Company> {
    return invoke<Company>('update_company_cmd', { company })
  }

  async getVoucherNumbering(companyId: string): Promise<VoucherNumbering> {
    return invoke<VoucherNumbering>('get_voucher_numbering_cmd', { companyId })
  }

  async saveVoucherNumbering(numbering: VoucherNumbering): Promise<VoucherNumbering> {
    return invoke<VoucherNumbering>('save_voucher_numbering_cmd', { numbering })
  }

  async deleteVoucher(companyId: string, id: string): Promise<void> {
    await invoke<void>('delete_voucher_cmd', { companyId, id })
  }

  async nextVoucherNumber(companyId: string, type: VoucherType): Promise<string> {
    // The saved numbering scheme is the authority, so the command reads it.
    return invoke<string>('next_voucher_number_cmd', { companyId, kind: type })
  }

  // -- Records -----------------------------------------------------------

  async listStockMovements(
    companyId: string,
    filters: { itemId?: string } = {},
  ): Promise<StockMovement[]> {
    return invoke<StockMovement[]>('list_stock_movements_cmd', {
      companyId,
      itemId: filters.itemId ?? null,
    })
  }

  async getInventoryAccounts(companyId: string): Promise<InventoryAccounts | null> {
    return invoke<InventoryAccounts | null>('get_inventory_accounts_cmd', { companyId })
  }

  async saveInventoryAccounts(accounts: InventoryAccounts): Promise<InventoryAccounts> {
    return invoke<InventoryAccounts>('save_inventory_accounts_cmd', { accounts })
  }

  async listStockPools(companyId: string): Promise<StockPoolBalance[]> {
    return invoke<StockPoolBalance[]>('list_stock_pools_cmd', { companyId })
  }

  async listStockBalances(
    companyId: string,
    itemId?: string,
  ): Promise<StockLocationBalance[]> {
    return invoke<StockLocationBalance[]>('list_stock_balances_cmd', {
      companyId,
      itemId: itemId ?? null,
    })
  }

  async createOpeningStock(request: OpeningStockRequest): Promise<OpeningStockResult> {
    return invoke<OpeningStockResult>('create_opening_stock_cmd', { request })
  }

  async listStatementLines(
    companyId: string,
    filters: { ledgerId?: string; reconciled?: boolean; from?: string; to?: string } = {},
  ): Promise<StatementLine[]> {
    return invoke<StatementLine[]>('list_statement_lines_cmd', {
      companyId,
      ledgerId: filters.ledgerId ?? null,
      reconciled: filters.reconciled ?? null,
    })
  }

  async reconcileStatementLine(
    companyId: string,
    lineId: string,
    voucherId: string | null,
  ): Promise<StatementLine> {
    return invoke<StatementLine>('reconcile_statement_line_cmd', {
      companyId,
      lineId,
      voucherId,
    })
  }

  async listAuditEvents(
    companyId: string,
    filters: AuditFilters = {},
  ): Promise<import('@/domain/types').AuditEvent[]> {
    return invoke('list_audit_events_cmd', { companyId, filters })
  }

  // -- Dashboard ---------------------------------------------------------

  async getDashboard(companyId: string, range: DateRange): Promise<DashboardSnapshot> {
    const [ledgers, vouchers, items, units, stockMovements, statementLines] = await Promise.all([
      this.listLedgers(companyId),
      this.listVouchers(companyId),
      this.listItems(companyId),
      this.listUnits(companyId),
      this.listStockMovements(companyId),
      this.listStatementLines(companyId),
    ])

    return buildDashboardSnapshot({
      range,
      ledgers,
      vouchers,
      items,
      units,
      stockMovements,
      statementLines,
      asOf: todayIso(),
    })
  }

  // -- Orders ---------------------------------------------------------------

  /**
   * The orders of a company.
   *
   * The list command returns the header and the lines; the deliveries and the
   * history come from the detail command, so the state the register shows can
   * be derived rather than guessed.
   */
  async listOrders(companyId: string, kind?: OrderKind): Promise<OrderWithLines[]> {
    const summaries = await invoke<Array<{ order: Order; lines: OrderLine[] }>>(
      'list_orders_cmd',
      { companyId, kind: kind ?? null },
    )
    const details = await Promise.all(
      summaries.map((summary) => this.getOrder(companyId, summary.order.id)),
    )
    return details.filter((detail): detail is OrderWithLines => detail !== null)
  }

  async getOrder(companyId: string, id: string): Promise<OrderWithLines | null> {
    return invoke<OrderWithLines | null>('get_order_cmd', { companyId, id })
  }

  async saveOrder(order: Order, lines: OrderLine[]): Promise<OrderWithLines> {
    return invoke<OrderWithLines>('save_order_cmd', { order, lines })
  }

  async confirmOrder(companyId: string, id: string): Promise<Order> {
    const detail = await invoke<OrderWithLines>('confirm_order_cmd', {
      companyId,
      id,
      actor: 'local.operator',
    })
    return detail.order
  }

  async cancelOrder(companyId: string, id: string, reason: string): Promise<Order> {
    const detail = await invoke<OrderWithLines>('cancel_order_cmd', {
      companyId,
      id,
      reason,
      actor: 'local.operator',
    })
    return detail.order
  }

  async amendOrder(
    companyId: string,
    id: string,
    lines: OrderLine[],
    reason: string,
  ): Promise<OrderWithLines> {
    return invoke<OrderWithLines>('amend_order_cmd', {
      companyId,
      id,
      lines,
      reason,
      actor: 'local.operator',
    })
  }

  /**
   * The next number for an order of the given kind.
   *
   * The number series and the padding are the company's own settings, so the
   * command reads them. The kind is the order kind, `sales` or `purchase`.
   */
  async nextOrderNumber(companyId: string, kind: OrderKind): Promise<string> {
    return invoke<string>('next_order_number_cmd', {
      companyId,
      kind,
      prefix: null,
      padding: null,
    })
  }

  // -- Bills of materials ---------------------------------------------------

  async listBoms(companyId: string, itemId?: string): Promise<BomWithLines[]> {
    return invoke<BomWithLines[]>('list_boms_cmd', { companyId, itemId: itemId ?? null })
  }

  async getBom(companyId: string, id: string): Promise<BomWithLines | null> {
    return invoke<BomWithLines | null>('get_bom_cmd', { companyId, id })
  }

  async saveBom(bom: Bom, lines: BomLine[]): Promise<BomWithLines> {
    return invoke<BomWithLines>('save_bom_cmd', { bom, lines })
  }

  async releaseBom(companyId: string, id: string): Promise<BomWithLines> {
    return invoke<BomWithLines>('release_bom_cmd', { companyId, id, actor: 'local.operator' })
  }

  // -- Production ------------------------------------------------------------

  /**
   * The production orders of a company.
   *
   * The list command returns the headers, so each order is read in full to
   * bring back its requirements, its issues and its completions.
   */
  async listProductionOrders(companyId: string): Promise<ProductionOrderWithDetail[]> {
    const headers = await invoke<ProductionOrder[]>('list_production_orders_cmd', { companyId })
    const details = await Promise.all(
      headers.map((header) => this.getProductionOrder(companyId, header.id)),
    )
    return details.filter((detail): detail is ProductionOrderWithDetail => detail !== null)
  }

  async getProductionOrder(
    companyId: string,
    id: string,
  ): Promise<ProductionOrderWithDetail | null> {
    return invoke<ProductionOrderWithDetail | null>('get_production_order_cmd', { companyId, id })
  }

  async saveProductionOrder(
    order: ProductionOrder,
    requirements: ProductionRequirement[],
  ): Promise<ProductionOrderWithDetail> {
    const number = order.number || (await this.nextProductionNumber(order.companyId))
    return invoke<ProductionOrderWithDetail>('save_production_order_cmd', {
      order: { ...order, number },
      requirements,
    })
  }

  /**
   * The next production order number.
   *
   * The production orders carry their own series, so the count is taken from
   * the orders of the company rather than from the order numbering.
   */
  private async nextProductionNumber(companyId: string): Promise<string> {
    const existing = await invoke<ProductionOrder[]>('list_production_orders_cmd', { companyId })
    const highest = existing.reduce((max, order) => {
      const digits = order.number.slice(order.number.indexOf('-') + 1)
      const value = Number(digits)
      return Number.isFinite(value) ? Math.max(max, value) : max
    }, 0)
    return `PRD-${String(highest + 1).padStart(4, '0')}`
  }

  async releaseProductionOrder(companyId: string, id: string): Promise<ProductionOrderWithDetail> {
    return invoke<ProductionOrderWithDetail>('release_production_order_cmd', {
      companyId,
      id,
      actor: 'local.operator',
    })
  }

  /**
   * Issue materials against a production order.
   *
   * The cost of the issue is the inventory engine's, and the work in progress
   * account carries it until the finished goods are received. The voucher, its
   * entries, the movements, the balances and the issue rows are written in one
   * transaction, through the posting command, which is the one command that
   * commits a voucher and everything it implies together.
   */
  async postProductionIssue(
    order: ProductionOrder,
    requirements: ProductionRequirement[],
    inputs: ProductionIssueInput[],
  ): Promise<ProductionIssueResult> {
    const context = await this.productionContext(order.companyId)
    const plan = planProductionIssue(order, requirements, inputs, context)

    const nextRequirements = applyIssuedQuantities(requirements, inputs)
    const locations = await this.productionLocations(
      order.companyId,
      context.inventory.movements ?? [],
      plan.movements,
    )

    const voucher = { ...plan.voucher, number: await this.nextStockJournalNumber(order.companyId) }

    await invoke<Voucher>('post_voucher_cmd', {
      payload: {
        voucher,
        entries: plan.entries,
        items: voucher.items,
        taxes: [],
        allocations: [],
        advances: [],
        affectedPartyIds: [],
        movements: plan.movements,
        stockPools: poolsOf(order.companyId, plan.pools),
        stockLocations: locations,
        orderFulfilments: [],
        productionIssues: plan.issues,
        productionCompletions: [],
        auditEvents: [
          {
            id: `audit-production-issue-${order.id}`,
            companyId: order.companyId,
            actor: 'local.operator',
            action: 'production.issued',
            recordType: 'production-order',
            recordId: order.id,
            recordLabel: `${order.number} — materials issued`,
            timestamp: context.now(),
            detail: `Materials issued against production order ${order.number}`,
          },
        ],
        actor: 'local.operator',
      },
    })

    return { voucher, issues: plan.issues, requirements: nextRequirements }
  }

  /**
   * Receive the finished goods of a production order.
   *
   * The finished goods are valued at the cost of the materials that were
   * issued, and the work in progress account is relieved by the same figure.
   */
  async postProductionCompletion(
    order: ProductionOrder,
    requirements: ProductionRequirement[],
    issues: ProductionIssue[],
  ): Promise<ProductionCompletionResult> {
    const context = await this.productionContext(order.companyId)
    const plan = planProductionCompletion(order, requirements, issues, context)

    const locations = await this.productionLocations(
      order.companyId,
      context.inventory.movements ?? [],
      plan.movements,
    )

    const voucher = { ...plan.voucher, number: await this.nextStockJournalNumber(order.companyId) }

    await invoke<Voucher>('post_voucher_cmd', {
      payload: {
        voucher,
        entries: plan.entries,
        items: voucher.items,
        taxes: [],
        allocations: [],
        advances: [],
        affectedPartyIds: [],
        movements: plan.movements,
        stockPools: poolsOf(order.companyId, plan.pools),
        stockLocations: locations,
        orderFulfilments: [],
        productionIssues: [],
        productionCompletions: plan.completions,
        auditEvents: [
          {
            id: `audit-production-completion-${order.id}`,
            companyId: order.companyId,
            actor: 'local.operator',
            action: 'production.completed',
            recordType: 'production-order',
            recordId: order.id,
            recordLabel: `${order.number} — finished goods received`,
            timestamp: context.now(),
            detail: `Finished goods received against production order ${order.number}`,
          },
        ],
        actor: 'local.operator',
      },
    })

    return { voucher, completions: plan.completions, requirements }
  }

  /** The context the production domain needs: the costing engine and the account. */
  private async productionContext(companyId: string) {
    const [ledgers, items, accounts] = await Promise.all([
      this.listLedgers(companyId),
      this.listItems(companyId),
      this.getInventoryAccounts(companyId),
    ])
    if (!accounts?.productionLedgerId) {
      throw new Error(
        'Choose a work in progress account before posting a production order. ' +
          'Inventory settings has no production account for this company yet.',
      )
    }
    let sequence = 0
    const idFactory = () => `production-${Date.now().toString(36)}-${++sequence}`
    const inventory = await this.inventoryContext(companyId, ledgers, items, idFactory)
    if (!inventory) {
      throw new Error(
        'Production needs inventory to be activated for this company, so the materials can be costed.',
      )
    }
    return {
      companyId,
      items: new Map(items.map((item) => [item.id, item])),
      inventory,
      productionLedgerId: accounts.productionLedgerId,
      idFactory,
      now: () => new Date().toISOString(),
      today: todayIso(),
    }
  }

  /**
   * The location balances after a production movement.
   *
   * The projection is the movement ledger's, so the stored balances and the
   * movements cannot drift apart.
   */
  private async productionLocations(
    companyId: string,
    movements: StockMovement[],
    added: Array<{
      itemId: string
      godownId: string | null
      direction: 'in' | 'out'
      quantityMilli: number
      value: number
    }>,
  ): Promise<StockLocationBalance[]> {
    const stored = await this.listStockBalances(companyId)
    const replayed = replayMovements([...movements, ...added])
    const byKey = new Map(
      stored.map((location) => [locationKey(location.itemId, location.godownId), location]),
    )
    const now = new Date().toISOString()

    const next: StockLocationBalance[] = stored.map((location) => {
      const balance = replayed.get(locationKey(location.itemId, location.godownId))
      const quantityMilli = balance?.quantityMilli ?? location.quantityMilli
      return {
        ...location,
        quantityMilli,
        revision:
          quantityMilli === location.quantityMilli ? location.revision : location.revision + 1,
        updatedAt: now,
      }
    })

    for (const [key, balance] of replayed) {
      if (byKey.has(key)) continue
      next.push({
        companyId,
        itemId: balance.itemId,
        godownId: balance.godownId ?? '',
        quantityMilli: balance.quantityMilli,
        revision: 1,
        updatedAt: now,
      })
    }

    return next
  }

  /** The number a production voucher carries. */
  private async nextStockJournalNumber(companyId: string): Promise<string> {
    return invoke<string>('next_voucher_number_cmd', { companyId, kind: 'stock-journal' })
  }

  // -- Payroll ---------------------------------------------------------------

  async listSalaryStructures(companyId: string): Promise<SalaryStructure[]> {
    return invoke<SalaryStructure[]>('list_salary_structures_cmd', { companyId })
  }

  async getSalaryStructure(
    companyId: string,
    id: string,
  ): Promise<SalaryStructureDetail | null> {
    return invoke<SalaryStructureDetail | null>('get_salary_structure_cmd', { companyId, id })
  }

  /**
   * Save a structure and its components.
   *
   * The components travel with the structure so that a version and the
   * components that make it up are written together.
   */
  async saveSalaryStructure(
    structure: SalaryStructure,
    components: SalaryComponent[],
  ): Promise<SalaryStructure> {
    return invoke<SalaryStructure>('save_salary_structure_cmd', { structure, components })
  }

  async listSalaryAssignments(companyId: string): Promise<SalaryAssignment[]> {
    return invoke<SalaryAssignment[]>('list_salary_assignments_cmd', { companyId })
  }

  async saveSalaryAssignment(assignment: SalaryAssignment): Promise<SalaryAssignment> {
    return invoke<SalaryAssignment>('save_salary_assignment_cmd', { assignment })
  }

  async listAttendance(companyId: string, period: string): Promise<PayrollAttendance[]> {
    return invoke<PayrollAttendance[]>('list_attendance_cmd', { companyId, period })
  }

  async saveAttendance(attendance: PayrollAttendance): Promise<PayrollAttendance> {
    return invoke<PayrollAttendance>('save_attendance_cmd', { attendance })
  }

  async listPayrollRuns(companyId: string): Promise<PayrollRun[]> {
    return invoke<PayrollRun[]>('list_payroll_runs_cmd', { companyId })
  }

  async getPayrollRun(companyId: string, id: string): Promise<PayrollRunDetail | null> {
    return invoke<PayrollRunDetail | null>('get_payroll_run_cmd', { companyId, id })
  }

  /**
   * Save a run and the snapshot it carries.
   *
   * The run is the header and the snapshots are its children: the header is
   * written first, then the snapshot each employee's pay was taken from. The
   * snapshot is computed by the domain and is never derived here.
   */
  async savePayrollRun(run: PayrollRun, snapshots: PayrollSnapshot[] = []): Promise<PayrollRun> {
    const saved = await invoke<PayrollRun>('save_payroll_run_cmd', { run })
    if (snapshots.length) {
      await invoke<PayrollSnapshot[]>('save_payroll_snapshots_cmd', { snapshots })
    }
    return saved
  }

  async deletePayrollRun(companyId: string, id: string): Promise<void> {
    await invoke<void>('delete_payroll_run_cmd', { companyId, id })
  }

  /**
   * Post a payroll run.
   *
   * The journal is an ordinary journal voucher, so it obeys the same period
   * locks as every other voucher. The voucher, its entries, the run's own
   * state and the audit event are written in one transaction.
   */
  async postPayrollRun(
    companyId: string,
    id: string,
    run: PayrollRun,
    journal: Voucher,
    entries: VoucherEntry[],
  ): Promise<PayrollRun> {
    const voucher: Voucher = {
      ...journal,
      companyId,
      type: 'journal',
      status: 'posted',
      partyId: null,
      items: [],
      taxes: [],
    }
    const now = new Date().toISOString()
    return invoke<PayrollRun>('post_payroll_run_cmd', {
      companyId,
      id,
      payload: {
        voucher,
        entries,
        items: [],
        taxes: [],
        allocations: [],
        advances: [],
        affectedPartyIds: [],
        movements: [],
        stockPools: [],
        stockLocations: [],
        orderFulfilments: [],
        productionIssues: [],
        productionCompletions: [],
        auditEvents: [
          {
            id: `audit-payroll-posted-${run.id}`,
            companyId,
            actor: 'local.operator',
            action: 'payroll.posted',
            recordType: 'payroll-run',
            recordId: run.id,
            recordLabel: `${run.number} — salary posted`,
            timestamp: now,
            detail: `Payroll run ${run.number} for ${run.period} posted as ${voucher.number}`,
          },
        ],
        actor: 'local.operator',
      },
    })
  }

  async listPayrollPayments(companyId: string, runId: string): Promise<PayrollPayment[]> {
    return invoke<PayrollPayment[]>('list_payroll_payments_cmd', { companyId, runId })
  }

  async savePayrollPayment(payment: PayrollPayment): Promise<PayrollPayment> {
    return invoke<PayrollPayment>('save_payroll_payment_cmd', { payment })
  }

  async getPayrollAccounts(companyId: string): Promise<PayrollAccounts | null> {
    return invoke<PayrollAccounts | null>('get_payroll_accounts_cmd', { companyId })
  }

  async savePayrollAccounts(accounts: PayrollAccounts): Promise<PayrollAccounts> {
    return invoke<PayrollAccounts>('save_payroll_accounts_cmd', { accounts })
  }

  async listStatutoryRules(companyId: string): Promise<StatutoryRuleVersion[]> {
    return invoke<StatutoryRuleVersion[]>('list_statutory_rules_cmd', { companyId })
  }

  async saveStatutoryRule(rule: StatutoryRuleVersion): Promise<StatutoryRuleVersion> {
    return invoke<StatutoryRuleVersion>('save_statutory_rule_cmd', { rule })
  }

  async nextPayrollNumber(companyId: string, period: string): Promise<string> {
    return invoke<string>('payroll_number_cmd', { companyId, period })
  }
}

/** The pools a production plan leaves behind, in the shape the store keeps. */
function poolsOf(
  companyId: string,
  pools: Map<string, { itemId: string; quantityMilli: number; carryingValue: number; revision: number }>,
): StockPoolBalance[] {
  const now = new Date().toISOString()
  return [...pools.values()].map((pool) => ({
    companyId,
    itemId: pool.itemId,
    quantityMilli: pool.quantityMilli,
    carryingValue: pool.carryingValue,
    revision: pool.revision,
    updatedAt: now,
  }))
}

/**
 * The requirements after an issue.
 *
 * The domain refuses to issue more than the structure requires, so the issued
 * quantity is the requirement plus what was just issued.
 */
function applyIssuedQuantities(
  requirements: ProductionRequirement[],
  inputs: ProductionIssueInput[],
): ProductionRequirement[] {
  return requirements.map((requirement) => {
    const issued = inputs
      .filter((input) => input.requirementId === requirement.id)
      .reduce((sum, input) => sum + input.quantityMilli, 0)
    if (!issued) return requirement
    return { ...requirement, issuedQuantityMilli: requirement.issuedQuantityMilli + issued }
  })
}

export { VOUCHER_PREFIX }

/**
 * The prefix in force for a voucher type.
 *
 * The numbering is a company setting, so the saved scheme is what is used.
 */
export function prefixFor(numbering: VoucherNumbering, type: VoucherType): string {
  switch (type) {
    case 'sales':
      return numbering.salesPrefix
    case 'purchase':
      return numbering.purchasePrefix
    case 'payment':
      return numbering.paymentPrefix
    case 'receipt':
      return numbering.receiptPrefix
    case 'contra':
      return numbering.contraPrefix
    case 'journal':
      return numbering.journalPrefix
    case 'credit-note':
      return numbering.creditNotePrefix
    case 'debit-note':
      return numbering.debitNotePrefix
    case 'sales-order':
      return numbering.salesOrderPrefix
    case 'purchase-order':
      return numbering.purchaseOrderPrefix
    default:
      return VOUCHER_PREFIX[type] ?? 'VCH'
  }
}
