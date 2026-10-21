/**
 * The payroll calculation and the rules it uses.
 *
 * Every figure here is checked against the rule it comes from, and the rules
 * come from `docs/payroll-compliance-sources.md`. If a number in this file
 * changes, a rule changed, and the evidence register has to say so.
 */

import { describe, expect, it } from 'vitest'

import {
  buildPayrollJournal,
  calculatePayroll,
  deriveRunState,
  esiWageBase,
  maskIdentifier,
  professionalTaxFor,
  projectedMonthlyGross,
  summariseRun,
  type PayrollCalculationInput,
} from '@/domain/payroll'
import {
  assignmentInForce,
  BUILT_IN_RULE_SETS,
  blockingRules,
  ruleInForce,
  wageBase,
} from '@/domain/payrollRules'
import { monthlySalaryTds, salaryTaxForYear, taxOnIncome } from '@/domain/payrollTax'
import type {
  Employee,
  PayrollAccounts,
  PayrollAttendance,
  SalaryAssignment,
  SalaryComponent,
  SalaryStructure,
  StatutoryRuleVersion,
} from '@/domain/types'

const rupees = (amount: number): number => amount * 100
const percent = (value: number): number => Math.round(value * 100)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function employee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 'emp-1',
    companyId: 'cmp-1',
    name: 'Asha Menon',
    code: 'EMP-001',
    department: 'Production',
    designation: 'Supervisor',
    dateOfJoining: '2024-01-15',
    monthlyGross: rupees(60_000),
    isActive: true,
    costCentreId: 'cc-1',
    pan: 'ABCDE1234F',
    taxRegime: 'new',
    isProvidentFundMember: true,
    isStateInsuranceMember: true,
    isPersonWithDisability: false,
    professionalTaxJurisdiction: 'WB',
    bankName: 'HDFC Bank',
    bankAccountNumber: '50100234567890',
    bankIfsc: 'HDFC0001234',
    ...overrides,
  }
}

const structure: SalaryStructure = {
  id: 'str-1',
  companyId: 'cmp-1',
  name: 'Supervisor',
  version: 1,
  effectiveFrom: '2024-01-01',
  effectiveTo: null,
  isActive: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
}

function component(
  code: string,
  name: string,
  amount: number,
  bases: SalaryComponent['bases'],
  position: number,
): SalaryComponent {
  return {
    id: `cmp-${code}`,
    companyId: 'cmp-1',
    structureId: structure.id,
    code,
    name,
    kind: 'earning',
    calculation: { type: 'fixed', amount },
    bases,
    position,
  }
}

const ALL_BASES: SalaryComponent['bases'] = [
  'gross-earnings',
  'epf-wages',
  'esic-wages',
  'professional-tax-wages',
  'salary-tds-wages',
]

/**
 * Basic 40,000 + dearness 10,000 + house rent 8,000 + special 2,000.
 *
 * The house rent is not part of the state insurance wages, and the excluded
 * items are below half the remuneration, so nothing is added back.
 */
const components: SalaryComponent[] = [
  component('BASIC', 'Basic salary', rupees(40_000), ALL_BASES, 1),
  component('DA', 'Dearness allowance', rupees(10_000), ALL_BASES, 2),
  component('HRA', 'House rent allowance', rupees(8_000), ['gross-earnings'], 3),
  component('SPECIAL', 'Special allowance', rupees(2_000), ['gross-earnings'], 4),
]

function rulesFor(): StatutoryRuleVersion[] {
  const sets = [
    BUILT_IN_RULE_SETS.epf!,
    BUILT_IN_RULE_SETS.esic!,
    BUILT_IN_RULE_SETS['professional-tax']!,
    BUILT_IN_RULE_SETS['salary-tds']!,
  ]
  return sets.flatMap((set) =>
    set.versions.map((version, index) => ({
      ...version,
      id: `${set.ruleSet}-${index}`,
      companyId: 'cmp-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    })),
  )
}

function input(overrides: Partial<PayrollCalculationInput> = {}): PayrollCalculationInput {
  return {
    employee: employee(),
    structure,
    components,
    attendance: null,
    rules: rulesFor(),
    period: '2026-04',
    periodStart: '2026-04-01',
    periodEnd: '2026-04-30',
    paymentDate: '2026-04-30',
    daysInPeriod: 30,
    monthsPaidInYear: 12,
    declaredDeductions: 0,
    projectedAnnualGross: rupees(60_000 * 12),
    ...overrides,
  }
}

const accounts: PayrollAccounts = {
  id: 'pa-1',
  companyId: 'cmp-1',
  salaryExpenseLedgerId: 'l-salary-expense',
  netSalaryPayableLedgerId: 'l-salary-payable',
  employeeDeductionsPayableLedgerId: 'l-pf-payable',
  statutoryDeductionsPayableLedgerId: 'l-tds-payable',
  employerContributionsPayableLedgerId: 'l-esic-payable',
  createdAt: '2026-01-01T00:00:00.000Z',
}

// ---------------------------------------------------------------------------

describe('the statutory rules', () => {
  it('choose the provident fund ceiling in force on the date', () => {
    const rules = rulesFor()
    const before = ruleInForce(rules, 'epf', '2026-09-16')
    const after = ruleInForce(rules, 'epf', '2026-09-17')

    expect(before?.parameters).toMatchObject({ wageCeiling: rupees(15_000) })
    expect(after?.parameters).toMatchObject({ wageCeiling: rupees(25_000) })
  })

  it('choose the tax section by the date of payment', () => {
    const rules = rulesFor()
    expect(ruleInForce(rules, 'salary-tds', '2026-03-31')?.parameters).toMatchObject({
      section: '192',
    })
    expect(ruleInForce(rules, 'salary-tds', '2026-04-01')?.parameters).toMatchObject({
      section: '392',
    })
  })

  it('hold the state insurance rates and the wage exemption', () => {
    const rule = ruleInForce(rulesFor(), 'esic', '2026-04-30')
    expect(rule?.parameters).toMatchObject({
      employeeRateBps: percent(0.75),
      employerRateBps: percent(3.25),
      wageCeiling: rupees(21_000),
      dailyWageExemption: rupees(176),
    })
  })

  it('hold the professional tax schedule that is in force, and the one that is not', () => {
    const rules = rulesFor()
    const inForce = ruleInForce(rules, 'professional-tax', '2026-09-30')
    const proposed = ruleInForce(rules, 'professional-tax', '2026-10-01')

    expect(inForce?.status).toBe('in-force')
    expect(proposed?.status).toBe('proposed')
  })

  it('block a run when a rule is not in force and has not been acknowledged', () => {
    const rules = rulesFor()
    const blocked = blockingRules(rules, '2026-10-15', ['professional-tax'])
    expect(blocked).toHaveLength(1)
    expect(blocked[0]?.reason).toMatch(/proposed, not in force/i)
  })

  it('let an acknowledged rule through', () => {
    const rules = rulesFor().map((rule) =>
      rule.ruleSet === 'professional-tax'
        ? { ...rule, acknowledged: true, acknowledgedBy: 'the owner' }
        : rule,
    )
    expect(blockingRules(rules, '2026-10-15', ['professional-tax'])).toHaveLength(0)
  })
})

describe('the salary tax deducted at source', () => {
  const rule = ruleInForce(rulesFor(), 'salary-tds', '2026-04-30')!
  const parameters = rule.parameters as Extract<
    StatutoryRuleVersion['parameters'],
    { kind: 'salary-tds' }
  >

  it('taxes nothing below the exemption', () => {
    expect(salaryTaxForYear(rupees(3_00_000), parameters)).toBe(0)
    expect(salaryTaxForYear(rupees(4_00_000), parameters)).toBe(0)
  })

  it('taxes at the slab rate', () => {
    // 15% of the income above 12 lakh, with 60,000 already paid.
    expect(taxOnIncome(rupees(16_00_000), parameters.newRegime.slabs)).toBe(rupees(1_20_000))
  })

  it('adds the health and education cess', () => {
    // 1,20,000 plus 4% of it.
    expect(salaryTaxForYear(rupees(16_00_000), parameters)).toBe(rupees(1_24_800))
  })

  it('removes the tax entirely inside the rebate', () => {
    expect(salaryTaxForYear(rupees(11_00_000), parameters)).toBe(0)
    // A rupee above the rebate limit, the tax is payable.
    expect(salaryTaxForYear(rupees(12_00_001), parameters)).toBeGreaterThan(0)
  })

  it('taxes the old regime on its own scale', () => {
    // 5% of the income above 2,50,000, plus the cess.
    expect(salaryTaxForYear(rupees(3_00_000), parameters, 'old')).toBe(rupees(2_600))
  })

  it('spreads the year over the months paid', () => {
    const annual = salaryTaxForYear(rupees(20_00_000), parameters)
    expect(monthlySalaryTds(rupees(20_00_000), parameters, 12)).toBe(
      Math.round(annual / 12),
    )
  })

  it('taxes an income above a slab without a floating-point drift', () => {
    const slabs = [{ from: 0, to: null, rateBps: percent(12.5), baseAmount: 0 }]
    expect(taxOnIncome(rupees(1_000), slabs)).toBe(rupees(125))
  })
})

describe('the professional tax', () => {
  const inForce = ruleInForce(rulesFor(), 'professional-tax', '2026-09-30')!
  const parameters = inForce.parameters as Extract<
    StatutoryRuleVersion['parameters'],
    { kind: 'professional-tax' }
  >

  it('is nil at the bottom of the schedule', () => {
    expect(professionalTaxFor(rupees(10_000), parameters.slabs)).toBe(0)
  })

  it('follows the slab', () => {
    expect(professionalTaxFor(rupees(12_000), parameters.slabs)).toBe(rupees(110))
    expect(professionalTaxFor(rupees(50_000), parameters.slabs)).toBe(rupees(200))
  })
})

describe('the calculation', () => {
  it('adds up the earnings', () => {
    const { calculation } = calculatePayroll(input())
    expect(calculation.grossEarnings).toBe(rupees(60_000))
    expect(calculation.components).toHaveLength(4)
  })

  it('computes the provident fund on the wages the rule names', () => {
    const { calculation } = calculatePayroll(input())
    const epf = calculation.employeeDeductions.find((entry) => entry.code === 'EPF')
    // 12% of the wages up to the ₹15,000 ceiling.
    expect(epf?.amount).toBe(rupees(1_800))
  })

  it('computes the state insurance on the wages the rule names', () => {
    const { calculation } = calculatePayroll(input())
    const esic = calculation.employeeDeductions.find((entry) => entry.code === 'ESIC')
    // 0.75% of the wages up to the ₹21,000 ceiling.
    expect(esic?.amount).toBe(rupees(158))
  })

  it('adds back the excess of the excluded items when they pass half the pay', () => {
    // Basic 20,000, house rent 40,000: the excluded items are more than half
    // of the remuneration, so 10,000 of the house rent is added back.
    const wide: SalaryComponent[] = [
      component('BASIC', 'Basic salary', rupees(20_000), ALL_BASES, 1),
      component('HRA', 'House rent allowance', rupees(40_000), ['gross-earnings'], 2),
    ]
    const base = esiWageBase(
      wide.map((entry) => ({ bases: entry.bases, amount: entry.calculation.type === 'fixed' ? entry.calculation.amount : 0 })),
      rupees(60_000),
    )
    expect(base).toBe(rupees(30_000))
  })

  it("computes the employer's contributions as well", () => {
    const { calculation } = calculatePayroll(input())
    const epf = calculation.employerContributions.find((entry) => entry.code === 'EPF')
    const esic = calculation.employerContributions.find((entry) => entry.code === 'ESIC')
    expect(epf?.amount).toBe(rupees(1_800))
    expect(esic?.amount).toBe(rupees(683))
  })

  it('deducts the professional tax and the salary tax', () => {
    const { calculation } = calculatePayroll(
      input({ projectedAnnualGross: rupees(24_00_000) }),
    )
    const pt = calculation.statutoryDeductions.find((entry) => entry.code === 'PT')
    expect(pt?.amount).toBe(rupees(200))
    const tds = calculation.statutoryDeductions.find((entry) => entry.code === 'TDS')
    expect(tds).toBeTruthy()
    expect(tds?.amount).toBeGreaterThan(0)
  })

  it('arrives at a net pay that balances', () => {
    const { calculation } = calculatePayroll(input())
    expect(calculation.netPay).toBe(
      calculation.grossEarnings -
        calculation.employeeDeductionTotal -
        calculation.statutoryDeductionTotal,
    )
  })

  it('refuses a net pay that is negative', () => {
    expect(() =>
      calculatePayroll(
        input({
          attendance: {
            id: 'att-1',
            companyId: 'cmp-1',
            employeeId: 'emp-1',
            period: '2026-04',
            payableDays: 1,
            lopDays: 29,
            extraDays: 0,
            otherDeductions: rupees(59_000),
            note: '',
            createdAt: '2026-04-30T00:00:00.000Z',
            updatedAt: '2026-04-30T00:00:00.000Z',
          },
        }),
      ),
    ).toThrow(/cannot be negative/i)
  })

  it('pays for the days the attendance records', () => {
    const half = calculatePayroll(
      input({
        attendance: {
          id: 'att-1',
          companyId: 'cmp-1',
          employeeId: 'emp-1',
          period: '2026-04',
          payableDays: 15,
          lopDays: 15,
          extraDays: 0,
          otherDeductions: 0,
          note: '',
          createdAt: '2026-04-30T00:00:00.000Z',
          updatedAt: '2026-04-30T00:00:00.000Z',
        },
      }),
    )
    expect(half.calculation.grossEarnings).toBe(rupees(30_000))
  })

  it('records the rules it used', () => {
    const { calculation } = calculatePayroll(input())
    const sets = calculation.ruleVersions.map((version) => version.ruleSet)
    expect(sets).toContain('epf')
    expect(sets).toContain('esic')
    expect(sets).toContain('salary-tds')
    expect(calculation.ruleVersions[0]?.source).toBeTruthy()
  })

  it('produces the same figures every time', () => {
    const first = calculatePayroll(input()).calculation
    const second = calculatePayroll(input()).calculation
    expect(second).toEqual(first)
  })
})

describe('the run', () => {
  it('totals the employees', () => {
    const { calculation } = calculatePayroll(input())
    const totals = summariseRun([calculation])
    expect(totals.grossEarnings).toBe(rupees(60_000))
    expect(totals.liability).toBe(
      totals.netPay + totals.employeeDeductions + totals.statutoryDeductions + totals.employerContributions,
    )
  })

  it('derives its state from what has happened to it', () => {
    expect(deriveRunState('draft', false, false, false)).toBe('draft')
    expect(deriveRunState('calculated', true, false, false)).toBe('calculated')
    expect(deriveRunState('approved', true, false, false)).toBe('approved')
    expect(deriveRunState('posted', true, true, false)).toBe('posted')
    expect(deriveRunState('paid', true, true, true)).toBe('paid')
    expect(deriveRunState('cancelled', false, false, false)).toBe('cancelled')
  })
})

describe('the payroll journal', () => {
  it('balances', () => {
    const { calculation } = calculatePayroll(input())
    const journal = buildPayrollJournal([calculation], accounts, 'Salary for April 2026')
    expect(journal.debit).toBe(journal.credit)
  })

  it('debits the cost of employment once', () => {
    const { calculation } = calculatePayroll(input())
    const totals = summariseRun([calculation])
    const journal = buildPayrollJournal([calculation], accounts, 'Salary')
    const expense = journal.lines.find(
      (line) => line.ledgerId === accounts.salaryExpenseLedgerId,
    )
    expect(expense?.debit).toBe(totals.grossEarnings + totals.employerContributions)
    // There is no second debit of the earnings anywhere.
    expect(journal.lines.filter((line) => line.debit > 0)).toHaveLength(1)
  })

  it('credits each liability', () => {
    const { calculation } = calculatePayroll(input())
    const totals = summariseRun([calculation])
    const journal = buildPayrollJournal([calculation], accounts, 'Salary')
    const credit = (ledgerId: string) =>
      journal.lines.find((line) => line.ledgerId === ledgerId)?.credit

    expect(credit(accounts.netSalaryPayableLedgerId)).toBe(totals.netPay)
    expect(credit(accounts.employeeDeductionsPayableLedgerId)).toBe(totals.employeeDeductions)
    expect(credit(accounts.statutoryDeductionsPayableLedgerId)).toBe(totals.statutoryDeductions)
    expect(credit(accounts.employerContributionsPayableLedgerId)).toBe(
      totals.employerContributions,
    )
  })

  it('refuses a run with nothing in it', () => {
    expect(() => buildPayrollJournal([], accounts, 'Salary')).toThrow(/nothing to post/i)
  })
})

describe('the sensitive fields', () => {
  it('are masked for display', () => {
    expect(maskIdentifier('ABCDE1234F')).toBe('••••••234F')
    expect(maskIdentifier('50100234567890')).toBe('••••••••••7890')
    expect(maskIdentifier(null)).toBe('')
  })
})

describe('the wage bases', () => {
  it('sum only the components that take part', () => {
    const base = wageBase(
      [
        { bases: ['gross-earnings', 'epf-wages'], amount: rupees(40_000) },
        { bases: ['gross-earnings'], amount: rupees(8_000) },
      ],
      'epf-wages',
    )
    expect(base).toBe(rupees(40_000))
  })
})

// ---------------------------------------------------------------------------
// The assignment in force for a period
// ---------------------------------------------------------------------------

describe('the salary assignment in force for a period', () => {
  function assignment(overrides: Partial<SalaryAssignment> = {}): SalaryAssignment {
    return {
      id: 'asn-1',
      companyId: 'cmp-1',
      employeeId: 'emp-1',
      structureId: 'str-1',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    }
  }

  it('takes the revision that begins on the first day of the period', () => {
    // The comparison used to be between a date and a `YYYY-MM` period, so
    // '2026-04-01' was not seen as being on or before '2026-04' and the
    // revision was ignored: the employee was paid at the old rate.
    const chosen = assignmentInForce(
      [
        assignment({ id: 'old', effectiveFrom: '2026-01-01' }),
        assignment({ id: 'new', structureId: 'str-2', effectiveFrom: '2026-04-01' }),
      ],
      'emp-1',
      '2026-04-01',
      '2026-04-30',
    )
    expect(chosen?.structureId).toBe('str-2')
  })

  it('takes a revision that begins inside the period', () => {
    const chosen = assignmentInForce(
      [assignment({ structureId: 'str-2', effectiveFrom: '2026-04-15' })],
      'emp-1',
      '2026-04-01',
      '2026-04-30',
    )
    expect(chosen?.structureId).toBe('str-2')
  })

  it('does not drop an employee whose only assignment begins inside the period', () => {
    // With the old comparison the assignment did not qualify, the employee
    // had no structure, and the run refused to calculate them at all.
    const chosen = assignmentInForce(
      [assignment({ effectiveFrom: '2026-04-15' })],
      'emp-1',
      '2026-04-01',
      '2026-04-30',
    )
    expect(chosen).not.toBeNull()
  })

  it('does not take an assignment that ended before the period', () => {
    const chosen = assignmentInForce(
      [assignment({ effectiveFrom: '2026-01-01', effectiveTo: '2026-03-31' })],
      'emp-1',
      '2026-04-01',
      '2026-04-30',
    )
    expect(chosen).toBeNull()
  })

  it('does not take an assignment that begins after the period', () => {
    const chosen = assignmentInForce(
      [assignment({ effectiveFrom: '2026-05-01' })],
      'emp-1',
      '2026-04-01',
      '2026-04-30',
    )
    expect(chosen).toBeNull()
  })

  it('takes the most recently started of the assignments that overlap', () => {
    const chosen = assignmentInForce(
      [
        assignment({ id: 'old', effectiveFrom: '2026-01-01' }),
        assignment({ id: 'new', structureId: 'str-2', effectiveFrom: '2026-03-01' }),
      ],
      'emp-1',
      '2026-04-01',
      '2026-04-30',
    )
    expect(chosen?.structureId).toBe('str-2')
  })

  it('leaves another employee alone', () => {
    const chosen = assignmentInForce(
      [assignment({ employeeId: 'emp-2' })],
      'emp-1',
      '2026-04-01',
      '2026-04-30',
    )
    expect(chosen).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The projected gross
// ---------------------------------------------------------------------------

describe('the projected gross', () => {
  it('includes a percentage component, not only the fixed ones', () => {
    // The projection used to add up the fixed components only, so the tax was
    // projected from less money than the run actually pays.
    const withPercentage: SalaryComponent[] = [
      component('BASIC', 'Basic salary', rupees(40_000), ALL_BASES, 1),
      {
        ...component('DA', 'Dearness allowance', rupees(10_000), ALL_BASES, 2),
        calculation: { type: 'percentage', of: 'BASIC', rateBps: percent(50) },
      },
    ]
    expect(projectedMonthlyGross(withPercentage, 30)).toBe(rupees(60_000))
  })

  it('includes a per-day component', () => {
    const withPerDay: SalaryComponent[] = [
      component('BASIC', 'Basic salary', rupees(40_000), ALL_BASES, 1),
      {
        ...component('DA', 'Dearness allowance', rupees(10_000), ALL_BASES, 2),
        calculation: { type: 'per-day', rate: rupees(100) },
      },
    ]
    expect(projectedMonthlyGross(withPerDay, 30)).toBe(rupees(43_000))
  })

  it('leaves out a deduction', () => {
    const withDeduction: SalaryComponent[] = [
      component('BASIC', 'Basic salary', rupees(40_000), ALL_BASES, 1),
      {
        ...component('ADVANCE', 'Advance recovery', rupees(5_000), [], 2),
        kind: 'employee-deduction',
      },
    ]
    expect(projectedMonthlyGross(withDeduction, 30)).toBe(rupees(40_000))
  })
})

// ---------------------------------------------------------------------------
// The attendance figures
// ---------------------------------------------------------------------------

describe('the attendance figures', () => {
  function attendance(overrides: Partial<PayrollAttendance> = {}): PayrollAttendance {
    return {
      id: 'att-1',
      companyId: 'cmp-1',
      employeeId: 'emp-1',
      period: '2026-04',
      payableDays: 30,
      lopDays: 0,
      extraDays: 0,
      otherDeductions: 0,
      note: '',
      createdAt: '2026-04-30T00:00:00.000Z',
      updatedAt: '2026-04-30T00:00:00.000Z',
      ...overrides,
    }
  }

  it('refuses a negative number of payable days', () => {
    expect(() =>
      calculatePayroll(input({ attendance: attendance({ payableDays: -1 }) })),
    ).toThrow(/negative payableDays/)
  })

  it('refuses a fractional number of days', () => {
    expect(() =>
      calculatePayroll(input({ attendance: attendance({ payableDays: 15.5 }) })),
    ).toThrow(/fractional payableDays/)
  })

  it('refuses more payable days than the period has', () => {
    expect(() =>
      calculatePayroll(input({ attendance: attendance({ payableDays: 31 }) })),
    ).toThrow(/more than the 30 days in the period/)
  })

  it('refuses a negative number of days lost without pay', () => {
    expect(() =>
      calculatePayroll(input({ attendance: attendance({ lopDays: -2 }) })),
    ).toThrow(/negative lopDays/)
  })

  it('refuses a negative deduction', () => {
    expect(() =>
      calculatePayroll(input({ attendance: attendance({ otherDeductions: -100 }) })),
    ).toThrow(/other deductions/)
  })
})

// ---------------------------------------------------------------------------
// The proration
// ---------------------------------------------------------------------------

describe('the proration of a fixed amount', () => {
  it('is worked out exactly, not in floating point', () => {
    // 4 858 paise over 17 of 28 days is 2 949.5 paise, which is 29 rupees
    // 50 paise and posts 30 rupees. In floating point the division gives
    // 2 949.49999999999954525, which rounds down to 2 949 paise and posts
    // 29 rupees. The exact division gives 2 950 paise and posts 30.
    const attendance: PayrollAttendance = {
      id: 'att-1',
      companyId: 'cmp-1',
      employeeId: 'emp-1',
      period: '2026-04',
      payableDays: 17,
      lopDays: 0,
      extraDays: 0,
      otherDeductions: 0,
      note: '',
      createdAt: '2026-04-30T00:00:00.000Z',
      updatedAt: '2026-04-30T00:00:00.000Z',
    }
    const single: SalaryComponent[] = [
      {
        ...component('BASIC', 'Basic salary', 4858, ALL_BASES, 1),
        calculation: { type: 'fixed', amount: 4858 },
      },
    ]
    const { calculation } = calculatePayroll(
      input({
        components: single,
        attendance,
        daysInPeriod: 28,
        periodStart: '2026-04-01',
        periodEnd: '2026-04-28',
      }),
    )
    expect(calculation.grossEarnings).toBe(rupees(30))
  })
})
