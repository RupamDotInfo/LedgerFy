/**
 * What the payroll screens do to a run.
 *
 * The arithmetic is the domain's: `calculatePayroll` produces the snapshot,
 * `summariseRun` produces the totals and `buildPayrollJournal` produces the
 * journal. Nothing here decides a figure; it only gathers what the domain
 * needs and hands the result to the repository.
 */

import {
  buildPayrollJournal,
  calculatePayroll,
  projectedMonthlyGross,
  summariseRun,
} from '@/domain/payroll'
import { assignmentInForce } from '@/domain/payrollRules'
import type {
  Employee,
  PayrollAccounts,
  PayrollRun,
  PayrollSnapshot,
  Voucher,
  VoucherEntry,
} from '@/domain/types'
import type { LedgerFyRepository } from '@/repositories/contracts'
import { periodBounds, monthsPaidInYear } from '@/views/payroll/payrollSupport'

/** A rule that would block the run, and why. */
export interface BlockingRule {
  ruleSet: string
  reason: string
}

/** The result of calculating a run. */
export interface RunCalculation {
  run: PayrollRun
  snapshots: PayrollSnapshot[]
  blocked: BlockingRule[]
}

export class PayrollRunError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PayrollRunError'
  }
}

/**
 * Calculate a run.
 *
 * The snapshot of each employee is computed by the domain and stored as it is.
 * A rule that is not in force blocks the run: it is reported, never applied
 * silently.
 */
export async function calculateRun(
  repository: LedgerFyRepository,
  companyId: string,
  run: PayrollRun,
  employees: Employee[],
  yearStart: string,
  yearEnd: string,
): Promise<RunCalculation> {
  const [rules, assignments, attendance] = await Promise.all([
    repository.listStatutoryRules(companyId),
    repository.listSalaryAssignments(companyId),
    repository.listAttendance(companyId, run.period),
  ])

  const bounds = periodBounds(run.period)
  const blocked: BlockingRule[] = []
  const calculations = []
  const snapshots: PayrollSnapshot[] = []

  for (const employee of employees) {
    // An employee who is no longer active is not paid in this run.
    if (!employee.isActive) continue

    // The structure in force for the period. The domain decides which one
    // that is, so that a revision is selected the same way everywhere.
    const assignment = assignmentInForce(assignments, employee.id, bounds.start, bounds.end)
    if (!assignment) continue

    const detail = await repository.getSalaryStructure(companyId, assignment.structureId)
    if (!detail) {
      throw new PayrollRunError(
        `The salary structure for ${employee.name} could not be read, so the run was not calculated.`,
      )
    }

    const record = attendance.find((entry) => entry.employeeId === employee.id) ?? null

    // The gross the structure produces for a whole period, every earning and
    // reimbursement component on its own basis, so the tax is projected from
    // the money the run actually pays.
    const projectedGross = projectedMonthlyGross(detail.components, bounds.days)

    const result = calculatePayroll({
      employee,
      structure: detail.structure,
      components: detail.components,
      attendance: record,
      rules,
      period: run.period,
      periodStart: bounds.start,
      periodEnd: bounds.end,
      paymentDate: run.paymentDate,
      daysInPeriod: bounds.days,
      monthsPaidInYear: monthsPaidInYear(employee.dateOfJoining, yearStart, yearEnd),
      declaredDeductions: 0,
      projectedAnnualGross: projectedGross * 12,
    })

    for (const entry of result.blocked) {
      if (!blocked.some((existing) => existing.ruleSet === entry.ruleSet)) {
        blocked.push(entry)
      }
    }

    calculations.push(result.calculation)
    snapshots.push({
      id: `snp-${run.id}-${employee.id}`,
      companyId,
      runId: run.id,
      employeeId: employee.id,
      snapshot: result.calculation,
      createdAt: new Date().toISOString(),
    })
  }

  if (!calculations.length) {
    throw new PayrollRunError(
      'No employee is paid by a salary structure for this period, so there is nothing to calculate.',
    )
  }

  const totals = summariseRun(calculations)
  const calculated: PayrollRun = {
    ...run,
    status: 'calculated',
    employeeCount: calculations.length,
    grossEarnings: totals.grossEarnings,
    employeeDeductions: totals.employeeDeductions,
    statutoryDeductions: totals.statutoryDeductions,
    employerContributions: totals.employerContributions,
    netPay: totals.netPay,
    updatedAt: new Date().toISOString(),
  }

  return { run: calculated, snapshots, blocked }
}

/**
 * The journal a run posts.
 *
 * It is an ordinary journal voucher, so it obeys the same period locks as
 * every other voucher.
 */
export async function buildRunJournal(
  repository: LedgerFyRepository,
  companyId: string,
  run: PayrollRun,
  snapshots: PayrollSnapshot[],
  accounts: PayrollAccounts,
): Promise<{ voucher: Voucher; entries: VoucherEntry[] }> {
  const narration = `Salary for ${run.period} — ${run.number}`
  const journal = buildPayrollJournal(
    snapshots.map((snapshot) => snapshot.snapshot),
    accounts,
    narration,
  )

  const number = await repository.nextVoucherNumber(companyId, 'journal')
  const now = new Date().toISOString()
  const entries: VoucherEntry[] = journal.lines.map((line, index) => ({
    id: `${run.id}-entry-${index + 1}`,
    ledgerId: line.ledgerId,
    debit: line.debit,
    credit: line.credit,
    narration: line.narration,
  }))

  const voucher: Voucher = {
    id: `vch-${run.id}`,
    companyId,
    type: 'journal',
    number,
    date: run.paymentDate,
    partyId: null,
    narration,
    reference: run.number,
    status: 'posted',
    entries,
    items: [],
    taxes: [],
    linkedVoucherId: null,
    reversedByVoucherId: null,
    isLocked: false,
    createdAt: now,
    updatedAt: now,
  }

  return { voucher, entries }
}
