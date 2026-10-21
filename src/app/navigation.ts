/**
 * The application information architecture.
 *
 * `icon` values are Material Symbols ligature names, rendered by
 * `components/ui/MaterialIcon.vue`.
 *
 * Individual reports and voucher types are deliberately kept out of the top
 * level: they live inside grouped sections and are reachable from the command
 * palette.
 */

export interface NavItem {
  label: string
  to: string
  icon?: string
  /** Marks actions that create data rather than navigate. */
  isAction?: boolean
  /** Keyboard shortcut shown in the palette and command bar. */
  shortcut?: string
}

export interface NavSection {
  id: string
  label: string
  icon: string
  items: NavItem[]
  /** Rendered as a plain top-level link instead of a collapsible group. */
  flat?: boolean
}

export const navigation: NavSection[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    icon: 'home',
    flat: true,
    items: [{ label: 'Home', to: '/', icon: 'home' }],
  },
  {
    id: 'transactions',
    label: 'Transactions',
    icon: 'receipt_long',
    items: [
      { label: 'Sales', to: '/sales', icon: 'shopping_cart' },
      { label: 'Purchase', to: '/purchases', icon: 'inventory_2' },
      { label: 'Payment', to: '/vouchers/new/payment', icon: 'payments', isAction: true, shortcut: 'F5' },
      { label: 'Receipt', to: '/vouchers/new/receipt', icon: 'currency_rupee', isAction: true, shortcut: 'F6' },
      { label: 'Contra', to: '/vouchers/new/contra', icon: 'swap_horiz', isAction: true, shortcut: 'F4' },
      { label: 'Journal', to: '/vouchers/new/journal', icon: 'menu_book', isAction: true, shortcut: 'F7' },
      { label: 'Credit note', to: '/vouchers/new/credit-note', icon: 'description', isAction: true, shortcut: 'Alt+F8' },
      { label: 'Debit note', to: '/vouchers/new/debit-note', icon: 'description', isAction: true, shortcut: 'Alt+F9' },
      { label: 'Sales orders', to: '/orders', icon: 'playlist_add_check' },
      { label: 'Purchase orders', to: '/orders/purchase', icon: 'playlist_add_check' },
    ],
  },
  {
    id: 'accounting',
    label: 'Accounting',
    icon: 'account_balance',
    items: [
      { label: 'Voucher register', to: '/vouchers', icon: 'receipt_long' },
      { label: 'Ledgers', to: '/masters/ledgers', icon: 'account_balance' },
      { label: 'Parties', to: '/masters/parties', icon: 'contacts' },
      { label: 'Items', to: '/masters/items', icon: 'inventory_2' },
      { label: 'Tax categories', to: '/masters/taxes', icon: 'percent' },
      { label: 'Godowns', to: '/masters/godowns', icon: 'warehouse' },
      { label: 'Cost centres', to: '/masters/cost-centres', icon: 'domain' },
      { label: 'Currencies', to: '/masters/currencies', icon: 'currency_exchange' },
    ],
  },
  {
    id: 'banking',
    label: 'Banking',
    icon: 'account_balance_wallet',
    items: [
      { label: 'Cash and bank', to: '/banking', icon: 'account_balance_wallet' },
      { label: 'Reconciliation', to: '/banking/reconciliation', icon: 'fact_check' },
      { label: 'Statement import', to: '/banking/import', icon: 'upload_file' },
    ],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    icon: 'inventory_2',
    items: [
      { label: 'Stock summary', to: '/inventory', icon: 'inventory_2' },
      { label: 'Stock register', to: '/inventory/register', icon: 'history' },
      { label: 'Stock movements', to: '/inventory/movements', icon: 'local_shipping' },
      { label: 'Valuation', to: '/inventory/valuation', icon: 'query_stats' },
      { label: 'Activation', to: '/inventory/activation', icon: 'rocket_launch' },
    ],
  },
  {
    id: 'production',
    label: 'Production',
    icon: 'precision_manufacturing',
    items: [
      { label: 'Production orders', to: '/production', icon: 'precision_manufacturing' },
      { label: 'Bill of materials', to: '/production/bom', icon: 'account_tree' },
    ],
  },
  {
    id: 'tax',
    label: 'Tax and compliance',
    icon: 'verified_user',
    items: [
      { label: 'GST setup', to: '/compliance/gst', icon: 'verified_user' },
      { label: 'GSTR-1', to: '/compliance/gstr-1', icon: 'description' },
      { label: 'GSTR-3B', to: '/compliance/gstr-3b', icon: 'description' },
      { label: 'E-invoice', to: '/compliance/e-invoice', icon: 'qr_code_2' },
      { label: 'E-way bill', to: '/compliance/e-way-bill', icon: 'local_shipping' },
      { label: 'TDS and TCS', to: '/compliance/tds', icon: 'percent' },
    ],
  },
  {
    id: 'payroll',
    label: 'Payroll',
    icon: 'groups',
    items: [
      { label: 'Employees', to: '/payroll/employees', icon: 'groups' },
      { label: 'Pay runs', to: '/payroll/pay-runs', icon: 'payments' },
      { label: 'Payslips', to: '/payroll/payslips', icon: 'receipt_long' },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: 'bar_chart',
    items: [
      { label: 'Report library', to: '/reports', icon: 'library_books' },
      { label: 'Balance sheet', to: '/reports/balance-sheet', icon: 'balance' },
      { label: 'Profit and loss', to: '/reports/profit-and-loss', icon: 'monitoring' },
      { label: 'Trial balance', to: '/reports/trial-balance', icon: 'scale' },
      { label: 'Receivables ageing', to: '/reports/receivables', icon: 'assignment_turned_in' },
      { label: 'Payables ageing', to: '/reports/payables', icon: 'schedule' },
      { label: 'GST summary', to: '/reports/gst-summary', icon: 'receipt_long' },
    ],
  },
  {
    id: 'data',
    label: 'Data and tools',
    icon: 'table_view',
    items: [
      { label: 'Backup and restore', to: '/data/backup', icon: 'backup' },
      { label: 'Import data', to: '/data/import', icon: 'upload_file' },
      { label: 'Export data', to: '/data/export', icon: 'download' },
      { label: 'Migration', to: '/data/migration', icon: 'moving' },
      { label: 'Integrity check', to: '/data/integrity', icon: 'fact_check' },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'settings',
    items: [
      { label: 'Company settings', to: '/settings/company', icon: 'domain' },
      { label: 'Preferences', to: '/settings/preferences', icon: 'tune' },
      { label: 'Users and roles', to: '/settings/users', icon: 'manage_accounts' },
      { label: 'Audit trail', to: '/settings/audit', icon: 'history' },
    ],
  },
]

export interface VoucherTypeMeta {
  label: string
  plural: string
  route: string
  icon: string
  description: string
  shortcut?: string
}

/** Voucher types offered by the command palette and the entry screen. */
export const VOUCHER_TYPE_META: Record<string, VoucherTypeMeta> = {
  sales: {
    label: 'Sales',
    plural: 'Sales invoices',
    route: '/vouchers/new/sales',
    icon: 'shopping_cart',
    description: 'Record a sales invoice against a customer',
    shortcut: 'F8',
  },
  purchase: {
    label: 'Purchase',
    plural: 'Purchase bills',
    route: '/vouchers/new/purchase',
    icon: 'inventory_2',
    description: 'Record a purchase bill against a supplier',
    shortcut: 'F9',
  },
  payment: {
    label: 'Payment',
    plural: 'Payments',
    route: '/vouchers/new/payment',
    icon: 'payments',
    description: 'Pay a supplier from a bank or cash ledger',
    shortcut: 'F5',
  },
  receipt: {
    label: 'Receipt',
    plural: 'Receipts',
    route: '/vouchers/new/receipt',
    icon: 'currency_rupee',
    description: 'Record money received from a customer',
    shortcut: 'F6',
  },
  contra: {
    label: 'Contra',
    plural: 'Contra entries',
    route: '/vouchers/new/contra',
    icon: 'swap_horiz',
    description: 'Move funds between cash and bank ledgers',
    shortcut: 'F4',
  },
  journal: {
    label: 'Journal',
    plural: 'Journals',
    route: '/vouchers/new/journal',
    icon: 'menu_book',
    description: 'Post an adjustment between ledgers',
    shortcut: 'F7',
  },
  'credit-note': {
    label: 'Credit note',
    plural: 'Credit notes',
    route: '/vouchers/new/credit-note',
    icon: 'description',
    description: 'Issue a credit note against a sales invoice',
    shortcut: 'Alt+F8',
  },
  'debit-note': {
    label: 'Debit note',
    plural: 'Debit notes',
    route: '/vouchers/new/debit-note',
    icon: 'description',
    description: 'Issue a debit note against a purchase bill',
    shortcut: 'Alt+F9',
  },
  'sales-order': {
    label: 'Sales order',
    plural: 'Sales orders',
    route: '/vouchers/new/sales-order',
    icon: 'playlist_add_check',
    description: 'Record a customer order awaiting despatch',
  },
  'purchase-order': {
    label: 'Purchase order',
    plural: 'Purchase orders',
    route: '/vouchers/new/purchase-order',
    icon: 'playlist_add_check',
    description: 'Raise an order with a supplier',
  },
}
