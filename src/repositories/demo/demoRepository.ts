/**
 * Demo repository.
 *
 * Backed by the deterministic fixture dataset in `fixtures.ts`. Every mutation
 * is applied to the in-memory dataset, so a saved voucher is visible in every
 * later screen — the interface behaves as if the data were real, while the
 * banner and repository metadata make clear that it is sample data.
 */

import { buildDashboardSnapshot } from '@/domain/dashboard'
import { locationKey, replayMovements, type InventoryContext } from '@/domain/inventory'
import {
  buildOrderRevision,
  cancelOrder,
  confirmOrder,
  prepareOrderAmendment,
  type OrderContext,
} from '@/domain/orders'
import {
  buildProductionRequirements,
  planProductionCompletion,
  planProductionIssue,
  type ProductionIssueInput,
  type ProductionOrderContext,
  type ProductionPostingContext,
} from '@/domain/production'
import { prepareCancellation, preparePosting } from '@/domain/posting'
import { prefixFor } from '@/repositories/sqlite/sqliteRepository'
import type { AdvanceRecord, AllocationRecord } from '@/domain/allocations'
import type { VoucherNumbering } from '@/repositories/contracts'
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
  PayrollRunDetail,
  SalaryStructureDetail,
  VoucherFilters,
} from '@/repositories/contracts'
import { createDemoDataset, DEMO_TODAY } from '@/repositories/demo/fixtures'


/** Resolves after a microtask so screens exercise their loading states. */
function tick<T>(value: T): Promise<T> {
  return new Promise((resolve) => {
    window.setTimeout(() => resolve(value), 0)
  })
}

export class DemoRepository implements LedgerFyRepository {
  readonly info: RepositoryInfo = {
    kind: 'demo',
    label: 'Demo workspace',
    isSampleData: true,
  }

  private data = createDemoDataset()

  async listCompanies(): Promise<Company[]> {
    return tick([...this.data.companies])
  }

  async getCompany(id: string): Promise<Company | null> {
    return tick(this.data.companies.find((company) => company.id === id) ?? null)
  }

  async createCompany(input: NewCompanyInput): Promise<Company> {
    const company: Company = {
      id: `cmp-${String(this.data.companies.length + 1).padStart(5, '0')}`,
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
      isDemo: true,
      createdAt: new Date().toISOString(),
    }
    this.data.companies = [...this.data.companies, company]
    this.data.financialYears = [
      ...this.data.financialYears,
      {
        id: `fy-${company.id}-1`,
        companyId: company.id,
        label: `${input.fiscalYearStart.slice(0, 4)}-${input.fiscalYearEnd.slice(2, 4)}`,
        start: input.fiscalYearStart,
        end: input.fiscalYearEnd,
        isClosed: false,
      },
    ]
    return tick(company)
  }

  async listFinancialYears(companyId: string): Promise<FinancialYear[]> {
    return tick(this.data.financialYears.filter((year) => year.companyId === companyId))
  }

  async listLedgers(companyId: string): Promise<Ledger[]> {
    return tick(this.data.ledgers.filter((ledger) => ledger.companyId === companyId))
  }

  async saveLedger(ledger: Ledger): Promise<Ledger> {
    const index = this.data.ledgers.findIndex((candidate) => candidate.id === ledger.id)
    if (index >= 0) this.data.ledgers[index] = ledger
    else this.data.ledgers = [...this.data.ledgers, ledger]
    return tick(ledger)
  }

  async deactivateLedger(companyId: string, id: string): Promise<void> {
    const index = this.data.ledgers.findIndex(
      (ledger) => ledger.id === id && ledger.companyId === companyId,
    )
    if (index >= 0) {
      this.data.ledgers[index] = { ...this.data.ledgers[index]!, isActive: false }
    }
    return tick(undefined)
  }

  /** Replace a record in one of the master collections. */
  private saveMaster<T extends { id: string }>(
    collection: 'stockGroups' | 'units' | 'godowns' | 'taxCategories' | 'costCentres' | 'employees' | 'currencies' | 'priceLists' | 'paymentTerms',
    record: T,
  ): Promise<T> {
    const list = this.data[collection] as unknown as T[]
    const index = list.findIndex((candidate) => candidate.id === record.id)
    if (index >= 0) list[index] = record
    else list.push(record)
    return tick(record)
  }

  async saveStockGroup(group: StockGroup): Promise<StockGroup> {
    return this.saveMaster('stockGroups', group)
  }

  async saveUnit(unit: Unit): Promise<Unit> {
    return this.saveMaster('units', unit)
  }

  async saveGodown(godown: Godown): Promise<Godown> {
    return this.saveMaster('godowns', godown)
  }

  async saveTaxCategory(tax: TaxCategory): Promise<TaxCategory> {
    return this.saveMaster('taxCategories', tax)
  }

  async saveCostCentre(centre: CostCentre): Promise<CostCentre> {
    return this.saveMaster('costCentres', centre)
  }

  async saveEmployee(employee: Employee): Promise<Employee> {
    return this.saveMaster('employees', employee)
  }

  async saveCurrency(currency: Currency): Promise<Currency> {
    return this.saveMaster('currencies', currency)
  }

  async savePriceList(priceList: PriceList): Promise<PriceList> {
    return this.saveMaster('priceLists', priceList)
  }

  async savePriceListEntries(
    companyId: string,
    priceListId: string,
    entries: PriceListEntry[],
  ): Promise<PriceListEntry[]> {
    const itemIds = new Set(
      this.data.items.filter((item) => item.companyId === companyId).map((item) => item.id),
    )
    this.data.priceListEntries = [
      ...this.data.priceListEntries.filter(
        (entry) => entry.priceListId !== priceListId || !itemIds.has(entry.itemId),
      ),
      ...entries.filter((entry) => itemIds.has(entry.itemId)),
    ]
    return tick(entries)
  }

  async savePaymentTerm(term: PaymentTerm): Promise<PaymentTerm> {
    return this.saveMaster('paymentTerms', term)
  }

  async listItems(companyId: string): Promise<Item[]> {
    return tick(this.data.items.filter((item) => item.companyId === companyId))
  }

  async saveItem(item: Item): Promise<Item> {
    const index = this.data.items.findIndex((candidate) => candidate.id === item.id)
    if (index >= 0) this.data.items[index] = item
    else this.data.items = [...this.data.items, item]
    return tick(item)
  }

  async listStockGroups(companyId: string): Promise<StockGroup[]> {
    return tick(this.data.stockGroups.filter((group) => group.companyId === companyId))
  }

  async listUnits(companyId: string): Promise<Unit[]> {
    return tick(this.data.units.filter((unit) => unit.companyId === companyId))
  }

  async listGodowns(companyId: string): Promise<Godown[]> {
    return tick(this.data.godowns.filter((godown) => godown.companyId === companyId))
  }

  async listTaxCategories(companyId: string): Promise<TaxCategory[]> {
    return tick(this.data.taxCategories.filter((tax) => tax.companyId === companyId))
  }

  async listCostCentres(companyId: string): Promise<CostCentre[]> {
    return tick(this.data.costCentres.filter((centre) => centre.companyId === companyId))
  }

  async listEmployees(companyId: string): Promise<Employee[]> {
    return tick(this.data.employees.filter((employee) => employee.companyId === companyId))
  }

  async listCurrencies(companyId: string): Promise<Currency[]> {
    return tick(this.data.currencies.filter((currency) => currency.companyId === companyId))
  }

  async listPriceLists(companyId: string): Promise<PriceList[]> {
    return tick(this.data.priceLists.filter((list) => list.companyId === companyId))
  }

  async listPriceListEntries(companyId: string, priceListId: string): Promise<PriceListEntry[]> {
    const itemIds = new Set(
      this.data.items.filter((item) => item.companyId === companyId).map((item) => item.id),
    )
    return tick(
      this.data.priceListEntries.filter(
        (entry) => entry.priceListId === priceListId && itemIds.has(entry.itemId),
      ),
    )
  }

  async listPaymentTerms(companyId: string): Promise<PaymentTerm[]> {
    return tick(this.data.paymentTerms.filter((term) => term.companyId === companyId))
  }

  async listVouchers(companyId: string, filters: VoucherFilters = {}): Promise<Voucher[]> {
    const search = filters.search?.trim().toLowerCase()
    const result = this.data.vouchers.filter((voucher) => {
      if (voucher.companyId !== companyId) return false
      if (filters.from && voucher.date < filters.from) return false
      if (filters.to && voucher.date > filters.to) return false
      if (filters.type && filters.type !== 'all' && voucher.type !== filters.type) return false
      if (filters.status && filters.status !== 'all' && voucher.status !== filters.status) return false
      if (filters.partyId && voucher.partyId !== filters.partyId) return false
      if (filters.ledgerId && !voucher.entries.some((entry) => entry.ledgerId === filters.ledgerId)) {
        return false
      }
      if (search) {
        const haystack = `${voucher.number} ${voucher.narration} ${voucher.reference}`.toLowerCase()
        if (!haystack.includes(search)) return false
      }
      return true
    })

    result.sort((left, right) =>
      left.date === right.date
        ? left.number.localeCompare(right.number)
        : left.date < right.date
          ? 1
          : -1,
    )
    return tick(result)
  }

  async getVoucher(companyId: string, id: string): Promise<Voucher | null> {
    return tick(this.data.vouchers.find((voucher) => voucher.id === id && voucher.companyId === companyId) ?? null)
  }

  async saveVoucher(voucher: Voucher): Promise<Voucher> {
    const now = new Date().toISOString()
    const stored: Voucher = { ...voucher, updatedAt: now }
    if (!stored.createdAt) stored.createdAt = now

    const index = this.data.vouchers.findIndex((candidate) => candidate.id === stored.id)
    if (index >= 0) this.data.vouchers[index] = stored
    else this.data.vouchers = [stored, ...this.data.vouchers]

    this.data.auditEvents = [
      {
        id: `aud-${stored.id}-${Date.now()}`,
        companyId: stored.companyId,
        actor: 'rupam.admin',
        action: index >= 0 ? 'voucher.updated' : 'voucher.posted',
        recordType: 'voucher',
        recordId: stored.id,
        recordLabel: `${stored.number} — ${stored.narration}`,
        timestamp: now,
        detail: `${stored.status === 'posted' ? 'Posted' : 'Saved as draft'} ${stored.type} voucher dated ${stored.date}`,
      },
      ...this.data.auditEvents,
    ]

    return tick(stored)
  }

  /**
   * Post a voucher. The demo repository holds the allocations in memory in
   * the same way the local database holds them, so both behave identically.
   */
  async postVoucher(voucher: Voucher): Promise<Voucher> {
    const companyId = voucher.companyId
    const ledgers = this.data.ledgers.filter((ledger) => ledger.companyId === companyId)
    const taxCategories = this.data.taxCategories.filter((tax) => tax.companyId === companyId)
    const existing = this.data.vouchers.filter((candidate) => candidate.companyId === companyId)

    let sequence = 0
    const idFactory = () => `demo-post-${Date.now().toString(36)}-${++sequence}`
    const inventory = this.inventoryContext(companyId, ledgers, idFactory)
    const package_ = preparePosting(voucher, {
      companyId,
      ledgers,
      taxCategories,
      existingVouchers: existing,
      closedPeriods: this.data.financialYears
        .filter((year) => year.companyId === companyId && year.isClosed)
        .map((year) => ({ from: year.start, to: year.end, label: `Financial year ${year.label}` })),
      inventory,
      orderContext: this.orderContext(voucher),
      actor: 'rupam.admin',
      idFactory,
      now: () => new Date().toISOString(),
    })

    const index = this.data.vouchers.findIndex((candidate) => candidate.id === package_.voucher.id)
    if (index >= 0) this.data.vouchers[index] = package_.voucher
    else this.data.vouchers = [package_.voucher, ...this.data.vouchers]

    this.data.allocations = [
      ...this.data.allocations.filter(
        (allocation) => !package_.affectedPartyIds.includes(allocation.partyId),
      ),
      ...package_.allocations,
    ]
    this.data.advances = [
      ...this.data.advances.filter(
        (advance) => !package_.affectedPartyIds.includes(advance.partyId),
      ),
      ...package_.advances,
    ]
    this.data.orderFulfilments = [
      ...this.data.orderFulfilments,
      ...package_.orderFulfilments,
    ]
    this.applyStockPlan(
      package_.movements.map((movement) => ({
        ...movement,
        // The domain names more movement types than the stored record does.
        // The types a posting produces are the same in both.
        movementType: movement.movementType as StockMovement['movementType'],
        voucherNumber: package_.voucher.number,
      })),
      package_.stockPools,
      package_.stockLocations,
    )
    this.data.auditEvents = [...package_.auditEvents, ...this.data.auditEvents]

    return tick(package_.voucher)
  }

  /**
   * The order a voucher delivers against, when its lines name order lines.
   *
   * The order is only read when a line names one, so an ordinary voucher costs
   * nothing extra.
   */
  private orderContext(voucher: Voucher) {
    const lineIds = voucher.items
      .map((item) => item.orderLineId)
      .filter((id): id is string => Boolean(id))
    if (!lineIds.length) return undefined

    const owner = this.data.orders.find((order) =>
      this.data.orderLines.some(
        (line) => line.orderId === order.id && lineIds.includes(line.id),
      ),
    )
    if (!owner) return undefined
    return {
      order: owner,
      lines: this.data.orderLines.filter((line) => line.orderId === owner.id),
      fulfilments: this.data.orderFulfilments.filter(
        (fulfilment) => fulfilment.orderId === owner.id,
      ),
    }
  }

  /**
   * The inventory context, when the sample workspace has inventory activated.
   */
  private inventoryContext(
    companyId: string,
    ledgers: Ledger[],
    idFactory: () => string,
  ): InventoryContext | undefined {
    const configured = this.data.inventoryAccounts.find(
      (accounts) => accounts.companyId === companyId,
    )
    if (!configured) return undefined

    const inventory = ledgers.find((ledger) => ledger.id === configured.inventoryLedgerId)
    const cogs = ledgers.find((ledger) => ledger.id === configured.cogsLedgerId)
    const variance = ledgers.find((ledger) => ledger.id === configured.varianceLedgerId)
    const purchases = ledgers.find((ledger) => ledger.id === configured.purchasesLedgerId)
    if (!inventory || !cogs || !variance || !purchases) return undefined

    const items = this.data.items.filter((item) => item.companyId === companyId)

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
        this.data.stockPools
          .filter((pool) => pool.companyId === companyId)
          .map((pool) => [
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
        this.data.stockLocations
          .filter((location) => location.companyId === companyId)
          .map((location) => [
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
      movements: this.data.stockMovements.filter((movement) => movement.companyId === companyId),
    }
  }

  /** Write the movements and the balances they imply into the sample books. */
  private applyStockPlan(
    movements: StockMovement[],
    pools: StockPoolBalance[],
    locations: StockLocationBalance[],
  ): void {
    if (movements.length) {
      const seen = new Set(this.data.stockMovements.map((movement) => movement.id))
      const fresh = movements.filter((movement) => !seen.has(movement.id))
      this.data.stockMovements = [...fresh, ...this.data.stockMovements]
    }

    for (const pool of pools) {
      const index = this.data.stockPools.findIndex(
        (candidate) => candidate.companyId === pool.companyId && candidate.itemId === pool.itemId,
      )
      if (index >= 0) this.data.stockPools[index] = pool
      else this.data.stockPools = [...this.data.stockPools, pool]
    }

    for (const location of locations) {
      const index = this.data.stockLocations.findIndex(
        (candidate) =>
          candidate.companyId === location.companyId &&
          candidate.itemId === location.itemId &&
          candidate.godownId === location.godownId,
      )
      if (index >= 0) this.data.stockLocations[index] = location
      else this.data.stockLocations = [...this.data.stockLocations, location]
    }
  }

  /**
   * Cancel a voucher. The financial effect is withdrawn and the allocations of
   * the affected party are recomputed, exactly as the local database does it.
   */
  async cancelVoucher(voucher: Voucher): Promise<Voucher> {
    const companyId = voucher.companyId
    const ledgers = this.data.ledgers.filter((ledger) => ledger.companyId === companyId)
    const taxCategories = this.data.taxCategories.filter((tax) => tax.companyId === companyId)
    const existing = this.data.vouchers.filter((candidate) => candidate.companyId === companyId)

    let sequence = 0
    const idFactory = () => `demo-cancel-${Date.now().toString(36)}-${++sequence}`
    const package_ = prepareCancellation(voucher, {
      companyId,
      ledgers,
      taxCategories,
      existingVouchers: existing,
      closedPeriods: this.data.financialYears
        .filter((year) => year.companyId === companyId && year.isClosed)
        .map((year) => ({ from: year.start, to: year.end, label: `Financial year ${year.label}` })),
      // The stock the voucher moved is given back by compensating movements.
      inventory: this.inventoryContext(companyId, ledgers, idFactory),
      actor: 'rupam.admin',
      idFactory,
      now: () => new Date().toISOString(),
    })

    const index = this.data.vouchers.findIndex(
      (candidate) => candidate.id === package_.voucher.id,
    )
    if (index >= 0) this.data.vouchers[index] = package_.voucher
    else this.data.vouchers = [package_.voucher, ...this.data.vouchers]

    this.data.allocations = [
      ...this.data.allocations.filter(
        (allocation) => !package_.affectedPartyIds.includes(allocation.partyId),
      ),
      ...package_.allocations,
    ]
    this.data.advances = [
      ...this.data.advances.filter(
        (advance) => !package_.affectedPartyIds.includes(advance.partyId),
      ),
      ...package_.advances,
    ]
    this.data.auditEvents = [...package_.auditEvents, ...this.data.auditEvents]

    this.applyStockPlan(
      package_.movements.map((movement) => ({
        ...movement,
        // The domain names more movement types than the stored record does.
        // The types a posting produces are the same in both.
        movementType: movement.movementType as StockMovement['movementType'],
        voucherNumber: package_.voucher.number,
      })),
      package_.stockPools,
      package_.stockLocations,
    )

    return tick(package_.voucher)
  }

  async listAllocations(companyId: string): Promise<AllocationRecord[]> {
    return tick(
      this.data.allocations.filter((allocation) => allocation.companyId === companyId),
    )
  }

  async listAdvances(companyId: string): Promise<AdvanceRecord[]> {
    return tick(this.data.advances.filter((advance) => advance.companyId === companyId))
  }

  async updateCompany(company: Company): Promise<Company> {
    const index = this.data.companies.findIndex((candidate) => candidate.id === company.id)
    if (index >= 0) this.data.companies[index] = company
    return tick(company)
  }

  async getVoucherNumbering(companyId: string): Promise<VoucherNumbering> {
    const existing = this.data.numbering.find((entry) => entry.companyId === companyId)
    if (existing) return tick(existing)
    return tick({
      id: `numbering-${companyId}`,
      companyId,
      salesPrefix: 'INV',
      purchasePrefix: 'PUR',
      paymentPrefix: 'PAY',
      receiptPrefix: 'RCP',
      contraPrefix: 'CNT',
      journalPrefix: 'JNL',
      creditNotePrefix: 'CN',
      debitNotePrefix: 'DN',
      salesOrderPrefix: 'SO',
      purchaseOrderPrefix: 'PO',
      padding: 4,
      updatedAt: new Date().toISOString(),
    })
  }

  async saveVoucherNumbering(numbering: VoucherNumbering): Promise<VoucherNumbering> {
    const index = this.data.numbering.findIndex(
      (entry) => entry.companyId === numbering.companyId,
    )
    if (index >= 0) this.data.numbering[index] = numbering
    else this.data.numbering = [...this.data.numbering, numbering]
    return tick(numbering)
  }

  async deleteVoucher(companyId: string, id: string): Promise<void> {
    this.data.vouchers = this.data.vouchers.filter(
      (voucher) => !(voucher.id === id && voucher.companyId === companyId),
    )
    this.data.stockMovements = this.data.stockMovements.filter(
      (movement) => movement.voucherId !== id,
    )
    return tick(undefined)
  }

  async nextVoucherNumber(companyId: string, type: VoucherType): Promise<string> {
    const numbering = await this.getVoucherNumbering(companyId)
    const prefix = prefixFor(numbering, type)
    const padding = Math.min(8, Math.max(1, numbering.padding))

    const used = this.data.vouchers.filter(
      (voucher) => voucher.companyId === companyId && voucher.type === type,
    )
    let highest = 0
    for (const voucher of used) {
      if (!voucher.number.startsWith(`${prefix}-`)) continue
      const value = Number(voucher.number.slice(prefix.length + 1))
      if (Number.isFinite(value)) highest = Math.max(highest, value)
    }
    return tick(`${prefix}-${String(highest + 1).padStart(padding, '0')}`)
  }

  async listStockMovements(
    companyId: string,
    filters: { itemId?: string } = {},
  ): Promise<StockMovement[]> {
    const result = this.data.stockMovements.filter(
      (movement) =>
        movement.companyId === companyId && (!filters.itemId || movement.itemId === filters.itemId),
    )
    result.sort((left, right) => (left.date < right.date ? 1 : -1))
    return tick(result)
  }

  async getInventoryAccounts(companyId: string): Promise<InventoryAccounts | null> {
    return tick(
      this.data.inventoryAccounts.find((accounts) => accounts.companyId === companyId) ?? null,
    )
  }

  async saveInventoryAccounts(accounts: InventoryAccounts): Promise<InventoryAccounts> {
    const index = this.data.inventoryAccounts.findIndex(
      (candidate) =>
        candidate.companyId === accounts.companyId && candidate.id === accounts.id,
    )
    if (index >= 0) this.data.inventoryAccounts[index] = accounts
    else this.data.inventoryAccounts = [...this.data.inventoryAccounts, accounts]
    return tick(accounts)
  }

  async listStockPools(companyId: string): Promise<StockPoolBalance[]> {
    return tick(this.data.stockPools.filter((pool) => pool.companyId === companyId))
  }

  async listStockBalances(
    companyId: string,
    itemId?: string,
  ): Promise<StockLocationBalance[]> {
    return tick(
      this.data.stockLocations.filter(
        (location) =>
          location.companyId === companyId && (!itemId || location.itemId === itemId),
      ),
    )
  }

  /**
   * Open the sample books at a cutover date.
   *
   * The opening balances become the costing pools, the locations and the
   * opening movements, and the decision is recorded in the audit trail.
   */
  async createOpeningStock(request: OpeningStockRequest): Promise<OpeningStockResult> {
    const now = new Date().toISOString()
    const accounts: InventoryAccounts = { ...request.accounts, activatedAt: request.cutoverDate }
    const movements: StockMovement[] = []
    const pools: StockPoolBalance[] = []
    const locations: StockLocationBalance[] = []
    // One pool per item and one balance per item and location, however many
    // opening lines the item has.
    const poolTotals = new Map<string, { quantity: number; value: number }>()
    const locationTotals = new Map<string, { quantity: number }>()

    for (const line of request.lines) {
      const pool = this.data.stockPools.find(
        (candidate) =>
          candidate.companyId === request.companyId && candidate.itemId === line.itemId,
      )
      const location = this.data.stockLocations.find(
        (candidate) =>
          candidate.companyId === request.companyId &&
          candidate.itemId === line.itemId &&
          candidate.godownId === line.godownId,
      )

      const poolTotal = poolTotals.get(line.itemId) ?? {
        quantity: pool?.quantityMilli ?? 0,
        value: pool?.carryingValue ?? 0,
      }
      poolTotal.quantity += line.quantityMilli
      poolTotal.value += line.carryingValue
      poolTotals.set(line.itemId, poolTotal)

      const locationKey = `${line.itemId}|${line.godownId}`
      const locationTotal = locationTotals.get(locationKey) ?? {
        quantity: location?.quantityMilli ?? 0,
      }
      locationTotal.quantity += line.quantityMilli
      locationTotals.set(locationKey, locationTotal)

      movements.push({
        id: `opening-${request.companyId}-${line.itemId}-${line.godownId}`,
        companyId: request.companyId,
        voucherId: `opening-${request.companyId}`,
        voucherItemId: null,
        voucherNumber: 'OPENING',
        date: request.cutoverDate,
        itemId: line.itemId,
        godownId: line.godownId,
        movementType: 'opening',
        direction: 'in',
        quantityMilli: line.quantityMilli,
        rate:
          line.quantityMilli === 0
            ? 0
            : Math.round((line.carryingValue * 1000) / line.quantityMilli),
        value: line.carryingValue,
        cost: 0,
        valuationMethod: accounts.valuationMethod,
        resultingQuantityMilli: poolTotal.quantity,
        resultingCarryingValue: poolTotal.value,
        reversesMovementId: null,
        createdAt: now,
      })
    }

    for (const [itemId, total] of poolTotals) {
      const pool = this.data.stockPools.find(
        (candidate) =>
          candidate.companyId === request.companyId && candidate.itemId === itemId,
      )
      pools.push({
        companyId: request.companyId,
        itemId,
        quantityMilli: total.quantity,
        carryingValue: total.value,
        revision: (pool?.revision ?? 0) + 1,
        updatedAt: now,
      })
    }

    for (const [key, total] of locationTotals) {
      const [itemId, godownId] = key.split('|') as [string, string]
      const location = this.data.stockLocations.find(
        (candidate) =>
          candidate.companyId === request.companyId &&
          candidate.itemId === itemId &&
          candidate.godownId === godownId,
      )
      locations.push({
        companyId: request.companyId,
        itemId,
        godownId,
        quantityMilli: total.quantity,
        revision: (location?.revision ?? 0) + 1,
        updatedAt: now,
      })
    }

    this.applyStockPlan(movements, pools, locations)
    await this.saveInventoryAccounts(accounts)

    // The opening stock is a transaction like any other, so the movements
    // point at a voucher that exists. The desktop shell writes the same one.
    const openingVoucher: Voucher = {
      id: `opening-${request.companyId}`,
      companyId: request.companyId,
      type: 'stock-journal',
      number: 'OPENING',
      date: request.cutoverDate,
      dueDate: null,
      paymentTermId: null,
      partyId: null,
      narration:
        request.reason.trim() || `Opening stock from ${request.cutoverDate}`,
      reference: '',
      status: 'posted',
      entries: [],
      items: [],
      taxes: [],
      linkedVoucherId: null,
      reversedByVoucherId: null,
      isLocked: true,
      createdAt: now,
      updatedAt: now,
    }
    const voucherIndex = this.data.vouchers.findIndex(
      (candidate) => candidate.id === openingVoucher.id,
    )
    if (voucherIndex >= 0) this.data.vouchers[voucherIndex] = openingVoucher
    else this.data.vouchers = [openingVoucher, ...this.data.vouchers]

    const auditEvent: AuditEvent = {
      id: `aud-opening-${request.companyId}`,
      companyId: request.companyId,
      actor: request.actor,
      action: 'inventory.activated',
      recordType: 'company',
      recordId: request.companyId,
      recordLabel: `Inventory activated from ${request.cutoverDate}`,
      timestamp: now,
      detail:
        request.reason ||
        `Inventory activated from ${request.cutoverDate} with ${request.lines.length} opening balances`,
    }
    this.data.auditEvents = [auditEvent, ...this.data.auditEvents]

    return { accounts, movements, pools, locations, auditEvent }
  }

  async listAuditEvents(companyId: string, filters: AuditFilters = {}): Promise<AuditEvent[]> {
    const result = this.data.auditEvents.filter((event) => {
      if (event.companyId !== companyId) return false
      if (filters.from && event.timestamp < filters.from) return false
      if (filters.to && event.timestamp > filters.to) return false
      if (filters.actor && event.actor !== filters.actor) return false
      if (filters.action && event.action !== filters.action) return false
      if (filters.recordType && event.recordType !== filters.recordType) return false
      return true
    })
    return tick(result)
  }

  async listStatementLines(
    companyId: string,
    filters: { ledgerId?: string; reconciled?: boolean; from?: string; to?: string } = {},
  ): Promise<StatementLine[]> {
    const result = this.data.statementLines.filter((line) => {
      if (line.companyId !== companyId) return false
      if (filters.ledgerId && line.ledgerId !== filters.ledgerId) return false
      if (filters.reconciled !== undefined && line.isReconciled !== filters.reconciled) return false
      if (filters.from && line.date < filters.from) return false
      if (filters.to && line.date > filters.to) return false
      return true
    })
    result.sort((left, right) => (left.date < right.date ? 1 : -1))
    return tick(result)
  }

  async reconcileStatementLine(
    companyId: string,
    lineId: string,
    voucherId: string | null,
  ): Promise<StatementLine> {
    const index = this.data.statementLines.findIndex(
      (line) => line.id === lineId && line.companyId === companyId,
    )
    if (index < 0) throw new Error('That statement line no longer exists.')
    const existing = this.data.statementLines[index]!
    const updated: StatementLine = {
      ...existing,
      matchedVoucherId: voucherId,
      isReconciled: voucherId !== null,
      confidence: voucherId ? 1 : 0,
      matchReason: voucherId
        ? 'Confirmed by the user against the selected voucher.'
        : 'Unmatched: the line was marked as a book entry to create.',
    }
    this.data.statementLines[index] = updated
    return tick(updated)
  }

  async getDashboard(companyId: string, range: DateRange): Promise<DashboardSnapshot> {
    const ledgers = this.data.ledgers.filter((ledger) => ledger.companyId === companyId)
    const vouchers = this.data.vouchers.filter((voucher) => voucher.companyId === companyId)
    const items = this.data.items.filter((item) => item.companyId === companyId)
    const units = this.data.units.filter((unit) => unit.companyId === companyId)
    const stockMovements = this.data.stockMovements.filter(
      (movement) => movement.companyId === companyId,
    )
    const statementLines = this.data.statementLines.filter(
      (line) => line.companyId === companyId,
    )

    return buildDashboardSnapshot({
      range,
      ledgers,
      vouchers,
      items,
      units,
      stockMovements,
      statementLines,
      asOf: DEMO_TODAY,
    })
  }

  // -- Orders ---------------------------------------------------------------

  async listOrders(companyId: string, kind?: OrderKind): Promise<OrderWithLines[]> {
    const result = this.data.orders
      .filter((order) => order.companyId === companyId && (!kind || order.kind === kind))
      .map((order) => this.orderDetail(order))
    result.sort((left, right) => (left.order.date < right.order.date ? 1 : -1))
    return tick(result)
  }

  async getOrder(companyId: string, id: string): Promise<OrderWithLines | null> {
    const order = this.data.orders.find(
      (candidate) => candidate.id === id && candidate.companyId === companyId,
    )
    return tick(order ? this.orderDetail(order) : null)
  }

  async saveOrder(order: Order, lines: OrderLine[]): Promise<OrderWithLines> {
    const index = this.data.orders.findIndex((candidate) => candidate.id === order.id)
    if (index >= 0) this.data.orders[index] = order
    else this.data.orders = [...this.data.orders, order]
    this.data.orderLines = [
      ...this.data.orderLines.filter((line) => line.orderId !== order.id),
      ...lines,
    ]
    return tick(this.orderDetail(order))
  }

  async confirmOrder(companyId: string, id: string): Promise<Order> {
    const order = this.mustFindOrder(companyId, id)
    const updated = confirmOrder(order, new Date().toISOString())
    this.replaceOrder(updated)
    this.recordAudit(companyId, 'order.confirmed', 'order', updated.id, updated.number,
      `Order ${updated.number} confirmed`)
    return tick(updated)
  }

  async cancelOrder(companyId: string, id: string, reason: string): Promise<Order> {
    const order = this.mustFindOrder(companyId, id)
    const fulfilments = this.data.orderFulfilments.filter(
      (fulfilment) => fulfilment.orderId === order.id,
    )
    const updated = cancelOrder(order, fulfilments, new Date().toISOString())
    this.replaceOrder(updated)
    this.recordAudit(
      companyId,
      'order.cancelled',
      'order',
      updated.id,
      updated.number,
      `Order ${updated.number} cancelled: ${reason.trim()}`,
    )
    return tick(updated)
  }

  async amendOrder(
    companyId: string,
    id: string,
    lines: OrderLine[],
    reason: string,
  ): Promise<OrderWithLines> {
    const order = this.mustFindOrder(companyId, id)
    const current = this.data.orderLines.filter((line) => line.orderId === order.id)
    const fulfilments = this.data.orderFulfilments.filter(
      (fulfilment) => fulfilment.orderId === order.id,
    )
    const context: OrderContext & { actor: string } = {
      companyId,
      items: new Map(
        this.data.items
          .filter((item) => item.companyId === companyId)
          .map((item) => [item.id, item]),
      ),
      idFactory: () => `demo-ord-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`,
      now: () => new Date().toISOString(),
      actor: 'rupam.admin',
    }
    const amendment = prepareOrderAmendment(order, current, fulfilments, { lines, reason }, context)
    const history = buildOrderRevision(order, amendment, context)

    const updated: Order = {
      ...amendment.order,
      revision: order.revision + 1,
      updatedAt: context.now(),
    }
    this.replaceOrder(updated)
    this.data.orderLines = [
      ...this.data.orderLines.filter((line) => line.orderId !== order.id),
      ...amendment.lines,
    ]
    this.data.orderRevisions = [...this.data.orderRevisions, history.revision]
    this.data.orderRevisionLines = [...this.data.orderRevisionLines, ...history.lines]
    this.recordAudit(
      companyId,
      'order.amended',
      'order',
      updated.id,
      updated.number,
      `Order ${updated.number} amended: ${amendment.reason}`,
    )
    return tick(this.orderDetail(updated))
  }

  async nextOrderNumber(companyId: string, kind: OrderKind): Promise<string> {
    const numbering = await this.getVoucherNumbering(companyId)
    const prefix = kind === 'sales' ? numbering.salesOrderPrefix : numbering.purchaseOrderPrefix
    const padding = Math.min(8, Math.max(1, numbering.padding))
    const highest = this.data.orders
      .filter((order) => order.companyId === companyId && order.kind === kind)
      .reduce((max, order) => {
        if (!order.number.startsWith(`${prefix}-`)) return max
        const value = Number(order.number.slice(prefix.length + 1))
        return Number.isFinite(value) ? Math.max(max, value) : max
      }, 0)
    return tick(`${prefix}-${String(highest + 1).padStart(padding, '0')}`)
  }

  /** One order with its lines, its deliveries and its history. */
  private orderDetail(order: Order): OrderWithLines {
    const revisions = this.data.orderRevisions.filter((revision) => revision.orderId === order.id)
    const revisionIds = new Set(revisions.map((revision) => revision.id))
    return {
      order,
      lines: this.data.orderLines.filter((line) => line.orderId === order.id),
      fulfilments: this.data.orderFulfilments.filter(
        (fulfilment) => fulfilment.orderId === order.id,
      ),
      revisions,
      revisionLines: this.data.orderRevisionLines.filter((line) =>
        revisionIds.has(line.revisionId),
      ),
    }
  }

  private mustFindOrder(companyId: string, id: string): Order {
    const order = this.data.orders.find(
      (candidate) => candidate.id === id && candidate.companyId === companyId,
    )
    if (!order) throw new Error('That order no longer exists.')
    return order
  }

  private replaceOrder(order: Order): void {
    const index = this.data.orders.findIndex((candidate) => candidate.id === order.id)
    if (index >= 0) this.data.orders[index] = order
    else this.data.orders = [...this.data.orders, order]
  }

  private recordAudit(
    companyId: string,
    action: string,
    recordType: string,
    recordId: string,
    recordLabel: string,
    detail: string,
  ): void {
    this.data.auditEvents = [
      {
        id: `aud-${recordId}-${Date.now()}`,
        companyId,
        actor: 'rupam.admin',
        action,
        recordType,
        recordId,
        recordLabel,
        timestamp: new Date().toISOString(),
        detail,
      },
      ...this.data.auditEvents,
    ]
  }

  // -- Bills of materials ---------------------------------------------------

  async listBoms(companyId: string, itemId?: string): Promise<BomWithLines[]> {
    const result = this.data.boms
      .filter((bom) => bom.companyId === companyId && (!itemId || bom.itemId === itemId))
      .map((bom) => this.bomDetail(bom))
    result.sort((left, right) => (left.bom.itemId < right.bom.itemId ? -1 : 1))
    return tick(result)
  }

  async getBom(companyId: string, id: string): Promise<BomWithLines | null> {
    const bom = this.data.boms.find(
      (candidate) => candidate.id === id && candidate.companyId === companyId,
    )
    return tick(bom ? this.bomDetail(bom) : null)
  }

  async saveBom(bom: Bom, lines: BomLine[]): Promise<BomWithLines> {
    const index = this.data.boms.findIndex((candidate) => candidate.id === bom.id)
    if (index >= 0) this.data.boms[index] = bom
    else this.data.boms = [...this.data.boms, bom]
    this.data.bomLines = [
      ...this.data.bomLines.filter((line) => line.bomId !== bom.id),
      ...lines,
    ]
    return tick(this.bomDetail(bom))
  }

  async releaseBom(companyId: string, id: string): Promise<BomWithLines> {
    const bom = this.data.boms.find(
      (candidate) => candidate.id === id && candidate.companyId === companyId,
    )
    if (!bom) throw new Error('That structure no longer exists.')
    if (bom.status === 'released') {
      throw new Error(
        'This structure is already released. A released structure cannot be changed; ' +
          'raise a new version instead.',
      )
    }
    const lines = this.data.bomLines.filter((line) => line.bomId === bom.id)
    if (lines.length === 0) {
      throw new Error('A structure with no components cannot be released.')
    }
    const released: Bom = {
      ...bom,
      status: 'released',
      updatedAt: new Date().toISOString(),
    }
    const index = this.data.boms.findIndex((candidate) => candidate.id === bom.id)
    this.data.boms[index] = released
    this.recordAudit(
      companyId,
      'bom.released',
      'bom',
      released.id,
      `Structure v${released.version}`,
      `Structure version ${released.version} released`,
    )
    return tick(this.bomDetail(released))
  }

  private bomDetail(bom: Bom): BomWithLines {
    return {
      bom,
      lines: this.data.bomLines.filter((line) => line.bomId === bom.id),
    }
  }

  // -- Production ------------------------------------------------------------

  async listProductionOrders(companyId: string): Promise<ProductionOrderWithDetail[]> {
    const result = this.data.productionOrders
      .filter((order) => order.companyId === companyId)
      .map((order) => this.productionDetail(order))
    result.sort((left, right) => (left.order.plannedAt < right.order.plannedAt ? 1 : -1))
    return tick(result)
  }

  async getProductionOrder(
    companyId: string,
    id: string,
  ): Promise<ProductionOrderWithDetail | null> {
    const order = this.data.productionOrders.find(
      (candidate) => candidate.id === id && candidate.companyId === companyId,
    )
    return tick(order ? this.productionDetail(order) : null)
  }

  async saveProductionOrder(
    order: ProductionOrder,
    requirements: ProductionRequirement[],
  ): Promise<ProductionOrderWithDetail> {
    const stored = order.number
      ? order
      : { ...order, number: this.nextProductionNumber(order.companyId) }
    const index = this.data.productionOrders.findIndex((candidate) => candidate.id === stored.id)
    if (index >= 0) this.data.productionOrders[index] = stored
    else this.data.productionOrders = [...this.data.productionOrders, stored]
    this.data.productionRequirements = [
      ...this.data.productionRequirements.filter(
        (requirement) => requirement.productionOrderId !== stored.id,
      ),
      ...requirements,
    ]
    return tick(this.productionDetail(stored))
  }

  /** The next production order number, in the sample books. */
  private nextProductionNumber(companyId: string): string {
    const highest = this.data.productionOrders
      .filter((order) => order.companyId === companyId)
      .reduce((max, order) => {
        const digits = order.number.slice(order.number.indexOf('-') + 1)
        const value = Number(digits)
        return Number.isFinite(value) ? Math.max(max, value) : max
      }, 0)
    return `PRD-${String(highest + 1).padStart(4, '0')}`
  }

  async releaseProductionOrder(companyId: string, id: string): Promise<ProductionOrderWithDetail> {
    const order = this.data.productionOrders.find(
      (candidate) => candidate.id === id && candidate.companyId === companyId,
    )
    if (!order) throw new Error('That production order no longer exists.')
    if (order.status !== 'draft') {
      throw new Error('Only a draft production order can be released.')
    }
    const bom = this.data.boms.find((candidate) => candidate.id === order.bomId)
    if (!bom) throw new Error('The structure this order was raised against no longer exists.')
    if (bom.status !== 'released') {
      throw new Error('A production order can only be released against a released structure.')
    }
    const accounts = this.data.inventoryAccounts.find(
      (candidate) => candidate.companyId === companyId,
    )
    if (!accounts) {
      throw new Error(
        'Production needs inventory to be activated for this company, so the materials can be costed.',
      )
    }
    const bomLines = this.data.bomLines.filter((line) => line.bomId === bom.id)
    const context: ProductionOrderContext = {
      companyId,
      items: new Map(
        this.data.items
          .filter((item) => item.companyId === companyId)
          .map((item) => [item.id, item]),
      ),
      idFactory: () => `demo-prq-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`,
      now: () => new Date().toISOString(),
    }
    const requirements = buildProductionRequirements(order, bom, bomLines, context)
    const released: ProductionOrder = {
      ...order,
      status: 'released',
      bomVersion: bom.version,
      updatedAt: context.now(),
    }
    const index = this.data.productionOrders.findIndex((candidate) => candidate.id === order.id)
    this.data.productionOrders[index] = released
    this.data.productionRequirements = [
      ...this.data.productionRequirements.filter(
        (requirement) => requirement.productionOrderId !== order.id,
      ),
      ...requirements,
    ]
    this.recordAudit(
      companyId,
      'production.released',
      'production-order',
      released.id,
      released.number,
      `Production order ${released.number} released against structure version ${bom.version}`,
    )
    return tick(this.productionDetail(released))
  }

  async postProductionIssue(
    order: ProductionOrder,
    requirements: ProductionRequirement[],
    inputs: ProductionIssueInput[],
  ): Promise<ProductionIssueResult> {
    const context = this.productionContext(order.companyId)
    const plan = planProductionIssue(order, requirements, inputs, context)

    const nextRequirements = requirements.map((requirement) => {
      const issued = inputs
        .filter((input) => input.requirementId === requirement.id)
        .reduce((sum, input) => sum + input.quantityMilli, 0)
      return issued
        ? { ...requirement, issuedQuantityMilli: requirement.issuedQuantityMilli + issued }
        : requirement
    })

    const voucher: Voucher = {
      ...plan.voucher,
      number: await this.nextVoucherNumber(order.companyId, 'stock-journal'),
    }
    this.data.vouchers = [voucher, ...this.data.vouchers]
    this.data.productionIssues = [...this.data.productionIssues, ...plan.issues]
    this.data.productionRequirements = this.data.productionRequirements.map((requirement) =>
      nextRequirements.find((candidate) => candidate.id === requirement.id) ?? requirement,
    )
    this.writeProductionPlan(voucher, plan.movements, plan.pools, order.companyId)
    this.recordAudit(
      order.companyId,
      'production.issued',
      'production-order',
      order.id,
      order.number,
      `Materials issued against production order ${order.number}`,
    )

    return tick({ voucher, issues: plan.issues, requirements: nextRequirements })
  }

  async postProductionCompletion(
    order: ProductionOrder,
    requirements: ProductionRequirement[],
    issues: ProductionIssue[],
  ): Promise<ProductionCompletionResult> {
    const context = this.productionContext(order.companyId)
    const plan = planProductionCompletion(order, requirements, issues, context)

    const voucher: Voucher = {
      ...plan.voucher,
      number: await this.nextVoucherNumber(order.companyId, 'stock-journal'),
    }
    this.data.vouchers = [voucher, ...this.data.vouchers]
    this.data.productionCompletions = [...this.data.productionCompletions, ...plan.completions]
    this.writeProductionPlan(voucher, plan.movements, plan.pools, order.companyId)
    this.recordAudit(
      order.companyId,
      'production.completed',
      'production-order',
      order.id,
      order.number,
      `Finished goods received against production order ${order.number}`,
    )

    return tick({ voucher, completions: plan.completions, requirements })
  }

  /** The context the production domain needs: the costing engine and the account. */
  private productionContext(companyId: string): ProductionPostingContext {
    const ledgers = this.data.ledgers.filter((ledger) => ledger.companyId === companyId)
    const accounts = this.data.inventoryAccounts.find(
      (candidate) => candidate.companyId === companyId,
    )
    if (!accounts?.productionLedgerId) {
      throw new Error(
        'Choose a work in progress account before posting a production order. ' +
          'Inventory settings has no production account for this company yet.',
      )
    }
    let sequence = 0
    const idFactory = () => `demo-mov-${Date.now().toString(36)}-${++sequence}`
    const inventory = this.inventoryContext(companyId, ledgers, idFactory)
    if (!inventory) {
      throw new Error(
        'Production needs inventory to be activated for this company, so the materials can be costed.',
      )
    }
    return {
      companyId,
      items: new Map(
        this.data.items
          .filter((item) => item.companyId === companyId)
          .map((item) => [item.id, item]),
      ),
      inventory,
      productionLedgerId: accounts.productionLedgerId,
      idFactory,
      now: () => new Date().toISOString(),
      today: DEMO_TODAY,
    }
  }

  /**
   * Write the movements of a production posting and the balances they imply.
   *
   * The location balances are the projection of the movement ledger, so the
   * two cannot drift apart.
   */
  private writeProductionPlan(
    voucher: Voucher,
    movements: Array<{
      id: string
      companyId: string
      itemId: string
      godownId: string | null
      voucherId: string
      voucherItemId: string | null
      movementType: string
      date: string
      direction: 'in' | 'out'
      quantityMilli: number
      rate: number
      value: number
      cost: number
      valuationMethod: string
      resultingQuantityMilli: number
      resultingCarryingValue: number
      reversesMovementId: string | null
      createdAt: string
    }>,
    pools: Map<string, { itemId: string; quantityMilli: number; carryingValue: number; revision: number }>,
    companyId: string,
  ): void {
    const now = new Date().toISOString()
    const records: StockMovement[] = movements.map((movement) => ({
      ...movement,
      movementType: movement.movementType as StockMovement['movementType'],
      voucherNumber: voucher.number,
    }))
    this.data.stockMovements = [...records, ...this.data.stockMovements]

    const poolRecords: StockPoolBalance[] = [...pools.values()].map((pool) => ({
      companyId,
      itemId: pool.itemId,
      quantityMilli: pool.quantityMilli,
      carryingValue: pool.carryingValue,
      revision: pool.revision,
      updatedAt: now,
    }))
    for (const pool of poolRecords) {
      const index = this.data.stockPools.findIndex(
        (candidate) => candidate.companyId === pool.companyId && candidate.itemId === pool.itemId,
      )
      if (index >= 0) this.data.stockPools[index] = pool
      else this.data.stockPools = [...this.data.stockPools, pool]
    }

    const replayed = replayMovements(
      this.data.stockMovements.filter((movement) => movement.companyId === companyId),
    )
    for (const [key, balance] of replayed) {
      const existing = this.data.stockLocations.find(
        (location) =>
          location.companyId === companyId &&
          locationKey(location.itemId, location.godownId) === key,
      )
      const record: StockLocationBalance = {
        companyId,
        itemId: balance.itemId,
        godownId: balance.godownId ?? '',
        quantityMilli: balance.quantityMilli,
        revision: (existing?.revision ?? 0) + 1,
        updatedAt: now,
      }
      if (existing) {
        const index = this.data.stockLocations.findIndex(
          (candidate) =>
            candidate.companyId === companyId &&
            candidate.itemId === record.itemId &&
            candidate.godownId === record.godownId,
        )
        this.data.stockLocations[index] = record
      } else {
        this.data.stockLocations = [...this.data.stockLocations, record]
      }
    }
  }

  private productionDetail(order: ProductionOrder): ProductionOrderWithDetail {
    return {
      order,
      requirements: this.data.productionRequirements.filter(
        (requirement) => requirement.productionOrderId === order.id,
      ),
      issues: this.data.productionIssues.filter((issue) => issue.productionOrderId === order.id),
      completions: this.data.productionCompletions.filter(
        (completion) => completion.productionOrderId === order.id,
      ),
    }
  }

  // -- Payroll ---------------------------------------------------------------

  async listSalaryStructures(companyId: string): Promise<SalaryStructure[]> {
    return tick(this.data.salaryStructures.filter((structure) => structure.companyId === companyId))
  }

  async getSalaryStructure(
    companyId: string,
    id: string,
  ): Promise<SalaryStructureDetail | null> {
    const structure = this.data.salaryStructures.find(
      (candidate) => candidate.id === id && candidate.companyId === companyId,
    )
    if (!structure) return tick(null)
    return tick({
      structure,
      components: this.data.salaryComponents.filter(
        (component) => component.structureId === structure.id,
      ),
    })
  }

  async saveSalaryStructure(
    structure: SalaryStructure,
    components: SalaryComponent[],
  ): Promise<SalaryStructure> {
    const index = this.data.salaryStructures.findIndex((candidate) => candidate.id === structure.id)
    if (index >= 0) this.data.salaryStructures[index] = structure
    else this.data.salaryStructures = [...this.data.salaryStructures, structure]

    this.data.salaryComponents = [
      ...this.data.salaryComponents.filter(
        (component) => component.structureId !== structure.id,
      ),
      ...components.map((component) => ({ ...component, structureId: structure.id })),
    ]
    return tick(structure)
  }

  async listSalaryAssignments(companyId: string): Promise<SalaryAssignment[]> {
    return tick(
      this.data.salaryAssignments.filter((assignment) => assignment.companyId === companyId),
    )
  }

  async saveSalaryAssignment(assignment: SalaryAssignment): Promise<SalaryAssignment> {
    const index = this.data.salaryAssignments.findIndex(
      (candidate) => candidate.id === assignment.id,
    )
    if (index >= 0) this.data.salaryAssignments[index] = assignment
    else this.data.salaryAssignments = [...this.data.salaryAssignments, assignment]
    return tick(assignment)
  }

  async listAttendance(companyId: string, period: string): Promise<PayrollAttendance[]> {
    return tick(
      this.data.payrollAttendance.filter(
        (attendance) => attendance.companyId === companyId && attendance.period === period,
      ),
    )
  }

  async saveAttendance(attendance: PayrollAttendance): Promise<PayrollAttendance> {
    const index = this.data.payrollAttendance.findIndex(
      (candidate) => candidate.id === attendance.id,
    )
    const stored = { ...attendance, updatedAt: new Date().toISOString() }
    if (index >= 0) this.data.payrollAttendance[index] = stored
    else this.data.payrollAttendance = [...this.data.payrollAttendance, stored]
    return tick(stored)
  }

  async listPayrollRuns(companyId: string): Promise<PayrollRun[]> {
    const result = this.data.payrollRuns.filter((run) => run.companyId === companyId)
    result.sort((left, right) => (left.period < right.period ? 1 : -1))
    return tick(result)
  }

  async getPayrollRun(companyId: string, id: string): Promise<PayrollRunDetail | null> {
    const run = this.data.payrollRuns.find(
      (candidate) => candidate.id === id && candidate.companyId === companyId,
    )
    if (!run) return tick(null)
    return tick({
      run,
      snapshots: this.data.payrollSnapshots.filter((snapshot) => snapshot.runId === run.id),
    })
  }

  async savePayrollRun(run: PayrollRun, snapshots: PayrollSnapshot[] = []): Promise<PayrollRun> {
    const index = this.data.payrollRuns.findIndex((candidate) => candidate.id === run.id)
    const existing = index >= 0 ? this.data.payrollRuns[index]! : null
    const stored = {
      ...run,
      // A posted run keeps the journal that carried it. Re-saving it never
      // clears the voucher, or the paid state could never follow.
      journalVoucherId: run.journalVoucherId ?? existing?.journalVoucherId ?? null,
      updatedAt: new Date().toISOString(),
    }
    if (index >= 0) this.data.payrollRuns[index] = stored
    else this.data.payrollRuns = [stored, ...this.data.payrollRuns]

    if (snapshots.length) {
      this.data.payrollSnapshots = [
        ...this.data.payrollSnapshots.filter((snapshot) => snapshot.runId !== stored.id),
        ...snapshots.map((snapshot) => ({ ...snapshot, runId: stored.id })),
      ]
    }
    return tick(stored)
  }

  async deletePayrollRun(companyId: string, id: string): Promise<void> {
    this.data.payrollRuns = this.data.payrollRuns.filter(
      (run) => !(run.id === id && run.companyId === companyId),
    )
    this.data.payrollSnapshots = this.data.payrollSnapshots.filter(
      (snapshot) => snapshot.runId !== id,
    )
    this.data.payrollPayments = this.data.payrollPayments.filter(
      (payment) => payment.runId !== id,
    )
    return tick(undefined)
  }

  /**
   * Post a payroll run.
   *
   * The journal is an ordinary journal voucher and is written into the books
   * the same way one raised by hand would be, so the trial balance and the
   * payslips agree.
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
      entries,
      items: [],
      taxes: [],
      updatedAt: new Date().toISOString(),
    }
    if (!voucher.createdAt) voucher.createdAt = voucher.updatedAt

    const index = this.data.vouchers.findIndex((candidate) => candidate.id === voucher.id)
    if (index >= 0) this.data.vouchers[index] = voucher
    else this.data.vouchers = [voucher, ...this.data.vouchers]

    const stored: PayrollRun = {
      ...run,
      companyId,
      id,
      status: 'posted',
      journalVoucherId: voucher.id,
      updatedAt: new Date().toISOString(),
    }
    const runIndex = this.data.payrollRuns.findIndex((candidate) => candidate.id === id)
    if (runIndex >= 0) this.data.payrollRuns[runIndex] = stored
    else this.data.payrollRuns = [stored, ...this.data.payrollRuns]

    this.recordAudit(
      companyId,
      'payroll.posted',
      'payroll-run',
      stored.id,
      `${stored.number} — salary posted`,
      `Payroll run ${stored.number} for ${stored.period} posted as ${voucher.number}`,
    )

    return tick(stored)
  }

  async listPayrollPayments(companyId: string, runId: string): Promise<PayrollPayment[]> {
    return tick(
      this.data.payrollPayments.filter(
        (payment) => payment.companyId === companyId && payment.runId === runId,
      ),
    )
  }

  async savePayrollPayment(payment: PayrollPayment): Promise<PayrollPayment> {
    const index = this.data.payrollPayments.findIndex((candidate) => candidate.id === payment.id)
    if (index >= 0) this.data.payrollPayments[index] = payment
    else this.data.payrollPayments = [...this.data.payrollPayments, payment]
    return tick(payment)
  }

  async getPayrollAccounts(companyId: string): Promise<PayrollAccounts | null> {
    return tick(
      this.data.payrollAccounts.find((accounts) => accounts.companyId === companyId) ?? null,
    )
  }

  async savePayrollAccounts(accounts: PayrollAccounts): Promise<PayrollAccounts> {
    const index = this.data.payrollAccounts.findIndex(
      (candidate) => candidate.id === accounts.id,
    )
    if (index >= 0) this.data.payrollAccounts[index] = accounts
    else this.data.payrollAccounts = [...this.data.payrollAccounts, accounts]
    return tick(accounts)
  }

  async listStatutoryRules(companyId: string): Promise<StatutoryRuleVersion[]> {
    return tick(this.data.statutoryRules.filter((rule) => rule.companyId === companyId))
  }

  async saveStatutoryRule(rule: StatutoryRuleVersion): Promise<StatutoryRuleVersion> {
    const index = this.data.statutoryRules.findIndex((candidate) => candidate.id === rule.id)
    if (index >= 0) this.data.statutoryRules[index] = rule
    else this.data.statutoryRules = [...this.data.statutoryRules, rule]
    return tick(rule)
  }

  /**
   * The next number for a payroll run of a period.
   *
   * The number carries the period, so a run is found by the period it pays.
   */
  async nextPayrollNumber(companyId: string, period: string): Promise<string> {
    const base = `PR-${period}`
    const used = this.data.payrollRuns.filter(
      (run) => run.companyId === companyId && run.number.startsWith(base),
    )
    let highest = 0
    for (const run of used) {
      const suffix = run.number.slice(base.length).replace('-', '')
      const value = Number(suffix)
      if (Number.isFinite(value)) highest = Math.max(highest, value)
    }
    return highest === 0 ? base : `${base}-${String(highest + 1).padStart(2, '0')}`
  }
}
