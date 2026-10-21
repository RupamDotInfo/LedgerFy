/**
 * The figures an order register and an order detail show.
 *
 * Every figure here is derived: the state comes from `deriveOrderState`, the
 * delivered quantities and amounts from `orderLineTotals`. Nothing is read
 * from a stored total, so a screen cannot show a figure that disagrees with
 * the deliveries behind it.
 */

import { deriveOrderState, orderLineTotals } from '@/domain/orders'
import type { Order, OrderFulfilment, OrderLine, OrderState } from '@/domain/types'

/** The tone a badge carries for each derived state. */
export type OrderStateTone = 'neutral' | 'info' | 'warning' | 'positive' | 'danger'

/** The label a badge carries for each derived state. */
export const ORDER_STATE_LABEL: Record<OrderState, string> = {
  draft: 'Draft',
  open: 'Open',
  'partially-fulfilled': 'Partly delivered',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
}

/** The tone a badge carries for each derived state. */
export const ORDER_STATE_TONE: Record<OrderState, OrderStateTone> = {
  draft: 'neutral',
  open: 'info',
  'partially-fulfilled': 'warning',
  fulfilled: 'positive',
  cancelled: 'danger',
}

/** The Material Symbols icon that goes with each derived state. */
export const ORDER_STATE_ICON: Record<OrderState, string> = {
  draft: 'edit_note',
  open: 'pending_actions',
  'partially-fulfilled': 'local_shipping',
  fulfilled: 'task_alt',
  cancelled: 'cancel',
}

export interface OrderFigures {
  /** The derived state of the order. */
  state: OrderState
  stateLabel: string
  stateTone: OrderStateTone
  stateIcon: string
  /** The value of what was ordered. */
  orderedValue: number
  /** The value of what has been delivered. */
  deliveredValue: number
  /** The value of what is still to be delivered. */
  remainingValue: number
  /** The number of deliveries recorded against the order. */
  deliveryCount: number
}

/** The figures of one order, derived from its lines and its deliveries. */
export function orderFigures(
  order: Order,
  lines: OrderLine[],
  fulfilments: OrderFulfilment[],
): OrderFigures {
  const state = deriveOrderState(order, lines, fulfilments)
  const totals = orderLineTotals(lines, fulfilments)
  const orderedValue = lines.reduce((sum, line) => sum + line.amount, 0)
  const deliveredValue = lines.reduce(
    (sum, line) => sum + (totals.get(line.id)?.fulfilledAmount ?? 0),
    0,
  )
  return {
    state,
    stateLabel: ORDER_STATE_LABEL[state],
    stateTone: ORDER_STATE_TONE[state],
    stateIcon: ORDER_STATE_ICON[state],
    orderedValue,
    deliveredValue,
    remainingValue: orderedValue - deliveredValue,
    deliveryCount: fulfilments.length,
  }
}
