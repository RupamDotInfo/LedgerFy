/**
 * LedgerFy accounting domain.
 *
 * Every authoritative financial figure the UI shows is produced here or by the
 * repository that stores vouchers. Presentation components never re-implement
 * accounting rules.
 */

import type { Money } from '@/lib/money'
import { buildAllocationLedger, type InvoiceAllocation } from '@/domain/allocations'
import { lineValue } from '@/domain/quantity'
import type {
  AccountGroup,
  Ledger,
  TaxCategory,
  Voucher,
  VoucherEntry,
  VoucherItemLine,
  VoucherStatus,
  VoucherTaxLine,
  VoucherType,
} from '@/domain/types'

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Round half away from zero. Keeps debit and credit arithmetic symmetric. */
export function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value)
}

/** Positive amount only — a ledger entry is either a debit or a credit. */
export function absolute(value: Money): Money {
  return value < 0 ? -value : value
}

// ---------------------------------------------------------------------------
// Voucher balance
// ---------------------------------------------------------------------------

export function totalDebit(voucher: Pick<Voucher, 'entries'>): Money {
  return voucher.entries.reduce((sum, entry) => sum + entry.debit, 0)
}

export function totalCredit(voucher: Pick<Voucher, 'entries'>): Money {
  return voucher.entries.reduce((sum, entry) => sum + entry.credit, 0)
}

export function isBalanced(voucher: Pick<Voucher, 'entries'>): boolean {
  return totalDebit(voucher) === totalCredit(voucher)
}

/** Difference between debits and credits. Positive means unbalanced debit. */
export function balanceDifference(voucher: Pick<Voucher, 'entries'>): Money {
  return totalDebit(voucher) - totalCredit(voucher)
}

// ---------------------------------------------------------------------------
// Ledger balances
// ---------------------------------------------------------------------------

export interface LedgerBalance {
  ledger: Ledger
  /** Debit positive, credit negative. */
  closing: Money
  debitTotal: Money
  creditTotal: Money
  debitCount: number
  creditCount: number
}

/**
 * Closing balance of a ledger: opening balance plus every posted entry.
 * Debit balances are positive, credit balances negative.
 */
export function ledgerClosingBalance(
  ledger: Ledger,
  entries: VoucherEntry[],
): { closing: Money; debitTotal: Money; creditTotal: Money; debitCount: number; creditCount: number } {
  let debitTotal = 0
  let creditTotal = 0
  let debitCount = 0
  let creditCount = 0

  for (const entry of entries) {
    debitTotal += entry.debit
    creditTotal += entry.credit
    if (entry.debit > 0) debitCount += 1
    if (entry.credit > 0) creditCount += 1
  }

  const signed = ledger.openingBalance + debitTotal - creditTotal
  return { closing: signed, debitTotal, creditTotal, debitCount, creditCount }
}

export function computeLedgerBalances(
  ledgers: Ledger[],
  vouchers: Voucher[],
  options: { from?: string; to?: string; includeDrafts?: boolean } = {},
): LedgerBalance[] {
  const entriesByLedger = new Map<string, VoucherEntry[]>()
  for (const voucher of vouchers) {
    if (!options.includeDrafts && voucher.status !== 'posted') continue
    if (options.from && voucher.date < options.from) continue
    if (options.to && voucher.date > options.to) continue
    for (const entry of voucher.entries) {
      const bucket = entriesByLedger.get(entry.ledgerId)
      if (bucket) bucket.push(entry)
      else entriesByLedger.set(entry.ledgerId, [entry])
    }
  }

  return ledgers.map((ledger) => {
    const computed = ledgerClosingBalance(ledger, entriesByLedger.get(ledger.id) ?? [])
    return { ledger, ...computed }
  })
}

/** Opening balances of a ledger, before any voucher in the period. */
export function ledgerOpeningBalance(ledger: Ledger): Money {
  return ledger.openingBalance
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface TrialBalanceRow {
  ledgerId: string
  ledgerName: string
  group: AccountGroup
  opening: Money
  debit: Money
  credit: Money
  /** Signed closing balance: debit positive, credit negative. */
  closing: Money
  debitCount: number
  creditCount: number
}

export function trialBalance(
  ledgers: Ledger[],
  vouchers: Voucher[],
  options: { from?: string; to?: string } = {},
): { rows: TrialBalanceRow[]; totalDebit: Money; totalCredit: Money; closingNet: Money } {
  const balances = computeLedgerBalances(ledgers, vouchers, options)
  const rows: TrialBalanceRow[] = []
  let totalDebit = 0
  let totalCredit = 0

  for (const balance of balances) {
    if (
      balance.debitTotal === 0 &&
      balance.creditTotal === 0 &&
      balance.ledger.openingBalance === 0
    ) {
      continue
    }
    totalDebit += balance.debitTotal
    totalCredit += balance.creditTotal
    rows.push({
      ledgerId: balance.ledger.id,
      ledgerName: balance.ledger.name,
      group: balance.ledger.group,
      opening: balance.ledger.openingBalance,
      debit: balance.debitTotal,
      credit: balance.creditTotal,
      closing: balance.closing,
      debitCount: balance.debitCount,
      creditCount: balance.creditCount,
    })
  }

  rows.sort((left, right) => left.ledgerName.localeCompare(right.ledgerName))
  return {
    rows,
    totalDebit,
    totalCredit,
    closingNet: totalDebit - totalCredit,
  }
}

export interface ProfitAndLoss {
  income: Money
  expense: Money
  net: Money
  incomeRows: TrialBalanceRow[]
  expenseRows: TrialBalanceRow[]
}

export function profitAndLoss(
  ledgers: Ledger[],
  vouchers: Voucher[],
  options: { from?: string; to?: string } = {},
): ProfitAndLoss {
  const balances = computeLedgerBalances(ledgers, vouchers, options)
  const incomeRows: TrialBalanceRow[] = []
  const expenseRows: TrialBalanceRow[] = []
  let income = 0
  let expense = 0

  for (const balance of balances) {
    const closing = balance.closing
    if (closing === 0) continue

    if (balance.ledger.group === 'income') {
      // Income balances are credit positive, so the reported amount is negated.
      income += -closing
      incomeRows.push({
        ledgerId: balance.ledger.id,
        ledgerName: balance.ledger.name,
        group: balance.ledger.group,
        opening: -balance.ledger.openingBalance,
        debit: balance.debitTotal,
        credit: balance.creditTotal,
        closing: -closing,
        debitCount: balance.debitCount,
        creditCount: balance.creditCount,
      })
    } else if (balance.ledger.group === 'expenses') {
      expense += closing
      expenseRows.push({
        ledgerId: balance.ledger.id,
        ledgerName: balance.ledger.name,
        group: balance.ledger.group,
        opening: balance.ledger.openingBalance,
        debit: balance.debitTotal,
        credit: balance.creditTotal,
        closing,
        debitCount: balance.debitCount,
        creditCount: balance.creditCount,
      })
    }
  }

  incomeRows.sort((left, right) => right.closing - left.closing)
  expenseRows.sort((left, right) => right.closing - left.closing)
  return { income, expense, net: income - expense, incomeRows, expenseRows }
}

export interface BalanceSheet {
  assets: Money
  liabilities: Money
  equity: Money
  /** Retained profit for the period, which belongs on the equity side. */
  profit: Money
  /** Equity including retained profit. */
  totalEquity: Money
  /** Assets minus (liabilities + equity). Must be zero for a consistent book. */
  difference: Money
  assetRows: TrialBalanceRow[]
  liabilityRows: TrialBalanceRow[]
  equityRows: TrialBalanceRow[]
}

export function balanceSheet(
  ledgers: Ledger[],
  vouchers: Voucher[],
  options: { asOf?: string } = {},
): BalanceSheet {
  const balances = computeLedgerBalances(ledgers, vouchers, { to: options.asOf })
  const assetRows: TrialBalanceRow[] = []
  const liabilityRows: TrialBalanceRow[] = []
  const equityRows: TrialBalanceRow[] = []
  let assets = 0
  let liabilities = 0
  let equity = 0
  let profit = 0

  for (const balance of balances) {
    const closing = balance.closing
    if (closing === 0) continue
    const row: TrialBalanceRow = {
      ledgerId: balance.ledger.id,
      ledgerName: balance.ledger.name,
      group: balance.ledger.group,
      opening: balance.ledger.openingBalance,
      debit: balance.debitTotal,
      credit: balance.creditTotal,
      closing,
      debitCount: balance.debitCount,
      creditCount: balance.creditCount,
    }

    if (balance.ledger.group === 'assets') {
      assets += closing
      assetRows.push(row)
    } else if (balance.ledger.group === 'liabilities') {
      liabilities += -closing
      liabilityRows.push(row)
    } else if (balance.ledger.group === 'equity') {
      equity += -closing
      equityRows.push(row)
    } else if (balance.ledger.group === 'income') {
      profit += -closing
    } else if (balance.ledger.group === 'expenses') {
      profit -= closing
    }
  }

  assetRows.sort((left, right) => right.closing - left.closing)
  liabilityRows.sort((left, right) => right.closing - left.closing)
  equityRows.sort((left, right) => right.closing - left.closing)

  const totalEquity = equity + profit

  return {
    assets,
    liabilities,
    equity,
    profit,
    totalEquity,
    difference: assets - liabilities - totalEquity,
    assetRows,
    liabilityRows,
    equityRows,
  }
}

/** Grouped cash and bank position for the dashboard. */
export function cashPosition(
  ledgers: Ledger[],
  vouchers: Voucher[],
  options: { asOf?: string } = {},
): { cash: Money; bank: Money; total: Money; breakdown: TrialBalanceRow[] } {
  const balances = computeLedgerBalances(ledgers, vouchers, { to: options.asOf })
  let cash = 0
  let bank = 0
  const breakdown: TrialBalanceRow[] = []

  for (const balance of balances) {
    if (balance.ledger.type !== 'cash' && balance.ledger.type !== 'bank') continue
    if (balance.closing === 0) continue
    if (balance.ledger.type === 'cash') cash += balance.closing
    else bank += balance.closing
    breakdown.push({
      ledgerId: balance.ledger.id,
      ledgerName: balance.ledger.name,
      group: balance.ledger.group,
      opening: balance.ledger.openingBalance,
      debit: balance.debitTotal,
      credit: balance.creditTotal,
      closing: balance.closing,
      debitCount: balance.debitCount,
      creditCount: balance.creditCount,
    })
  }

  breakdown.sort((left, right) => right.closing - left.closing)
  return { cash, bank, total: cash + bank, breakdown }
}

// ---------------------------------------------------------------------------
// Tax
// ---------------------------------------------------------------------------

export interface TaxComputation {
  taxable: Money
  tax: Money
  lines: VoucherTaxLine[]
}

export type SupplyType = 'intra' | 'inter'

export interface TaxOptions {
  /**
   * Where the supply is made.
   *
   * An intra-state supply charges CGST and SGST at the same rate; an
   * inter-state supply charges IGST. When a line carries a CGST or SGST
   * category and the supply is intra-state, the matching state tax is added
   * automatically so the books show the statutory split.
   */
  supply?: SupplyType
}

export interface LineTaxSplit {
  taxCategoryId: string
  amount: Money
}

export interface LineTaxResult {
  tax: Money
  splits: LineTaxSplit[]
}

/**
 * Tax for a single item line, including the paired state tax.
 *
 * An intra-state supply charges CGST and SGST at the same rate, so a line
 * tagged with a CGST category also attracts SGST at that rate. The mirrored
 * category is only added when the line did not already name it, so a voucher
 * that mixes both categories is never charged twice.
 */
export function computeLineTax(
  line: VoucherItemLine,
  taxCategories: TaxCategory[],
  options: TaxOptions = {},
): LineTaxResult {
  const supply = options.supply ?? 'intra'
  if (!line.taxCategoryId) return { tax: 0, splits: [] }

  const category = taxCategories.find((candidate) => candidate.id === line.taxCategoryId)
  if (!category) return { tax: 0, splits: [] }

  const amount = roundHalfAwayFromZero((line.amount * category.rate) / 100)
  const splits: LineTaxSplit[] = [{ taxCategoryId: category.id, amount }]

  if (supply === 'intra' && (category.type === 'cgst' || category.type === 'sgst')) {
    const counterpartType = category.type === 'cgst' ? 'sgst' : 'cgst'
    const counterpart = taxCategories.find(
      (candidate) =>
        candidate.type === counterpartType &&
        candidate.rate === category.rate &&
        !splits.some((split) => split.taxCategoryId === candidate.id),
    )
    if (counterpart) {
      splits.push({
        taxCategoryId: counterpart.id,
        amount: roundHalfAwayFromZero((line.amount * counterpart.rate) / 100),
      })
    }
  }

  return { tax: splits.reduce((sum, split) => sum + split.amount, 0), splits }
}

/**
 * Compute tax on a set of item lines.
 *
 * Rule: each line is taxed on its post-discount value, tax is rounded
 * half-away-from-zero to the nearest minor unit, and lines sharing a tax
 * category are summed before the total is produced.
 */
export function computeTax(
  itemLines: VoucherItemLine[],
  taxCategories: TaxCategory[],
  idFactory: () => string,
  options: TaxOptions = {},
): TaxComputation {
  const supply = options.supply ?? 'intra'

  // Categories the voucher names explicitly are never mirrored, so mixing
  // CGST and SGST on one voucher cannot double-charge a line.
  const applied = new Set<string>()
  for (const line of itemLines) {
    if (line.taxCategoryId) applied.add(line.taxCategoryId)
  }

  const byCategory = new Map<string, { taxable: Money; tax: Money }>()

  for (const line of itemLines) {
    if (!line.taxCategoryId) continue
    const result = computeLineTax(line, taxCategories, { supply })

    for (const split of result.splits) {
      if (split.taxCategoryId !== line.taxCategoryId && applied.has(split.taxCategoryId)) {
        continue
      }
      const bucket = byCategory.get(split.taxCategoryId)
      if (bucket) {
        bucket.taxable += line.amount
        bucket.tax += split.amount
      } else {
        byCategory.set(split.taxCategoryId, { taxable: line.amount, tax: split.amount })
      }
    }
  }

  const lines: VoucherTaxLine[] = []
  let taxable = 0
  let tax = 0

  for (const [taxCategoryId, bucket] of byCategory) {
    lines.push({
      id: idFactory(),
      taxCategoryId,
      taxable: bucket.taxable,
      amount: bucket.tax,
    })
    taxable += bucket.taxable
    tax += bucket.tax
  }

  return { taxable, tax, lines }
}

// ---------------------------------------------------------------------------
// Voucher construction
// ---------------------------------------------------------------------------

export interface VoucherContext {
  ledgers: Ledger[]
  taxCategories: TaxCategory[]
  nextId: () => string
  companyId: string
  /** Whether the supply is intra-state or inter-state. */
  supply?: SupplyType
}

export interface ItemLineInput {
  id?: string
  itemId: string
  /** The quantity, in exact milli-units (thousandths of a unit). */
  quantityMilli: number
  rate: Money
  discount?: Money
  /** Directly attributable acquisition cost captured on the line. */
  directCost?: Money
  taxCategoryId?: string | null
  godownId?: string | null
  /** The destination location, used by a stock transfer. */
  toGodownId?: string | null
  /** The order line this line fulfils, when the voucher is raised from an order. */
  orderLineId?: string | null
  /** The production requirement this line consumes. */
  productionRequirementId?: string | null
}

export interface VoucherDraft {
  type: VoucherType
  date: string
  partyId: string | null
  narration: string
  reference: string
  status: VoucherStatus
  items: ItemLineInput[]
  /** Explicit ledger lines, used by payment / receipt / contra / journal. */
  entries?: Array<{ ledgerId: string; debit?: Money; credit?: Money; narration?: string }>
  narrationLine?: string
}

const ACCOUNT_GROUPS: Record<string, AccountGroup> = {
  assets: 'assets',
  liabilities: 'liabilities',
  equity: 'equity',
  income: 'income',
  expenses: 'expenses',
}

/**
 * Net line value after discount.
 *
 * The quantity is in exact milli-units, so the value is computed with exact
 * integer arithmetic and rounded once, to the nearest minor unit.
 */
export function lineAmount(
  quantityMilli: number,
  rate: Money,
  discount: Money,
  directCost = 0,
): Money {
  return lineValue(quantityMilli, rate) - discount + directCost
}

/**
 * Build the voucher line items and the tax breakup for a stock voucher.
 */
export function buildItemLines(
  inputs: ItemLineInput[],
  context: VoucherContext,
): { items: VoucherItemLine[]; taxes: VoucherTaxLine[]; taxable: Money; tax: Money; gross: Money } {
  const items: VoucherItemLine[] = inputs.map((input) => ({
    id: input.id ?? context.nextId(),
    itemId: input.itemId,
    quantityMilli: input.quantityMilli,
    rate: input.rate,
    discount: input.discount ?? 0,
    // The acquisition cost travels with the line, so the costing layer can
    // capitalise it into the stock instead of losing it.
    directCost: input.directCost ?? 0,
    taxCategoryId: input.taxCategoryId ?? null,
    amount: lineAmount(input.quantityMilli, input.rate, input.discount ?? 0, input.directCost ?? 0),
    godownId: input.godownId ?? null,
    toGodownId: input.toGodownId ?? null,
    // The links to an order line or a production requirement travel with the
    // line, so the posting knows what the line fulfils or consumes.
    orderLineId: input.orderLineId ?? null,
    productionRequirementId: input.productionRequirementId ?? null,
  }))

  const computation = computeTax(items, context.taxCategories, context.nextId, {
    supply: context.supply ?? 'intra',
  })
  const gross = items.reduce((sum, item) => sum + item.amount, 0)

  return {
    items,
    taxes: computation.lines,
    taxable: computation.taxable,
    tax: computation.tax,
    gross,
  }
}

function entry(
  id: string,
  ledgerId: string,
  debit: Money,
  credit: Money,
  narration?: string,
): VoucherEntry {
  return { id, ledgerId, debit: absolute(debit), credit: absolute(credit), narration }
}

function findLedger(context: VoucherContext, predicate: (ledger: Ledger) => boolean): Ledger | undefined {
  return context.ledgers.find(
    (ledger) => ledger.companyId === context.companyId && ledger.isActive && predicate(ledger),
  )
}

/**
 * Turn a draft into a complete voucher with authoritative double-entry lines.
 *
 * Sales and purchase vouchers derive their entries from the party, the item
 * lines and the tax breakup, so the ledger preview shown in the UI always
 * matches what gets posted.
 */
export function buildVoucher(draft: VoucherDraft, context: VoucherContext): Voucher {
  const now = new Date().toISOString()
  const base = {
    id: context.nextId(),
    companyId: context.companyId,
    type: draft.type,
    number: '',
    date: draft.date,
    partyId: draft.partyId,
    narration: draft.narration,
    reference: draft.reference,
    status: draft.status,
    items: [] as VoucherItemLine[],
    taxes: [] as VoucherTaxLine[],
    entries: [] as VoucherEntry[],
    linkedVoucherId: null,
    reversedByVoucherId: null,
    isLocked: false,
    createdAt: now,
    updatedAt: now,
  }

  const lines = buildItemLines(draft.items, context)
  const total = lines.gross + lines.tax

  switch (draft.type) {
    case 'sales':
    case 'credit-note': {
      const isCreditNote = draft.type === 'credit-note'
      const party = draft.partyId
      const salesLedger = findLedger(
        context,
        (ledger) => ledger.type === 'sales' && ledger.group === 'income',
      )
      const entries: VoucherEntry[] = []
      if (party) {
        entries.push(
          entry(context.nextId(), party, isCreditNote ? 0 : total, isCreditNote ? total : 0),
        )
      }
      if (salesLedger) {
        entries.push(
          entry(
            context.nextId(),
            salesLedger.id,
            isCreditNote ? lines.gross : 0,
            isCreditNote ? 0 : lines.gross,
          ),
        )
      }
      for (const taxLine of lines.taxes) {
        if (taxLine.amount === 0) continue
        const category = context.taxCategories.find(
          (candidate) => candidate.id === taxLine.taxCategoryId,
        )
        if (!category?.ledgerId) continue
        entries.push(
          entry(
            context.nextId(),
            category.ledgerId,
            isCreditNote ? taxLine.amount : 0,
            isCreditNote ? 0 : taxLine.amount,
          ),
        )
      }
      return { ...base, items: lines.items, taxes: lines.taxes, entries }
    }

    case 'purchase':
    case 'debit-note': {
      const isDebitNote = draft.type === 'debit-note'
      const party = draft.partyId
      const purchaseLedger = findLedger(
        context,
        (ledger) => ledger.type === 'purchase' && ledger.group === 'expenses',
      )
      const entries: VoucherEntry[] = []
      if (purchaseLedger) {
        // Purchases are an expense, so a purchase bill debits it. A debit note
        // reverses the entry and therefore credits it.
        entries.push(
          entry(
            context.nextId(),
            purchaseLedger.id,
            isDebitNote ? 0 : lines.gross,
            isDebitNote ? lines.gross : 0,
          ),
        )
      }
      for (const taxLine of lines.taxes) {
        if (taxLine.amount === 0) continue
        const category = context.taxCategories.find(
          (candidate) => candidate.id === taxLine.taxCategoryId,
        )
        const ledgerId = category?.inputLedgerId ?? category?.ledgerId
        if (!ledgerId) continue
        // Input tax is recoverable, so it is debited on a purchase.
        entries.push(
          entry(
            context.nextId(),
            ledgerId,
            isDebitNote ? 0 : taxLine.amount,
            isDebitNote ? taxLine.amount : 0,
          ),
        )
      }
      if (party) {
        entries.push(
          entry(context.nextId(), party, isDebitNote ? total : 0, isDebitNote ? 0 : total),
        )
      }
      return { ...base, items: lines.items, taxes: lines.taxes, entries }
    }

    case 'payment':
    case 'receipt':
    case 'contra':
    case 'journal':
    default: {
      const entries = (draft.entries ?? []).map((line) =>
        entry(
          context.nextId(),
          line.ledgerId,
          line.debit ?? 0,
          line.credit ?? 0,
          line.narration ?? draft.narrationLine,
        ),
      )
      // The item lines are kept even when there are no entries, because a
      // stock journal and an order carry stock without moving money.
      return { ...base, items: lines.items, taxes: lines.taxes, entries }
    }
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface VoucherIssue {
  field: string
  lineId?: string
  message: string
  severity: 'error' | 'warning'
}

export interface ValidationContext {
  ledgers: Ledger[]
  taxCategories: TaxCategory[]
  /** ISO date ranges that are closed and must not be posted to. */
  closedPeriods: Array<{ from: string; to: string; label: string }>
  /** Existing voucher numbers, to catch duplicates. */
  existingNumbers?: string[]
}

/**
 * Validate a voucher against accounting rules. Errors block posting,
 * warnings do not.
 */
export function validateVoucher(voucher: Voucher, context: ValidationContext): VoucherIssue[] {
  const issues: VoucherIssue[] = []
  const ledgerIds = new Set(context.ledgers.map((ledger) => ledger.id))

  if (!voucher.date) {
    issues.push({ field: 'date', message: 'A voucher date is required.', severity: 'error' })
  }

  for (const period of context.closedPeriods) {
    if (voucher.date >= period.from && voucher.date <= period.to) {
      issues.push({
        field: 'date',
        message: `${period.label} is closed. Choose a date in an open period.`,
        severity: 'error',
      })
      break
    }
  }

  if (context.existingNumbers?.includes(voucher.number)) {
    issues.push({
      field: 'number',
      message: `Voucher number ${voucher.number} is already used.`,
      severity: 'error',
    })
  }

  if (voucher.entries.length === 0) {
    issues.push({
      field: 'entries',
      message: 'Add at least one ledger line before posting.',
      severity: 'error',
    })
  }

  voucher.entries.forEach((line, index) => {
    if (!ledgerIds.has(line.ledgerId)) {
      issues.push({
        field: `entries.${index}`,
        lineId: line.id,
        message: 'This ledger no longer exists.',
        severity: 'error',
      })
    }
    if (line.debit < 0 || line.credit < 0) {
      issues.push({
        field: `entries.${index}`,
        lineId: line.id,
        message: 'Entry amounts cannot be negative.',
        severity: 'error',
      })
    }
    if (line.debit > 0 && line.credit > 0) {
      issues.push({
        field: `entries.${index}`,
        lineId: line.id,
        message: 'An entry cannot be both a debit and a credit.',
        severity: 'error',
      })
    }
    if (line.debit === 0 && line.credit === 0) {
      issues.push({
        field: `entries.${index}`,
        lineId: line.id,
        message: 'Enter an amount for this line.',
        severity: 'error',
      })
    }
  })

  const difference = balanceDifference(voucher)
  if (voucher.entries.length > 0 && difference !== 0) {
    issues.push({
      field: 'entries',
      message: `Debits and credits differ by ${Math.abs(difference)} minor units. The voucher must balance.`,
      severity: 'error',
    })
  }

  const needsParty = ['sales', 'purchase', 'receipt', 'payment', 'credit-note', 'debit-note']
  if (needsParty.includes(voucher.type) && !voucher.partyId) {
    issues.push({
      field: 'party',
      message: 'Select a party for this voucher type.',
      severity: 'error',
    })
  }

  const needsItems = ['sales', 'purchase', 'credit-note', 'debit-note']
  if (needsItems.includes(voucher.type) && voucher.items.length === 0) {
    issues.push({
      field: 'items',
      message: 'Add at least one item line.',
      severity: 'error',
    })
  }

  voucher.items.forEach((line, index) => {
    if (line.quantityMilli <= 0) {
      issues.push({
        field: `items.${index}.quantity`,
        lineId: line.id,
        message: 'Quantity must be greater than zero.',
        severity: 'error',
      })
    }
    if (line.rate < 0) {
      issues.push({
        field: `items.${index}.rate`,
        lineId: line.id,
        message: 'Rate cannot be negative.',
        severity: 'error',
      })
    }
  })

  const duplicateItems = voucher.items.filter(
    (line, index) =>
      voucher.items.findIndex((candidate) => candidate.itemId === line.itemId) !== index,
  )
  if (duplicateItems.length && voucher.type !== 'journal') {
    issues.push({
      field: 'items',
      message: 'The same item appears more than once. Merge the lines into one.',
      severity: 'warning',
    })
  }

  return issues
}

export function hasBlockingIssues(issues: VoucherIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error')
}

export function issueFor(issues: VoucherIssue[], field: string): string | undefined {
  return issues.find((issue) => issue.field === field && issue.severity === 'error')?.message
}

// ---------------------------------------------------------------------------
// Outstanding allocation
// ---------------------------------------------------------------------------

/**
 * The outstanding position of one invoice.
 *
 * `buildAllocationLedger` in `@/domain/allocations` is the authority for
 * how money is applied to invoices. This is the same information, enriched
 * with the party name for the screens that show it.
 */
export interface Allocation extends InvoiceAllocation {
  partyName: string
}

export interface AllocationOptions {
  asOf?: string
  /** Fallback credit period when a voucher carries no payment term. */
  dueDays?: number
  idFactory?: () => string
  now?: () => string
}

/**
 * Allocate receipts and payments to the invoices of the same party, oldest
 * first, and report what remains outstanding.
 *
 * A credit note reduces what the customer owes, so it settles part of the
 * balance in the same way a receipt does. That keeps the sum of outstanding
 * invoices equal to the party's ledger balance.
 */
export function allocateOutstanding(
  vouchers: Voucher[],
  parties: Ledger[],
  options: AllocationOptions = {},
): Allocation[] {
  const tradeParties = new Set(
    parties
      .filter((party) => party.partyKind === 'customer' || party.partyKind === 'supplier')
      .map((party) => party.id),
  )

  const ledger = buildAllocationLedger(vouchers, {
    asOf: options.asOf,
    dueDays: options.dueDays,
    idFactory: options.idFactory ?? (() => 'allocation'),
    now: options.now ?? (() => new Date().toISOString()),
    tradePartyIds: tradeParties,
  })

  const names = new Map(parties.map((party) => [party.id, party.name]))
  return ledger.invoices.map((invoice) => ({
    ...invoice,
    partyName: names.get(invoice.partyId) ?? 'Unknown party',
  }))
}

/** Quantity on hand per item, from opening stock and stock movements. */
export function stockOnHand(
  opening: Map<string, number>,
  movements: Array<{ itemId: string; quantityMilli: number }>,
): Map<string, number> {
  const result = new Map(opening)
  for (const movement of movements) {
    result.set(movement.itemId, (result.get(movement.itemId) ?? 0) + movement.quantityMilli)
  }
  return result
}

export { ACCOUNT_GROUPS }
