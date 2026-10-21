/**
 * Deterministic demo dataset.
 *
 * Every figure is generated from a fixed seed and the reference date below, so
 * the demo books are identical on every machine and every run. Vouchers are
 * produced by the domain service itself, which guarantees the demo trial
 * balance nets to zero and that ledger balances reconcile to their entries.
 *
 * All names, numbers and tax identifiers are fictional.
 */

import { buildVoucher, type ItemLineInput, type VoucherContext } from '@/domain/accounting'
import { buildAllocationLedger, type AdvanceRecord, type AllocationRecord } from '@/domain/allocations'
import {
  locationKey,
  planInventoryPosting,
  replayMovements,
  VALUATION_METHOD,
  type InventoryContext,
  type StockPool,
} from '@/domain/inventory'
import {
  buildOrder,
  confirmOrder,
  type OrderContext,
  type OrderLineInput,
} from '@/domain/orders'
import {
  buildBom,
  buildProductionOrder,
  buildProductionRequirements,
  planProductionCompletion,
  planProductionIssue,
  requiredQuantityMilli,
  type BomContext,
  type ProductionOrderContext,
  type ProductionPostingContext,
} from '@/domain/production'
import { averageCost, divideRounded, lineValue, QUANTITY_SCALE, type Quantity } from '@/domain/quantity'
import { addDays } from '@/lib/datetime'
import type { VoucherNumbering } from '@/repositories/contracts'
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
  PriceList,
  PriceListEntry,
  ProductionCompletion,
  ProductionIssue,
  ProductionOrder,
  ProductionRequirement,
  StatementLine,
  StockGroup,
  StockLocationBalance,
  StockMovement,
  StockPoolBalance,
  TaxCategory,
  Unit,
  Voucher,
  VoucherItemLine,
  VoucherType,
} from '@/domain/types'

/** Reference "today" for the demo books. */
export const DEMO_TODAY = '2026-10-20'

/** The date the sample books open on, and the day inventory starts. */
const OPENING_DATE = '2025-04-01'

/** The capital the sample books open with, before the company scale. */
const DEMO_CAPITAL = 50_000_000

export interface DemoDataset {
  companies: Company[]
  financialYears: FinancialYear[]
  ledgers: Ledger[]
  items: Item[]
  stockGroups: StockGroup[]
  units: Unit[]
  godowns: Godown[]
  taxCategories: TaxCategory[]
  costCentres: CostCentre[]
  employees: Employee[]
  currencies: Currency[]
  priceLists: PriceList[]
  priceListEntries: PriceListEntry[]
  paymentTerms: PaymentTerm[]
  vouchers: Voucher[]
  stockMovements: StockMovement[]
  stockPools: StockPoolBalance[]
  stockLocations: StockLocationBalance[]
  inventoryAccounts: InventoryAccounts[]
  statementLines: StatementLine[]
  allocations: AllocationRecord[]
  advances: AdvanceRecord[]
  numbering: VoucherNumbering[]
  auditEvents: AuditEvent[]
  orders: Order[]
  orderLines: OrderLine[]
  orderFulfilments: OrderFulfilment[]
  orderRevisions: OrderRevision[]
  orderRevisionLines: OrderRevisionLine[]
  boms: Bom[]
  bomLines: BomLine[]
  productionOrders: ProductionOrder[]
  productionRequirements: ProductionRequirement[]
  productionIssues: ProductionIssue[]
  productionCompletions: ProductionCompletion[]
}

// ---------------------------------------------------------------------------
// Deterministic pseudo-random source
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

class IdFactory {
  private counters = new Map<string, number>()

  next(prefix: string): string {
    const current = (this.counters.get(prefix) ?? 0) + 1
    this.counters.set(prefix, current)
    return `${prefix}-${String(current).padStart(5, '0')}`
  }
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

const COMPANY_BLUEPRINTS = [
  {
    id: 'cmp-00001',
    name: 'Shree Balaji Traders',
    legalName: 'Shree Balaji Traders',
    industry: 'Hardware retail',
    state: 'Gujarat',
    gstin: '24AABCS1429B1ZX',
    pan: 'AABCS1429B',
    address: 'Shop 18-19, Sarkhej Trade Centre, Sarkhej-Gandhinagar Highway, Ahmedabad, Gujarat 380054',
    phone: '+91 79 2685 4412',
    email: 'accounts@shreebalajitraders.demo',
    scale: 1,
    fyStart: '2026-04-01',
    fyEnd: '2027-03-31',
  },
  {
    id: 'cmp-00002',
    name: 'Northbridge Instruments and Engineering Solutions Private Limited',
    legalName: 'Northbridge Instruments and Engineering Solutions Private Limited',
    industry: 'Industrial instrumentation',
    state: 'Maharashtra',
    gstin: '27AAFCN9182K1ZP',
    pan: 'AAFCN9182K',
    address: 'Unit 402, Solaris Business Park, Andheri East, Mumbai, Maharashtra 400069',
    phone: '+91 22 6789 1200',
    email: 'finance@northbridge-instruments.demo',
    scale: 6,
    fyStart: '2026-04-01',
    fyEnd: '2027-03-31',
  },
  {
    id: 'cmp-00003',
    name: 'Kuber',
    legalName: 'Kuber',
    industry: 'Services',
    state: 'Karnataka',
    gstin: '29ABCK1455N1ZQ',
    pan: 'ABCK1455N',
    address: 'No. 7, 3rd Cross, Jayanagar 4th Block, Bengaluru, Karnataka 560011',
    phone: '+91 80 4123 7788',
    email: 'hello@kuber.demo',
    scale: 0.18,
    fyStart: '2026-04-01',
    fyEnd: '2027-03-31',
  },
]

const CUSTOMER_NAMES = [
  'Anand Textiles Private Limited',
  'Shree Ganesh Hardware Stores',
  'Rajasthan Infra Projects LLP',
  'Mehta Electricals',
  'Kasturi Builders and Developers',
  'Sunrise Agro Equipment Traders',
  'Nadiya Construction Company',
  'Grace Diagnostics Supplies',
  'Vertex Interiors',
  'R K Steel Traders',
  'Bluewave Packaging Industries',
  'Deepak Hardware and Paints',
  'Lotus Hospitality Supplies',
  'Pragati Auto Components',
  'Sagar Food Products',
]

const SUPPLIER_NAMES = [
  'Bharat Industrial Tools Private Limited',
  'Precision Fasteners and Bearings',
  'Ashok Electricals Wholesale',
  'National Hardware Stores',
  'Zenith Safety Equipment',
  'Gokul Packaging Supplies',
  'Sunrise Chemicals Corporation',
  'Magnet Steel Depot',
  'Orion Office Supplies',
  'Vikram Lubricants and Oils',
  'Kalyan Plastic Components',
  'Shakti Motors and Spares',
]

const EXPENSE_LEDGER_NAMES = [
  'Rent',
  'Salaries and Wages',
  'Electricity',
  'Telephone and Internet',
  'Stationery and Printing',
  'Travel and Conveyance',
  'Bank Charges',
  'Freight and Cartage',
  'Repairs and Maintenance',
  'Advertisement',
  'Professional Fees',
  'Insurance',
  'Depreciation',
  'Miscellaneous Expenses',
]

const ITEM_BLUEPRINTS = [
  { name: 'SS 304 Hex Bolt M8 x 40mm', group: 'Fasteners', unit: 'Nos', cost: 12, sell: 19, tax: 'CGST 9%' },
  { name: 'SS 304 Hex Bolt M10 x 60mm', group: 'Fasteners', unit: 'Nos', cost: 24, sell: 37, tax: 'CGST 9%' },
  { name: 'MS Flat Bar 25mm x 6mm', group: 'Steel and Metals', unit: 'Kg', cost: 58, sell: 84, tax: 'CGST 9%' },
  { name: 'MS Angle 40mm x 40mm x 6mm', group: 'Steel and Metals', unit: 'Kg', cost: 62, sell: 91, tax: 'CGST 9%' },
  { name: 'GI Pipe 1 inch', group: 'Pipes and Fittings', unit: 'Nos', cost: 142, sell: 198, tax: 'CGST 9%' },
  { name: 'GI Elbow 1 inch', group: 'Pipes and Fittings', unit: 'Nos', cost: 18, sell: 29, tax: 'CGST 9%' },
  { name: 'CPVC Pipe 2 inch', group: 'Pipes and Fittings', unit: 'Nos', cost: 96, sell: 139, tax: 'CGST 9%' },
  { name: 'PVC Ball Valve 1 inch', group: 'Valves and Fittings', unit: 'Nos', cost: 128, sell: 186, tax: 'CGST 9%' },
  { name: 'Pressure Gauge 0-10 bar', group: 'Instrumentation', unit: 'Nos', cost: 640, sell: 980, tax: 'CGST 9%' },
  { name: 'Digital Temperature Sensor PT100', group: 'Instrumentation', unit: 'Nos', cost: 1850, sell: 2650, tax: 'CGST 9%' },
  { name: 'Pressure Transmitter 0-16 bar', group: 'Instrumentation', unit: 'Nos', cost: 4200, sell: 5900, tax: 'CGST 9%' },
  { name: 'Industrial Solenoid Valve 24VDC', group: 'Valves and Fittings', unit: 'Nos', cost: 3150, sell: 4450, tax: 'CGST 9%' },
  { name: 'VFD 2.2 kW', group: 'Electrical', unit: 'Nos', cost: 11500, sell: 15900, tax: 'CGST 9%' },
  { name: 'Contactor 32A', group: 'Electrical', unit: 'Nos', cost: 890, sell: 1250, tax: 'CGST 9%' },
  { name: 'LED Flood Light 50W', group: 'Electrical', unit: 'Nos', cost: 720, sell: 1040, tax: 'CGST 9%' },
  { name: 'Cable 2.5 sq mm (per m)', group: 'Electrical', unit: 'Metre', cost: 86, sell: 119, tax: 'CGST 9%' },
  { name: 'Safety Helmet', group: 'Safety', unit: 'Nos', cost: 210, sell: 320, tax: 'CGST 5%' },
  { name: 'Safety Goggles', group: 'Safety', unit: 'Nos', cost: 95, sell: 160, tax: 'CGST 5%' },
  { name: 'Cotton Wiping Cloth (pack)', group: 'Consumables', unit: 'Pack', cost: 60, sell: 95, tax: 'CGST 2.5%' },
  { name: 'Cutting Oil 1 litre', group: 'Consumables', unit: 'Litre', cost: 240, sell: 340, tax: 'CGST 9%' },
  { name: 'Welding Electrode 3.15mm (5kg)', group: 'Consumables', unit: 'Box', cost: 380, sell: 540, tax: 'CGST 9%' },
  { name: 'Installation and Commissioning', group: 'Services', unit: 'Hour', cost: 450, sell: 1200, tax: 'IGST 18%', service: true },
  { name: 'Annual Maintenance Contract', group: 'Services', unit: 'Nos', cost: 0, sell: 45000, tax: 'IGST 18%', service: true },
]

const UNITS = [
  { name: 'Nos', decimalPlaces: 0 },
  { name: 'Kg', decimalPlaces: 3 },
  { name: 'Litre', decimalPlaces: 2 },
  { name: 'Metre', decimalPlaces: 2 },
  { name: 'Pack', decimalPlaces: 0 },
  { name: 'Box', decimalPlaces: 0 },
  { name: 'Hour', decimalPlaces: 2 },
]

const STOCK_GROUPS = [
  'Fasteners',
  'Steel and Metals',
  'Pipes and Fittings',
  'Valves and Fittings',
  'Instrumentation',
  'Electrical',
  'Safety',
  'Consumables',
  'Services',
]

const GODOWNS = [
  { name: 'Main Store', location: 'Ahmedabad HQ' },
  { name: 'Project Yard', location: 'Sanand' },
  { name: 'Service Depot', location: 'Mumbai' },
]

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function monthsBetween(start: string, end: string): string[] {
  const months: string[] = []
  const cursor = new Date(`${start}T00:00:00`)
  const last = new Date(`${end}T00:00:00`)
  while (cursor <= last) {
    months.push(cursor.toISOString().slice(0, 7))
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return months
}

function dayInMonth(month: string, day: number): string {
  const clamped = Math.min(day, 28)
  return `${month}-${String(clamped).padStart(2, '0')}`
}

/**
 * The location balances the movement ledger implies.
 *
 * The projection is the ledger's, so the stored balances and the movements
 * cannot drift apart.
 */
function projectLocations(
  context: InventoryContext,
  movements: StockMovement[],
): InventoryContext['locations'] {
  const replayed = replayMovements(movements)
  return new Map(
    [...replayed].map(([key, balance]) => [
      key,
      {
        itemId: balance.itemId,
        godownId: balance.godownId ?? '',
        quantityMilli: balance.quantityMilli,
        revision: (context.locations.get(key)?.revision ?? 0) + 1,
      },
    ]),
  )
}

function buildLedgers(
  company: (typeof COMPANY_BLUEPRINTS)[number],
  ids: IdFactory,
  inventoryOpeningValue: number,
  inventoryTarget: number,
): { ledgers: Ledger[]; taxCategories: TaxCategory[] } {
  const ledgers: Ledger[] = []
  const taxCategories: TaxCategory[] = []
  const created = '2026-04-01T09:00:00.000Z'

  const push = (
    name: string,
    group: Ledger['group'],
    type: Ledger['type'],
    openingBalance = 0,
    options: Partial<Ledger> = {},
  ): Ledger => {
    const ledger: Ledger = {
      id: ids.next('led'),
      companyId: company.id,
      name,
      group,
      type,
      parentId: null,
      openingBalance,
      openingDate: '2025-04-01',
      partyKind: null,
      currency: 'INR',
      isSystem: type !== 'receivable' && type !== 'payable',
      isActive: true,
      createdAt: created,
      ...options,
    }
    ledgers.push(ledger)
    return ledger
  }

  const capital = DEMO_CAPITAL * company.scale
  push("Owner's Capital", 'equity', 'capital', -capital, { isSystem: false })
  push('Retained Earnings', 'equity', 'capital', 0)
  // Cash carries the rounding that is left when the opening stock is valued,
  // so the opening balance sheet still nets to zero.
  push('Cash', 'assets', 'cash', Math.round(capital * 0.5) + (inventoryTarget - inventoryOpeningValue))
  push('HDFC Bank Current Account', 'assets', 'bank', Math.round(capital * 0.25))
  push('ICICI Bank Savings Account', 'assets', 'bank', Math.round(capital * 0.125))
  push('Accounts Receivable', 'assets', 'receivable', 0)
  // The inventory asset account opens at exactly the carrying value of the
  // opening stock, so the ledger and the stock agree from the first day.
  push('Inventory', 'assets', 'inventory', inventoryOpeningValue)
  push('Furniture and Fixtures', 'assets', 'fixed-assets', 0)
  push('Accounts Payable', 'liabilities', 'payable', 0)
  push('Salaries Payable', 'liabilities', 'current-liabilities', 0)
  push('Outstanding Expenses', 'liabilities', 'current-liabilities', 0)
  push('TDS Payable', 'liabilities', 'current-liabilities', 0)
  push('Sales', 'income', 'sales', 0, { isSystem: false })
  push('Service Income', 'income', 'sales', 0, { isSystem: false })
  push('Other Income', 'income', 'sales', 0, { isSystem: false })
  push('Purchases', 'expenses', 'purchase', 0, { isSystem: false })
  // The two accounts the inventory policy needs: the cost of the stock that has
  // been sold, and the account that carries a count variance.
  push('Cost of Goods Sold', 'expenses', 'expenses', 0, { isSystem: false })
  push('Stock Adjustment / Variance', 'expenses', 'expenses', 0, { isSystem: false })
  // The work in progress account carries the cost of the materials issued to
  // production until the finished goods are received.
  push('Work in Progress', 'assets', 'work-in-progress', 0, { isSystem: false })
  for (const name of EXPENSE_LEDGER_NAMES) {
    push(name, 'expenses', 'expenses', 0, { isSystem: false })
  }

  // Tax ledgers, one pair per statutory rate, with a matching input ledger so
  // purchase tax lands on the input side of the books.
  const taxBlueprint: Array<{
    key: string
    name: string
    rate: number
    type: TaxCategory['type']
    group: Ledger['group']
    hsn: string
  }> = [
    { key: 'cgst9', name: 'CGST 9%', rate: 9, type: 'cgst', group: 'liabilities', hsn: '732690' },
    { key: 'sgst9', name: 'SGST 9%', rate: 9, type: 'sgst', group: 'liabilities', hsn: '732690' },
    { key: 'cgst5', name: 'CGST 5%', rate: 5, type: 'cgst', group: 'liabilities', hsn: '190590' },
    { key: 'sgst5', name: 'SGST 5%', rate: 5, type: 'sgst', group: 'liabilities', hsn: '190590' },
    {
      key: 'cgst2',
      name: 'CGST 2.5%',
      rate: 2.5,
      type: 'cgst',
      group: 'liabilities',
      hsn: '847130',
    },
    {
      key: 'sgst2',
      name: 'SGST 2.5%',
      rate: 2.5,
      type: 'sgst',
      group: 'liabilities',
      hsn: '847130',
    },
    {
      key: 'igst18',
      name: 'IGST 18%',
      rate: 18,
      type: 'igst',
      group: 'liabilities',
      hsn: '732690',
    },
  ]

  for (const blueprint of taxBlueprint) {
    const output = push(`Output ${blueprint.name}`, blueprint.group, 'tax', 0)
    const input = push(
      `Input ${blueprint.name}`,
      'assets',
      'tax',
      0,
    )
    taxCategories.push({
      id: ids.next('tax'),
      companyId: company.id,
      name: blueprint.name,
      rate: blueprint.rate,
      type: blueprint.type,
      hsn: blueprint.hsn,
      ledgerId: output.id,
      inputLedgerId: input.id,
      isActive: true,
    })
  }

  // Parties.
  for (const name of CUSTOMER_NAMES) {
    push(name, 'assets', 'receivable', 0, {
      partyKind: 'customer',
      isSystem: false,
      email: `${name.split(' ')[0]!.toLowerCase()}@customer.demo`,
      phone: `+91 9${Math.floor(Math.random() * 900000000 + 100000000)}`,
      address: `${name}, India`,
    })
  }
  for (const name of SUPPLIER_NAMES) {
    push(name, 'liabilities', 'payable', 0, {
      partyKind: 'supplier',
      isSystem: false,
      email: `${name.split(' ')[0]!.toLowerCase()}@supplier.demo`,
      phone: `+91 9${Math.floor(Math.random() * 900000000 + 100000000)}`,
      address: `${name}, India`,
    })
  }

  return { ledgers, taxCategories }
}

// ---------------------------------------------------------------------------
// Dataset assembly
// ---------------------------------------------------------------------------

export function createDemoDataset(): DemoDataset {
  const ids = new IdFactory()
  const random = mulberry32(20260401)

  const companies: Company[] = []
  const financialYears: FinancialYear[] = []
  const ledgers: Ledger[] = []
  const taxCategories: TaxCategory[] = []
  const items: Item[] = []
  const stockGroups: StockGroup[] = []
  const units: Unit[] = []
  const godowns: Godown[] = []
  const costCentres: CostCentre[] = []
  const employees: Employee[] = []
  const currencies: Currency[] = []
  const priceLists: PriceList[] = []
  const priceListEntries: PriceListEntry[] = []
  const paymentTerms: PaymentTerm[] = []
  const vouchers: Voucher[] = []
  const stockMovements: StockMovement[] = []
  const stockPools: StockPoolBalance[] = []
  const stockLocations: StockLocationBalance[] = []
  const inventoryAccounts: InventoryAccounts[] = []
  const statementLines: StatementLine[] = []
  const allocations: AllocationRecord[] = []
  const advances: AdvanceRecord[] = []
  const numbering: VoucherNumbering[] = []
  const auditEvents: AuditEvent[] = []
  const orders: Order[] = []
  const orderLines: OrderLine[] = []
  const orderFulfilments: OrderFulfilment[] = []
  const orderRevisions: OrderRevision[] = []
  const orderRevisionLines: OrderRevisionLine[] = []
  const boms: Bom[] = []
  const bomLines: BomLine[] = []
  const productionOrders: ProductionOrder[] = []
  const productionRequirements: ProductionRequirement[] = []
  const productionIssues: ProductionIssue[] = []
  const productionCompletions: ProductionCompletion[] = []

  for (const blueprint of COMPANY_BLUEPRINTS) {
    const company: Company = {
      id: blueprint.id,
      name: blueprint.name,
      legalName: blueprint.legalName,
      country: 'India',
      state: blueprint.state,
      baseCurrency: 'INR',
      fiscalYearStart: blueprint.fyStart,
      fiscalYearEnd: blueprint.fyEnd,
      gstin: blueprint.gstin,
      pan: blueprint.pan,
      address: blueprint.address,
      phone: blueprint.phone,
      email: blueprint.email,
      industry: blueprint.industry,
      isDemo: true,
      createdAt: '2025-04-01T09:00:00.000Z',
    }
    companies.push(company)

    financialYears.push(
      {
        id: ids.next('fy'),
        companyId: company.id,
        label: '2025-26',
        start: '2025-04-01',
        end: '2026-03-31',
        isClosed: true,
      },
      {
        id: ids.next('fy'),
        companyId: company.id,
        label: '2026-27',
        start: '2026-04-01',
        end: '2027-03-31',
        isClosed: false,
      },
    )

    // The opening stock and the reorder level of every item are drawn here,
    // before the ledgers are built, because the inventory asset account opens
    // at exactly the carrying value of the opening stock.
    const openingUnits: number[] = []
    const reorderUnits: number[] = []
    for (let index = 0; index < ITEM_BLUEPRINTS.length; index += 1) {
      openingUnits.push(Math.floor(random() * 120 * blueprint.scale + 20))
      reorderUnits.push(Math.floor(random() * 30 + 10))
    }

    const purchasePrices = ITEM_BLUEPRINTS.map((itemBlueprint) =>
      Math.round(itemBlueprint.cost * 100 * blueprint.scale),
    )

    // -- Opening stock -------------------------------------------------------
    // The opening stock is scaled so that the inventory asset account opens at
    // the share of the capital the balance sheet expects. Every item keeps
    // whole units, and its opening unit cost is its own purchase price, so the
    // costing engine starts from a cost the item master agrees with.
    const inventoryTarget = Math.round(DEMO_CAPITAL * blueprint.scale * 0.125)
    const naturalValues = ITEM_BLUEPRINTS.map((itemBlueprint, index) =>
      itemBlueprint.service ? 0 : openingUnits[index] * purchasePrices[index],
    )
    const naturalTotal = naturalValues.reduce((sum, value) => sum + value, 0)
    const openingUnitCounts = ITEM_BLUEPRINTS.map((itemBlueprint, index) => {
      if (itemBlueprint.service) return 0
      const share = divideRounded(
        BigInt(naturalValues[index]) * BigInt(inventoryTarget),
        BigInt(naturalTotal),
      )
      return Math.max(1, Math.round(share / purchasePrices[index]))
    })

    // The largest line takes up the rounding, so the opening stock adds up to
    // the figure the balance sheet expects.
    const largestIndex = openingUnitCounts.reduce(
      (best, units, index) =>
        units * purchasePrices[index] > openingUnitCounts[best] * purchasePrices[best]
          ? index
          : best,
      0,
    )
    const beforeAdjust = openingUnitCounts.reduce(
      (sum, units, index) => sum + units * purchasePrices[index],
      0,
    )
    const residual = inventoryTarget - beforeAdjust
    if (largestIndex >= 0 && purchasePrices[largestIndex] > 0) {
      openingUnitCounts[largestIndex] = Math.max(
        1,
        openingUnitCounts[largestIndex] +
          Math.round(residual / purchasePrices[largestIndex]),
      )
    }

    const openingQuantities: Quantity[] = openingUnitCounts.map(
      (units) => units * QUANTITY_SCALE,
    )
    const openingValues = ITEM_BLUEPRINTS.map((itemBlueprint, index) =>
      itemBlueprint.service ? 0 : lineValue(openingQuantities[index], purchasePrices[index]),
    )
    const inventoryOpeningValue = openingValues.reduce((sum, value) => sum + value, 0)

    const { ledgers: companyLedgers, taxCategories: companyTaxes } = buildLedgers(
      blueprint,
      ids,
      inventoryOpeningValue,
      inventoryTarget,
    )
    ledgers.push(...companyLedgers)
    taxCategories.push(...companyTaxes)

    const companyUnits: Unit[] = UNITS.map((unit) => ({
      id: ids.next('unt'),
      companyId: company.id,
      name: unit.name,
      decimalPlaces: unit.decimalPlaces,
    }))
    units.push(...companyUnits)

    const companyGroups: StockGroup[] = STOCK_GROUPS.map((name) => ({
      id: ids.next('sgr'),
      companyId: company.id,
      name,
      parentId: null,
    }))
    stockGroups.push(...companyGroups)

    const companyGodowns: Godown[] = GODOWNS.map((godown) => ({
      id: ids.next('gdw'),
      companyId: company.id,
      name: godown.name,
      location: godown.location,
    }))
    godowns.push(...companyGodowns)

    const companyCostCentres: CostCentre[] = [
      'Head Office',
      'Project Yard',
      'Service Depot',
      'Sales',
    ].map((name) => ({
      id: ids.next('ccn'),
      companyId: company.id,
      name,
      parentId: null,
      isActive: true,
    }))
    costCentres.push(...companyCostCentres)

    const companyEmployees: Employee[] = Array.from({ length: 9 }, (_, index) => ({
      id: ids.next('emp'),
      companyId: company.id,
      name: [
        'Ramesh Patel',
        'Sneha Iyer',
        'Imran Qureshi',
        'Divya Menon',
        'Harpreet Singh',
        'Anjali Deshpande',
        'Vikram Rathore',
        'Farhan Ali',
        'Meera Krishnan',
      ][index]!,
      code: `EMP-${String(index + 1).padStart(3, '0')}`,
      department: ['Accounts', 'Sales', 'Operations', 'Stores', 'Service'][index % 5]!,
      designation: ['Executive', 'Senior Executive', 'Manager', 'Assistant Manager'][index % 4]!,
      dateOfJoining: `20${18 + (index % 8)}-0${(index % 9) + 1}-1${index % 10}`,
      monthlyGross: (28_000 + index * 4_500) * 100 * blueprint.scale,
      isActive: index !== 7,
    }))
    employees.push(...companyEmployees)

    currencies.push(
      {
        id: ids.next('cur'),
        companyId: company.id,
        code: 'INR',
        name: 'Indian Rupee',
        rate: 1,
        symbol: '₹',
      },
      {
        id: ids.next('cur'),
        companyId: company.id,
        code: 'USD',
        name: 'United States Dollar',
        rate: 83.25,
        symbol: '$',
      },
      {
        id: ids.next('cur'),
        companyId: company.id,
        code: 'AED',
        name: 'UAE Dirham',
        rate: 22.68,
        symbol: 'AED ',
      },
    )

    const companyPriceLists: PriceList[] = [
      { id: ids.next('pl'), companyId: company.id, name: 'Retail Price List', isDefault: true },
      { id: ids.next('pl'), companyId: company.id, name: 'Dealer Price List', isDefault: false },
    ]
    priceLists.push(...companyPriceLists)

    const companyItems: Item[] = ITEM_BLUEPRINTS.map((itemBlueprint, index) => {
      const group = companyGroups.find((candidate) => candidate.name === itemBlueprint.group)!
      const unit = companyUnits.find((candidate) => candidate.name === itemBlueprint.unit)!
      const tax = companyTaxes.find((candidate) => candidate.name === itemBlueprint.tax)!
      return {
        id: ids.next('itm'),
        companyId: company.id,
        name: itemBlueprint.name,
        stockGroupId: group.id,
        unitId: unit.id,
        isInventory: !itemBlueprint.service,
        isService: Boolean(itemBlueprint.service),
        purchasePrice: purchasePrices[index],
        salesPrice: Math.round(itemBlueprint.sell * 100 * blueprint.scale),
        hsn: tax.hsn,
        taxCategoryId: tax.id,
        // Quantities are exact milli-units everywhere they are authoritative.
        openingQuantityMilli: openingQuantities[index],
        openingValue: openingValues[index],
        reorderLevelMilli: reorderUnits[index] * 1000,
        isActive: true,
        createdAt: '2025-04-02T09:00:00.000Z',
      }
    })
    items.push(...companyItems)

    for (const priceList of companyPriceLists) {
      for (const item of companyItems) {
        priceListEntries.push({
          priceListId: priceList.id,
          itemId: item.id,
          rate: priceList.isDefault ? item.salesPrice : Math.round(item.salesPrice * 0.92),
        })
      }
    }

    paymentTerms.push(
      { id: ids.next('pty'), companyId: company.id, name: 'Due on receipt', days: 0 },
      { id: ids.next('pty'), companyId: company.id, name: 'Net 15', days: 15 },
      { id: ids.next('pty'), companyId: company.id, name: 'Net 30', days: 30 },
      { id: ids.next('pty'), companyId: company.id, name: 'Net 45', days: 45 },
    )

    // -- Vouchers -----------------------------------------------------------
    const context: VoucherContext = {
      ledgers: companyLedgers,
      taxCategories: companyTaxes,
      nextId: () => ids.next('vch'),
      companyId: company.id,
    }

    const customers = companyLedgers.filter((ledger) => ledger.partyKind === 'customer')
    const suppliers = companyLedgers.filter((ledger) => ledger.partyKind === 'supplier')
    const cashLedger = companyLedgers.find((ledger) => ledger.type === 'cash')!
    // Money physically in the till. The generator never spends what is not
    // there, so the demo books never show a negative cash balance.
    let cashBalance = cashLedger.openingBalance
    const bankLedgers = companyLedgers.filter((ledger) => ledger.type === 'bank')
    // The cost of goods sold and the variance account are posted by the
    // inventory engine alone, so a journal never touches them.
    const expenseLedgers = companyLedgers.filter(
      (ledger) =>
        ledger.group === 'expenses' &&
        ledger.type === 'expenses' &&
        ledger.name !== 'Cost of Goods Sold' &&
        ledger.name !== 'Stock Adjustment / Variance',
    )
    const incomeLedgers = companyLedgers.filter((ledger) => ledger.group === 'income')

    const counters: Record<string, number> = {}
    const nextNumber = (type: VoucherType): string => {
      const prefix = VOUCHER_PREFIX[type]
      counters[prefix] = (counters[prefix] ?? 0) + 1
      return `${prefix}-${String(counters[prefix]).padStart(4, '0')}`
    }

    // -- Inventory ----------------------------------------------------------
    // The sample workspace is activated for inventory from the first day of the
    // books, so the sample stock is produced by the same costing engine the
    // live workspace uses.
    const inventoryLedger = companyLedgers.find((ledger) => ledger.name === 'Inventory')!
    const cogsLedger = companyLedgers.find((ledger) => ledger.name === 'Cost of Goods Sold')!
    const varianceLedger = companyLedgers.find(
      (ledger) => ledger.name === 'Stock Adjustment / Variance',
    )!
    const purchasesLedger = companyLedgers.find((ledger) => ledger.name === 'Purchases')!
    const productionLedger = companyLedgers.find((ledger) => ledger.name === 'Work in Progress')!
    const stockGodownId = companyGodowns[0]!.id
    const openedAt = `${OPENING_DATE}T09:00:00.000Z`
    // The movement history of this company. A sales return reverses the cost of
    // the original issue, so the planner has to know what the goods went out at.
    const companyMovements: StockMovement[] = []

    inventoryAccounts.push({
      id: ids.next('ina'),
      companyId: company.id,
      inventoryLedgerId: inventoryLedger.id,
      cogsLedgerId: cogsLedger.id,
      varianceLedgerId: varianceLedger.id,
      purchasesLedgerId: purchasesLedger.id,
      productionLedgerId: productionLedger.id,
      valuationMethod: VALUATION_METHOD,
      inputTaxRecoverable: true,
      activatedAt: OPENING_DATE,
      createdAt: openedAt,
    })

    // The opening stock is a transaction like any other: the movements below
    // point at a voucher, so that voucher exists.
    vouchers.push({
      id: `opening-${company.id}`,
      companyId: company.id,
      type: 'stock-journal',
      number: 'OPENING',
      date: OPENING_DATE,
      dueDate: null,
      paymentTermId: null,
      partyId: null,
      narration: `Opening stock from ${OPENING_DATE}`,
      reference: '',
      status: 'posted',
      entries: [],
      items: [],
      taxes: [],
      linkedVoucherId: null,
      reversedByVoucherId: null,
      isLocked: true,
      createdAt: openedAt,
      updatedAt: openedAt,
    })

    for (const item of companyItems) {
      if (!item.isInventory) continue
      const quantity = item.openingQuantityMilli
      const value = item.openingValue
      stockPools.push({
        companyId: company.id,
        itemId: item.id,
        quantityMilli: quantity,
        carryingValue: value,
        revision: 1,
        updatedAt: openedAt,
      })
      stockLocations.push({
        companyId: company.id,
        itemId: item.id,
        godownId: stockGodownId,
        quantityMilli: quantity,
        revision: 1,
        updatedAt: openedAt,
      })
      companyMovements.push({
        id: ids.next('stm'),
        companyId: company.id,
        voucherId: `opening-${company.id}`,
        voucherItemId: null,
        voucherNumber: 'OPENING',
        date: OPENING_DATE,
        itemId: item.id,
        godownId: stockGodownId,
        movementType: 'opening',
        direction: 'in',
        quantityMilli: quantity,
        rate: averageCost(value, quantity),
        value,
        cost: 0,
        valuationMethod: VALUATION_METHOD,
        resultingQuantityMilli: quantity,
        resultingCarryingValue: value,
        reversesMovementId: null,
        createdAt: openedAt,
      })
    }
    stockMovements.push(...companyMovements)

    const inventoryContext: InventoryContext = {
      companyId: company.id,
      accounts: {
        inventory: inventoryLedger,
        cogs: cogsLedger,
        variance: varianceLedger,
        purchases: purchasesLedger,
        inputTaxRecoverable: true,
      },
      items: new Map(companyItems.map((item) => [item.id, item])),
      pools: new Map<string, StockPool>(
        stockPools
          .filter((pool) => pool.companyId === company.id)
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
        stockLocations
          .filter((location) => location.companyId === company.id)
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
      idFactory: () => ids.next('mov'),
      now: () => new Date().toISOString(),
      movements: companyMovements,
    }

    /**
     * Apply the inventory plan of one voucher: the movements it causes, the
     * balances they imply and the extra accounting entries.
     */
    const planVoucher = (voucher: Voucher): Voucher => {
      const plan = planInventoryPosting(voucher, inventoryContext)
      for (const movement of plan.movements) {
        const record: StockMovement = {
          ...movement,
          // The domain names more movement types than the stored record does.
          // The types a posting produces are the same in both.
          movementType: movement.movementType as StockMovement['movementType'],
          voucherNumber: voucher.number,
        }
        companyMovements.push(record)
        stockMovements.push(record)
      }
      for (const pool of plan.pools.values()) {
        const index = stockPools.findIndex(
          (candidate) => candidate.companyId === company.id && candidate.itemId === pool.itemId,
        )
        const record: StockPoolBalance = {
          companyId: company.id,
          itemId: pool.itemId,
          quantityMilli: pool.quantityMilli,
          carryingValue: pool.carryingValue,
          revision: pool.revision,
          updatedAt: new Date().toISOString(),
        }
        if (index >= 0) stockPools[index] = record
        else stockPools.push(record)
      }
      for (const location of plan.locations.values()) {
        const index = stockLocations.findIndex(
          (candidate) =>
            candidate.companyId === company.id &&
            candidate.itemId === location.itemId &&
            candidate.godownId === location.godownId,
        )
        const record: StockLocationBalance = {
          companyId: company.id,
          itemId: location.itemId,
          godownId: location.godownId,
          quantityMilli: location.quantityMilli,
          revision: location.revision,
          updatedAt: new Date().toISOString(),
        }
        if (index >= 0) stockLocations[index] = record
        else stockLocations.push(record)
      }
      inventoryContext.pools = plan.pools
      inventoryContext.locations = plan.locations
      return plan.voucher
    }

    /** What a customer owes on a voucher: the debit posted against its ledger. */
    const receivableOf = (voucher: Voucher): number => {
      if (!voucher.partyId) return 0
      return voucher.entries
        .filter((entry) => entry.ledgerId === voucher.partyId)
        .reduce((sum, entry) => sum + entry.debit, 0)
    }

    /** What a supplier is owed on a voucher: the credit posted against its ledger. */
    const payableOf = (voucher: Voucher): number => {
      if (!voucher.partyId) return 0
      return voucher.entries
        .filter((entry) => entry.ledgerId === voucher.partyId)
        .reduce((sum, entry) => sum + entry.credit, 0)
    }

    /** What a voucher moves on a party's ledger, whichever way it moves. */
    const partyMovementOf = (voucher: Voucher): number => {
      if (!voucher.partyId) return 0
      return voucher.entries
        .filter((entry) => entry.ledgerId === voucher.partyId)
        .reduce((sum, entry) => sum + entry.debit - entry.credit, 0)
    }

    // What each party still owes, or is still owed. Money only ever settles a
    // real invoice or a real bill, so the sample books carry no advance that
    // the party ledgers do not show.
    const partyBalance = new Map<string, number>()

    const periods = [
      { start: '2025-04-01', end: '2026-03-31' },
      { start: '2026-04-01', end: DEMO_TODAY },
    ]

    for (const period of periods) {
      for (const month of monthsBetween(period.start, period.end)) {
        const isCurrentMonth = month === DEMO_TODAY.slice(0, 7)
        const lastDay = isCurrentMonth ? Number(DEMO_TODAY.slice(8, 10)) : 28

        const salesCount = Math.round((5 + random() * 6) * (blueprint.scale > 2 ? 1.5 : 1))
        const purchaseCount = Math.round((3 + random() * 4) * (blueprint.scale > 2 ? 1.4 : 1))

        // Stock-affecting vouchers are planned first and then written in date
        // order, because the weighted-average cost depends on the sequence.
        type StockPlan = {
          kind: 'sale' | 'purchase'
          date: string
          party: Ledger
          narration: string
          reference: string
          lines: Array<{ item: Item; quantityMilli: Quantity; discounted: boolean }>
        }

        const stockPlans: StockPlan[] = []

        for (let index = 0; index < salesCount; index += 1) {
          const customer = customers[Math.floor(random() * customers.length)]!
          const lineCount = 1 + Math.floor(random() * 3)
          const lines = Array.from({ length: lineCount }, () => {
            const item = companyItems[Math.floor(random() * companyItems.length)]!
            const units = item.isInventory
              ? 1 + Math.floor(random() * 12)
              : 1 + Math.floor(random() * 6)
            return {
              item,
              quantityMilli: units * 1000,
              discounted: random() > 0.75,
            }
          })

          const day = Math.min(lastDay, 1 + Math.floor(random() * lastDay))
          stockPlans.push({
            kind: 'sale',
            date: dayInMonth(month, day),
            party: customer,
            narration: `Sale to ${customer.name}`,
            reference: `SO-${String(1000 + Math.floor(random() * 8999))}`,
            lines,
          })
        }

        for (let index = 0; index < purchaseCount; index += 1) {
          const supplier = suppliers[Math.floor(random() * suppliers.length)]!
          const lineCount = 1 + Math.floor(random() * 2)
          const lines = Array.from({ length: lineCount }, () => {
            const item = companyItems[Math.floor(random() * companyItems.length)]!
            const units = item.isInventory ? 2 + Math.floor(random() * 30) : 1
            return { item, quantityMilli: units * 1000, discounted: false }
          })

          const day = Math.min(lastDay, 1 + Math.floor(random() * lastDay))
          stockPlans.push({
            kind: 'purchase',
            date: dayInMonth(month, day),
            party: supplier,
            narration: `Purchase from ${supplier.name}`,
            reference: `PO-${String(2000 + Math.floor(random() * 7999))}`,
            lines,
          })
        }

        // A receipt that arrives on the same day is written before the sale that
        // takes the stock, so the cost is never taken from stock that is not
        // there yet.
        stockPlans.sort((left, right) => {
          if (left.date !== right.date) return left.date < right.date ? -1 : 1
          if (left.kind !== right.kind) return left.kind === 'purchase' ? -1 : 1
          return 0
        })

        for (const plan of stockPlans) {
          const itemInputs: ItemLineInput[] = []
          // Two lines of one voucher may carry the same item, so the stock they
          // take is counted as the voucher is built.
          const taken = new Map<string, Quantity>()
          for (const line of plan.lines) {
            const rate = plan.kind === 'sale' ? line.item.salesPrice : line.item.purchasePrice
            let quantityMilli = line.quantityMilli
            if (line.item.isInventory && plan.kind === 'sale') {
              // A sale never issues more than the stock that is on hand.
              const held = inventoryContext.pools.get(line.item.id)?.quantityMilli ?? 0
              const used = taken.get(line.item.id) ?? 0
              quantityMilli = Math.min(quantityMilli, Math.max(0, held - used))
              if (quantityMilli <= 0) continue
              taken.set(line.item.id, used + quantityMilli)
            }
            itemInputs.push({
              itemId: line.item.id,
              quantityMilli,
              rate,
              discount: line.discounted ? Math.round(lineValue(quantityMilli, rate) * 0.05) : 0,
              taxCategoryId: line.item.taxCategoryId,
              godownId: stockGodownId,
            })
          }
          if (!itemInputs.length) continue

          const voucher = buildVoucher(
            {
              type: plan.kind === 'sale' ? 'sales' : 'purchase',
              date: plan.date,
              partyId: plan.party.id,
              narration: plan.narration,
              reference: plan.reference,
              status: 'posted',
              items: itemInputs,
            },
            context,
          )
          voucher.number = nextNumber(plan.kind === 'sale' ? 'sales' : 'purchase')
          const planned = planVoucher(voucher)
          vouchers.push(planned)
          // The party ledger carries the same figure the allocation uses.
          partyBalance.set(
            plan.party.id,
            (partyBalance.get(plan.party.id) ?? 0) +
              (plan.kind === 'sale' ? receivableOf(planned) : payableOf(planned)),
          )
        }

        const monthSales = vouchers.filter(
          (voucher) =>
            voucher.companyId === company.id &&
            voucher.type === 'sales' &&
            voucher.date.startsWith(month),
        )
        const receiptCount = Math.round(3 + random() * 4)
        for (let index = 0; index < receiptCount; index += 1) {
          // A receipt settles a real invoice, so it is only written against a
          // customer who still owes something.
          const openSales = monthSales.filter(
            (voucher) => (partyBalance.get(voucher.partyId ?? '') ?? 0) > 0,
          )
          const source = openSales[Math.floor(random() * openSales.length)]
          if (!source) continue
          const customer = ledgers.find((ledger) => ledger.id === source.partyId)!
          const outstanding = partyBalance.get(customer.id) ?? 0
          const invoiceValue = receivableOf(source)
          const amount = Math.min(
            outstanding,
            Math.round(invoiceValue * (0.25 + random() * 0.75)),
          )
          if (amount <= 0) continue
          partyBalance.set(customer.id, outstanding - amount)
          const toBank = random() > 0.35
          if (!toBank) cashBalance += amount
          const voucher = buildVoucher(
            {
              type: 'receipt',
              date: dayInMonth(month, 1 + Math.floor(random() * lastDay)),
              partyId: customer.id,
              narration: `Payment received from ${customer.name}`,
              reference: `RCPT-${String(Math.floor(random() * 90000) + 10000)}`,
              status: 'posted',
              items: [],
              entries: [
                {
                  ledgerId: toBank ? bankLedgers[Math.floor(random() * bankLedgers.length)]!.id : cashLedger.id,
                  debit: amount,
                },
                { ledgerId: customer.id, credit: amount },
              ],
            },
            context,
          )
          voucher.number = nextNumber('receipt')
          vouchers.push(voucher)
        }

        const monthPurchases = vouchers.filter(
          (voucher) =>
            voucher.companyId === company.id &&
            voucher.type === 'purchase' &&
            voucher.date.startsWith(month),
        )
        const paymentCount = Math.round(2 + random() * 4)
        for (let index = 0; index < paymentCount; index += 1) {
          // A payment settles a real bill, so it is only written against a
          // supplier who is still owed something.
          const openPurchases = monthPurchases.filter(
            (voucher) => (partyBalance.get(voucher.partyId ?? '') ?? 0) > 0,
          )
          const source = openPurchases[Math.floor(random() * openPurchases.length)]
          if (!source) continue
          const supplier = ledgers.find((ledger) => ledger.id === source.partyId)!
          const outstanding = partyBalance.get(supplier.id) ?? 0
          const billValue = payableOf(source)
          const amount = Math.min(
            outstanding,
            Math.round(billValue * (0.25 + random() * 0.75)),
          )
          if (amount <= 0) continue
          partyBalance.set(supplier.id, outstanding - amount)
          const fromCash = random() > 0.25 && cashBalance >= amount
          if (fromCash) cashBalance -= amount
          const voucher = buildVoucher(
            {
              type: 'payment',
              date: dayInMonth(month, 1 + Math.floor(random() * lastDay)),
              partyId: supplier?.id ?? null,
              narration: `Payment to ${supplier?.name ?? 'a supplier'}`,
              reference: `CHQ-${String(Math.floor(random() * 900000) + 100000)}`,
              status: 'posted',
              items: [],
              entries: [
                { ledgerId: supplier?.id ?? '', debit: amount },
                {
                  ledgerId: fromCash ? cashLedger.id : bankLedgers[0]!.id,
                  credit: amount,
                },
              ],
            },
            context,
          )
          voucher.number = nextNumber('payment')
          vouchers.push(voucher)
        }

        const contraCount = 2 + Math.floor(random() * 3)
        for (let index = 0; index < contraCount; index += 1) {
          const amount = Math.round((10_000 + random() * 60_000) * 100 * blueprint.scale)
          if (cashBalance < amount) continue
          cashBalance -= amount
          const voucher = buildVoucher(
            {
              type: 'contra',
              date: dayInMonth(month, 1 + Math.floor(random() * lastDay)),
              partyId: null,
              narration: 'Cash deposited into bank',
              reference: '',
              status: 'posted',
              items: [],
              entries: [
                { ledgerId: bankLedgers[0]!.id, debit: amount },
                { ledgerId: cashLedger.id, credit: amount },
              ],
            },
            context,
          )
          voucher.number = nextNumber('contra')
          vouchers.push(voucher)
        }

        const journalCount = 2 + Math.floor(random() * 3)
        for (let index = 0; index < journalCount; index += 1) {
          const debitLedger = expenseLedgers[Math.floor(random() * expenseLedgers.length)]!
          const creditLedger = incomeLedgers[Math.floor(random() * incomeLedgers.length)]!
          const amount = Math.round((1_500 + random() * 22_000) * 100 * blueprint.scale)
          const voucher = buildVoucher(
            {
              type: 'journal',
              date: dayInMonth(month, 1 + Math.floor(random() * lastDay)),
              partyId: null,
              narration: `${debitLedger.name} adjustment`,
              reference: '',
              status: 'posted',
              items: [],
              entries: [
                { ledgerId: debitLedger.id, debit: amount },
                { ledgerId: creditLedger.id, credit: amount },
              ],
            },
            context,
          )
          voucher.number = nextNumber('journal')
          vouchers.push(voucher)
        }

        if (random() > 0.75) {
          const customer = customers[Math.floor(random() * customers.length)]!
          // A return reverses stock that was actually sold, so it is written
          // against an issue that has not been returned yet.
          const reversed = new Set(
            companyMovements
              .filter((movement) => movement.reversesMovementId)
              .map((movement) => movement.reversesMovementId!),
          )
          const issues = companyMovements.filter(
            (movement) =>
              movement.movementType === 'issue' && !reversed.has(movement.id),
          )
          const issue = issues[issues.length - 1]
          if (!issue) continue
          const item = companyItems.find((candidate) => candidate.id === issue.itemId)!
          const quantityMilli = Math.min(1000, issue.quantityMilli)
          // A return never settles more than the customer owes.
          const outstanding = partyBalance.get(customer.id) ?? 0
          if (quantityMilli <= 0 || outstanding < lineValue(quantityMilli, item.salesPrice)) {
            continue
          }
          const voucher = buildVoucher(
            {
              type: 'credit-note',
              date: dayInMonth(month, lastDay),
              partyId: customer.id,
              narration: `Return against sales to ${customer.name}`,
              reference: '',
              status: 'posted',
              items: [
                {
                  itemId: item.id,
                  quantityMilli,
                  rate: item.salesPrice,
                  taxCategoryId: item.taxCategoryId,
                  godownId: stockGodownId,
                },
              ],
            },
            context,
          )
          voucher.number = nextNumber('credit-note')
          // The return belongs to the sale it reverses.
          voucher.linkedVoucherId = issue.voucherId
          const planned = planVoucher(voucher)
          vouchers.push(planned)
          partyBalance.set(customer.id, outstanding + partyMovementOf(planned))
        }

        if (random() > 0.8) {
          const customer = customers[Math.floor(random() * customers.length)]!
          const item = companyItems[Math.floor(random() * companyItems.length)]!
          const quantity = 2 + Math.floor(random() * 20)
          const voucher = buildVoucher(
            {
              type: 'sales-order',
              date: dayInMonth(month, 1 + Math.floor(random() * lastDay)),
              partyId: customer.id,
              narration: `Order from ${customer.name}`,
              reference: '',
              status: 'posted',
              items: [
                {
                  itemId: item.id,
                  quantityMilli: quantity * 1000,
                  rate: item.salesPrice,
                  taxCategoryId: item.taxCategoryId,
                  godownId: stockGodownId,
                },
              ],
            },
            context,
          )
          voucher.number = nextNumber('sales-order')
          // An order is not a posted transaction, so it moves no stock.
          vouchers.push(voucher)
        }
      }
    }

    // -- Bank statement lines ------------------------------------------------
    // Matched lines come from real vouchers; unmatched lines are bank activity
    // with no voucher yet, which is what a reconciliation screen must surface.
    const unmatchedDescriptions = [
      'IMPS credit from unknown party',
      'NEFT credit transfer',
      'Bank charges debit',
      'Interest credit',
      'Cash deposit counter',
      'Standing instruction debit',
      'Card swipe settlement',
    ]

    for (const bankLedger of bankLedgers) {
      const touching = vouchers.filter((voucher) =>
        voucher.entries.some((entry) => entry.ledgerId === bankLedger.id),
      )

      touching.forEach((voucher, index) => {
        const entry = voucher.entries.find((candidate) => candidate.ledgerId === bankLedger.id)
        if (!entry) return
        const magnitude = entry.debit > 0 ? entry.debit : entry.credit
        const signed = entry.debit > 0 ? -magnitude : magnitude
        const roll = random()

        if (roll < 0.72) {
          statementLines.push({
            id: ids.next('stl'),
            companyId: company.id,
            ledgerId: bankLedger.id,
            date: voucher.date,
            description: voucher.narration,
            reference: voucher.reference || `UTR${String(100000 + index * 37).slice(0, 6)}`,
            amount: signed,
            matchedVoucherId: voucher.id,
            confidence: 1,
            matchReason: `Amount and date agree with ${voucher.number}.`,
            isReconciled: true,
          })
        } else if (roll < 0.9) {
          const shift = 1 + Math.floor(random() * 2)
          const shifted = new Date(`${voucher.date}T00:00:00`)
          shifted.setDate(shifted.getDate() + shift)
          statementLines.push({
            id: ids.next('stl'),
            companyId: company.id,
            ledgerId: bankLedger.id,
            date: shifted.toISOString().slice(0, 10),
            description: voucher.narration,
            reference: voucher.reference || `UTR${String(200000 + index * 41).slice(0, 6)}`,
            amount: signed,
            matchedVoucherId: voucher.id,
            confidence: 0.82,
            matchReason: `Amount matches ${voucher.number}; the bank value date is ${shift} day${shift === 1 ? '' : 's'} later.`,
            isReconciled: false,
          })
        }
      })

      const extra = 6 + Math.floor(random() * 5)
      for (let index = 0; index < extra; index += 1) {
        const outward = random() > 0.45
        const magnitude = Math.round((1_500 + random() * 42_000) * 100 * blueprint.scale)
        statementLines.push({
          id: ids.next('stl'),
          companyId: company.id,
          ledgerId: bankLedger.id,
          date: dayInMonth('2026-09', 1 + Math.floor(random() * 27)),
          description: unmatchedDescriptions[Math.floor(random() * unmatchedDescriptions.length)]!,
          reference: `STMT${String(500000 + Math.floor(random() * 400000))}`,
          amount: outward ? -magnitude : magnitude,
          matchedVoucherId: null,
          confidence: 0,
          matchReason: 'No voucher of this amount is recorded for this date.',
          isReconciled: false,
        })
      }
    }

    // A handful of drafts so the interface shows mixed states.
    const draftCount = 3
    for (let index = 0; index < draftCount; index += 1) {
      const customer = customers[Math.floor(random() * customers.length)]!
      const item = companyItems[Math.floor(random() * companyItems.length)]!
      const voucher = buildVoucher(
        {
          type: 'sales',
          date: DEMO_TODAY,
          partyId: customer.id,
          narration: 'Draft awaiting despatch confirmation',
          reference: '',
          status: 'draft',
          items: [
            {
              itemId: item.id,
              quantityMilli: 3000,
              rate: item.salesPrice,
              taxCategoryId: item.taxCategoryId,
              godownId: stockGodownId,
            },
          ],
        },
        context,
      )
      voucher.number = nextNumber('sales')
      // A draft allocates nothing and moves no stock.
      vouchers.push(voucher)
    }

    // -- Orders, structures and production ----------------------------------
    // The sample orders are built from the invoices the engine produced, so the
    // deliveries they point at are real and every derived state is the truth.
    const orderContext: OrderContext = {
      companyId: company.id,
      items: new Map(companyItems.map((item) => [item.id, item])),
      idFactory: () => ids.next('ord'),
      now: () => new Date().toISOString(),
    }
    const orderCounters: Record<string, number> = {}
    const nextOrderNumber = (kind: OrderKind): string => {
      const prefix = kind === 'sales' ? 'SO' : 'PO'
      orderCounters[prefix] = (orderCounters[prefix] ?? 0) + 1
      return `${prefix}-${String(orderCounters[prefix]).padStart(4, '0')}`
    }

    const companyPosted = vouchers.filter(
      (voucher) => voucher.companyId === company.id && voucher.status === 'posted',
    )
    const salesInvoices = companyPosted.filter(
      (voucher) => voucher.type === 'sales' && voucher.items.length > 0,
    )
    const purchaseBills = companyPosted.filter(
      (voucher) => voucher.type === 'purchase' && voucher.items.length > 0,
    )

    /** An order built from a posted voucher, with the deliveries behind it. */
    const orderFromVoucher = (
      kind: OrderKind,
      voucher: Voucher,
      options: { shortByMilli?: number } = {},
    ) => {
      const inputs: OrderLineInput[] = voucher.items.map((line, index) => ({
        itemId: line.itemId,
        quantityMilli:
          index === 0 && options.shortByMilli
            ? line.quantityMilli + options.shortByMilli
            : line.quantityMilli,
        rate: line.rate,
        discount: line.discount,
        taxCategoryId: line.taxCategoryId,
      }))
      const built = buildOrder(
        {
          kind,
          partyId: voucher.partyId ?? '',
          date: voucher.date,
          expectedDate: addDays(voucher.date, kind === 'sales' ? 21 : 14),
          narration: `Order raised from ${voucher.number}`,
          reference: voucher.reference,
          lines: inputs,
        },
        orderContext,
      )
      const order = confirmOrder(built.order, new Date().toISOString())
      order.number = nextOrderNumber(kind)
      const fulfilments: OrderFulfilment[] = voucher.items.map((line, index) => ({
        id: ids.next('ofl'),
        companyId: company.id,
        orderId: order.id,
        orderLineId: built.lines[index]!.id,
        voucherId: voucher.id,
        voucherItemId: line.id,
        quantityMilli: line.quantityMilli,
        amount: line.amount,
        createdAt: voucher.updatedAt,
      }))
      return { order, lines: built.lines, fulfilments }
    }

    /** An order that has not been delivered against yet. */
    const openOrder = (kind: OrderKind, partyId: string, quantityMilli: number) => {
      const item = companyItems.find((candidate) => candidate.isInventory)!
      const built = buildOrder(
        {
          kind,
          partyId,
          date: DEMO_TODAY,
          expectedDate: addDays(DEMO_TODAY, kind === 'sales' ? 21 : 14),
          narration: kind === 'sales' ? 'Order awaiting despatch' : 'Order placed with the supplier',
          reference: '',
          lines: [
            {
              itemId: item.id,
              quantityMilli,
              rate: kind === 'sales' ? item.salesPrice : item.purchasePrice,
              taxCategoryId: item.taxCategoryId,
            },
          ],
        },
        orderContext,
      )
      const order = confirmOrder(built.order, new Date().toISOString())
      order.number = nextOrderNumber(kind)
      return { order, lines: built.lines, fulfilments: [] as OrderFulfilment[] }
    }

    const customerIds = customers.map((ledger) => ledger.id)
    const supplierIds = suppliers.map((ledger) => ledger.id)

    // Three sales orders: one fully delivered, one partly delivered and one
    // still open.
    const fulfilledSale = salesInvoices.at(-1)
    const partlyFulfilledSale = salesInvoices.at(-2)
    if (fulfilledSale) {
      const built = orderFromVoucher('sales', fulfilledSale)
      orders.push(built.order)
      orderLines.push(...built.lines)
      orderFulfilments.push(...built.fulfilments)
    }
    if (partlyFulfilledSale) {
      const built = orderFromVoucher('sales', partlyFulfilledSale, { shortByMilli: 2500 })
      orders.push(built.order)
      orderLines.push(...built.lines)
      orderFulfilments.push(...built.fulfilments)
    }
    const openSale = openOrder('sales', customerIds[0]!, 4000)
    orders.push(openSale.order)
    orderLines.push(...openSale.lines)

    // A draft order, so the register shows a state that is not yet committed.
    const draftSale = buildOrder(
      {
        kind: 'sales',
        partyId: customerIds[1] ?? customerIds[0]!,
        date: DEMO_TODAY,
        expectedDate: addDays(DEMO_TODAY, 28),
        narration: 'Draft order awaiting the customer confirmation',
        reference: '',
        lines: [
          {
            itemId: companyItems.find((candidate) => candidate.isInventory)!.id,
            quantityMilli: 2500,
            rate: companyItems.find((candidate) => candidate.isInventory)!.salesPrice,
            taxCategoryId: companyItems.find((candidate) => candidate.isInventory)!.taxCategoryId,
          },
        ],
      },
      orderContext,
    )
    draftSale.order.number = nextOrderNumber('sales')
    orders.push(draftSale.order)
    orderLines.push(...draftSale.lines)

    // Two purchase orders, one delivered against a real bill and one open.
    const fulfilledPurchase = purchaseBills.at(-1)
    if (fulfilledPurchase) {
      const built = orderFromVoucher('purchase', fulfilledPurchase)
      orders.push(built.order)
      orderLines.push(...built.lines)
      orderFulfilments.push(...built.fulfilments)
    }
    const openPurchase = openOrder('purchase', supplierIds[0]!, 6000)
    orders.push(openPurchase.order)
    orderLines.push(...openPurchase.lines)

    // -- A structure and a production order ---------------------------------
    // The structure names real components and the production order is issued
    // and completed through the production engine, so the work in progress
    // account nets to zero and the finished goods are in stock.
    const finishedItem = companyItems.find((item) => item.name === 'SS 304 Hex Bolt M8 x 40mm')
    if (finishedItem) {
      // The components are the raw materials the bolts are made from. The ones
      // the sample books still hold are the ones used, so the materials can
      // actually be issued.
      const candidates = [
        { name: 'MS Flat Bar 25mm x 6mm', label: 'MS flat bar', quantityMilli: 200 },
        { name: 'Cutting Oil 1 litre', label: 'cutting fluid', quantityMilli: 20 },
      ]
      const stocked = (name: string): Item | undefined => {
        const item = companyItems.find((candidate) => candidate.name === name)
        if (!item) return undefined
        return (inventoryContext.pools.get(item.id)?.quantityMilli ?? 0) > 0 ? item : undefined
      }
      const components: Array<{ item: Item; label: string; quantityMilli: number }> = []
      for (const candidate of candidates) {
        const item = stocked(candidate.name)
        if (item) components.push({ item, label: candidate.label, quantityMilli: candidate.quantityMilli })
      }
      if (components.length < 2) {
        for (const item of companyItems) {
          if (components.length >= 2) break
          if (!item.isInventory || item.id === finishedItem.id) continue
          if (components.some((component) => component.item.id === item.id)) continue
          if ((inventoryContext.pools.get(item.id)?.quantityMilli ?? 0) <= 0) continue
          components.push({ item, label: item.name, quantityMilli: 20 })
        }
      }

      const bomContext: BomContext = {
        companyId: company.id,
        items: new Map(companyItems.map((item) => [item.id, item])),
        releasedBoms: [],
        idFactory: () => ids.next('bom'),
        now: () => new Date().toISOString(),
      }
      if (components.length > 0) {
        const builtBom = buildBom(
          {
            itemId: finishedItem.id,
            outputQuantityMilli: 1000,
            effectiveFrom: '2026-04-01',
            narration: `Hex bolt M8 x 40mm made from ${components
              .map((component) => component.label)
              .join(' and ')}`,
            lines: components.map((component) => ({
              itemId: component.item.id,
              quantityMilli: component.quantityMilli,
              conversionMilli: 1000,
            })),
          },
          bomContext,
        )
        const bom: Bom = {
          ...builtBom.bom,
          version: 1,
          status: 'released',
        }
        boms.push(bom)
        bomLines.push(...builtBom.lines)

        const productionContext: ProductionOrderContext = {
          companyId: company.id,
          items: new Map(companyItems.map((item) => [item.id, item])),
          idFactory: () => ids.next('prd'),
          now: () => new Date().toISOString(),
        }
        // The batch is a quarter of what the stock on hand allows, so the
        // materials can actually be issued and some are left on the shelf.
        const plannedBolts = components.reduce((smallest, component) => {
          const pool = inventoryContext.pools.get(component.item.id)?.quantityMilli ?? 0
          let best = 0
          for (let candidate = 1; candidate <= 50; candidate += 1) {
            const needed = requiredQuantityMilli(
              component.quantityMilli,
              1000,
              candidate * 1000,
              1000,
            )
            if (needed * 4 > pool) break
            best = candidate
          }
          return Math.min(smallest, best)
        }, 50)
        if (plannedBolts > 0) {
        const builtOrder = buildProductionOrder(
          {
            itemId: finishedItem.id,
            bomId: bom.id,
            plannedQuantityMilli: plannedBolts * 1000,
            godownId: stockGodownId,
            plannedAt: '2026-10-14',
            narration: 'Batch of hex bolts from the flat bar rack',
          },
          productionContext,
        )
        const productionOrder: ProductionOrder = {
          ...builtOrder,
          number: 'PRD-0001',
          status: 'released',
          bomVersion: bom.version,
        }
        const requirements = buildProductionRequirements(
          productionOrder,
          bom,
          builtBom.lines,
          productionContext,
        )
        productionOrders.push(productionOrder)

        const productionPosting: ProductionPostingContext = {
          companyId: company.id,
          items: new Map(companyItems.map((item) => [item.id, item])),
          inventory: inventoryContext,
          productionLedgerId: productionLedger.id,
          idFactory: () => ids.next('mov'),
          now: () => new Date().toISOString(),
          today: '2026-10-19',
        }
        const issuePlan = planProductionIssue(
          productionOrder,
          requirements,
          requirements.map((requirement) => ({
            requirementId: requirement.id,
            itemId: requirement.itemId,
            godownId: stockGodownId,
            quantityMilli: requirement.requiredQuantityMilli,
          })),
          productionPosting,
        )
        const issueVoucher: Voucher = {
          ...issuePlan.voucher,
          number: nextNumber('stock-journal'),
        }
        vouchers.push(issueVoucher)
        const issueMovements: StockMovement[] = issuePlan.movements.map((movement) => ({
          ...movement,
          movementType: movement.movementType as StockMovement['movementType'],
          voucherNumber: issueVoucher.number,
        }))
        companyMovements.push(...issueMovements)
        stockMovements.push(...issueMovements)
        productionIssues.push(...issuePlan.issues)

        // The issue is applied to the books before the completion is planned,
        // because the finished goods are valued against the pools and the
        // locations the issue leaves behind.
        inventoryContext.pools = issuePlan.pools
        inventoryContext.locations = projectLocations(inventoryContext, companyMovements)

        const issuedRequirements = requirements.map((requirement) => ({
          ...requirement,
          issuedQuantityMilli: requirement.requiredQuantityMilli,
        }))
        productionRequirements.push(...issuedRequirements)
        const completionPlan = planProductionCompletion(
          productionOrder,
          issuedRequirements,
          issuePlan.issues,
          { ...productionPosting, today: '2026-10-20' },
        )
        const completionVoucher: Voucher = {
          ...completionPlan.voucher,
          number: nextNumber('stock-journal'),
        }
        vouchers.push(completionVoucher)
        const completionMovements: StockMovement[] = completionPlan.movements.map((movement) => ({
          ...movement,
          movementType: movement.movementType as StockMovement['movementType'],
          voucherNumber: completionVoucher.number,
        }))
        companyMovements.push(...completionMovements)
        stockMovements.push(...completionMovements)
        productionCompletions.push(...completionPlan.completions)

        // The pools and the locations are the projection of the movement ledger.
        const now = new Date().toISOString()
        for (const pool of completionPlan.pools.values()) {
          const record = {
            companyId: company.id,
            itemId: pool.itemId,
            quantityMilli: pool.quantityMilli,
            carryingValue: pool.carryingValue,
            revision: pool.revision,
            updatedAt: now,
          }
          const index = stockPools.findIndex(
            (candidate) => candidate.companyId === company.id && candidate.itemId === pool.itemId,
          )
          if (index >= 0) stockPools[index] = record
          else stockPools.push(record)
        }
        inventoryContext.pools = completionPlan.pools
        inventoryContext.locations = projectLocations(inventoryContext, companyMovements)
        for (const location of stockLocations) {
          if (location.companyId !== company.id) continue
          const balance = inventoryContext.locations.get(
            locationKey(location.itemId, location.godownId),
          )
          if (!balance) continue
          location.quantityMilli = balance.quantityMilli
          location.revision += 1
          location.updatedAt = now
        }
        }
      }
    }

    // -- Bill-wise allocation ------------------------------------------------
    // The allocation is produced by the same engine the live workspace uses, so
    // the sample outstanding balances are real rather than assumed.
    const tradePartyIds = new Set(
      companyLedgers
        .filter((ledger) => ledger.partyKind === 'customer' || ledger.partyKind === 'supplier')
        .map((ledger) => ledger.id),
    )
    const companyVouchers = vouchers.filter((voucher) => voucher.companyId === company.id)
    const allocationLedger = buildAllocationLedger(companyVouchers, {
      idFactory: () => ids.next('alc'),
      now: () => new Date().toISOString(),
      tradePartyIds,
    })
    allocations.push(...allocationLedger.allocations)
    advances.push(...allocationLedger.advances)

    // Audit trail for the most recent activity of this company.
    const recent = companyVouchers
      .filter((voucher) => voucher.status === 'posted')
      .sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1))
      .slice(0, 20)
    recent.forEach((voucher, index) => {
      auditEvents.push({
        id: ids.next('aud'),
        companyId: voucher.companyId,
        actor: index % 3 === 0 ? 'rupam.admin' : index % 3 === 1 ? 'accounts.desk' : 'data.import',
        action: 'voucher.posted',
        recordType: 'voucher',
        recordId: voucher.id,
        recordLabel: `${voucher.number} — ${voucher.narration}`,
        timestamp: voucher.updatedAt,
        detail: `Posted ${voucher.type} voucher dated ${voucher.date}`,
      })
    })
  }

  // Audit trail for the most recent activity.
  return {
    companies,
    financialYears,
    ledgers,
    items,
    stockGroups,
    units,
    godowns,
    taxCategories,
    costCentres,
    employees,
    currencies,
    priceLists,
    priceListEntries,
    paymentTerms,
    vouchers,
    stockMovements,
    stockPools,
    stockLocations,
    inventoryAccounts,
    statementLines,
    allocations,
    advances,
    numbering,
    auditEvents,
    orders,
    orderLines,
    orderFulfilments,
    orderRevisions,
    orderRevisionLines,
    boms,
    bomLines,
    productionOrders,
    productionRequirements,
    productionIssues,
    productionCompletions,
  }
}

const VOUCHER_PREFIX: Record<VoucherType, string> = {
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

export function emptyItemLines(): VoucherItemLine[] {
  return []
}
