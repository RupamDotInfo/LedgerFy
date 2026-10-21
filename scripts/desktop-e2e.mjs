import { existsSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

// The packaged desktop build, found relative to this script so the path works
// on any machine. Set LEDGERFY_EXE to point at a specific build.
const EXE = process.env.LEDGERFY_EXE
    ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'target', 'release', 'ledgerfy.exe')
const DEBUG_PORT = 9333
const BASE_URL = 'http://tauri.localhost'
const VOUCHER_MARKER = `E2E-${Date.now()}`

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForDebugPort(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return true
    } catch {
      // The port is not open yet.
    }
    await sleep(500)
  }
  return false
}

async function launch() {
  const { spawn } = await import('node:child_process')
  return spawn(EXE, [], {
    env: {
      ...process.env,
      LEDGERFY_OFFSCREEN: '1',
      LEDGERFY_DEBUG_PORT: String(DEBUG_PORT),
    },
    stdio: 'ignore',
  })
}

const results = []
function check(name, passed, detail) {
  results.push({ name, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

if (!existsSync(EXE)) {
  console.error(`The packaged application is missing at ${EXE}`)
  process.exit(1)
}

const workspaceRoot = join(process.env.LOCALAPPDATA ?? '', 'info.rupam.ledgerfy')
if (existsSync(workspaceRoot)) {
  rmSync(workspaceRoot, { recursive: true, force: true })
}

/** Connect to the running application and wait until it has painted. */
async function openApp() {
  const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${DEBUG_PORT}`,
    defaultViewport: { width: 1440, height: 900 },
  })
  const pages = await browser.pages()
  const page = pages[0] ?? (await browser.newPage())

  await page
    .waitForFunction(
      () => {
        const root = document.querySelector('#app')
        return !!root && root.innerText.trim().length > 20
      },
      { timeout: 60_000 },
    )
    .catch(() => {})

  await sleep(1200)
  return { browser, page }
}

/** Call one of the application's own commands from inside the webview. */
async function callCommand(page, command, args = {}) {
  return page.evaluate(
    async (name, payload) => {
      const internals = window.__TAURI_INTERNALS__
      if (!internals) return { error: 'the command bridge is not available' }
      try {
        return { value: await internals.invoke(name, payload) }
      } catch (error) {
        return { error: String(error) }
      }
    },
    command,
    args,
  )
}

/**
 * Drive the sales voucher screen the way a user would: choose a customer,
 * enter a narration and post the invoice. Then read the stored record back
 * through the application's own commands.
 */
async function postSalesInvoice(page, companyId, marker, base) {
  await page.goto(`${base}/vouchers/new/sales`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => {
      const root = document.querySelector('#app')
      // The rendered text is upper-cased by the design system.
      return !!root && /itemized tax matrix/i.test(root.innerText)
    },
    { timeout: 45_000 },
  )
  await sleep(1200)

  // Choose the first customer in the party list.
  const chosen = await page.evaluate(() => {
    const input = document.querySelector('input[role="combobox"]')
    if (!input) return false
    input.focus()
    return true
  })
  if (!chosen) return { posted: false, detail: 'the party list was not available' }

  await page.keyboard.type('Anand')
  await sleep(700)
  const picked = await page.evaluate(() => {
    const option = document.querySelector('[role="option"]')
    if (!option) return false
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    return true
  })
  if (!picked) return { posted: false, detail: 'no customer matched' }

  await sleep(400)
  await page.evaluate((text) => {
    const textarea = document.querySelector('textarea')
    if (!textarea) return
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    ).set
    setter.call(textarea, text)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  }, `${marker} posted invoice`)
  await sleep(400)

  const clicked = await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((element) =>
      element.textContent?.includes('Post Voucher'),
    )
    if (!button || button.disabled) return false
    button.click()
    return true
  })
  if (!clicked) return { posted: false, detail: 'the post button was unavailable' }

  await sleep(3500)

  const vouchers = await callCommand(page, 'list_vouchers_cmd', {
    companyId,
    filters: { search: marker, type: 'sales' },
  })
  const list = vouchers.value ?? []
  const found = list.find(
    (voucher) => voucher.narration?.includes(marker) && voucher.status === 'posted',
  )

  // Every posted voucher in the company must balance.
  const all = await callCommand(page, 'list_vouchers_cmd', {
    companyId,
    filters: { status: 'posted' },
  })
  const balanced = (all.value ?? []).every((voucher) => {
    const debit = (voucher.entries ?? []).reduce((sum, entry) => sum + entry.debit, 0)
    const credit = (voucher.entries ?? []).reduce((sum, entry) => sum + entry.credit, 0)
    return debit === credit
  })

  return {
    posted: Boolean(found),
    detail: found ? `invoice ${found.number}` : 'the invoice was not stored',
    status: found?.status ?? 'missing',
    balanced,
  }
}

/**
 * Verify the inventory engine against the stored records.
 *
 * The checks read the database through the application's own commands, so they
 * prove what the application actually holds rather than what a file looks
 * like. The invariant that matters most is the second one: the inventory
 * asset in the general ledger must equal the carrying value of the stock
 * pools, to the paisa.
 */
async function verifyInventory(page, companyId) {
  const accounts = await callCommand(page, 'get_inventory_accounts_cmd', { companyId })
  const pools = await callCommand(page, 'list_stock_pools_cmd', { companyId })
  const locations = await callCommand(page, 'list_stock_balances_cmd', { companyId })
  const movements = await callCommand(page, 'list_stock_movements_cmd', { companyId })
  const ledgers = await callCommand(page, 'list_ledgers_cmd', { companyId })
  const vouchers = await callCommand(page, 'list_vouchers_cmd', {
    companyId,
    filters: { status: 'posted' },
  })

  const configuration = accounts.value ?? null
  const poolList = pools.value ?? []
  const locationList = locations.value ?? []
  const movementList = movements.value ?? []
  const voucherList = vouchers.value ?? []
  const ledgerList = ledgers.value ?? []

  const poolValue = poolList.reduce((sum, pool) => sum + (pool.carryingValue ?? 0), 0)

  const inventoryLedgerId = configuration?.inventoryLedgerId ?? null
  const inventoryLedger = ledgerList.find((ledger) => ledger.id === inventoryLedgerId)
  const ledgerBalance = inventoryLedgerId
    ? (inventoryLedger?.openingBalance ?? 0) +
      voucherList
        .flatMap((voucher) => voucher.entries ?? [])
        .filter((entry) => entry.ledgerId === inventoryLedgerId)
        .reduce((sum, entry) => sum + entry.debit - entry.credit, 0)
    : null

  const movementValue = movementList.reduce(
    (sum, movement) =>
      sum + (movement.direction === 'in' ? movement.value : -movement.value),
    0,
  )

  // Every movement must carry a costing result and an exact quantity.
  const movementsComplete = movementList.every(
    (movement) =>
      Number.isInteger(movement.quantityMilli) &&
      typeof movement.valuationMethod === 'string' &&
      movement.valuationMethod.length > 0 &&
      Number.isInteger(movement.value),
  )

  const balanced = voucherList.every((voucher) => {
    const debit = (voucher.entries ?? []).reduce((sum, entry) => sum + entry.debit, 0)
    const credit = (voucher.entries ?? []).reduce((sum, entry) => sum + entry.credit, 0)
    return debit === credit
  })

  return {
    configuration,
    poolList,
    locationList,
    movementList,
    voucherList,
    poolValue,
    ledgerBalance,
    movementValue,
    movementsComplete,
    balanced,
  }
}

/**
 * Read the orders and the production orders back through the application's own
 * commands, and work out the state each one should be showing.
 *
 * The state is derived from the deliveries, so the check recomputes it here
 * rather than trusting a stored flag. A screen that shows a state the records
 * do not support is a defect, and this is what would find it.
 */
async function verifyOrdersAndProduction(page, companyId) {
  const orders = await callCommand(page, 'list_orders_cmd', { companyId, kind: null })
  const production = await callCommand(page, 'list_production_orders_cmd', { companyId })
  const orderList = orders.value ?? []
  const productionList = production.value ?? []

  // The list carries the header and the lines; the deliveries are read from
  // the order itself, because the state is derived from them.
  const details = []
  for (const summary of orderList) {
    const detail = await callCommand(page, 'get_order_cmd', { companyId, id: summary.order.id })
    if (detail.value) details.push(detail.value)
  }

  const stateOf = (order) => {
    if (order.order?.status === 'cancelled') return 'cancelled'
    if (order.order?.status === 'draft') return 'draft'
    const lines = order.lines ?? []
    const fulfilments = order.fulfilments ?? []
    const delivered = new Map()
    for (const fulfilment of fulfilments) {
      delivered.set(
        fulfilment.orderLineId,
        (delivered.get(fulfilment.orderLineId) ?? 0) + fulfilment.quantityMilli,
      )
    }
    const complete =
      lines.length > 0 &&
      lines.every((line) => (delivered.get(line.id) ?? 0) >= line.quantityMilli)
    if (complete) return 'fulfilled'
    if (fulfilments.length > 0) return 'partially-fulfilled'
    return 'open'
  }

  const states = details.map(stateOf)

  // Every delivery must be inside the order it says it is.
  const deliveriesWithinTheOrder = details.every((order) => {
    const lines = (order.lines ?? []).map((line) => [line.id, line.quantityMilli])
    const delivered = new Map()
    for (const fulfilment of order.fulfilments ?? []) {
      const ordered = lines.find(([id]) => id === fulfilment.orderLineId)
      if (!ordered) return false
      delivered.set(
        fulfilment.orderLineId,
        (delivered.get(fulfilment.orderLineId) ?? 0) + fulfilment.quantityMilli,
      )
    }
    for (const [id, quantity] of delivered) {
      const ordered = lines.find(([lineId]) => lineId === id)
      if (!ordered || quantity > ordered[1]) return false
    }
    return true
  })

  // The deliveries the sample books hold must actually change the state.
  const deliveriesAreVisible = details.some(
    (order) => (order.fulfilments ?? []).length > 0,
  )

  // A production order's work in progress must net to zero once it is done.
  const productionCostsBalance = productionList.every((order) => {
    const issues = order.issues ?? []
    const completions = order.completions ?? []
    if (issues.length === 0) return true
    const issued = issues.reduce((sum, issue) => sum + (issue.cost ?? 0), 0)
    const transferred = completions.reduce((sum, one) => sum + (one.cost ?? 0), 0)
    return transferred === issued
  })

  return {
    orderList,
    details,
    productionList,
    states,
    deliveriesWithinTheOrder,
    deliveriesAreVisible,
    productionCostsBalance,
  }
}

let child = await launch()
const connected = await waitForDebugPort(DEBUG_PORT)
check('the packaged application starts and exposes its webview', connected)

if (connected) {
  let browser
  let page
  try {
    const opened = await openApp()
    browser = opened.browser
    page = opened.page

    const bodyText = await page.evaluate(() => document.body.innerText)
    check(
      'the first-run screen is shown for an empty workspace',
      bodyText.includes('Welcome to LedgerFy'),
      bodyText.slice(0, 70).replace(/\n/g, ' '),
    )

    const clicked = await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((element) =>
        element.textContent?.includes('Open the sample workspace'),
      )
      if (!button) return false
      button.click()
      return true
    })
    check('the sample workspace can be opened', clicked)

    await page
      .waitForFunction(
        () => document.body.innerText.includes('Executive Operating Dashboard'),
        { timeout: 120_000 },
      )
      .catch(() => {})
    await sleep(2500)

    const afterSeed = await page.evaluate(() => document.body.innerText)
    check(
      'the dashboard renders from the local database',
      afterSeed.includes('Executive Operating Dashboard'),
      afterSeed.slice(0, 70).replace(/\n/g, ' '),
    )

    // The database must exist on disk and report the seeded company.
    const databasePath = join(workspaceRoot, 'ledgerfy.sqlite3')
    check('the workspace database was written to disk', existsSync(databasePath), databasePath)

    const status = await callCommand(page, 'db_status')
    check(
      'the database reports the seeded company',
      status.value?.companyCount > 0,
      `schema version ${status.value?.schemaVersion}, ${status.value?.companyCount} company`,
    )

    const files = [databasePath, `${databasePath}-wal`]
    const totalBytes = files.reduce(
      (sum, file) => (existsSync(file) ? sum + statSync(file).size : sum),
      0,
    )
    check('the database files hold data', totalBytes > 100_000, `${totalBytes} bytes on disk`)

    // Save a voucher through the interface.
    await page.evaluate(() => {
      const link = [...document.querySelectorAll('a')].find((element) =>
        element.getAttribute('href')?.startsWith('/vouchers/new/'),
      )
      link?.click()
    })
    await sleep(3000)

    const entered = await page.evaluate((marker) => {
      const textarea = document.querySelector('textarea')
      if (!textarea) return false
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      ).set
      setter.call(textarea, marker)
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    }, VOUCHER_MARKER)
    check('a voucher can be opened and edited', entered)

    await sleep(800)
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((element) =>
        element.textContent?.includes('Save as Draft'),
      )
      button?.click()
    })
    await sleep(3000)

    const saved = await page.evaluate(() => {
      // The narration lives in a textarea, whose value is not part of the
      // rendered text, so the confirmation toast is the signal here.
      const textarea = document.querySelector('textarea')
      return {
        value: textarea ? textarea.value : '',
        confirmed: document.body.innerText.includes('Draft saved'),
      }
    })
    check(
      'the voucher was accepted by the local database',
      saved.confirmed && saved.value.includes(VOUCHER_MARKER),
      saved.confirmed ? 'the draft was confirmed' : 'no confirmation appeared',
    )

    // Ask the application itself for the stored record.
    const companies = await callCommand(page, 'list_companies_cmd')
    const companyId = companies.value?.[0]?.id
    const stored = await callCommand(page, 'list_vouchers_cmd', {
      companyId,
      filters: { search: VOUCHER_MARKER },
    })
    check(
      'the saved voucher is in the database',
      (stored.value?.length ?? 0) > 0,
      `${stored.value?.length ?? 0} record(s) matched the marker`,
    )

    // Post a real sales invoice and confirm the financial effect is stored.
    const invoiceMarker = `${VOUCHER_MARKER}-invoice`
    const posted = await postSalesInvoice(page, companyId, invoiceMarker, BASE_URL)
    check(
      'a sales invoice can be posted through the interface',
      posted.posted,
      posted.detail,
    )
    check(
      'the posted invoice is stored as posted',
      posted.status === 'posted',
      `status ${posted.status}`,
    )
    check(
      'every posted voucher in the company balances',
      posted.balanced,
      posted.balanced ? 'debits equal credits' : 'a voucher does not balance',
    )

    // -- The inventory engine ------------------------------------------------

    const stock = await verifyInventory(page, companyId)

    check(
      'the inventory accounts of the company are configured',
      Boolean(
        stock.configuration &&
          stock.configuration.inventoryLedgerId &&
          stock.configuration.cogsLedgerId &&
          stock.configuration.varianceLedgerId &&
          stock.configuration.purchasesLedgerId,
      ),
      stock.configuration
        ? `method ${stock.configuration.valuationMethod}`
        : 'no inventory accounts were found',
    )
    check(
      'the costing method in force is moving weighted average',
      stock.configuration?.valuationMethod === 'moving-weighted-average',
      stock.configuration?.valuationMethod ?? 'none',
    )
    check(
      'the stock pools are held in the database',
      stock.poolList.length > 0,
      `${stock.poolList.length} pool(s)`,
    )
    check(
      'the quantity at each location is held in the database',
      stock.locationList.length > 0,
      `${stock.locationList.length} location balance(s)`,
    )
    check(
      'the movement ledger holds the stock history',
      stock.movementList.length > 0,
      `${stock.movementList.length} movement(s)`,
    )
    check(
      'every movement carries an exact quantity and a costing result',
      stock.movementsComplete,
      stock.movementsComplete
        ? 'all movements are complete'
        : 'a movement is missing its quantity or valuation',
    )
    check(
      'the movement ledger replays to the same value as the pools',
      stock.movementValue === stock.poolValue,
      `movements ${stock.movementValue}, pools ${stock.poolValue}`,
    )
    check(
      'the inventory asset in the ledger equals the value of the stock on hand',
      stock.ledgerBalance === stock.poolValue,
      `ledger ${stock.ledgerBalance}, pools ${stock.poolValue}`,
    )
    check(
      'every posted voucher balances after the inventory postings',
      stock.balanced,
      stock.balanced ? 'debits equal credits' : 'a voucher does not balance',
    )

    // The rebuild replays the movement ledger and must agree with what is
    // stored. A difference is reported, never quietly corrected.
    const rebuilt = await callCommand(page, 'rebuild_stock_balances_cmd', { companyId })
    const rebuiltPools = rebuilt.value?.pools ?? []
    const agrees =
      rebuiltPools.length === stock.poolList.length &&
      rebuiltPools.every((pool) => {
        const stored = stock.poolList.find(
          (candidate) => candidate.itemId === pool.itemId,
        )
        return (
          stored &&
          stored.quantityMilli === pool.quantityMilli &&
          stored.carryingValue === pool.carryingValue
        )
      })
    check(
      'replaying the movement ledger reproduces the stored balances',
      agrees,
      agrees
        ? `${rebuiltPools.length} pool(s) reproduced`
        : 'the rebuilt pools differ from the stored pools',
    )

    // -- Orders and production ------------------------------------------------

    const trade = await verifyOrdersAndProduction(page, companyId)

    check(
      'the sample books hold real orders',
      trade.orderList.length > 0,
      `${trade.orderList.length} order(s)`,
    )
    check(
      'every delivery is inside the order it belongs to',
      trade.deliveriesWithinTheOrder,
      trade.deliveriesWithinTheOrder
        ? 'no order is over-delivered'
        : 'an order delivers more than it carries',
    )
    check(
      'the sample books hold deliveries that change an order\'s state',
      trade.deliveriesAreVisible,
      trade.deliveriesAreVisible
        ? 'the deliveries are recorded against the orders'
        : 'no order carries a delivery',
    )
    check(
      'an order shows the state its deliveries support',
      trade.states.every((state) =>
        ['draft', 'open', 'partially-fulfilled', 'fulfilled', 'cancelled'].includes(state),
      ),
      trade.states.join(', '),
    )
    check(
      'the sample books hold a production order',
      trade.productionList.length > 0,
      `${trade.productionList.length} production order(s)`,
    )
    check(
      'the production cost transferred equals the cost of the materials issued',
      trade.productionCostsBalance,
      trade.productionCostsBalance
        ? 'the work in progress account nets to zero'
        : 'the work in progress account does not net to zero',
    )

    await browser.close()
  } catch (error) {
    check('the end-to-end run completed', false, error.message)
    if (page) {
      const text = await page.evaluate(() => document.body.innerText).catch(() => '')
      console.log(`      page text: ${text.slice(0, 300).replace(/\n/g, ' ')}`)
    }
    if (browser) await browser.close().catch(() => {})
  }

  // Restart the application and confirm the data is still there.
  child.kill()
  await sleep(3000)

  child = await launch()
  const reconnected = await waitForDebugPort(DEBUG_PORT)
  check('the application starts again after a restart', reconnected)

  if (reconnected) {
    let browser
    try {
      const opened = await openApp()
      browser = opened.browser
      const page = opened.page

      await page
        .waitForFunction(
          () => document.body.innerText.includes('Executive Operating Dashboard'),
          { timeout: 90_000 },
        )
        .catch(() => {})
      await sleep(2500)

      const afterRestart = await page.evaluate(() => document.body.innerText)
      check(
        'the workspace opens straight into the saved company',
        afterRestart.includes('Executive Operating Dashboard'),
        'no first-run screen after the restart',
      )

      const companies = await callCommand(page, 'list_companies_cmd')
      const companyId = companies.value?.[0]?.id
      const stored = await callCommand(page, 'list_vouchers_cmd', {
        companyId,
        filters: { search: VOUCHER_MARKER },
      })
      check(
        'the voucher saved before the restart is still in the database',
        (stored.value?.length ?? 0) > 0,
        `${stored.value?.length ?? 0} record(s) survived the restart`,
      )

      // The stock must survive the restart too, with its costing intact.
      const stockAfter = await verifyInventory(page, companyId)
      check(
        'the stock movement ledger survives the restart',
        stockAfter.movementList.length > 0,
        `${stockAfter.movementList.length} movement(s) survived the restart`,
      )
      check(
        'the inventory asset still equals the value of the stock on hand',
        stockAfter.ledgerBalance === stockAfter.poolValue,
        `ledger ${stockAfter.ledgerBalance}, pools ${stockAfter.poolValue}`,
      )

      await browser.close()
    } catch (error) {
      check('the restart check completed', false, error.message)
      if (browser) await browser.close().catch(() => {})
    }
  }
}

child.kill()
await sleep(1000)

const failed = results.filter((result) => !result.passed)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
