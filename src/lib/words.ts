/**
 * Amount in words, using the Indian numbering system (crore, lakh, thousand).
 */

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
]

const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
]

function twoDigits(value: number): string {
  if (value < 20) return ONES[value] ?? ''
  const tens = TENS[Math.floor(value / 10)] ?? ''
  const ones = ONES[value % 10] ?? ''
  return ones ? `${tens}-${ones}` : tens
}

function threeDigits(value: number): string {
  const hundreds = Math.floor(value / 100)
  const rest = value % 100
  const parts: string[] = []
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`)
  if (rest) parts.push(twoDigits(rest))
  return parts.join(' ')
}

/**
 * Convert a minor-unit amount into words.
 * `41022200` (₹410,222.00) becomes "Four Lakh Ten Thousand Two Hundred Twenty-Two".
 */
export function amountInWords(minor: number, currency = 'INR'): string {
  const negative = minor < 0
  const value = Math.abs(minor)
  const major = Math.floor(value / 100)
  const paise = value % 100

  const prefix = currency === 'INR' ? 'INR ' : `${currency} `

  if (major === 0 && paise === 0) return `${prefix}Zero Only`

  const parts: string[] = []
  const crore = Math.floor(major / 10_000_000)
  const remainder = major % 10_000_000
  const lakh = Math.floor(remainder / 100_000)
  const thousand = Math.floor((remainder % 100_000) / 1000)
  const hundreds = remainder % 1000

  if (crore) parts.push(`${threeDigits(crore)} Crore`)
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`)
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`)
  if (hundreds) parts.push(threeDigits(hundreds))

  let text = parts.filter(Boolean).join(' ')

  if (paise) {
    text += ` and ${twoDigits(paise)} Paise`
  }

  return `${negative ? 'Minus ' : ''}${prefix}${text} Only`
}
