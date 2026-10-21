/**
 * Preparing a posting.
 *
 * The domain decides what a transaction means. This module turns a voucher
 * into the complete set of records it implies — entries, tax lines, the
 * bill-wise allocations it settles, the stock movements it causes and the
 * audit event that explains it — so the persistence layer can commit all of
 * it in one transaction, or none of it.
 *
 * Nothing here touches the database, and nothing here is a rule that lives
 * anywhere else.
 */

import { buildAllocationLedger, type AdvanceRecord, type AllocationRecord } from '@/domain/allocations'
import { prepareOrderFulfilments } from '@/domain/orders'
import {
  buildVoucher,
  hasBlockingIssues,
  validateVoucher,
  type VoucherContext,
  type VoucherIssue,
} from '@/domain/accounting'
import {
  planInventoryPosting,
  planStockReversal,
  type InventoryContext,
  type PlannedMovement,
} from '@/domain/inventory'
import type {
  AuditEvent,
  Order,
  OrderFulfilment,
  OrderLine,
  ProductionCompletion,
  ProductionIssue,
  StockLocationBalance,
  StockPoolBalance,
  Voucher,
} from '@/domain/types'

export interface PostingContext extends Omit<VoucherContext, 'nextId'> {
  /** Every voucher already in the company, used to work out allocations. */
  existingVouchers: Voucher[]
  /** The party the voucher was previously against, when it is being edited. */
  previousPartyId?: string | null
  /** The periods that are closed, which no voucher may be posted into. */
  closedPeriods?: Array<{ from: string; to: string; label: string }>
  /**
   * The inventory context, when the company has inventory activated.
   * Without it, the voucher keeps its existing periodic treatment.
   */
  inventory?: InventoryContext
  /**
   * The order the voucher delivers against, when its lines name order
   * lines. It carries the order, its lines and what has already been
   * delivered, so that the fulfilment can be checked before anything is
   * written.
   */
  orderContext?: {
    order: Order
    lines: OrderLine[]
    fulfilments: OrderFulfilment[]
  }
  actor: string
  idFactory: () => string
  now: () => string
}

export interface PostingPackage {
  voucher: Voucher
  entries: Voucher['entries']
  items: Voucher['items']
  taxes: Voucher['taxes']
  /** Allocation records for the affected parties, replacing whatever was stored. */
  allocations: AllocationRecord[]
  /** Unallocated payments held by the affected parties. */
  advances: AdvanceRecord[]
  /** The parties whose stored allocations must be replaced. */
  affectedPartyIds: string[]
  /** The stock movements the voucher causes. */
  movements: PlannedMovement[]
  /** The costing pools after the voucher. */
  stockPools: StockPoolBalance[]
  /** The location balances after the voucher. */
  stockLocations: StockLocationBalance[]
  /** What the voucher delivered against the order it came from. */
  orderFulfilments: OrderFulfilment[]
  /** The materials the voucher issued to production. */
  productionIssues: ProductionIssue[]
  /** The finished goods the voucher received from production. */
  productionCompletions: ProductionCompletion[]
  auditEvents: AuditEvent[]
}

export class PostingError extends Error {
  readonly issues: VoucherIssue[]

  constructor(message: string, issues: VoucherIssue[]) {
    super(message)
    this.name = 'PostingError'
    this.issues = issues
  }
}

/**
 * Prepare the records a voucher implies.
 *
 * Throws a `PostingError` with the specific problems when the voucher is not
 * fit to post. A draft never goes through here: a draft has no financial
 * effect, so it must not allocate anything or move any stock.
 */
export function preparePosting(draft: Voucher, context: PostingContext): PostingPackage {
  const issues = validateVoucher(draft, {
    ledgers: context.ledgers,
    taxCategories: context.taxCategories,
    closedPeriods: context.closedPeriods ?? [],
  })

  if (hasBlockingIssues(issues)) {
    throw new PostingError('This voucher cannot be posted yet.', issues)
  }

  const built = buildVoucher(
    {
      type: draft.type,
      date: draft.date,
      partyId: draft.partyId,
      narration: draft.narration,
      reference: draft.reference,
      status: 'posted',
      items: draft.items.map((item) => ({
        id: item.id,
        itemId: item.itemId,
        quantityMilli: item.quantityMilli,
        rate: item.rate,
        discount: item.discount,
        directCost: item.directCost,
        taxCategoryId: item.taxCategoryId,
        godownId: item.godownId,
        toGodownId: item.toGodownId,
        orderLineId: item.orderLineId,
        productionRequirementId: item.productionRequirementId,
      })),
    },
    { ...context, nextId: context.idFactory },
  )

  // Carry the identity and the terms of the draft onto the posted voucher.
  const identified: Voucher = {
    ...built,
    id: draft.id,
    number: draft.number,
    createdAt: draft.createdAt,
    updatedAt: context.now(),
    dueDate: draft.dueDate ?? null,
    paymentTermId: draft.paymentTermId ?? null,
    linkedVoucherId: draft.linkedVoucherId ?? null,
    reversedByVoucherId: draft.reversedByVoucherId ?? null,
    isLocked: draft.isLocked,
    status: 'posted',
  }

  // The inventory consequences, when the company has inventory activated.
  let voucher = identified
  let movements: PlannedMovement[] = []
  let stockPools: StockPoolBalance[] = []
  let stockLocations: StockLocationBalance[] = []

  if (context.inventory) {
    const plan = planInventoryPosting(identified, context.inventory)
    voucher = plan.voucher
    movements = plan.movements
    stockPools = [...plan.pools.values()].map((pool) => ({
      companyId: context.companyId,
      itemId: pool.itemId,
      quantityMilli: pool.quantityMilli,
      carryingValue: pool.carryingValue,
      revision: pool.revision,
      updatedAt: context.now(),
    }))
    stockLocations = [...plan.locations.values()].map((location) => ({
      companyId: context.companyId,
      itemId: location.itemId,
      godownId: location.godownId,
      quantityMilli: location.quantityMilli,
      revision: location.revision,
      updatedAt: context.now(),
    }))
  }

  // The stock the invoice delivers against the order it came from.
  //
  // The fulfilment rows are written in the same transaction as the voucher's
  // entries and its stock movements, so an invoice can never exist without
  // the delivery it records.
  let orderFulfilments: OrderFulfilment[] = []
  const namesOrderLines = draft.items.some((item) => Boolean(item.orderLineId))
  if (namesOrderLines) {
    if (!context.orderContext) {
      throw new PostingError(
        'This voucher delivers against an order that could not be found.',
        [],
      )
    }
    orderFulfilments = prepareOrderFulfilments(
      draft.items,
      context.orderContext.order,
      context.orderContext.lines,
      context.orderContext.fulfilments,
      {
        companyId: context.companyId,
        idFactory: context.idFactory,
        now: context.now,
      },
    ).map((fulfilment) => ({ ...fulfilment, voucherId: identified.id }))
  }

  // Allocations are recomputed over the whole book so that an advance
  // received earlier settles an invoice raised later, and so that a cancelled
  // invoice releases the money that had been applied to it.
  const affectedPartyIds = new Set<string>()
  if (draft.partyId) affectedPartyIds.add(draft.partyId)
  if (context.previousPartyId) affectedPartyIds.add(context.previousPartyId)

  const others = context.existingVouchers.filter((existing) => existing.id !== draft.id)
  const tradePartyIds = new Set(
    context.ledgers
      .filter((ledger) => ledger.partyKind === 'customer' || ledger.partyKind === 'supplier')
      .map((ledger) => ledger.id),
  )
  const ledger = buildAllocationLedger([...others, voucher], {
    idFactory: context.idFactory,
    now: context.now,
    tradePartyIds,
  })

  const allocations = ledger.allocations.filter((allocation) =>
    affectedPartyIds.has(partyOf(ledger, allocation)),
  )
  const advances = ledger.advances.filter((advance) => affectedPartyIds.has(advance.partyId))

  const auditEvent: AuditEvent = {
    id: context.idFactory(),
    companyId: draft.companyId,
    actor: context.actor,
    action: 'voucher.posted',
    recordType: 'voucher',
    recordId: voucher.id,
    recordLabel: `${voucher.number} — ${voucher.narration}`,
    timestamp: voucher.updatedAt,
    detail: `${voucher.type} voucher dated ${voucher.date} posted`,
  }

  return {
    voucher,
    entries: voucher.entries,
    items: voucher.items,
    taxes: voucher.taxes,
    allocations,
    advances,
    affectedPartyIds: [...affectedPartyIds],
    movements,
    stockPools,
    stockLocations,
    orderFulfilments,
    productionIssues: [],
    productionCompletions: [],
    auditEvents: [auditEvent],
  }
}

function partyOf(
  ledger: { invoices: Array<{ voucherId: string; partyId: string }> },
  allocation: AllocationRecord,
): string {
  const invoice = ledger.invoices.find(
    (candidate) => candidate.voucherId === allocation.invoiceVoucherId,
  )
  return invoice?.partyId ?? ''
}

/**
 * Prepare the records a cancellation implies.
 *
 * Cancelling a voucher withdraws the allocations and movements it created, so
 * the outstanding balances of the other invoices of that party are restored.
 *
 * The stock the voucher moved is given back by compensating movements, in the
 * same transaction as the cancellation, so the stock on hand and the general
 * ledger still agree afterwards. A cancellation that would change a cost that
 * has already been reported is refused, and the message names the corrective
 * workflow.
 */
export function prepareCancellation(
  voucher: Voucher,
  context: PostingContext,
): PostingPackage {
  const cancelled: Voucher = { ...voucher, status: 'cancelled', updatedAt: context.now() }

  // The stock the voucher moved is given back by compensating movements.
  let movements: PlannedMovement[] = []
  let stockPools: StockPoolBalance[] = []
  let stockLocations: StockLocationBalance[] = []

  if (context.inventory) {
    const reversal = planStockReversal(cancelled, context.inventory)
    movements = reversal.movements
    stockPools = [...reversal.pools.values()].map((pool) => ({
      companyId: context.companyId,
      itemId: pool.itemId,
      quantityMilli: pool.quantityMilli,
      carryingValue: pool.carryingValue,
      revision: pool.revision,
      updatedAt: context.now(),
    }))
    stockLocations = [...reversal.locations.values()].map((location) => ({
      companyId: context.companyId,
      itemId: location.itemId,
      godownId: location.godownId,
      quantityMilli: location.quantityMilli,
      revision: location.revision,
      updatedAt: context.now(),
    }))
  }

  const others = context.existingVouchers.filter((candidate) => candidate.id !== voucher.id)
  const ledger = buildAllocationLedger(others, {
    idFactory: context.idFactory,
    now: context.now,
  })

  const affectedPartyIds = new Set<string>()
  if (voucher.partyId) affectedPartyIds.add(voucher.partyId)

  const allocations = ledger.allocations.filter((allocation) =>
    affectedPartyIds.has(partyOf(ledger, allocation)),
  )
  const advances = ledger.advances.filter((advance) => affectedPartyIds.has(advance.partyId))

  const auditEvent: AuditEvent = {
    id: context.idFactory(),
    companyId: voucher.companyId,
    actor: context.actor,
    action: 'voucher.cancelled',
    recordType: 'voucher',
    recordId: voucher.id,
    recordLabel: `${voucher.number} — ${voucher.narration}`,
    timestamp: cancelled.updatedAt,
    detail: `${voucher.type} voucher dated ${voucher.date} cancelled`,
  }

  return {
    voucher: cancelled,
    entries: cancelled.entries,
    items: cancelled.items,
    taxes: cancelled.taxes,
    allocations,
    advances,
    affectedPartyIds: [...affectedPartyIds],
    movements,
    stockPools,
    stockLocations,
    orderFulfilments: [],
    productionIssues: [],
    productionCompletions: [],
    auditEvents: [auditEvent],
  }
}
