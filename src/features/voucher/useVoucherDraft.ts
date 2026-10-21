import { computed, ref } from 'vue'
import type { Ref } from 'vue'

import {
  buildVoucher,
  computeLineTax,
  computeTax,
  lineAmount,
  totalDebit,
  validateVoucher,
  type SupplyType,
  type VoucherContext,
  type VoucherIssue,
} from '@/domain/accounting'
import type { VoucherDraft } from '@/domain/accounting'
import type { Voucher, VoucherEntry, VoucherItemLine, VoucherType } from '@/domain/types'
import { toMinor } from '@/lib/money'
import { addDays, todayIso } from '@/lib/datetime'
import { useSessionStore } from '@/stores/session'

export interface DraftItemRow {
  id: string
  itemId: string
  /** The quantity, in exact milli-units (thousandths of a unit). */
  quantityMilli: number
  /** Rate in minor units. */
  rate: number
  /** Absolute discount in minor units. */
  discount: number
  taxCategoryId: string | null
  godownId: string | null
  /**
   * The order line this row fulfils, when the voucher is raised from an
   * order. The link is what records the delivery when the voucher is posted.
   */
  orderLineId: string | null
}

export interface DraftLedgerRow {
  id: string
  ledgerId: string
  /** Debit amount in minor units. */
  debit: number
  /** Credit amount in minor units. */
  credit: number
}

const STOCK_TYPES: VoucherType[] = [
  'sales',
  'purchase',
  'credit-note',
  'debit-note',
  'sales-order',
  'purchase-order',
]

export function usesItemGrid(type: VoucherType): boolean {
  return STOCK_TYPES.includes(type)
}

/**
 * Draft state and derived accounting values for the voucher entry screen.
 *
 * All totals are produced by the domain layer, so the preview shown while
 * typing is exactly what gets posted.
 */
export function useVoucherDraft(type: Ref<VoucherType>) {
  const session = useSessionStore()
  let sequence = 0
  const nextId = () => `draft-${++sequence}`

  const date = ref(todayIso())
  const partyId = ref<string | null>(null)
  const narration = ref('')
  const reference = ref('')
  const voucherNumber = ref('')
  const status = ref<'draft' | 'posted'>('posted')
  /** The payment term the invoice was raised under. */
  const paymentTermId = ref<string | null>(null)
  /** The date the invoice falls due, fixed when the term is chosen. */
  const dueDate = ref<string | null>(null)

  const itemRows = ref<DraftItemRow[]>([])
  const ledgerRows = ref<DraftLedgerRow[]>([])

  /** Account used for money in (receipt) or money out (payment). */
  const accountLedgerId = ref<string | null>(null)
  /** Contra only. */
  const contraFromId = ref<string | null>(null)
  const contraToId = ref<string | null>(null)
  /** Journal and simple vouchers. */
  const simpleAmount = ref(0)

  const context = computed<VoucherContext>(() => ({
    ledgers: session.ledgers,
    taxCategories: session.taxCategories,
    nextId,
    companyId: session.activeCompanyId ?? '',
    supply: supply.value,
  }))

  const party = computed(
    () => session.ledgers.find((ledger) => ledger.id === partyId.value) ?? null,
  )

  /**
   * An inter-state supply is charged IGST; an intra-state supply is charged
   * CGST and SGST at the same rate. The state is read from the GSTIN prefix
   * of the company and the party.
   */
  const supply = computed<SupplyType>(() => {
    const companyCode = session.activeCompany?.gstin?.slice(0, 2) ?? ''
    const partyCode = party.value?.taxNumber?.slice(0, 2) ?? ''
    if (companyCode && partyCode && companyCode !== partyCode) return 'inter'
    return 'intra'
  })

  const itemLines = computed<VoucherItemLine[]>(() =>
    itemRows.value.map((row) => ({
      id: row.id,
      itemId: row.itemId,
      quantityMilli: row.quantityMilli,
      rate: row.rate,
      discount: row.discount,
      taxCategoryId: row.taxCategoryId,
      amount: lineAmount(row.quantityMilli, row.rate, row.discount),
      godownId: row.godownId,
      orderLineId: row.orderLineId,
    })),
  )

  const taxComputation = computed(() =>
    computeTax(itemLines.value, session.taxCategories, nextId, { supply: supply.value }),
  )

  /** Tax per grid row, computed by the domain so the grid never repeats the rule. */
  const lineTaxes = computed<Record<string, number>>(() => {
    const result: Record<string, number> = {}
    for (const line of itemLines.value) {
      result[line.id] = computeLineTax(line, session.taxCategories, { supply: supply.value }).tax
    }
    return result
  })

  const gross = computed(() => itemLines.value.reduce((sum, line) => sum + line.amount, 0))
  const taxTotal = computed(() => taxComputation.value.tax)
  const grandTotal = computed(() => gross.value + taxTotal.value)

  /** The voucher that would be posted from the current draft. */
  const baseVoucher = computed<Voucher>(() => {
    if (usesItemGrid(type.value)) {
      return buildVoucher(
        {
          type: type.value,
          date: date.value,
          partyId: partyId.value,
          narration: narration.value,
          reference: reference.value,
          status: status.value,
          items: itemRows.value.map((row) => ({
            id: row.id,
            itemId: row.itemId,
            quantityMilli: row.quantityMilli,
            rate: row.rate,
            discount: row.discount,
            taxCategoryId: row.taxCategoryId,
            godownId: row.godownId,
            orderLineId: row.orderLineId,
          })),
        },
        context.value,
      )
    }

    const entries = simpleEntries.value
    return {
      id: 'draft',
      companyId: session.activeCompanyId ?? '',
      type: type.value,
      number: voucherNumber.value,
      date: date.value,
      partyId: partyId.value,
      narration: narration.value,
      reference: reference.value,
      status: status.value,
      entries,
      items: [],
      taxes: [],
      linkedVoucherId: null,
      reversedByVoucherId: null,
      isLocked: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  })

  /**
   * The voucher as it stands, with the invoice terms it was raised under.
   */
  const draftVoucher = computed<Voucher>(() => ({
    ...baseVoucher.value,
    dueDate: dueDate.value,
    paymentTermId: paymentTermId.value,
  }))

  const simpleEntries = computed<VoucherEntry[]>(() => {
    const rows: Array<{ ledgerId: string; debit?: number; credit?: number }> = []

    if (type.value === 'payment') {
      if (partyId.value) rows.push({ ledgerId: partyId.value, debit: simpleAmount.value })
      if (accountLedgerId.value) rows.push({ ledgerId: accountLedgerId.value, credit: simpleAmount.value })
    } else if (type.value === 'receipt') {
      if (accountLedgerId.value) rows.push({ ledgerId: accountLedgerId.value, debit: simpleAmount.value })
      if (partyId.value) rows.push({ ledgerId: partyId.value, credit: simpleAmount.value })
    } else if (type.value === 'contra') {
      if (contraToId.value) rows.push({ ledgerId: contraToId.value, debit: simpleAmount.value })
      if (contraFromId.value) rows.push({ ledgerId: contraFromId.value, credit: simpleAmount.value })
    } else {
      for (const row of ledgerRows.value) {
        if (!row.ledgerId) continue
        rows.push({ ledgerId: row.ledgerId, debit: row.debit, credit: row.credit })
      }
    }

    return rows.map((row, index) => ({
      id: `draft-entry-${index}`,
      ledgerId: row.ledgerId,
      debit: row.debit ?? 0,
      credit: row.credit ?? 0,
      narration: narration.value || undefined,
    }))
  })

  const closedPeriods = computed(() =>
    session.financialYears
      .filter((year) => year.isClosed)
      .map((year) => ({ from: year.start, to: year.end, label: `Financial year ${year.label}` })),
  )

  const issues = computed<VoucherIssue[]>(() =>
    validateVoucher(draftVoucher.value, {
      ledgers: session.ledgers,
      taxCategories: session.taxCategories,
      closedPeriods: closedPeriods.value,
    }),
  )

  const balanceDifference = computed(
    () => totalDebit(draftVoucher.value) - totalDebit(draftVoucher.value),
  )

  const totalValue = computed(() => {
    if (usesItemGrid(type.value)) return grandTotal.value
    return simpleAmount.value
  })

  // -- editing ------------------------------------------------------------

  function addItemRow() {
    const firstItem = session.items[0]
    itemRows.value = [
      ...itemRows.value,
      {
        id: nextId(),
        itemId: firstItem?.id ?? '',
        quantityMilli: 1000,
        rate: firstItem?.salesPrice ?? 0,
        discount: 0,
        taxCategoryId: firstItem?.taxCategoryId ?? null,
        godownId: session.godowns[0]?.id ?? null,
        orderLineId: null,
      },
    ]
  }

  function removeItemRow(id: string) {
    itemRows.value = itemRows.value.filter((row) => row.id !== id)
  }

  function addLedgerRow() {
    ledgerRows.value = [
      ...ledgerRows.value,
      { id: nextId(), ledgerId: session.ledgers[0]?.id ?? '', debit: 0, credit: 0 },
    ]
  }

  function removeLedgerRow(id: string) {
    ledgerRows.value = ledgerRows.value.filter((row) => row.id !== id)
  }

  function applyItemDefaults(row: DraftItemRow) {
    const item = session.items.find((candidate) => candidate.id === row.itemId)
    if (!item) return
    row.rate = type.value === 'purchase' ? item.purchasePrice : item.salesPrice
    row.taxCategoryId = item.taxCategoryId
  }

  /**
   * Seed the draft from an order.
   *
   * The order's party, items, remaining quantities, rates and tax treatment
   * are carried across, and every line remembers which order line it
   * fulfils, so that posting the voucher records the delivery against the
   * order in the same transaction.
   */
  function applyOrderDraft(draft: VoucherDraft) {
    date.value = draft.date
    partyId.value = draft.partyId
    narration.value = draft.narration
    reference.value = draft.reference
    itemRows.value = draft.items.map((item) => ({
      id: nextId(),
      itemId: item.itemId,
      quantityMilli: item.quantityMilli,
      rate: item.rate,
      discount: item.discount ?? 0,
      taxCategoryId: item.taxCategoryId ?? null,
      godownId: item.godownId ?? null,
      orderLineId: item.orderLineId ?? null,
    }))
  }

  /**
   * Apply a payment term to the voucher.
   *
   * The due date is fixed at the moment the term is chosen, so a later change
   * to the term cannot silently restate an invoice that has been issued.
   */
  function applyPaymentTerm(termId: string | null) {
    paymentTermId.value = termId
    const term = session.paymentTerms.find((candidate) => candidate.id === termId)
    dueDate.value = term ? addDays(date.value, term.days) : null
  }

  function reset() {
    date.value = todayIso()
    partyId.value = null
    narration.value = ''
    reference.value = ''
    itemRows.value = []
    ledgerRows.value = []
    simpleAmount.value = 0
    accountLedgerId.value = null
    contraFromId.value = null
    contraToId.value = null
    paymentTermId.value = null
    dueDate.value = null
  }

  function setSimpleAmount(value: string) {
    simpleAmount.value = toMinor(value, 100)
  }

  return {
    date,
    partyId,
    party,
    supply,
    paymentTermId,
    dueDate,
    narration,
    reference,
    voucherNumber,
    status,
    itemRows,
    ledgerRows,
    accountLedgerId,
    contraFromId,
    contraToId,
    simpleAmount,
    itemLines,
    taxComputation,
    lineTaxes,
    gross,
    taxTotal,
    grandTotal,
    totalValue,
    draftVoucher,
    simpleEntries,
    issues,
    balanceDifference,
    addItemRow,
    removeItemRow,
    addLedgerRow,
    removeLedgerRow,
    applyItemDefaults,
    applyOrderDraft,
    applyPaymentTerm,
    reset,
    setSimpleAmount,
  }
}
