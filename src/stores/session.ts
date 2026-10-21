import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type {
  Company,
  CostCentre,
  Currency,
  Employee,
  FinancialYear,
  Godown,
  Item,
  Ledger,
  PaymentTerm,
  PriceList,
  StockGroup,
  TaxCategory,
  Unit,
} from '@/domain/types'
import { getRepository } from '@/repositories'
import { seedDemoWorkspace, demoCompanyIds } from '@/repositories/sqlite/demoSeed'
import { isDesktopRuntime } from '@/lib/native'
import { todayIso } from '@/lib/datetime'

/**
 * Session state: which company is open, which financial year is in view, and
 * the master data that every screen reads from.
 */
export const useSessionStore = defineStore('session', () => {
  const repository = getRepository()

  const companies = ref<Company[]>([])
  const activeCompanyId = ref<string | null>(null)
  const financialYears = ref<FinancialYear[]>([])
  const activeYearId = ref<string | null>(null)

  const ledgers = ref<Ledger[]>([])
  const items = ref<Item[]>([])
  const taxCategories = ref<TaxCategory[]>([])
  const godowns = ref<Godown[]>([])
  const units = ref<Unit[]>([])
  const stockGroups = ref<StockGroup[]>([])
  const costCentres = ref<CostCentre[]>([])
  const employees = ref<Employee[]>([])
  const currencies = ref<Currency[]>([])
  const priceLists = ref<PriceList[]>([])
  const paymentTerms = ref<PaymentTerm[]>([])

  const loading = ref(false)
  const ready = ref(false)
  const error = ref<string | null>(null)
  /** True when the workspace holds no company yet and one must be created. */
  const needsSetup = ref(false)

  /** True in a browser, where the books cannot be saved. */
  const isPreview = computed(() => !isDesktopRuntime())

  const activeCompany = computed(
    () => companies.value.find((company) => company.id === activeCompanyId.value) ?? null,
  )

  const activeFinancialYear = computed(
    () => financialYears.value.find((year) => year.id === activeYearId.value) ?? null,
  )

  /** Reporting window: the financial year to date. */
  const activePeriod = computed(() => {
    const year = activeFinancialYear.value
    const today = todayIso()
    if (!year) return { from: today, to: today }
    return { from: year.start, to: year.end < today ? year.end : today }
  })

  const partyLedgers = computed(() => ledgers.value.filter((ledger) => ledger.partyKind !== null))

  const customerLedgers = computed(() =>
    ledgers.value.filter((ledger) => ledger.partyKind === 'customer' || ledger.partyKind === 'both'),
  )

  const supplierLedgers = computed(() =>
    ledgers.value.filter((ledger) => ledger.partyKind === 'supplier' || ledger.partyKind === 'both'),
  )

  const bankLedgers = computed(() => ledgers.value.filter((ledger) => ledger.type === 'bank'))
  const cashLedgers = computed(() => ledgers.value.filter((ledger) => ledger.type === 'cash'))

  async function loadMasters(companyId: string) {
    const [
      ledgerList,
      itemList,
      taxList,
      godownList,
      unitList,
      stockGroupList,
      costCentreList,
      employeeList,
      currencyList,
      priceListList,
      paymentTermList,
    ] = await Promise.all([
      repository.listLedgers(companyId),
      repository.listItems(companyId),
      repository.listTaxCategories(companyId),
      repository.listGodowns(companyId),
      repository.listUnits(companyId),
      repository.listStockGroups(companyId),
      repository.listCostCentres(companyId),
      repository.listEmployees(companyId),
      repository.listCurrencies(companyId),
      repository.listPriceLists(companyId),
      repository.listPaymentTerms(companyId),
    ])

    ledgers.value = ledgerList
    items.value = itemList
    taxCategories.value = taxList
    godowns.value = godownList
    units.value = unitList
    stockGroups.value = stockGroupList
    costCentres.value = costCentreList
    employees.value = employeeList
    currencies.value = currencyList
    priceLists.value = priceListList
    paymentTerms.value = paymentTermList
  }

  async function bootstrap() {
    loading.value = true
    error.value = null
    try {
      companies.value = await repository.listCompanies()
      if (!companies.value.length) {
        // An empty workspace is a first-run state, not a failure.
        needsSetup.value = true
        ready.value = true
        return
      }
      const preferred = companies.value[0]!
      await switchCompany(preferred.id)
      ready.value = true
    } catch (cause) {
      // The reason the database gave is more useful than a summary of it.
      error.value =
        cause instanceof Error
          ? cause.message
          : typeof cause === 'string' && cause.trim().length > 0
            ? cause
            : 'The workspace could not be opened.'
      ready.value = true
    } finally {
      loading.value = false
    }
  }

  async function switchCompany(companyId: string) {
    loading.value = true
    try {
      const years = await repository.listFinancialYears(companyId)
      financialYears.value = years
      activeCompanyId.value = companyId
      const open = years.find((year) => !year.isClosed) ?? years[0] ?? null
      activeYearId.value = open?.id ?? null
      await loadMasters(companyId)
      needsSetup.value = false
    } finally {
      loading.value = false
    }
  }

  async function switchFinancialYear(yearId: string) {
    activeYearId.value = yearId
  }

  async function createCompany(input: Parameters<typeof repository.createCompany>[0]) {
    const company = await repository.createCompany(input)
    companies.value = await repository.listCompanies()
    await switchCompany(company.id)
    return company
  }

  /**
   * Open the sample workspace in the local database.
   *
   * The sample books are written as their own company, flagged as sample
   * data. They never touch a real company's records.
   */
  async function openSampleWorkspace() {
    loading.value = true
    error.value = null
    try {
      const company = await seedDemoWorkspace(demoCompanyIds()[0]!)
      companies.value = await repository.listCompanies()
      await switchCompany(company.id)
    } catch (cause) {
      // The reason the database gave is more useful than a summary of it,
      // so the message is shown whatever shape the failure arrived in.
      error.value =
        cause instanceof Error
          ? cause.message
          : typeof cause === 'string' && cause.trim().length > 0
            ? cause
            : 'The sample workspace could not be opened.'
    } finally {
      loading.value = false
    }
  }

  return {
    companies,
    activeCompanyId,
    financialYears,
    activeYearId,
    ledgers,
    items,
    taxCategories,
    godowns,
    units,
    stockGroups,
    costCentres,
    employees,
    currencies,
    priceLists,
    paymentTerms,
    loading,
    ready,
    error,
    needsSetup,
    isPreview,
    activeCompany,
    activeFinancialYear,
    activePeriod,
    partyLedgers,
    customerLedgers,
    supplierLedgers,
    bankLedgers,
    cashLedgers,
    repository,
    bootstrap,
    switchCompany,
    switchFinancialYear,
    createCompany,
    openSampleWorkspace,
    loadMasters,
  }
})
