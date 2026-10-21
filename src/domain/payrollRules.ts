/**
 * The statutory rules, effective-dated.
 *
 * Every rule carries its source, its status and the date from which it
 * applies. A rule that is not `in-force` does not calculate silently: it
 * blocks the run until a person with the authority to decide acknowledges it.
 *
 * The evidence for every rule here is in `docs/payroll-compliance-sources.md`.
 * That document is the source of truth; this module is the code that follows
 * it, and the two must not drift apart.
 */

import type {
  PayrollRuleSet,
  PayrollRuleStatus,
  SalaryAssignment,
  StatutoryRuleVersion,
} from '@/domain/types'
import type { Money } from '@/lib/money'

export class PayrollRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PayrollRuleError'
  }
}

const bps = (percent: number): number => Math.round(percent * 100)

/** The rule set shipped for a jurisdiction. */
export interface RuleSetDefinition {
  ruleSet: PayrollRuleSet
  /** The jurisdiction the rules apply to. */
  jurisdiction: string
  /** The versions, oldest first. */
  versions: Array<Omit<StatutoryRuleVersion, 'id' | 'companyId' | 'createdAt'>>
}

function version(
  ruleSet: PayrollRuleSet,
  effectiveFrom: string,
  effectiveTo: string | null,
  status: PayrollRuleStatus,
  source: string,
  summary: string,
  parameters: StatutoryRuleVersion['parameters'],
): Omit<StatutoryRuleVersion, 'id' | 'companyId' | 'createdAt'> {
  return {
    ruleSet,
    effectiveFrom,
    effectiveTo,
    status,
    source,
    summary,
    parameters,
    acknowledged: status === 'in-force',
    acknowledgedBy: null,
    acknowledgedAt: null,
  }
}

// ---------------------------------------------------------------------------
// The rules this build ships
// ---------------------------------------------------------------------------

/**
 * Employees' Provident Fund.
 *
 * The wage ceiling was raised from ₹15,000 to ₹25,000 per month with effect
 * from 17 September 2026, and the month of the change is pro-rated.
 */
const EPF: RuleSetDefinition = {
  ruleSet: 'epf',
  jurisdiction: 'IN',
  versions: [
    version(
      'epf',
      '1905-04-01',
      '2026-09-16',
      'in-force',
      'Code on Social Security, 2020; the Employees’ Provident Fund Scheme, 2026, notified 29 June 2026',
      'The employee and the employer each contribute 12% of basic wages and dearness allowance, on wages up to ₹15,000 a month.',
      {
        kind: 'epf',
        employeeRateBps: bps(12),
        employerRateBps: bps(12),
        pensionRateBps: bps(8.33),
        wageCeiling: 1_500_000,
        previousWageCeiling: null,
        changeDayOfMonth: null,
        reducedRateBps: bps(10),
        splitsToPension: true,
      },
    ),
    version(
      'epf',
      '2026-09-17',
      null,
      'in-force',
      'Ministry of Labour & Employment Notification S.O. 5109(E) dated 17 September 2026, under Section 2(89) of the Code on Social Security, 2020',
      'The wage ceiling is ₹25,000 a month. The employer’s 12% is split 8.33% to the pension scheme and 3.67% to the fund. The month of the change is pro-rated by the days on each side.',
      {
        kind: 'epf',
        employeeRateBps: bps(12),
        employerRateBps: bps(12),
        pensionRateBps: bps(8.33),
        wageCeiling: 2_500_000,
        previousWageCeiling: 1_500_000,
        changeDayOfMonth: 17,
        reducedRateBps: bps(10),
        splitsToPension: true,
      },
    ),
  ],
}

/**
 * Employees' State Insurance.
 *
 * The rates have not changed since 1 July 2019 and the ceiling has not
 * changed since 1 January 2017.
 */
const ESIC: RuleSetDefinition = {
  ruleSet: 'esic',
  jurisdiction: 'IN',
  versions: [
    version(
      'esic',
      '2019-07-01',
      null,
      'in-force',
      'G.S.R. 423(E) dated 13 June 2019 (rates) and G.S.R. 1166(E) dated 22 December 2016 (wage ceiling), under Rule 51 of the ESI (General) Regulations, 1950; esic.gov.in/contribution',
      'The employee contributes 0.75% and the employer 3.25% of wages, on wages up to ₹21,000 a month. An employee whose average daily wage is up to ₹176 pays no employee share, but the employer still pays its 3.25%.',
      {
        kind: 'esic',
        employeeRateBps: bps(0.75),
        employerRateBps: bps(3.25),
        wageCeiling: 2_100_000,
        disabilityWageCeiling: 2_500_000,
        dailyWageExemption: 17_600,
        daysInMonth: 30,
      },
    ),
  ],
}

/**
 * Professional tax — West Bengal.
 *
 * The schedule in force, and the replacement schedule published for
 * objections on 18 August 2026. The replacement is held as `proposed`: it
 * could not be established as in force from an official notification, so it
 * blocks a run rather than applying itself.
 */
const PROFESSIONAL_TAX: RuleSetDefinition = {
  ruleSet: 'professional-tax',
  jurisdiction: 'WB',
  versions: [
    version(
      'professional-tax',
      '1979-04-01',
      '2026-09-30',
      'in-force',
      'West Bengal State Tax on Professions, Trades, Callings and Employments Act, 1979 — the salaried schedule in force',
      'Nil up to ₹10,000 a month; ₹110, ₹130, ₹150 and ₹200 a month above it. The maximum is ₹2,400 a year.',
      {
        kind: 'professional-tax',
        jurisdiction: 'WB',
        slabs: [
          { upTo: 1_000_000, monthly: 0 },
          { upTo: 1_500_000, monthly: 11_000 },
          { upTo: 2_500_000, monthly: 13_000 },
          { upTo: 4_000_000, monthly: 15_000 },
          { upTo: null, monthly: 20_000 },
        ],
      },
    ),
    version(
      'professional-tax',
      '2026-10-01',
      null,
      'proposed',
      'West Bengal Finance Department Notification No. 1407-F.T. of 18 August 2026, published for objections in the Kolkata Gazette Extraordinary',
      'Nil up to ₹20,000 a month; ₹100, ₹140, ₹170 and ₹208 a month above it. The maximum is ₹2,496 a year.',
      {
        kind: 'professional-tax',
        jurisdiction: 'WB',
        slabs: [
          { upTo: 2_000_000, monthly: 0 },
          { upTo: 3_000_000, monthly: 10_000 },
          { upTo: 5_000_000, monthly: 14_000 },
          { upTo: 10_000_000, monthly: 17_000 },
          { upTo: null, monthly: 20_800 },
        ],
      },
    ),
  ],
}

/**
 * Salary tax deducted at source.
 *
 * The section changed on 1 April 2026 — Section 192 of the 1961 Act became
 * Section 392 of the 2025 Act — and the rates did not.
 */
const SALARY_TDS: RuleSetDefinition = {
  ruleSet: 'salary-tds',
  jurisdiction: 'IN',
  versions: [
    version(
      'salary-tds',
      '2025-04-01',
      '2026-03-31',
      'in-force',
      'Section 192 of the Income-tax Act, 1961; the Income Tax Department’s TDS Compliance FAQs and TDS Rates table',
      'Tax is deducted on salary at the normal slab rate of the year, with the rebate and the cess. The employer must reset the computation on 1 April.',
      {
        kind: 'salary-tds',
        taxYear: '2025-26',
        section: '192',
        regime: 'new',
        newRegime: {
          basicExemption: 40_000_000,
          standardDeduction: 7_500_000,
          slabs: [
            { from: 0, to: 40_000_000, rateBps: 0, baseAmount: 0 },
            { from: 40_000_000, to: 80_000_000, rateBps: bps(5), baseAmount: 0 },
            { from: 80_000_000, to: 120_000_000, rateBps: bps(10), baseAmount: 2_000_000 },
            { from: 120_000_000, to: 160_000_000, rateBps: bps(15), baseAmount: 6_000_000 },
            { from: 160_000_000, to: 200_000_000, rateBps: bps(20), baseAmount: 10_000_000 },
            { from: 200_000_000, to: 240_000_000, rateBps: bps(25), baseAmount: 14_000_000 },
            { from: 240_000_000, to: null, rateBps: bps(30), baseAmount: 18_000_000 },
          ],
          rebateUpTo: 120_000_000,
        },
        oldRegime: {
          basicExemption: 25_000_000,
          standardDeduction: 5_000_000,
          slabs: [
            { from: 0, to: 25_000_000, rateBps: 0, baseAmount: 0 },
            { from: 25_000_000, to: 50_000_000, rateBps: bps(5), baseAmount: 0 },
            { from: 50_000_000, to: 100_000_000, rateBps: bps(20), baseAmount: 12_500_000 },
            { from: 100_000_000, to: null, rateBps: bps(30), baseAmount: 11_250_000 },
          ],
          // The rebate is a relief of the new regime only.
          rebateUpTo: 0,
        },
        cessBps: bps(4),
        surchargeThreshold: 500_000_000,
        surchargeRates: [
          { above: 500_000_000, rateBps: bps(10) },
          { above: 750_000_000, rateBps: bps(15) },
          { above: 1_000_000_000, rateBps: bps(25) },
          { above: 1_250_000_000, rateBps: bps(37) },
        ],
        monthsInYear: 12,
      },
    ),
    version(
      'salary-tds',
      '2026-04-01',
      null,
      'in-force',
      'Section 392 of the Income-tax Act, 2025; the Income Tax Department’s TDS Compliance FAQs, which record that the rates and thresholds are retained',
      'The same slabs as before, under the new Act. The employer must reset the computation from 1 April for the new tax year, considering the projected income, the deductions and the regime.',
      {
        kind: 'salary-tds',
        taxYear: '2026-27',
        section: '392',
        regime: 'new',
        newRegime: {
          basicExemption: 40_000_000,
          standardDeduction: 7_500_000,
          slabs: [
            { from: 0, to: 40_000_000, rateBps: 0, baseAmount: 0 },
            { from: 40_000_000, to: 80_000_000, rateBps: bps(5), baseAmount: 0 },
            { from: 80_000_000, to: 120_000_000, rateBps: bps(10), baseAmount: 2_000_000 },
            { from: 120_000_000, to: 160_000_000, rateBps: bps(15), baseAmount: 6_000_000 },
            { from: 160_000_000, to: 200_000_000, rateBps: bps(20), baseAmount: 10_000_000 },
            { from: 200_000_000, to: 240_000_000, rateBps: bps(25), baseAmount: 14_000_000 },
            { from: 240_000_000, to: null, rateBps: bps(30), baseAmount: 18_000_000 },
          ],
          rebateUpTo: 120_000_000,
        },
        oldRegime: {
          basicExemption: 25_000_000,
          standardDeduction: 5_000_000,
          slabs: [
            { from: 0, to: 25_000_000, rateBps: 0, baseAmount: 0 },
            { from: 25_000_000, to: 50_000_000, rateBps: bps(5), baseAmount: 0 },
            { from: 50_000_000, to: 100_000_000, rateBps: bps(20), baseAmount: 12_500_000 },
            { from: 100_000_000, to: null, rateBps: bps(30), baseAmount: 11_250_000 },
          ],
          // The rebate is a relief of the new regime only.
          rebateUpTo: 0,
        },
        cessBps: bps(4),
        surchargeThreshold: 500_000_000,
        surchargeRates: [
          { above: 500_000_000, rateBps: bps(10) },
          { above: 750_000_000, rateBps: bps(15) },
          { above: 1_000_000_000, rateBps: bps(25) },
          { above: 1_250_000_000, rateBps: bps(37) },
        ],
        monthsInYear: 12,
      },
    ),
  ],
}

/** The rule sets this build ships, keyed by their set. */
export const BUILT_IN_RULE_SETS: Record<string, RuleSetDefinition> = {
  epf: EPF,
  esic: ESIC,
  'professional-tax': PROFESSIONAL_TAX,
  'salary-tds': SALARY_TDS,
}

/**
 * The salary assignment in force for an employee over a period.
 *
 * An assignment is in force for the period when its effective window
 * overlaps it: it starts on or before the period ends, and it has not ended
 * before the period starts. Where more than one overlaps, the one that
 * started most recently wins, because that is the one that was notified most
 * recently - the same rule the statutory rules follow.
 *
 * Both sides of the comparison are dates. Comparing a date to a `YYYY-MM`
 * period compares strings of different shapes, and a revision that began
 * inside the run month was silently ignored: the employee was paid at the old
 * rate, and an employee whose only assignment began inside the month was
 * dropped from the run altogether.
 *
 * A revision that takes effect part-way through the period is applied to the
 * whole period here. The policy does not say whether such a revision should
 * split the period and prorate it; that is an open decision, recorded in
 * `docs/payroll-decisions.md`.
 */
export function assignmentInForce(
  assignments: SalaryAssignment[],
  employeeId: string,
  periodStart: string,
  periodEnd: string,
): SalaryAssignment | null {
  const candidates = assignments
    .filter((assignment) => assignment.employeeId === employeeId)
    .filter((assignment) => assignment.effectiveFrom <= periodEnd)
    .filter((assignment) => !assignment.effectiveTo || assignment.effectiveTo >= periodStart)
    .sort((left, right) => (left.effectiveFrom < right.effectiveFrom ? -1 : 1))
  return candidates.length > 0 ? candidates[candidates.length - 1]! : null
}

/**
 * The rule in force on a date.
 *
 * The rule is the version whose period covers the date. When two versions
 * overlap, the later effective date wins, because that is the one that was
 * notified most recently.
 */
export function ruleInForce(
  versions: StatutoryRuleVersion[],
  ruleSet: PayrollRuleSet,
  onDate: string,
): StatutoryRuleVersion | null {
  const candidates = versions
    .filter((version) => version.ruleSet === ruleSet)
    .filter((version) => version.effectiveFrom <= onDate)
    .filter((version) => !version.effectiveTo || version.effectiveTo >= onDate)
    .sort((left, right) => (left.effectiveFrom < right.effectiveFrom ? -1 : 1))
  return candidates.length > 0 ? candidates[candidates.length - 1]! : null
}

/**
 * The rules that would block a run, and why.
 *
 * A rule that is not in force and has not been acknowledged blocks the run.
 * A rule that is simply missing blocks it too: the application does not
 * calculate a statutory contribution it has no rule for.
 */
export function blockingRules(
  versions: StatutoryRuleVersion[],
  onDate: string,
  required: PayrollRuleSet[],
): Array<{ ruleSet: PayrollRuleSet; reason: string }> {
  const blocked: Array<{ ruleSet: PayrollRuleSet; reason: string }> = []
  for (const ruleSet of required) {
    const rule = ruleInForce(versions, ruleSet, onDate)
    if (!rule) {
      blocked.push({
        ruleSet,
        reason: `No ${ruleSet} rule applies on ${onDate}. Add the rule before running payroll.`,
      })
      continue
    }
    if (rule.status !== 'in-force' && !rule.acknowledged) {
      blocked.push({
        ruleSet,
        reason:
          `The ${ruleSet} rule in force from ${rule.effectiveFrom} is ${rule.status}, not in force. ` +
          `It is not applied automatically. Acknowledge it if it applies to this company.`,
      })
    }
  }
  return blocked
}

/**
 * The wage base for a rule, from the components that take part in it.
 *
 * The bases are named by the rules, and a component says which ones it counts
 * towards, so the same employee produces a different base for each rule
 * without any of them being assumed.
 */
export function wageBase(
  amounts: Array<{ bases: string[]; amount: Money }>,
  basis: string,
): Money {
  return amounts
    .filter((entry) => entry.bases.includes(basis))
    .reduce((sum, entry) => sum + entry.amount, 0)
}
