/**
 * Orders, and what fulfils them.
 *
 * An order is a promise, not a transaction. It has no financial effect until
 * it is fulfilled, and it has a life of its own: it is written, confirmed,
 * amended, partly delivered and closed. A voucher cannot carry that, so an
 * order is its own record.
 *
 * The rules are written down in `docs/order-and-manufacturing-policy.md`.
 * That document is the specification; when the code and the document
 * disagree, the document is corrected or the code is — never the other way
 * round.
 *
 * Nothing here touches the database. The domain decides what an order means
 * and what may be done to it; the persistence layer stores the result.
 */

import { lineValue } from '@/domain/quantity'
import type { VoucherDraft } from '@/domain/accounting'
import type { Money } from '@/lib/money'
import type {
  Item,
  Order,
  OrderFulfilment,
  OrderKind,
  OrderLine,
  OrderRevision,
  OrderRevisionLine,
  OrderState,
  OrderStatus,
} from '@/domain/types'

export class OrderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OrderError'
  }
}

// ---------------------------------------------------------------------------
// Building an order
// ---------------------------------------------------------------------------

export interface OrderLineInput {
  id?: string
  itemId: string
  /** The ordered quantity, in exact milli-units. */
  quantityMilli: number
  rate: Money
  discount?: Money
  taxCategoryId?: string | null
}

export interface OrderDraft {
  kind: OrderKind
  /** The customer or the supplier. */
  partyId: string
  date: string
  expectedDate?: string | null
  narration?: string
  reference?: string
  paymentTermId?: string | null
  lines: OrderLineInput[]
}

export interface OrderContext {
  companyId: string
  items: Map<string, Item>
  idFactory: () => string
  now: () => string
}

/**
 * Build an order and its lines.
 *
 * The order is a draft until it is confirmed. Building it posts nothing and
 * moves no stock.
 */
export function buildOrder(
  draft: OrderDraft,
  context: OrderContext,
): { order: Order; lines: OrderLine[] } {
  if (!draft.partyId) {
    throw new OrderError('An order must be placed with a customer or a supplier.')
  }
  if (!draft.date) {
    throw new OrderError('An order must carry a date.')
  }
  if (draft.lines.length === 0) {
    throw new OrderError('An order must have at least one line.')
  }

  const now = context.now()
  const orderId = context.idFactory()
  const lines: OrderLine[] = draft.lines.map((line) => {
    if (!Number.isInteger(line.quantityMilli) || line.quantityMilli <= 0) {
      throw new OrderError('An ordered quantity must be a positive whole number of milli-units.')
    }
    if (line.rate < 0) {
      throw new OrderError('An ordered rate cannot be negative.')
    }
    const item = context.items.get(line.itemId)
    if (!item) {
      throw new OrderError('One of the ordered items no longer exists.')
    }
    const discount = line.discount ?? 0
    if (discount < 0) {
      throw new OrderError('A discount cannot be negative.')
    }
    return {
      id: line.id ?? context.idFactory(),
      companyId: context.companyId,
      orderId,
      itemId: line.itemId,
      quantityMilli: line.quantityMilli,
      rate: line.rate,
      discount,
      taxCategoryId: line.taxCategoryId ?? item.taxCategoryId ?? null,
      amount: lineValue(line.quantityMilli, line.rate) - discount,
    }
  })

  const order: Order = {
    id: orderId,
    companyId: context.companyId,
    kind: draft.kind,
    number: '',
    date: draft.date,
    expectedDate: draft.expectedDate ?? null,
    partyId: draft.partyId,
    narration: draft.narration ?? '',
    reference: draft.reference ?? '',
    status: 'draft',
    paymentTermId: draft.paymentTermId ?? null,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  }

  return { order, lines }
}

// ---------------------------------------------------------------------------
// Fulfilment
// ---------------------------------------------------------------------------

export interface OrderLineTotals {
  /** The quantity delivered against the line. */
  fulfilledMilli: number
  /** The quantity still to deliver. */
  remainingMilli: number
  /** The amount delivered against the line. */
  fulfilledAmount: Money
}

/**
 * What has been delivered against each line.
 *
 * The delivered quantity is a sum of the fulfilment rows, never a stored
 * figure, so it cannot drift from the invoices that caused it.
 */
export function orderLineTotals(
  lines: OrderLine[],
  fulfilments: OrderFulfilment[],
): Map<string, OrderLineTotals> {
  const totals = new Map<string, OrderLineTotals>()
  for (const line of lines) {
    totals.set(line.id, {
      fulfilledMilli: 0,
      remainingMilli: line.quantityMilli,
      fulfilledAmount: 0,
    })
  }
  for (const fulfilment of fulfilments) {
    const total = totals.get(fulfilment.orderLineId)
    if (!total) continue
    total.fulfilledMilli += fulfilment.quantityMilli
    total.fulfilledAmount += fulfilment.amount
    total.remainingMilli = Math.max(0, lineQuantity(lines, fulfilment.orderLineId) - total.fulfilledMilli)
  }
  return totals
}

function lineQuantity(lines: OrderLine[], lineId: string): number {
  return lines.find((line) => line.id === lineId)?.quantityMilli ?? 0
}

/**
 * The state of an order, derived from what has been delivered.
 *
 * Only the header state is stored. The fulfilment state is read from the
 * fulfilment rows every time, so a stored copy cannot disagree with the
 * invoices that caused it.
 */
export function deriveOrderState(
  order: Order,
  lines: OrderLine[],
  fulfilments: OrderFulfilment[],
): OrderState {
  if (order.status === 'cancelled') return 'cancelled'
  if (order.status === 'draft') return 'draft'

  const totals = orderLineTotals(lines, fulfilments)
  let complete = lines.length > 0
  for (const line of lines) {
    const total = totals.get(line.id)
    if (!total || total.fulfilledMilli < line.quantityMilli) {
      complete = false
      break
    }
  }
  const anyFulfilled = fulfilments.length > 0
  if (complete) return 'fulfilled'
  if (anyFulfilled) return 'partially-fulfilled'
  return 'open'
}

/**
 * The state an order header may hold.
 *
 * The derived state is never stored, so an order header is only ever in one
 * of these three.
 */
export function isOrderStatus(value: string): value is OrderStatus {
  return value === 'draft' || value === 'confirmed' || value === 'cancelled'
}

// ---------------------------------------------------------------------------
// Confirming, cancelling and amending
// ---------------------------------------------------------------------------

export function confirmOrder(order: Order, now: string): Order {
  if (order.status === 'cancelled') {
    throw new OrderError('A cancelled order cannot be confirmed.')
  }
  if (order.status === 'confirmed') {
    throw new OrderError('This order has already been confirmed.')
  }
  return { ...order, status: 'confirmed', revision: order.revision + 1, updatedAt: now }
}

export function cancelOrder(
  order: Order,
  fulfilments: OrderFulfilment[],
  now: string,
): Order {
  if (order.status === 'cancelled') {
    throw new OrderError('This order has already been cancelled.')
  }
  if (fulfilments.length > 0) {
    throw new OrderError(
      'This order has already been delivered against, so it cannot be cancelled. ' +
        'Cancel or credit the invoice first, then cancel the order.',
    )
  }
  return { ...order, status: 'cancelled', revision: order.revision + 1, updatedAt: now }
}

export interface OrderAmendment {
  order: Order
  lines: OrderLine[]
  /** The lines as they stood before the amendment, kept in the history. */
  previousLines: OrderLine[]
  reason: string
}

/**
 * Prepare an amendment to a confirmed order.
 *
 * The amendment may change a quantity, a rate or a discount, and it may add
 * lines. It may not remove a line that has been delivered against, change
 * what a line is, or reduce a line below what has already been delivered. It
 * requires a reason, and the previous lines are kept in the order history.
 */
export function prepareOrderAmendment(
  order: Order,
  lines: OrderLine[],
  fulfilments: OrderFulfilment[],
  amendment: { lines: OrderLineInput[]; reason: string },
  context: OrderContext,
): OrderAmendment {
  if (order.status === 'cancelled') {
    throw new OrderError('A cancelled order cannot be amended.')
  }
  if (order.status === 'draft') {
    throw new OrderError('A draft order is edited directly rather than amended.')
  }
  if (!amendment.reason.trim()) {
    throw new OrderError('An amendment needs a reason, so that the history says why.')
  }
  if (amendment.lines.length === 0) {
    throw new OrderError('An order must have at least one line.')
  }

  const totals = orderLineTotals(lines, fulfilments)
  const previous = new Map(lines.map((line) => [line.id, line]))
  const next: OrderLine[] = amendment.lines.map((line) => {
    const existing = line.id ? previous.get(line.id) : undefined
    if (line.id && !existing) {
      throw new OrderError('One of the amended lines is not part of this order.')
    }
    if (existing && existing.itemId !== line.itemId) {
      throw new OrderError('The item on a line cannot be changed by an amendment.')
    }
    if (!Number.isInteger(line.quantityMilli) || line.quantityMilli <= 0) {
      throw new OrderError('An ordered quantity must be a positive whole number of milli-units.')
    }
    const discount = line.discount ?? 0
    if (discount < 0) {
      throw new OrderError('A discount cannot be negative.')
    }
    const item = context.items.get(line.itemId)
    if (!item) {
      throw new OrderError('One of the ordered items no longer exists.')
    }
    const lineId = line.id ?? context.idFactory()
    const delivered = totals.get(lineId)?.fulfilledMilli ?? 0
    if (line.quantityMilli < delivered) {
      throw new OrderError(
        'An ordered quantity cannot be reduced below the quantity already delivered.',
      )
    }
    return {
      id: lineId,
      companyId: context.companyId,
      orderId: order.id,
      itemId: line.itemId,
      quantityMilli: line.quantityMilli,
      rate: line.rate,
      discount,
      taxCategoryId: line.taxCategoryId ?? item.taxCategoryId ?? null,
      amount: lineValue(line.quantityMilli, line.rate) - discount,
    }
  })

  // A line that has been delivered against must still be there.
  for (const fulfilment of fulfilments) {
    if (!next.some((line) => line.id === fulfilment.orderLineId)) {
      throw new OrderError(
        'A line that has been delivered against cannot be removed from the order.',
      )
    }
  }

  return {
    order: { ...order, revision: order.revision + 1, updatedAt: context.now() },
    lines: next,
    previousLines: lines,
    reason: amendment.reason.trim(),
  }
}

/**
 * The history record of an amendment.
 *
 * The lines are snapshotted as they stood, so the previous quantities are not
 * deleted when the order changes.
 */
export function buildOrderRevision(
  order: Order,
  amendment: OrderAmendment,
  context: OrderContext & { actor: string },
): { revision: OrderRevision; lines: OrderRevisionLine[] } {
  const revisionId = context.idFactory()
  const revision: OrderRevision = {
    id: revisionId,
    companyId: context.companyId,
    orderId: order.id,
    revision: order.revision,
    reason: amendment.reason,
    actor: context.actor,
    createdAt: context.now(),
  }
  const lines: OrderRevisionLine[] = amendment.previousLines.map((line) => ({
    id: context.idFactory(),
    companyId: context.companyId,
    revisionId,
    orderLineId: line.id,
    itemId: line.itemId,
    quantityMilli: line.quantityMilli,
    rate: line.rate,
    discount: line.discount,
    taxCategoryId: line.taxCategoryId,
    amount: line.amount,
  }))
  return { revision, lines }
}

// ---------------------------------------------------------------------------
// Turning an order into an invoice
// ---------------------------------------------------------------------------

export interface OrderConversionContext extends OrderContext {
  /** The date the invoice is raised on. */
  today: string
}

/**
 * Prepare the invoice or purchase voucher for what is left of an order.
 *
 * The order's party, items, remaining quantities, rates, discounts and tax
 * treatment are carried across. The draft is editable afterwards, and the
 * check that nothing is delivered beyond the order is applied again when the
 * voucher is posted.
 */
export function prepareOrderConversion(
  order: Order,
  lines: OrderLine[],
  fulfilments: OrderFulfilment[],
  context: OrderConversionContext,
): VoucherDraft {
  if (order.status === 'cancelled') {
    throw new OrderError('A cancelled order cannot be invoiced.')
  }
  if (order.status === 'draft') {
    throw new OrderError('Confirm the order before invoicing it.')
  }

  const totals = orderLineTotals(lines, fulfilments)
  const items = lines
    .map((line) => {
      const remaining = totals.get(line.id)?.remainingMilli ?? 0
      if (remaining <= 0) return null
      const item = context.items.get(line.itemId)
      if (!item) {
        throw new OrderError('One of the ordered items no longer exists.')
      }
      return {
        itemId: line.itemId,
        quantityMilli: remaining,
        rate: line.rate,
        discount: line.discount,
        taxCategoryId: line.taxCategoryId,
        orderLineId: line.id,
      }
    })
    .filter((line): line is NonNullable<typeof line> => line !== null)

  if (items.length === 0) {
    throw new OrderError('Everything on this order has already been delivered.')
  }

  return {
    type: order.kind === 'sales' ? 'sales' : 'purchase',
    date: context.today,
    partyId: order.partyId,
    narration: order.narration,
    reference: order.number,
    status: 'draft',
    items,
  }
}

/**
 * Prepare the fulfilment rows a posted voucher creates.
 *
 * The rows are written in the same transaction as the voucher, so an invoice
 * can never exist without the delivery it records, and a delivery can never
 * exist without its invoice.
 */
export function prepareOrderFulfilments(
  voucherLines: Array<{ id: string; itemId: string; quantityMilli: number; amount: Money; orderLineId?: string | null }>,
  order: Order,
  orderLines: OrderLine[],
  existing: OrderFulfilment[],
  context: { companyId: string; idFactory: () => string; now: () => string },
): OrderFulfilment[] {
  const fulfilments: OrderFulfilment[] = []
  const delivered = new Map<string, number>()
  for (const fulfilment of existing) {
    delivered.set(
      fulfilment.orderLineId,
      (delivered.get(fulfilment.orderLineId) ?? 0) + fulfilment.quantityMilli,
    )
  }

  for (const line of voucherLines) {
    if (!line.orderLineId) continue
    const orderLine = orderLines.find((candidate) => candidate.id === line.orderLineId)
    if (!orderLine) {
      throw new OrderError('One of the invoice lines names a line that is not on the order.')
    }
    if (orderLine.orderId !== order.id) {
      throw new OrderError('One of the invoice lines names a line of another order.')
    }
    if (line.quantityMilli <= 0) {
      throw new OrderError('A delivered quantity must be positive.')
    }
    const already = delivered.get(line.orderLineId) ?? 0
    if (already + line.quantityMilli > orderLine.quantityMilli) {
      throw new OrderError(
        'The invoice delivers more than the order remains. ' +
          `The order line carries ${orderLine.quantityMilli} milli-units and ` +
          `${already} have already been delivered.`,
      )
    }
    delivered.set(line.orderLineId, already + line.quantityMilli)
    fulfilments.push({
      id: context.idFactory(),
      companyId: context.companyId,
      orderId: order.id,
      orderLineId: line.orderLineId,
      voucherId: '',
      voucherItemId: line.id,
      quantityMilli: line.quantityMilli,
      amount: line.amount,
      createdAt: context.now(),
    })
  }

  return fulfilments
}
