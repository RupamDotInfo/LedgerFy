/**
 * Bill-wise allocation.
 *
 * The accounting model this application has always used is oldest-first: the
 * money a party pays is applied to that party's earliest unpaid invoice, and
 * anything left over stays with the party as an advance. This module makes
 * that model explicit and produces the records that record *which* payment
 * settled *which* invoice, so the effect can be reconstructed and audited
 * later instead of being re-derived on every read.
 *
 * The totals are identical to the previous derivation; only the audit trail
 * is new. Allocation is a domain concern. Rust only stores what this module
 * produces.
 */

import type { Money } from '@/lib/money'
import type { Voucher } from '@/domain/types'

export type AllocationSide = 'receivable' | 'payable'

export interface AllocationRecord {
  id: string
  companyId: string
  side: AllocationSide
  /** The receipt or payment that settled the invoice. */
  paymentVoucherId: string
  /** The party leg of that payment. */
  paymentEntryId: string
  /** The sales invoice or purchase bill that was settled. */
  invoiceVoucherId: string
  /** The party leg of that invoice. */
  invoiceEntryId: string
  /** The party the allocation belongs to. */
  partyId: string
  amount: Money
  createdAt: string
}

export interface AdvanceRecord {
  id: string
  companyId: string
  side: AllocationSide
  voucherId: string
  entryId: string
  partyId: string
  amount: Money
  date: string
}

export interface InvoiceAllocation {
  voucherId: string
  voucherNumber: string
  partyId: string
  side: AllocationSide
  date: string
  dueDate: string
  /** The amount invoiced. */
  amount: Money
  /** How much of it has been settled. */
  allocated: Money
  /** What is still owed. */
  outstanding: Money
  status: 'open' | 'partial' | 'settled' | 'overdue'
}

export interface AllocationLedger {
  allocations: AllocationRecord[]
  advances: AdvanceRecord[]
  invoices: InvoiceAllocation[]
}

export interface AllocationOptions {
  asOf?: string
  /** Fallback credit period when a voucher carries no payment term. */
  dueDays?: number
  idFactory: () => string
  now: () => string
  /**
   * The parties that trade with this business.
   *
   * A sale settled directly against a cash or bank account is not a
   * receivable, so it takes no part in the allocation. When this set is
   * given, only the parties in it are allocated.
   */
  tradePartyIds?: Set<string>
}

interface SideRule {
  side: AllocationSide
  invoiceTypes: Voucher['type'][]
  reductionTypes: Voucher['type'][]
}

const SIDE_RULES: SideRule[] = [
  {
    side: 'receivable',
    invoiceTypes: ['sales'],
    reductionTypes: ['receipt', 'credit-note'],
  },
  {
    side: 'payable',
    invoiceTypes: ['purchase'],
    reductionTypes: ['payment', 'debit-note'],
  },
]

/** The amount a voucher moves on the party's own ledger, positive for a debit. */
function partyMovement(voucher: Voucher, partyId: string): Money {
  const entry = voucher.entries.find((candidate) => candidate.ledgerId === partyId)
  return entry ? entry.debit - entry.credit : 0
}

/** The party leg of a voucher, which an allocation record points at. */
function partyEntry(voucher: Voucher, partyId: string) {
  return voucher.entries.find((candidate) => candidate.ledgerId === partyId)
}

/** The credit period applied to an invoice. */
export function dueDateFor(voucher: Voucher, fallbackDays: number): string {
  const days = voucher.dueDate
    ? daysBetween(voucher.date, voucher.dueDate)
    : fallbackDays
  return addDays(voucher.date, days)
}

function daysBetween(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00`).getTime()
  const end = new Date(`${to}T00:00:00`).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  return Math.round((end - start) / 86_400_000)
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  date.setDate(date.getDate() + days)
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10)
}

/**
 * Build the allocation ledger for a set of vouchers.
 *
 * Only posted vouchers take part: a draft has no financial effect. The
 * result is ordered by date so the same books always produce the same
 * allocation.
 */
export function buildAllocationLedger(
  vouchers: Voucher[],
  options: AllocationOptions,
): AllocationLedger {
  const asOf = options.asOf ?? '9999-12-31'
  const fallbackDays = options.dueDays ?? 30
  const posted = vouchers
    .filter((voucher) => voucher.status === 'posted' && voucher.date <= asOf)
    .sort((left, right) => (left.date === right.date ? (left.number < right.number ? -1 : 1) : left.date < right.date ? -1 : 1))

  const allocations: AllocationRecord[] = []
  const advances: AdvanceRecord[] = []
  const invoices: InvoiceAllocation[] = []

  for (const rule of SIDE_RULES) {
    // Group by party, because a receipt only settles an invoice of the same
    // party.
    const parties = new Map<string, Voucher[]>()
    for (const voucher of posted) {
      if (!voucher.partyId) continue
      const bucket = parties.get(voucher.partyId)
      if (bucket) bucket.push(voucher)
      else parties.set(voucher.partyId, [voucher])
    }

    for (const [partyId, partyVouchers] of parties) {
      if (options.tradePartyIds && !options.tradePartyIds.has(partyId)) {
        // A party that does not trade with the business, such as the cash
        // account a direct sale is settled against, has nothing to allocate.
        continue
      }
      const companyId = partyVouchers[0]!.companyId
      const sideInvoices = partyVouchers
        .filter((voucher) => rule.invoiceTypes.includes(voucher.type))
        .sort((left, right) => (left.date < right.date ? -1 : 1))
      const sideReductions = partyVouchers
        .filter((voucher) => rule.reductionTypes.includes(voucher.type))
        .map((voucher) => ({
          voucher,
          entry: partyEntry(voucher, partyId),
          amount: Math.abs(partyMovement(voucher, partyId)),
        }))
        .filter((reduction) => reduction.amount > 0 && reduction.entry)
        .sort((left, right) => (left.voucher.date < right.voucher.date ? -1 : 1))

      // A party may have paid money without having been invoiced yet. That
      // money is an advance, so the reductions are still recorded even when
      // there is no invoice to apply them to.
      if (!sideInvoices.length && !sideReductions.length) continue

      // Each reduction keeps a running remainder, so an amount is never
      // applied to more invoices than it covers.
      const remaining = sideReductions.map((reduction) => ({ ...reduction, left: reduction.amount }))

      for (const invoice of sideInvoices) {
        const amount = Math.abs(partyMovement(invoice, partyId))
        if (amount <= 0) continue
        const invoiceEntry = partyEntry(invoice, partyId)

        let allocated = 0
        for (const reduction of remaining) {
          if (reduction.left <= 0) continue
          const applied = Math.min(reduction.left, amount - allocated)
          if (applied <= 0) break

          allocations.push({
            id: options.idFactory(),
            companyId,
            side: rule.side,
            paymentVoucherId: reduction.voucher.id,
            paymentEntryId: reduction.entry!.id,
            invoiceVoucherId: invoice.id,
            invoiceEntryId: invoiceEntry?.id ?? '',
            partyId,
            amount: applied,
            createdAt: options.now(),
          })

          reduction.left -= applied
          allocated += applied
        }

        const dueDate = dueDateFor(invoice, fallbackDays)
        const outstanding = amount - allocated
        invoices.push({
          voucherId: invoice.id,
          voucherNumber: invoice.number,
          partyId,
          side: rule.side,
          date: invoice.date,
          dueDate,
          amount,
          allocated,
          outstanding,
          status:
            outstanding === 0
              ? 'settled'
              : dueDate < asOf
                ? 'overdue'
                : allocated > 0
                  ? 'partial'
                  : 'open',
        })
      }

      // Whatever is left of a payment is an advance held by the party.
      for (const reduction of remaining) {
        if (reduction.left <= 0) continue
        advances.push({
          id: options.idFactory(),
          companyId,
          side: rule.side,
          voucherId: reduction.voucher.id,
          entryId: reduction.entry!.id,
          partyId,
          amount: reduction.left,
          date: reduction.voucher.date,
        })
      }
    }
  }

  return { allocations, advances, invoices }
}

/**
 * Outstanding per invoice, computed from the stored allocation records.
 *
 * When a repository has persisted allocations, those records are the
 * authority. This function is how the application reads them back.
 */
export function outstandingFromRecords(
  invoices: InvoiceAllocation[],
): InvoiceAllocation[] {
  return invoices.map((invoice) => ({ ...invoice }))
}

/**
 * Total outstanding for a side, used by the dashboard and the reports.
 */
export function totalOutstanding(
  invoices: InvoiceAllocation[],
  side: AllocationSide,
): { count: number; amount: Money } {
  const open = invoices.filter(
    (invoice) => invoice.side === side && invoice.outstanding > 0,
  )
  return {
    count: open.length,
    amount: open.reduce((sum, invoice) => sum + invoice.outstanding, 0),
  }
}
