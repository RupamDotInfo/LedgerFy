/**
 * Headless visual pass over the running dev server.
 *
 * Uses the installed Chrome in headless mode so no window appears on the
 * desktop and the cursor is never moved. The Chrome MCP instance used by
 * other tools is left untouched.
 *
 * Screenshots land in `artifacts/screens`; console errors and horizontal
 * overflow are reported per route.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const BASE = process.env.LEDGERFY_URL ?? 'http://127.0.0.1:5191'
const OUT = 'artifacts/screens'
const CONCURRENCY = 5

/**
 * The browser to drive.
 *
 * A Chrome or Edge install that is already on the machine, found rather than
 * hard-coded, so the pass runs on a colleague's laptop and on CI. Set
 * LEDGERFY_CHROME to point at a specific build.
 */
function findBrowser() {
    if (process.env.LEDGERFY_CHROME) return process.env.LEDGERFY_CHROME

    const candidates = process.platform === 'win32'
        ? [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        ]
        : process.platform === 'darwin'
            ? [
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            ]
            : [
                '/usr/bin/google-chrome',
                '/usr/bin/google-chrome-stable',
                '/usr/bin/microsoft-edge',
                '/usr/bin/chromium',
                '/usr/bin/chromium-browser',
            ]

    for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate
    }

    throw new Error(
        'No Chrome or Edge build found. Set LEDGERFY_CHROME to the browser executable.',
    )
}

const CHROME = findBrowser()

const routes = [
  ['home', '/'],
  ['voucher-sales', '/vouchers/new/sales'],
  ['voucher-journal', '/vouchers/new/journal'],
  ['voucher-register', '/vouchers'],
  ['sales', '/sales'],
  ['purchases', '/purchases'],
  ['ledgers', '/masters/ledgers'],
  ['parties', '/masters/parties'],
  ['items', '/masters/items'],
  ['taxes', '/masters/taxes'],
  ['godowns', '/masters/godowns'],
  ['cost-centres', '/masters/cost-centres'],
  ['currencies', '/masters/currencies'],
  ['banking', '/banking'],
  ['reconciliation', '/banking/reconciliation'],
  ['inventory', '/inventory'],
  ['inventory-register', '/inventory/register'],
  ['inventory-movements', '/inventory/movements'],
  ['inventory-valuation', '/inventory/valuation'],
  ['inventory-activation', '/inventory/activation'],
  ['orders', '/orders'],
  ['purchase-orders', '/orders/purchase'],
  ['production', '/production'],
  ['bom', '/production/bom'],
  ['gstr1', '/compliance/gstr-1'],
  ['gstr3b', '/compliance/gstr-3b'],
  ['employees', '/payroll/employees'],
  ['reports', '/reports'],
  ['report-balance-sheet', '/reports/balance-sheet'],
  ['report-trial-balance', '/reports/trial-balance'],
  ['backup', '/data/backup'],
  ['integrity', '/data/integrity'],
  ['company-settings', '/settings/company'],
  ['audit', '/settings/audit'],
]

const viewports = [
  { name: '1366', width: 1366, height: 768 },
  { name: '1920', width: 1920, height: 1080 },
]

mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--disable-dev-shm-usage',
    '--force-device-scale-factor=1',
    '--disable-background-networking',
  ],
})

const report = []

async function capture(viewport, [name, route]) {
  const page = await browser.newPage()
  await page.setViewport({ width: viewport.width, height: viewport.height })

  const messages = []
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      messages.push(`${message.type()}: ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => {
    messages.push(`pageerror: ${error.message}`)
  })

  try {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 40_000 })
    // Wait for the app shell to actually paint its content.
    await page
      .waitForFunction(
        () => {
          const root = document.querySelector('#app')
          return !!root && root.childElementCount > 0 && document.body.innerText.length > 40
        },
        { timeout: 25_000 },
      )
      .catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 420))

    const file = `${OUT}/${viewport.name}-${name}.png`
    await page.screenshot({ path: file })

    const overflow = await page.evaluate(() => {
      const root = document.documentElement
      return Math.max(0, root.scrollWidth - root.clientWidth)
    })

    report.push({ viewport: viewport.name, name, route, file, overflowPx: overflow, console: messages })
  } catch (error) {
    report.push({
      viewport: viewport.name,
      name,
      route,
      file: null,
      overflowPx: 0,
      console: [`navigation failed: ${error.message}`],
    })
  } finally {
    await page.close()
  }
}

async function runViewport(viewport) {
  const queue = [...routes]
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const next = queue.shift()
      if (next) await capture(viewport, next)
    }
  })
  await Promise.all(workers)
}

await Promise.all(viewports.map(runViewport))

await browser.close()
report.sort((a, b) => a.viewport.localeCompare(b.viewport) || a.name.localeCompare(b.name))
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2))

let problems = 0
for (const entry of report) {
  const issues = []
  if (!entry.file) issues.push('capture failed')
  if (entry.overflowPx > 2) issues.push(`horizontal overflow ${entry.overflowPx}px`)
  if (entry.console.length) issues.push(`${entry.console.length} console messages`)
  if (issues.length) {
    problems += 1
    console.log(`ISSUE ${entry.viewport} ${entry.name}: ${issues.join(', ')}`)
    for (const message of entry.console.slice(0, 4)) console.log(`      ${message.slice(0, 220)}`)
  }
}
console.log(`\ncaptured ${report.length} screens, ${problems} with issues`)
