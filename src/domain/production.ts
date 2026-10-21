/**
 * Bills of materials and discrete manufacturing.
 *
 * A bill of materials says what a finished item is made of. A production
 * order says: make this many of this item, from this structure. The
 * materials are issued from stock at the moving weighted-average cost that
 * `docs/inventory-accounting-policy.md` already defines, and the finished
 * goods are received at the cost of the materials that were issued.
 *
 * The rules are written down in `docs/order-and-manufacturing-policy.md`.
 * That document is the specification; when the code and the document
 * disagree, the document is corrected or the code is — never the other way
 * round.
 *
 * Nothing here touches the database, and nothing here re-implements the
 * costing. The inventory engine is the only authority for what a movement
 * costs.
 */

import { divideRounded, lineValue } from '@/domain/quantity'
import {
  planStockIssue,
  VALUATION_METHOD,
  type InventoryContext,
  type PlannedMovement,
  type StockPool,
} from '@/domain/inventory'
import type { Money } from '@/lib/money'
import type {
  Bom,
  BomLine,
  Item,
  ProductionCompletion,
  ProductionIssue,
  ProductionOrder,
  ProductionOrderState,
  ProductionOrderStatus,
  ProductionRequirement,
  Voucher,
  VoucherEntry,
  VoucherItemLine,
} from '@/domain/types'

export class ProductionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductionError'
  }
}

// ---------------------------------------------------------------------------
// The bill of materials
// ---------------------------------------------------------------------------

export interface BomLineInput {
  id?: string
  itemId: string
  /** The quantity required per the BOM's output quantity, in milli-units. */
  quantityMilli: number
  /**
   * How many milli-units of the component's stock unit one unit of the
   * stated quantity is worth. One thousand is one to one.
   */
  conversionMilli?: number
}

export interface BomDraft {
  /** The item the structure produces. */
  itemId: string
  /** How many units of the finished item the structure makes. */
  outputQuantityMilli: number
  effectiveFrom?: string | null
  narration?: string
  lines: BomLineInput[]
}

export interface BomContext {
  companyId: string
  items: Map<string, Item>
  /**
   * Every released structure of the company, with its components.
   *
   * The components are needed for the cycle check: a structure that would
   * make itself, directly or through another structure, has to be found
   * whichever structure in the cycle is being written.
   */
  releasedBoms: ReleasedStructure[]
  idFactory: () => string
  now: () => string
}

/** A released structure and the components it names. */
export interface ReleasedStructure {
  bom: Bom
  lines: BomLine[]
}

/**
 * Build a bill of materials and its component lines.
 *
 * A structure that would consume itself, directly or through other
 * structures, is refused: the components would have to be made from
 * themselves.
 */
export function buildBom(
  draft: BomDraft,
  context: BomContext,
): { bom: Bom; lines: BomLine[] } {
  if (!draft.itemId) {
    throw new ProductionError('A bill of materials must say which item it makes.')
  }
  if (!Number.isInteger(draft.outputQuantityMilli) || draft.outputQuantityMilli <= 0) {
    throw new ProductionError('The output quantity must be a positive whole number of milli-units.')
  }
  if (draft.lines.length === 0) {
    throw new ProductionError('A bill of materials must have at least one component.')
  }
  if (!context.items.get(draft.itemId)) {
    throw new ProductionError('The item this structure makes no longer exists.')
  }

  const now = context.now()
  const bomId = context.idFactory()
  const lines: BomLine[] = draft.lines.map((line) => {
    if (!Number.isInteger(line.quantityMilli) || line.quantityMilli <= 0) {
      throw new ProductionError('A component quantity must be a positive whole number of milli-units.')
    }
    const conversionMilli = line.conversionMilli ?? 1000
    if (!Number.isInteger(conversionMilli) || conversionMilli <= 0) {
      throw new ProductionError('A unit conversion must be a positive whole number.')
    }
    if (!context.items.get(line.itemId)) {
      throw new ProductionError('One of the components no longer exists.')
    }
    if (line.itemId === draft.itemId) {
      throw new ProductionError('A structure cannot list the item it makes as its own component.')
    }
    return {
      id: line.id ?? context.idFactory(),
      companyId: context.companyId,
      bomId,
      itemId: line.itemId,
      quantityMilli: line.quantityMilli,
      conversionMilli,
      createdAt: now,
    }
  })

  assertNoComponentCycle(draft.itemId, lines, context)

  const bom: Bom = {
    id: bomId,
    companyId: context.companyId,
    itemId: draft.itemId,
    version: 1,
    outputQuantityMilli: draft.outputQuantityMilli,
    status: 'draft',
    effectiveFrom: draft.effectiveFrom ?? null,
    narration: draft.narration ?? '',
    createdAt: now,
    updatedAt: now,
  }

  return { bom, lines }
}

/**
 * Refuse a structure whose components would have to be made from themselves.
 *
 * The check walks the released structures of the company, so a cycle is found
 * whichever structure in the cycle is being written.
 */
export function assertNoComponentCycle(
  itemId: string,
  lines: BomLine[],
  context: BomContext,
): void {
  const componentsOf = new Map<string, string[]>()
  for (const structure of context.releasedBoms) {
    componentsOf.set(
      structure.bom.itemId,
      structure.lines.map((line) => line.itemId),
    )
  }
  componentsOf.set(itemId, lines.map((line) => line.itemId))

  const path: string[] = []
  const seen = new Set<string>()

  const walk = (current: string): boolean => {
    if (seen.has(current)) return true
    seen.add(current)
    path.push(current)
    for (const component of componentsOf.get(current) ?? []) {
      if (walk(component)) return true
    }
    path.pop()
    return false
  }

  if (walk(itemId)) {
    const cycle = [...path, path[0] ?? itemId].join(' → ')
    throw new ProductionError(`The components form a cycle: ${cycle}.`)
  }
}

/**
 * The quantity of a component needed for a given output, exactly.
 *
 * The requirement is stated per the structure's output quantity, so the
 * quantity for a whole production order is the requirement times the planned
 * output, divided by the output the structure makes, and then converted into
 * the component's own stock unit. The arithmetic is exact: half a milli-unit
 * goes away from zero.
 */
export function requiredQuantityMilli(
  requirementQuantityMilli: number,
  conversionMilli: number,
  plannedQuantityMilli: number,
  outputQuantityMilli: number,
): number {
  if (outputQuantityMilli <= 0) {
    throw new ProductionError('The output quantity of a structure must be positive.')
  }
  const numerator =
    BigInt(requirementQuantityMilli) * BigInt(plannedQuantityMilli) * BigInt(conversionMilli)
  const denominator = BigInt(outputQuantityMilli) * BigInt(1000)
  let result = numerator / denominator
  const remainder = numerator % denominator
  if (remainder * 2n >= denominator) result += 1n
  return Number(result)
}

// ---------------------------------------------------------------------------
// The production order
// ---------------------------------------------------------------------------

export interface ProductionOrderDraft {
  /** The item being made. */
  itemId: string
  bomId: string
  /** How many units are to be made. */
  plannedQuantityMilli: number
  godownId: string
  plannedAt: string
  narration?: string
}

export interface ProductionOrderContext {
  companyId: string
  items: Map<string, Item>
  idFactory: () => string
  now: () => string
}

/**
 * Build a production order.
 *
 * The order is a draft until it is released. Releasing it snapshots the
 * structure, so a later revision of the structure cannot change an order
 * that is already under way.
 */
export function buildProductionOrder(
  draft: ProductionOrderDraft,
  context: ProductionOrderContext,
): ProductionOrder {
  if (!draft.itemId) {
    throw new ProductionError('A production order must say which item is being made.')
  }
  if (!Number.isInteger(draft.plannedQuantityMilli) || draft.plannedQuantityMilli <= 0) {
    throw new ProductionError('The planned quantity must be a positive whole number of milli-units.')
  }
  if (!draft.godownId) {
    throw new ProductionError('A production order must say where the finished goods are received.')
  }
  if (!context.items.get(draft.itemId)) {
    throw new ProductionError('The item being made no longer exists.')
  }

  const now = context.now()
  return {
    id: context.idFactory(),
    companyId: context.companyId,
    number: '',
    itemId: draft.itemId,
    bomId: draft.bomId,
    bomVersion: 0,
    plannedQuantityMilli: draft.plannedQuantityMilli,
    status: 'draft',
    godownId: draft.godownId,
    plannedAt: draft.plannedAt,
    narration: draft.narration ?? '',
    revision: 1,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * The requirements of a production order, snapshotted from the structure.
 */
export function buildProductionRequirements(
  order: ProductionOrder,
  bom: Bom,
  bomLines: BomLine[],
  context: ProductionOrderContext,
): ProductionRequirement[] {
  if (bom.status !== 'released') {
    throw new ProductionError('A production order can only be released against a released structure.')
  }
  if (bomLines.length === 0) {
    throw new ProductionError('The structure has no components, so nothing would be produced.')
  }
  return bomLines.map((line) => ({
    id: context.idFactory(),
    companyId: context.companyId,
    productionOrderId: order.id,
    itemId: line.itemId,
    requirementQuantityMilli: line.quantityMilli,
    conversionMilli: line.conversionMilli,
    requiredQuantityMilli: requiredQuantityMilli(
      line.quantityMilli,
      line.conversionMilli,
      order.plannedQuantityMilli,
      bom.outputQuantityMilli,
    ),
    issuedQuantityMilli: 0,
    createdAt: context.now(),
  }))
}

/**
 * The state of a production order, derived from what has been issued and
 * received.
 *
 * The records are the truth. The stored header state agrees with them, and
 * where they disagree the records win.
 */
export function deriveProductionState(
  order: ProductionOrder,
  issues: ProductionIssue[],
  completions: ProductionCompletion[],
): ProductionOrderState {
  if (order.status === 'cancelled') return 'cancelled'
  if (order.status === 'draft') return 'draft'
  if (completions.length > 0 || order.status === 'completed') return 'completed'
  if (issues.length > 0) return 'in-production'
  return 'released'
}

export function isProductionStatus(value: string): value is ProductionOrderStatus {
  return (
    value === 'draft' || value === 'released' || value === 'completed' || value === 'cancelled'
  )
}

// ---------------------------------------------------------------------------
// Issuing materials
// ---------------------------------------------------------------------------

export interface ProductionIssueInput {
  requirementId: string
  itemId: string
  godownId: string
  /** How much of the component is issued, in exact milli-units. */
  quantityMilli: number
}

export interface ProductionPostingContext {
  companyId: string
  items: Map<string, Item>
  /** The inventory context, which carries the pools and the costing. */
  inventory: InventoryContext
  /** The work in progress account, which carries the cost until completion. */
  productionLedgerId: string
  idFactory: () => string
  now: () => string
  today: string
}

export interface ProductionIssuePlan {
  voucher: Voucher
  movements: PlannedMovement[]
  entries: VoucherEntry[]
  issues: ProductionIssue[]
  pools: Map<string, StockPool>
}

/**
 * Plan the issue of materials against a production order.
 *
 * The components are consumed at their current moving weighted-average
 * cost, exactly as any other issue is. The cost is not a debit to cost of
 * goods sold: it goes to work in progress, and only reaches the inventory
 * asset when the finished goods are received.
 */
export function planProductionIssue(
  order: ProductionOrder,
  requirements: ProductionRequirement[],
  inputs: ProductionIssueInput[],
  context: ProductionPostingContext,
): ProductionIssuePlan {
  if (order.status === 'cancelled') {
    throw new ProductionError('A cancelled production order cannot be issued against.')
  }
  if (order.status === 'draft') {
    throw new ProductionError('Release the production order before issuing materials against it.')
  }
  if (inputs.length === 0) {
    throw new ProductionError('Choose the components to issue.')
  }

  const voucherId = context.idFactory()
  const now = context.now()
  const items: VoucherItemLine[] = []
  const movements: PlannedMovement[] = []
  const issues: ProductionIssue[] = []
  const pools = new Map(context.inventory.pools)

  for (const input of inputs) {
    const requirement = requirements.find((candidate) => candidate.id === input.requirementId)
    if (!requirement) {
      throw new ProductionError('One of the components is not a requirement of this production order.')
    }
    if (requirement.itemId !== input.itemId) {
      throw new ProductionError('One of the components does not match the requirement it was chosen for.')
    }
    if (!Number.isInteger(input.quantityMilli) || input.quantityMilli <= 0) {
      throw new ProductionError('An issued quantity must be a positive whole number of milli-units.')
    }
    const issued = requirement.issuedQuantityMilli + input.quantityMilli
    if (issued > requirement.requiredQuantityMilli) {
      throw new ProductionError(
        'Issuing this much would exceed what the structure requires. ' +
          `The requirement is ${requirement.requiredQuantityMilli} milli-units and ` +
          `${requirement.issuedQuantityMilli} have already been issued.`,
      )
    }

    // The costing is the inventory engine's, not this module's.
    const working: InventoryContext = { ...context.inventory, pools }
    const plan = planStockIssue(working, {
      // The movement names the voucher that carries the issue, so the two are
      // never separated.
      id: voucherId,
      companyId: context.companyId,
      type: 'stock-journal',
      number: '',
      date: context.today,
      dueDate: null,
      paymentTermId: null,
      partyId: null,
      narration: '',
      reference: '',
      status: 'posted',
      entries: [],
      items: [],
      taxes: [],
      linkedVoucherId: null,
      reversedByVoucherId: null,
      isLocked: false,
      createdAt: now,
      updatedAt: now,
    }, {
      id: context.idFactory(),
      itemId: input.itemId,
      quantityMilli: input.quantityMilli,
      rate: 0,
      discount: 0,
      taxCategoryId: null,
      amount: 0,
      godownId: input.godownId,
      productionRequirementId: requirement.id,
    })

    const movement = plan.movements[0]!
    movements.push(movement)
    pools.set(plan.pool.itemId, plan.pool)

    const itemId = context.idFactory()
    items.push({
      id: itemId,
      itemId: input.itemId,
      // A stock journal carries an issue as a negative quantity, so that the
      // line says the component leaves the godown.
      quantityMilli: -input.quantityMilli,
      rate: movement.rate,
      discount: 0,
      taxCategoryId: null,
      amount: -movement.value,
      godownId: input.godownId,
      productionRequirementId: requirement.id,
    })

    issues.push({
      id: context.idFactory(),
      companyId: context.companyId,
      productionOrderId: order.id,
      requirementId: requirement.id,
      itemId: input.itemId,
      godownId: input.godownId,
      quantityMilli: input.quantityMilli,
      rate: movement.rate,
      cost: movement.cost,
      voucherId,
      voucherItemId: itemId,
      createdAt: now,
    })
  }

  const cost = issues.reduce((sum, issue) => sum + issue.cost, 0)
  const entries: VoucherEntry[] = [
    {
      id: context.idFactory(),
      ledgerId: context.productionLedgerId,
      debit: cost,
      credit: 0,
      narration: 'Materials issued to production',
    },
    {
      id: context.idFactory(),
      ledgerId: context.inventory.accounts.inventory.id,
      debit: 0,
      credit: cost,
      narration: 'Materials issued to production',
    },
  ]

  const voucher: Voucher = {
    id: voucherId,
    companyId: context.companyId,
    type: 'stock-journal',
    number: '',
    date: context.today,
    dueDate: null,
    paymentTermId: null,
    partyId: null,
    narration: `Materials issued to production order ${order.number}`,
    reference: order.number,
    status: 'posted',
    entries,
    items,
    taxes: [],
    linkedVoucherId: null,
    reversedByVoucherId: null,
    isLocked: false,
    createdAt: now,
    updatedAt: now,
  }

  return { voucher, movements, entries, issues, pools }
}

// ---------------------------------------------------------------------------
// Completing a production order
// ---------------------------------------------------------------------------

export interface ProductionCompletionPlan {
  voucher: Voucher
  movements: PlannedMovement[]
  entries: VoucherEntry[]
  completions: ProductionCompletion[]
  pools: Map<string, StockPool>
}

/**
 * Plan the receipt of finished goods.
 *
 * The finished goods are valued at the cost of the materials that were
 * issued against the order. A production order completes in one operation,
 * for its whole planned output: transferring part of an order would need an
 * assumption about how the materials were consumed, and the books cannot
 * support such an assumption.
 */
export function planProductionCompletion(
  order: ProductionOrder,
  requirements: ProductionRequirement[],
  issues: ProductionIssue[],
  context: ProductionPostingContext,
): ProductionCompletionPlan {
  if (order.status === 'cancelled') {
    throw new ProductionError('A cancelled production order cannot be completed.')
  }
  if (order.status === 'draft') {
    throw new ProductionError('Release the production order before completing it.')
  }
  if (issues.length === 0) {
    throw new ProductionError('No materials have been issued against this order, so there is no cost to transfer.')
  }

  // Every component must have been issued in full, and no more.
  for (const requirement of requirements) {
    if (requirement.issuedQuantityMilli < requirement.requiredQuantityMilli) {
      throw new ProductionError(
        'The materials have not all been issued, so the finished goods would be under-valued. ' +
          `The requirement is ${requirement.requiredQuantityMilli} milli-units and ` +
          `${requirement.issuedQuantityMilli} have been issued.`,
      )
    }
    if (requirement.issuedQuantityMilli > requirement.requiredQuantityMilli) {
      throw new ProductionError(
        'More materials have been issued than the structure requires. ' +
          'The excess must be adjusted explicitly before the order can be completed.',
      )
    }
  }

  const cost = issues.reduce((sum, issue) => sum + issue.cost, 0)
  const quantity = order.plannedQuantityMilli
  const rate = quantity > 0 ? divideRounded(BigInt(cost) * BigInt(1000), BigInt(quantity)) : 0

  const voucherId = context.idFactory()
  const now = context.now()
  const itemId = context.idFactory()

  // The finished goods come into stock at the production cost.
  const working: InventoryContext = { ...context.inventory }
  const pool = working.pools.get(order.itemId) ?? {
    itemId: order.itemId,
    quantityMilli: 0,
    carryingValue: 0,
    revision: 0,
  }
  const nextPool: StockPool = {
    ...pool,
    quantityMilli: pool.quantityMilli + quantity,
    carryingValue: pool.carryingValue + cost,
  }
  const pools = new Map(working.pools)
  pools.set(order.itemId, nextPool)

  const movement: PlannedMovement = {
    id: context.idFactory(),
    companyId: context.companyId,
    itemId: order.itemId,
    godownId: order.godownId,
    voucherId,
    voucherItemId: itemId,
    movementType: 'receipt',
    date: context.today,
    direction: 'in',
    quantityMilli: quantity,
    rate,
    value: cost,
    cost: 0,
    valuationMethod: VALUATION_METHOD,
    resultingQuantityMilli: nextPool.quantityMilli,
    resultingCarryingValue: nextPool.carryingValue,
    reversesMovementId: null,
    createdAt: now,
  }

  const entries: VoucherEntry[] = [
    {
      id: context.idFactory(),
      ledgerId: context.inventory.accounts.inventory.id,
      debit: cost,
      credit: 0,
      narration: 'Finished goods received from production',
    },
    {
      id: context.idFactory(),
      ledgerId: context.productionLedgerId,
      debit: 0,
      credit: cost,
      narration: 'Production cost transferred to the finished goods',
    },
  ]

  const items: VoucherItemLine[] = [
    {
      id: itemId,
      itemId: order.itemId,
      quantityMilli: quantity,
      rate,
      discount: 0,
      taxCategoryId: null,
      amount: cost,
      godownId: order.godownId,
    },
  ]

  const voucher: Voucher = {
    id: voucherId,
    companyId: context.companyId,
    type: 'stock-journal',
    number: '',
    date: context.today,
    dueDate: null,
    paymentTermId: null,
    partyId: null,
    narration: `Production order ${order.number} completed`,
    reference: order.number,
    status: 'posted',
    entries,
    items,
    taxes: [],
    linkedVoucherId: null,
    reversedByVoucherId: null,
    isLocked: false,
    createdAt: now,
    updatedAt: now,
  }

  const completions: ProductionCompletion[] = [
    {
      id: context.idFactory(),
      companyId: context.companyId,
      productionOrderId: order.id,
      itemId: order.itemId,
      godownId: order.godownId,
      quantityMilli: quantity,
      rate,
      cost,
      voucherId,
      voucherItemId: itemId,
      createdAt: now,
    },
  ]

  return { voucher, movements: [movement], entries, completions, pools }
}

/**
 * The cost of a production order that has not been transferred yet.
 *
 * It is the cost of the materials issued against it, which is what the work
 * in progress account carries.
 */
export function workInProgressCost(issues: ProductionIssue[]): Money {
  return issues.reduce((sum, issue) => sum + issue.cost, 0)
}

/**
 * The value of a quantity of finished goods, for display.
 */
export function productionValue(quantityMilli: number, rate: Money): Money {
  return lineValue(quantityMilli, rate)
}
