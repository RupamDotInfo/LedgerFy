import type { AccountGroup, VoucherStatus, VoucherType } from '@/domain/types'

export const VOUCHER_TYPE_LABELS: Record<VoucherType, string> = {
  sales: 'Sales',
  purchase: 'Purchase',
  payment: 'Payment',
  receipt: 'Receipt',
  contra: 'Contra',
  journal: 'Journal',
  'credit-note': 'Credit note',
  'debit-note': 'Debit note',
  'sales-order': 'Sales order',
  'purchase-order': 'Purchase order',
  'delivery-note': 'Delivery note',
  'receipt-note': 'Receipt note',
  'stock-journal': 'Stock journal',
}

export const ACCOUNT_GROUP_LABELS: Record<AccountGroup, string> = {
  assets: 'Assets',
  liabilities: 'Liabilities',
  equity: 'Equity',
  income: 'Income',
  expenses: 'Expenses',
}

export type BadgeTone = 'neutral' | 'info' | 'positive' | 'warning' | 'danger' | 'primary' | 'violet'

export function voucherTypeLabel(type: VoucherType): string {
  return VOUCHER_TYPE_LABELS[type] ?? type
}

export function voucherTypeTone(type: VoucherType): BadgeTone {
  switch (type) {
    case 'sales':
    case 'sales-order':
      return 'primary'
    case 'purchase':
    case 'purchase-order':
      return 'violet'
    case 'payment':
      return 'warning'
    case 'receipt':
      return 'positive'
    case 'contra':
      return 'info'
    case 'journal':
      return 'neutral'
    case 'credit-note':
    case 'debit-note':
      return 'danger'
    default:
      return 'neutral'
  }
}

export function voucherStatusLabel(status: VoucherStatus): string {
  switch (status) {
    case 'posted':
      return 'Posted'
    case 'draft':
      return 'Draft'
    case 'cancelled':
      return 'Cancelled'
    default:
      return status
  }
}

export function voucherStatusTone(status: VoucherStatus): BadgeTone {
  switch (status) {
    case 'posted':
      return 'positive'
    case 'draft':
      return 'warning'
    case 'cancelled':
      return 'danger'
    default:
      return 'neutral'
  }
}

/** Shorten a long master name for a dense table cell. */
export function truncateLabel(value: string, max = 42): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}
