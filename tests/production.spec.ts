/**
 * The manufacturing rules.
 *
 * A structure says what an item is made of, a production order says how
 * many are to be made, the materials are issued at the moving average, and
 * the finished goods are received at the cost of the materials that were
 * issued. These tests hold those rules down.
 */

import { describe, expect, it } from 'vitest'

import {
  buildBom,
  buildProductionOrder,
  buildProductionRequirements,
  deriveProductionState,
  planProductionCompletion,
  planProductionIssue,
  requiredQuantityMilli,
  workInProgressCost,
  type BomContext,
  type ProductionPostingContext,
  type ReleasedStructure,
} from '@/domain/production'
import { toQuantity } from '@/domain/quantity'
import type { InventoryContext } from '@/domain/inventory'
import type {
  AccountType,
  Bom,
  Item,
  Ledger,
  ProductionIssue,
  ProductionOrder,
  ProductionRequirement,
} from '@/domain/types'

const rupees = (amount: number): number => amount * 100

function item(id: string, name: string): Item {
  return {
    id,
    companyId: 'cmp-1',
    name,
    stockGroupId: 'sg-1',
    unitId: 'u-1',
    isInventory: true,
    isService: false,
    purchasePrice: rupees(100),
    salesPrice: rupees(150),
    taxCategoryId: null,
    hsn: '732690',
    openingQuantityMilli: 0,
    openingValue: 0,
    reorderLevelMilli: 0,
    isActive: true,
    createdAt: '2026-04-01T00:00:00.000Z',
  }
}

const bracket = item('i-bracket', 'Steel Bracket')
const bolt = item('i-bolt', 'SS 304 Hex Bolt')
const washer = item('i-washer', 'M8 Washer')

let counter = 0
const nextId = (): string => `id-${++counter}`

function ledger(id: string, name: string, type: AccountType): Ledger {
  return {
    id,
    companyId: 'cmp-1',
    name,
    group: type === 'inventory' ? 'assets' : 'expenses',
    type,
    parentId: null,
    openingBalance: 0,
    openingDate: '2026-04-01',
    partyKind: null,
    currency: 'INR',
    isSystem: true,
    isActive: true,
    createdAt: '2026-04-01T00:00:00.000Z',
  }
}

const inventoryLedger = ledger('l-inv', 'Inventory', 'inventory')
const cogsLedger = ledger('l-cogs', 'Cost of Goods Sold', 'expenses')
const varianceLedger = ledger('l-var', 'Stock Adjustment / Variance', 'expenses')
const purchasesLedger = ledger('l-pur', 'Purchases', 'purchase')
const productionLedger = ledger('l-wip', 'Work in Progress', 'work-in-progress')

function bomContext(released: ReleasedStructure[] = []): BomContext {
  return {
    companyId: 'cmp-1',
    items: new Map([
      [bracket.id, bracket],
      [bolt.id, bolt],
      [washer.id, washer],
    ]),
    releasedBoms: released,
    idFactory: nextId,
    now: () => '2026-05-01T00:00:00.000Z',
  }
}

function aStructure() {
  return buildBom(
    {
      itemId: bracket.id,
      outputQuantityMilli: toQuantity(1),
      narration: 'A bracket is two bolts and two washers',
      lines: [
        { itemId: bolt.id, quantityMilli: toQuantity(2) },
        { itemId: washer.id, quantityMilli: toQuantity(2) },
      ],
    },
    bomContext(),
  )
}

/**
 * An inventory context with ten bolts at 100 and twenty washers at 50.
 */
function inventoryContext(): InventoryContext {
  return {
    companyId: 'cmp-1',
    accounts: {
      inventory: inventoryLedger,
      cogs: cogsLedger,
      variance: varianceLedger,
      purchases: purchasesLedger,
      inputTaxRecoverable: true,
    },
    items: new Map([
      [bracket.id, bracket],
      [bolt.id, bolt],
      [washer.id, washer],
    ]),
    pools: new Map([
      [bolt.id, { itemId: bolt.id, quantityMilli: toQuantity(10), carryingValue: rupees(1000), revision: 1 }],
      [washer.id, { itemId: washer.id, quantityMilli: toQuantity(20), carryingValue: rupees(1000), revision: 1 }],
    ]),
    locations: new Map([
      [`${bolt.id}::g-1`, { itemId: bolt.id, godownId: 'g-1', quantityMilli: toQuantity(10), revision: 1 }],
      [`${washer.id}::g-1`, { itemId: washer.id, godownId: 'g-1', quantityMilli: toQuantity(20), revision: 1 }],
    ]),
    idFactory: nextId,
    now: () => '2026-05-01T00:00:00.000Z',
  }
}

function postingContext(): ProductionPostingContext {
  return {
    companyId: 'cmp-1',
    items: new Map([
      [bracket.id, bracket],
      [bolt.id, bolt],
      [washer.id, washer],
    ]),
    inventory: inventoryContext(),
    productionLedgerId: productionLedger.id,
    idFactory: nextId,
    now: () => '2026-05-02T00:00:00.000Z',
    today: '2026-05-02',
  }
}

function aProductionOrder(quantity = 1) {
  const order = buildProductionOrder(
    {
      itemId: bracket.id,
      bomId: 'bom-1',
      plannedQuantityMilli: toQuantity(quantity),
      godownId: 'g-1',
      plannedAt: '2026-05-02',
    },
    {
      companyId: 'cmp-1',
      items: new Map([[bracket.id, bracket]]),
      idFactory: nextId,
      now: () => '2026-05-01T00:00:00.000Z',
    },
  )
  return { ...order, status: 'released' as const }
}

function releasedStructure() {
  const { bom, lines } = aStructure()
  const released: Bom = { ...bom, status: 'released', version: 1 }
  return { bom: released, lines }
}

function requirements(order: ProductionOrder): ProductionRequirement[] {
  const { bom, lines } = releasedStructure()
  return buildProductionRequirements(order, bom, lines, {
    companyId: 'cmp-1',
    items: new Map([[bracket.id, bracket]]),
    idFactory: nextId,
    now: () => '2026-05-01T00:00:00.000Z',
  })
}

// ---------------------------------------------------------------------------

describe('a bill of materials', () => {
  it('records the finished item, the output quantity and the components', () => {
    const { bom, lines } = aStructure()
    expect(bom.itemId).toBe(bracket.id)
    expect(bom.outputQuantityMilli).toBe(toQuantity(1))
    expect(bom.status).toBe('draft')
    expect(lines).toHaveLength(2)
    expect(lines[0]?.quantityMilli).toBe(toQuantity(2))
    expect(lines[0]?.conversionMilli).toBe(1000)
  })

  it('refuses a structure with no components', () => {
    expect(() =>
      buildBom(
        { itemId: bracket.id, outputQuantityMilli: toQuantity(1), lines: [] },
        bomContext(),
      ),
    ).toThrow(/at least one component/i)
  })

  it('refuses a structure that lists the item it makes', () => {
    expect(() =>
      buildBom(
        {
          itemId: bracket.id,
          outputQuantityMilli: toQuantity(1),
          lines: [{ itemId: bracket.id, quantityMilli: toQuantity(1) }],
        },
        bomContext(),
      ),
    ).toThrow(/its own component/i)
  })

  it('refuses a structure whose components would make themselves', () => {
    // A bracket needs a bolt, and a bolt needs a bracket.
    const { bom: bracketBom, lines: bracketLines } = buildBom(
      {
        itemId: bracket.id,
        outputQuantityMilli: toQuantity(1),
        lines: [{ itemId: bolt.id, quantityMilli: toQuantity(1) }],
      },
      bomContext(),
    )
    const released: ReleasedStructure = {
      bom: { ...bracketBom, status: 'released' },
      lines: bracketLines,
    }

    expect(() =>
      buildBom(
        {
          itemId: bolt.id,
          outputQuantityMilli: toQuantity(1),
          lines: [{ itemId: bracket.id, quantityMilli: toQuantity(1) }],
        },
        bomContext([released]),
      ),
    ).toThrow(/cycle/i)
  })
})

describe('the requirement of a component', () => {
  it('is the stated quantity for the whole planned output, exactly', () => {
    // Two bolts per bracket, at one to one, making ten brackets.
    expect(requiredQuantityMilli(toQuantity(2), 1000, toQuantity(10), toQuantity(1))).toBe(
      toQuantity(20),
    )
    // A conversion of half changes the figure: the component is bought in
    // half the unit the structure states.
    expect(requiredQuantityMilli(toQuantity(2), 500, toQuantity(10), toQuantity(1))).toBe(
      toQuantity(10),
    )
    // A structure that makes ten brackets at a time needs a tenth per bracket.
    expect(requiredQuantityMilli(toQuantity(20), 1000, toQuantity(10), toQuantity(10))).toBe(
      toQuantity(20),
    )
    // A half is rounded away from zero, never left dangling.
    expect(requiredQuantityMilli(1, 1000, 500, toQuantity(1))).toBe(1)
  })

  it('is snapshotted into the production order when it is released', () => {
    const order = aProductionOrder(10)
    const reqs = requirements(order)
    const boltRequirement = reqs.find((requirement) => requirement.itemId === bolt.id)
    expect(boltRequirement?.requirementQuantityMilli).toBe(toQuantity(2))
    expect(boltRequirement?.requiredQuantityMilli).toBe(toQuantity(20))
    expect(boltRequirement?.issuedQuantityMilli).toBe(0)
  })
})

describe('issuing materials', () => {
  it('consumes the components at their moving average', () => {
    const order = aProductionOrder(1)
    const reqs = requirements(order)
    const boltRequirement = reqs.find((requirement) => requirement.itemId === bolt.id)!

    const plan = planProductionIssue(
      order,
      reqs,
      [{ requirementId: boltRequirement.id, itemId: bolt.id, godownId: 'g-1', quantityMilli: toQuantity(2) }],
      postingContext(),
    )

    // Two bolts out of a pool of ten at a hundred each.
    expect(plan.issues).toHaveLength(1)
    expect(plan.issues[0]?.cost).toBe(rupees(200))
    expect(plan.movements).toHaveLength(1)
    expect(plan.movements[0]?.direction).toBe('out')
    expect(plan.movements[0]?.movementType).toBe('issue')
  })

  it('does not debit cost of goods sold: the cost goes to work in progress', () => {
    const order = aProductionOrder(1)
    const reqs = requirements(order)
    const boltRequirement = reqs.find((requirement) => requirement.itemId === bolt.id)!

    const plan = planProductionIssue(
      order,
      reqs,
      [{ requirementId: boltRequirement.id, itemId: bolt.id, godownId: 'g-1', quantityMilli: toQuantity(2) }],
      postingContext(),
    )

    const debit = plan.entries.find((entry) => entry.ledgerId === productionLedger.id)
    const credit = plan.entries.find((entry) => entry.ledgerId === inventoryLedger.id)
    expect(debit?.debit).toBe(rupees(200))
    expect(credit?.credit).toBe(rupees(200))
    expect(plan.entries.some((entry) => entry.ledgerId === cogsLedger.id)).toBe(false)
  })

  it('refuses to issue more than the structure requires', () => {
    const order = aProductionOrder(1)
    const reqs = requirements(order)
    const boltRequirement = reqs.find((requirement) => requirement.itemId === bolt.id)!

    expect(() =>
      planProductionIssue(
        order,
        reqs,
        [{ requirementId: boltRequirement.id, itemId: bolt.id, godownId: 'g-1', quantityMilli: toQuantity(5) }],
        postingContext(),
      ),
    ).toThrow(/exceed what the structure requires/i)
  })
})

describe('completing a production order', () => {
  function issueAll(order: ProductionOrder, reqs: ProductionRequirement[]) {
    const context = postingContext()
    const issues: ProductionIssue[] = []
    const planned = planProductionIssue(
      order,
      reqs,
      reqs.map((requirement) => ({
        requirementId: requirement.id,
        itemId: requirement.itemId,
        godownId: 'g-1',
        quantityMilli: requirement.requiredQuantityMilli,
      })),
      context,
    )
    issues.push(...planned.issues)

    // The issued quantities are now on the requirements.
    const updated: ProductionRequirement[] = reqs.map((requirement) => ({
      ...requirement,
      issuedQuantityMilli: requirement.requiredQuantityMilli,
    }))
    return { issues, updated }
  }

  it('receives the finished goods at the cost of the materials issued', () => {
    const order = aProductionOrder(1)
    const reqs = requirements(order)
    const { issues, updated } = issueAll(order, reqs)

    // Two bolts at 100 and two washers at 50: 200 + 100.
    expect(workInProgressCost(issues)).toBe(rupees(300))

    const plan = planProductionCompletion(order, updated, issues, postingContext())

    expect(plan.completions).toHaveLength(1)
    expect(plan.completions[0]?.quantityMilli).toBe(toQuantity(1))
    expect(plan.completions[0]?.cost).toBe(rupees(300))

    const debit = plan.entries.find((entry) => entry.ledgerId === inventoryLedger.id)
    const credit = plan.entries.find((entry) => entry.ledgerId === productionLedger.id)
    expect(debit?.debit).toBe(rupees(300))
    expect(credit?.credit).toBe(rupees(300))
  })

  it('refuses to complete when the materials have not all been issued', () => {
    const order = aProductionOrder(1)
    const reqs = requirements(order)
    const boltRequirement = reqs.find((requirement) => requirement.itemId === bolt.id)!
    const { issues } = issueAll(order, reqs)

    // The washers were never issued.
    const short = reqs.map((requirement) =>
      requirement.itemId === washer.id
        ? { ...requirement, issuedQuantityMilli: 0 }
        : requirement,
    )

    expect(() => planProductionCompletion(order, short, issues, postingContext())).toThrow(
      /not all been issued/i,
    )
    expect(boltRequirement.requiredQuantityMilli).toBe(toQuantity(2))
  })

  it('refuses to complete when more has been issued than the structure requires', () => {
    const order = aProductionOrder(1)
    const reqs = requirements(order)
    const { issues } = issueAll(order, reqs)

    const over = reqs.map((requirement) => ({
      ...requirement,
      issuedQuantityMilli: requirement.requiredQuantityMilli + 1,
    }))

    expect(() => planProductionCompletion(order, over, issues, postingContext())).toThrow(
      /More materials have been issued/i,
    )
  })

  it('refuses to complete when nothing has been issued', () => {
    const order = aProductionOrder(1)
    const reqs = requirements(order)
    expect(() => planProductionCompletion(order, reqs, [], postingContext())).toThrow(
      /No materials have been issued/i,
    )
  })
})

describe('the work in progress account', () => {
  it('carries the cost of the materials issued until they are transferred', () => {
    const order = aProductionOrder(1)
    const reqs = requirements(order)
    const context = postingContext()

    const plan = planProductionIssue(
      order,
      reqs,
      reqs.map((requirement) => ({
        requirementId: requirement.id,
        itemId: requirement.itemId,
        godownId: 'g-1',
        quantityMilli: requirement.requiredQuantityMilli,
      })),
      context,
    )

    // The account is debited with exactly the cost of the materials issued.
    const debited = plan.entries
      .filter((entry) => entry.ledgerId === productionLedger.id)
      .reduce((sum, entry) => sum + entry.debit - entry.credit, 0)
    expect(debited).toBe(workInProgressCost(plan.issues))
    expect(debited).toBe(rupees(300))

    // The completion takes it out again, so the account nets to zero.
    const updated = reqs.map((requirement) => ({
      ...requirement,
      issuedQuantityMilli: requirement.requiredQuantityMilli,
    }))
    const completion = planProductionCompletion(order, updated, plan.issues, context)
    const credited = completion.entries
      .filter((entry) => entry.ledgerId === productionLedger.id)
      .reduce((sum, entry) => sum + entry.credit - entry.debit, 0)
    expect(credited).toBe(debited)
  })
})

describe('the state of a production order', () => {
  it('is derived from the issues and the completions', () => {
    const order = aProductionOrder(1)
    const reqs = requirements(order)
    expect(deriveProductionState(order, [], [])).toBe('released')

    const { issues, updated } = (() => {
      const context = postingContext()
      const planned = planProductionIssue(
        order,
        reqs,
        reqs.map((requirement) => ({
          requirementId: requirement.id,
          itemId: requirement.itemId,
          godownId: 'g-1',
          quantityMilli: requirement.requiredQuantityMilli,
        })),
        context,
      )
      return {
        issues: planned.issues,
        updated: reqs.map((requirement) => ({
          ...requirement,
          issuedQuantityMilli: requirement.requiredQuantityMilli,
        })),
      }
    })()

    expect(deriveProductionState(order, issues, [])).toBe('in-production')

    const completed = planProductionCompletion(order, updated, issues, postingContext())
    expect(deriveProductionState(order, issues, completed.completions)).toBe('completed')
  })
})
