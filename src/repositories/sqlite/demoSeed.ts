/**
 * Opening the sample workspace in the local database.
 *
 * The demo books live in the same database as real books, but as a separate
 * company flagged `isDemo`. Nothing is ever written into a real company's
 * records, and a real company's books are never overwritten by sample data.
 */

import { invoke } from '@tauri-apps/api/core'

import { createDemoDataset, DEMO_TODAY } from '@/repositories/demo/fixtures'
import type { Company } from '@/domain/types'

export interface SeededCompany {
  company: Company
  companyId: string
}

/**
 * Write the sample workspace into the local database.
 *
 * The whole workspace is written in one transaction: either the sample books
 * appear completely, or nothing does.
 */
export async function seedDemoWorkspace(companyId: string): Promise<Company> {
  const dataset = createDemoDataset()
  const company = dataset.companies.find((candidate) => candidate.id === companyId)
  if (!company) {
    throw new Error('That sample workspace could not be found.')
  }

  const scoped = <T extends { companyId: string }>(records: T[]) =>
    records.filter((record) => record.companyId === companyId)

  await invoke('seed_workspace', {
    company: { ...company, isDemo: true },
    financialYears: scoped(dataset.financialYears),
    ledgers: scoped(dataset.ledgers),
    items: scoped(dataset.items),
    taxCategories: scoped(dataset.taxCategories),
    stockGroups: scoped(dataset.stockGroups),
    units: scoped(dataset.units),
    godowns: scoped(dataset.godowns),
    costCentres: scoped(dataset.costCentres),
    employees: scoped(dataset.employees),
    currencies: scoped(dataset.currencies),
    priceLists: scoped(dataset.priceLists),
    priceListEntries: dataset.priceListEntries.filter((entry) =>
      scoped(dataset.priceLists).some((list) => list.id === entry.priceListId),
    ),
    paymentTerms: scoped(dataset.paymentTerms),
    vouchers: scoped(dataset.vouchers),
    stockMovements: scoped(dataset.stockMovements),
    orders: scoped(dataset.orders),
    orderLines: scoped(dataset.orderLines),
    orderFulfilments: scoped(dataset.orderFulfilments),
    orderRevisions: scoped(dataset.orderRevisions),
    orderRevisionLines: scoped(dataset.orderRevisionLines),
    boms: scoped(dataset.boms),
    bomLines: scoped(dataset.bomLines),
    productionOrders: scoped(dataset.productionOrders),
    productionRequirements: scoped(dataset.productionRequirements),
    productionIssues: scoped(dataset.productionIssues),
    productionCompletions: scoped(dataset.productionCompletions),
    inventoryAccounts: scoped(dataset.inventoryAccounts),
    salaryStructures: scoped(dataset.salaryStructures),
    salaryComponents: scoped(dataset.salaryComponents),
    salaryAssignments: scoped(dataset.salaryAssignments),
    payrollAttendance: scoped(dataset.payrollAttendance),
    payrollRuns: scoped(dataset.payrollRuns),
    payrollSnapshots: scoped(dataset.payrollSnapshots),
    payrollAccounts: scoped(dataset.payrollAccounts),
    statutoryRuleVersions: scoped(dataset.statutoryRules),
    statementLines: scoped(dataset.statementLines),
    auditEvents: scoped(dataset.auditEvents),
  })

  return { ...company, isDemo: true }
}

/** The companies the sample workspace can be opened as. */
export function demoCompanyIds(): string[] {
  return createDemoDataset().companies.map((company) => company.id)
}

export { DEMO_TODAY }
