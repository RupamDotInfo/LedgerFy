/**
 * The sample books must satisfy the same accounting invariants as real books.
 *
 * The demo workspace is generated through the inventory engine rather than
 * hand-written, so it is the cheapest place to prove that the engine, the
 * repository and the generated data agree with each other. If the sample
 * books break an invariant, a person looking at the demo would see a wrong
 * number and have no way of knowing why.
 */

import { beforeAll, describe, expect, it } from 'vitest'

import { DemoRepository } from '@/repositories/demo/demoRepository'
import { createDemoDataset } from '@/repositories/demo/fixtures'
import { computeLedgerBalances } from '@/domain/accounting'
import { replayMovements } from '@/domain/inventory'
import type { LedgerFyRepository } from '@/repositories/contracts'

let repository: LedgerFyRepository
let companyIds: string[] = []

beforeAll(async () => {
  repository = new DemoRepository()
  companyIds = (await repository.listCompanies()).map((company) => company.id)
})

describe('the generated sample books', () => {
  it('cover more than one company', () => {
    expect(companyIds.length).toBeGreaterThan(1)
  })

  it('have inventory activated, with the accounts the policy names', async () => {
    for (const companyId of companyIds) {
      const accounts = await repository.getInventoryAccounts(companyId)
      expect(accounts, `${companyId} has inventory accounts`).not.toBeNull()
      expect(accounts?.valuationMethod).toBe('moving-weighted-average')
      expect(accounts?.inventoryLedgerId).toBeTruthy()
      expect(accounts?.cogsLedgerId).toBeTruthy()
      expect(accounts?.varianceLedgerId).toBeTruthy()
      expect(accounts?.purchasesLedgerId).toBeTruthy()
    }
  })

  it('hold every posted voucher balanced', async () => {
    for (const companyId of companyIds) {
      const vouchers = await repository.listVouchers(companyId)
      for (const voucher of vouchers) {
        if (voucher.status !== 'posted') continue
        const debit = voucher.entries.reduce((sum, entry) => sum + entry.debit, 0)
        const credit = voucher.entries.reduce((sum, entry) => sum + entry.credit, 0)
        expect(
          debit,
          `${companyId} ${voucher.number} (${voucher.type}) balances`,
        ).toBe(credit)
      }
    }
  })

  it('carry the same stock value in the ledger as in the pools', async () => {
    for (const companyId of companyIds) {
      const accounts = await repository.getInventoryAccounts(companyId)
      const ledgers = await repository.listLedgers(companyId)
      const vouchers = await repository.listVouchers(companyId)
      const pools = await repository.listStockPools(companyId)

      const balances = computeLedgerBalances(ledgers, vouchers, { to: '2027-03-31' })
      const asset = balances.find(
        (balance) => balance.ledger.id === accounts?.inventoryLedgerId,
      )
      const poolValue = pools.reduce((sum, pool) => sum + pool.carryingValue, 0)

      expect(
        asset?.closing ?? 0,
        `${companyId}: the inventory asset equals the value of the stock on hand`,
      ).toBe(poolValue)
    }
  })

  it('replay the movement ledger to the stored balances', async () => {
    for (const companyId of companyIds) {
      const movements = await repository.listStockMovements(companyId)
      const locations = await repository.listStockBalances(companyId)

      const stored = new Map(
        locations.map((location) => [
          `${location.itemId}::${location.godownId}`,
          location.quantityMilli,
        ]),
      )
      const replayed = replayMovements(movements)

      // The quantity at every location is what the ledger says it is.
      for (const [key, balance] of replayed) {
        expect(
          stored.get(key),
          `${companyId}: the quantity at ${key} is what the ledger says`,
        ).toBe(balance.quantityMilli)
      }
      expect(
        stored.size,
        `${companyId}: no location holds stock the ledger does not know about`,
      ).toBe(replayed.size)
    }
  })

  it('leave no stock movement without an exact quantity', async () => {
    for (const companyId of companyIds) {
      const movements = await repository.listStockMovements(companyId)
      expect(movements.length).toBeGreaterThan(0)
      for (const movement of movements) {
        expect(Number.isInteger(movement.quantityMilli)).toBe(true)
        expect(movement.valuationMethod).toBe('moving-weighted-average')
        expect(Number.isInteger(movement.value)).toBe(true)
      }
    }
  })

  it('keep the pool totals equal to the sum of the movements', async () => {
    for (const companyId of companyIds) {
      const movements = await repository.listStockMovements(companyId)
      const pools = await repository.listStockPools(companyId)
      const replayed = replayMovements(movements)

      let replayedValue = 0
      for (const balance of replayed.values()) replayedValue += balance.value
      const poolValue = pools.reduce((sum, pool) => sum + pool.carryingValue, 0)

      expect(replayedValue, `${companyId}: the pools equal the replayed ledger`).toBe(poolValue)
    }
  })

  it('name no record that is not in the books', () => {
    // The sample workspace is written into the database, which refuses a
    // movement that names a voucher or an item it cannot see. A dangling
    // reference here would mean the sample workspace could not be opened at
    // all, and the failure would only show in the packaged application.
    const dataset = createDemoDataset()
    const voucherIds = new Set(
      dataset.vouchers.map((voucher) => `${voucher.id}|${voucher.companyId}`),
    )
    const itemIds = new Set(dataset.items.map((item) => `${item.id}|${item.companyId}`))

    for (const movement of dataset.stockMovements) {
      expect(
        voucherIds.has(`${movement.voucherId}|${movement.companyId}`),
        `movement ${movement.id} names a voucher that is not in the books`,
      ).toBe(true)
      expect(
        itemIds.has(`${movement.itemId}|${movement.companyId}`),
        `movement ${movement.id} names an item that is not in the books`,
      ).toBe(true)
    }
  })
})
