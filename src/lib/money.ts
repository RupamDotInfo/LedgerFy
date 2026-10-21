/**
 * Money is represented as an integer number of minor units (paise for INR).
 * Floating point is never used for authoritative amounts.
 */
export type Money = number

export interface CurrencyMeta {
  code: string
  symbol: string
  minorUnits: number
  decimals: number
}

export const CURRENCIES: Record<string, CurrencyMeta> = {
  INR: { code: 'INR', symbol: '₹', minorUnits: 100, decimals: 2 },
  USD: { code: 'USD', symbol: '$', minorUnits: 100, decimals: 2 },
  EUR: { code: 'EUR', symbol: '€', minorUnits: 100, decimals: 2 },
  GBP: { code: 'GBP', symbol: '£', minorUnits: 100, decimals: 2 },
  AED: { code: 'AED', symbol: 'AED ', minorUnits: 100, decimals: 2 },
  SGD: { code: 'SGD', symbol: 'S$', minorUnits: 100, decimals: 2 },
}

export function currencyMeta(code: string): CurrencyMeta {
  return CURRENCIES[code] ?? { code, symbol: `${code} `, minorUnits: 100, decimals: 2 }
}

/**
 * Convert a major-unit decimal (e.g. 1234.56) into minor units without float drift.
 * `minorUnits` is the number of minor units in one major unit (100 paise in a rupee).
 */
export function toMinor(value: string | number, minorUnits = 100): Money {
  if (typeof value === 'number') {
    return Math.round(value * minorUnits)
  }
  const cleaned = value.replace(/[,\s]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return 0
  const negative = cleaned.startsWith('-')
  const digits = cleaned.replace(/[^0-9.]/g, '')
  const decimals = Math.max(0, Math.round(Math.log10(minorUnits)))
  const [whole = '0', fraction = ''] = digits.split('.')
  const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals)
  const scaled = Number(whole || '0') * minorUnits + Number(padded || '0')
  return negative ? -scaled : scaled
}

/** Convert minor units back to a major-unit number (display only). */
export function toMajor(minor: Money, minorUnits = 100): number {
  return minor / minorUnits
}

const formatCache = new Map<string, Intl.NumberFormat>()

function numberFormat(options: Intl.NumberFormatOptions, locale = 'en-IN'): Intl.NumberFormat {
  const key = locale + JSON.stringify(options)
  let formatter = formatCache.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options)
    formatCache.set(key, formatter)
  }
  return formatter
}

/**
 * Format minor units as a currency string.
 * `signed` forces an explicit + / - for variance style figures.
 */
export function formatMoney(
  minor: Money,
  currency = 'INR',
  options: { signed?: boolean; blankZero?: boolean; decimals?: number } = {},
): string {
  const meta = currencyMeta(currency)
  const value = toMajor(minor, meta.minorUnits)
  if (options.blankZero && minor === 0) return ''
  const formatted = numberFormat({
    style: 'currency',
    currency: meta.code,
    minimumFractionDigits: options.decimals ?? meta.decimals,
    maximumFractionDigits: options.decimals ?? meta.decimals,
  }).format(Math.abs(value))
  if (options.signed) {
    return `${minor < 0 ? '−' : '+'}${formatted}`
  }
  return `${minor < 0 ? '−' : ''}${formatted}`
}

/** Format minor units as a plain grouped number (no currency symbol). */
export function formatAmount(minor: Money, decimals = 2): string {
  return numberFormat({
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(toMajor(minor))
}

/** Format a quantity with sensible precision (up to 3 decimals, trimmed). */
export function formatQuantity(value: number, unit?: string): string {
  const text = numberFormat({ maximumFractionDigits: 3 }).format(value)
  return unit ? `${text} ${unit}` : text
}

export function formatPercent(value: number, decimals = 1): string {
  return `${numberFormat({ minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value)}%`
}
