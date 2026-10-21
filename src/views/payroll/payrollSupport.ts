/**
 * The helpers the payroll screens share.
 *
 * The payroll arithmetic itself lives in `src/domain/payroll.ts` and is never
 * repeated here. What is in this module is only the shape of a period, the
 * rule sets a company needs, and the labels a state is shown with.
 */

import { deriveRunState } from '@/domain/payroll'
import type {
  Employee,
  PayrollPayment,
  PayrollRuleSet,
  PayrollRuleStatus,
  PayrollRun,
  PayrollRunState,
} from '@/domain/types'

/** The days a period covers. */
export interface PeriodBounds {
  period: string
  start: string
  end: string
  days: number
}

/**
 * The first day, the last day and the number of days of a period.
 *
 * The period is `YYYY-MM`, the way a payroll run carries it.
 */
export function periodBounds(period: string): PeriodBounds {
  const [year, month] = period.split('-')
  const days = new Date(Number(year), Number(month), 0).getDate()
  return {
    period,
    start: `${year}-${month}-01`,
    end: `${year}-${month}-${String(days).padStart(2, '0')}`,
    days,
  }
}

/**
 * The months an employee is paid for in the financial year.
 *
 * The tax spread divides the year's tax by the months the employee is
 * actually paid for, so a month in which an employee joined part way through
 * counts only from that month.
 */
export function monthsPaidInYear(
  joiningDate: string,
  yearStart: string,
  yearEnd: string,
): number {
  const from = joiningDate && joiningDate > yearStart ? joiningDate.slice(0, 7) : yearStart.slice(0, 7)
  const months =
    (Number(yearEnd.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
    Number(yearEnd.slice(5, 7)) -
    Number(from.slice(5, 7)) +
    1
  return Math.min(12, Math.max(1, months))
}

/**
 * The rule sets a company needs for a run.
 *
 * The professional tax schedule applies only to the employees who are in a
 * jurisdiction that has one, so it is needed only when there is such an
 * employee.
 */
export function requiredRuleSets(employees: Employee[]): PayrollRuleSet[] {
  const sets: PayrollRuleSet[] = ['epf', 'esic', 'salary-tds']
  if (employees.some((employee) => Boolean(employee.professionalTaxJurisdiction))) {
    sets.push('professional-tax')
  }
  return sets
}

/**
 * The state of a run, from what has happened to it.
 *
 * The state is derived, never stored, so a run cannot claim a state its
 * records do not support.
 */
export function runState(
  run: PayrollRun,
  hasSnapshot: boolean,
  payments: PayrollPayment[],
): PayrollRunState {
  const paid = payments.reduce((sum, payment) => sum + payment.amount, 0)
  const fullyPaid = run.netPay > 0 && paid >= run.netPay
  return deriveRunState(run.status, hasSnapshot, run.journalVoucherId !== null, fullyPaid)
}

export const RUN_STATE_LABEL: Record<PayrollRunState, string> = {
  draft: 'Draft',
  calculated: 'Calculated',
  approved: 'Approved',
  posted: 'Posted',
  paid: 'Paid',
  cancelled: 'Cancelled',
  reversed: 'Reversed',
}

export function runStateTone(state: PayrollRunState): 'neutral' | 'info' | 'positive' | 'warning' | 'danger' {
  switch (state) {
    case 'posted':
      return 'info'
    case 'paid':
      return 'positive'
    case 'cancelled':
    case 'reversed':
      return 'danger'
    case 'approved':
      return 'warning'
    default:
      return 'neutral'
  }
}

export const RULE_SET_LABEL: Record<PayrollRuleSet, string> = {
  epf: 'Provident fund',
  esic: 'State insurance',
  'professional-tax': 'Professional tax',
  'salary-tds': 'Tax deducted at source',
}

export const RULE_STATUS_LABEL: Record<PayrollRuleStatus, string> = {
  'in-force': 'In force',
  proposed: 'Proposed',
  'out-of-scope': 'Out of scope',
}

export function ruleStatusTone(
  status: PayrollRuleStatus,
): 'neutral' | 'info' | 'positive' | 'warning' | 'danger' {
  switch (status) {
    case 'in-force':
      return 'positive'
    case 'proposed':
      return 'warning'
    default:
      return 'danger'
  }
}

/**
 * The month a period covers, for a select.
 *
 * The periods are offered newest first, because the period that is being paid
 * is the one that is open.
 */
export function periodOptions(periods: string[]): Array<{ value: string; label: string }> {
  return periods.map((period) => {
    const [year, month] = period.split('-')
    const date = new Date(Number(year), Number(month) - 1, 1)
    const label = date.toLocaleString('en-IN', { month: 'long', year: 'numeric' })
    return { value: period, label }
  })
}
