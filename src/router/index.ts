import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

import AppShell from '@/layouts/AppShell.vue'

/**
 * Every navigation entry in `app/navigation.ts` resolves to one of these
 * routes. There are no placeholder screens.
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: AppShell,
    children: [
      { path: '', name: 'home', component: () => import('@/views/HomeView.vue') },

      {
        path: 'company/create',
        name: 'company-create',
        component: () => import('@/views/CompanyCreateView.vue'),
      },

      {
        path: 'vouchers',
        name: 'vouchers',
        component: () => import('@/views/VoucherRegisterView.vue'),
      },
      {
        path: 'vouchers/new/:type',
        name: 'voucher-new',
        component: () => import('@/views/VoucherEntryView.vue'),
      },
      {
        path: 'vouchers/:id',
        name: 'voucher-detail',
        component: () => import('@/views/VoucherDetailView.vue'),
      },

      {
        path: 'sales',
        name: 'sales',
        component: () => import('@/views/SalesView.vue'),
      },
      {
        path: 'purchases',
        name: 'purchases',
        component: () => import('@/views/PurchasesView.vue'),
      },

      {
        path: 'banking',
        name: 'banking',
        component: () => import('@/views/BankingView.vue'),
      },
      {
        path: 'banking/reconciliation',
        name: 'banking-reconciliation',
        component: () => import('@/views/BankingReconciliationView.vue'),
      },
      {
        path: 'banking/import',
        name: 'banking-import',
        component: () => import('@/views/BankingStatementImportView.vue'),
      },

      {
        path: 'inventory',
        name: 'inventory',
        component: () => import('@/views/InventoryView.vue'),
      },
      {
        path: 'inventory/register',
        name: 'inventory-register',
        component: () => import('@/views/InventoryRegisterView.vue'),
      },
      {
        path: 'inventory/movements',
        name: 'inventory-movements',
        component: () => import('@/views/InventoryMovementsView.vue'),
      },
      {
        path: 'inventory/valuation',
        name: 'inventory-valuation',
        component: () => import('@/views/InventoryValuationView.vue'),
      },
      {
        path: 'inventory/activation',
        name: 'inventory-activation',
        component: () => import('@/views/InventoryActivationView.vue'),
      },

      {
        path: 'orders',
        name: 'orders',
        component: () => import('@/views/OrdersView.vue'),
      },
      {
        path: 'orders/purchase',
        name: 'purchase-orders',
        component: () => import('@/views/PurchaseOrdersView.vue'),
      },
      {
        path: 'orders/:id',
        name: 'order-detail',
        meta: { orderKind: 'sales' },
        component: () => import('@/views/orders/OrderDetailView.vue'),
      },
      {
        path: 'orders/purchase/:id',
        name: 'purchase-order-detail',
        meta: { orderKind: 'purchase' },
        component: () => import('@/views/orders/OrderDetailView.vue'),
      },
      {
        path: 'production',
        name: 'production',
        component: () => import('@/views/ProductionView.vue'),
      },
      {
        path: 'production/bom',
        name: 'production-bom',
        component: () => import('@/views/production/BomView.vue'),
      },
      {
        path: 'production/:id',
        name: 'production-order-detail',
        component: () => import('@/views/production/ProductionOrderDetailView.vue'),
      },

      {
        path: 'compliance/gst',
        name: 'gst-setup',
        component: () => import('@/views/compliance/GstSetupView.vue'),
      },
      {
        path: 'compliance/gstr-1',
        name: 'gstr-1',
        component: () => import('@/views/compliance/Gstr1View.vue'),
      },
      {
        path: 'compliance/gstr-3b',
        name: 'gstr-3b',
        component: () => import('@/views/compliance/Gstr3bView.vue'),
      },
      {
        path: 'compliance/e-invoice',
        name: 'e-invoice',
        component: () => import('@/views/compliance/EInvoiceView.vue'),
      },
      {
        path: 'compliance/e-way-bill',
        name: 'e-way-bill',
        component: () => import('@/views/compliance/EWayBillView.vue'),
      },
      {
        path: 'compliance/tds',
        name: 'tds',
        component: () => import('@/views/compliance/TdsView.vue'),
      },

      {
        path: 'payroll/employees',
        name: 'payroll-employees',
        component: () => import('@/views/payroll/PayrollEmployeesView.vue'),
      },
      {
        path: 'payroll/pay-runs',
        name: 'payroll-pay-runs',
        component: () => import('@/views/payroll/PayrollPayRunsView.vue'),
      },
      {
        path: 'payroll/pay-runs/:id',
        name: 'payroll-pay-run',
        component: () => import('@/views/payroll/PayrollRunDetailView.vue'),
      },
      {
        path: 'payroll/pay-runs/:id/employees/:employeeId',
        name: 'payroll-pay-run-employee',
        component: () => import('@/views/payroll/PayrollEmployeeBreakdownView.vue'),
      },
      {
        path: 'payroll/payslips',
        name: 'payroll-payslips',
        component: () => import('@/views/payroll/PayrollPayslipsView.vue'),
      },
      {
        path: 'payroll/payslips/:runId/:employeeId',
        name: 'payroll-payslip',
        component: () => import('@/views/payroll/PayrollPayslipView.vue'),
      },
      {
        path: 'payroll/reports',
        name: 'payroll-reports',
        component: () => import('@/views/payroll/PayrollReportsView.vue'),
      },
      {
        path: 'payroll/settings',
        name: 'payroll-settings',
        component: () => import('@/views/payroll/PayrollSettingsView.vue'),
      },

      {
        path: 'reports',
        name: 'reports',
        component: () => import('@/views/ReportLibraryView.vue'),
      },
      {
        path: 'reports/:reportId',
        name: 'report',
        component: () => import('@/views/ReportView.vue'),
      },

      {
        path: 'masters/ledgers',
        name: 'masters-ledgers',
        component: () => import('@/views/masters/LedgersView.vue'),
      },
      {
        path: 'masters/parties',
        name: 'masters-parties',
        component: () => import('@/views/masters/PartiesView.vue'),
      },
      {
        path: 'masters/items',
        name: 'masters-items',
        component: () => import('@/views/masters/ItemsView.vue'),
      },
      {
        path: 'masters/taxes',
        name: 'masters-taxes',
        component: () => import('@/views/masters/TaxesView.vue'),
      },
      {
        path: 'masters/godowns',
        name: 'masters-godowns',
        component: () => import('@/views/masters/GodownsView.vue'),
      },
      {
        path: 'masters/cost-centres',
        name: 'masters-cost-centres',
        component: () => import('@/views/masters/CostCentresView.vue'),
      },
      {
        path: 'masters/currencies',
        name: 'masters-currencies',
        component: () => import('@/views/masters/CurrenciesView.vue'),
      },

      {
        path: 'data/backup',
        name: 'data-backup',
        component: () => import('@/views/data/BackupView.vue'),
      },
      {
        path: 'data/import',
        name: 'data-import',
        component: () => import('@/views/data/ImportView.vue'),
      },
      {
        path: 'data/export',
        name: 'data-export',
        component: () => import('@/views/data/ExportView.vue'),
      },
      {
        path: 'data/migration',
        name: 'data-migration',
        component: () => import('@/views/data/MigrationView.vue'),
      },
      {
        path: 'data/integrity',
        name: 'data-integrity',
        component: () => import('@/views/data/IntegrityView.vue'),
      },

      {
        path: 'settings/company',
        name: 'settings-company',
        component: () => import('@/views/settings/CompanySettingsView.vue'),
      },
      {
        path: 'settings/preferences',
        name: 'settings-preferences',
        component: () => import('@/views/settings/PreferencesView.vue'),
      },
      {
        path: 'settings/users',
        name: 'settings-users',
        component: () => import('@/views/settings/UsersView.vue'),
      },
      {
        path: 'settings/audit',
        name: 'settings-audit',
        component: () => import('@/views/settings/AuditTrailView.vue'),
      },

      { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/views/NotFoundView.vue') },
    ],
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

export default router
