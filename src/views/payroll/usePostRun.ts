/**
 * Posting a payroll run.
 *
 * The journal is prepared first, so the person posting can see exactly what
 * will be written to the books before anything is written. The arithmetic is
 * the domain's: this composable only gathers what it needs and hands the
 * journal to the repository.
 */

import { ref } from 'vue'

import type { PayrollRun, PayrollSnapshot, Voucher, VoucherEntry } from '@/domain/types'
import { useSessionStore } from '@/stores/session'
import { useToastStore } from '@/stores/toast'
import { buildRunJournal } from '@/views/payroll/payrollActions'

export function usePostRun() {
  const session = useSessionStore()
  const toast = useToastStore()

  /** True while the confirmation is open. */
  const open = ref(false)
  /** True while the run is being posted. */
  const posting = ref(false)
  /** The journal that will be posted, once it has been prepared. */
  const journal = ref<{ voucher: Voucher; entries: VoucherEntry[] } | null>(null)
  /** Why the run could not be posted, when it could not be. */
  const reason = ref('')

  /**
   * Prepare the journal of a run and open the confirmation.
   *
   * The payroll accounts must be mapped: no ledger is ever chosen for the
   * person posting.
   */
  async function prepare(run: PayrollRun, snapshots: PayrollSnapshot[]): Promise<boolean> {
    const companyId = session.activeCompanyId
    if (!companyId) {
      reason.value = 'Open a company before posting a payroll run.'
      return false
    }
    try {
      const accounts = await session.repository.getPayrollAccounts(companyId)
      if (!accounts) {
        reason.value =
          'The payroll accounts are not mapped, so the run cannot be posted. Map them in the payroll settings.'
        return false
      }
      if (!snapshots.length) {
        reason.value = 'This run has not been calculated, so there is nothing to post.'
        return false
      }
      journal.value = await buildRunJournal(
        session.repository,
        companyId,
        run,
        snapshots,
        accounts,
      )
      reason.value = ''
      open.value = true
      return true
    } catch (cause) {
      reason.value =
        cause instanceof Error ? cause.message : 'The journal could not be prepared.'
      return false
    }
  }

  /**
   * Post the run with the journal that was prepared.
   *
   * The voucher, its entries, the state of the run and the audit event are
   * written in one transaction by the repository.
   */
  async function post(run: PayrollRun): Promise<boolean> {
    const companyId = session.activeCompanyId
    if (!companyId || !journal.value) {
      reason.value = 'The journal was not prepared, so the run was not posted.'
      return false
    }
    posting.value = true
    try {
      const posted = await session.repository.postPayrollRun(
        companyId,
        run.id,
        { ...run, status: 'posted', journalVoucherId: journal.value.voucher.id },
        journal.value.voucher,
        journal.value.entries,
      )
      open.value = false
      toast.success(
        'Payroll posted',
        `${posted.number} was posted as journal ${journal.value.voucher.number}.`,
      )
      return true
    } catch (cause) {
      reason.value =
        cause instanceof Error ? cause.message : 'The run was not posted and the repository did not say why.'
      return false
    } finally {
      posting.value = false
    }
  }

  function close() {
    open.value = false
  }

  return { open, posting, journal, reason, prepare, post, close }
}
