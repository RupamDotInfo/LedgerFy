const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** ISO date (yyyy-mm-dd) -> `12 Mar 2026`. */
export function formatDate(iso: string): string {
  if (!iso) return ''
  const [year, month, day] = iso.split('-')
  const index = Number(month) - 1
  if (!year || Number.isNaN(index) || !MONTHS[index]) return iso
  return `${Number(day)} ${MONTHS[index]} ${year}`
}

/** ISO date -> `12 Mar 2026` with no year change. */
export function formatDateShort(iso: string): string {
  if (!iso) return ''
  const [, month, day] = iso.split('-')
  const index = Number(month) - 1
  if (!MONTHS[index]) return iso
  return `${Number(day)} ${MONTHS[index]}`
}

export function formatDateTime(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const time = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${formatDate(date.toISOString().slice(0, 10))}, ${time}`
}

export function todayIso(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset()
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10)
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`)
  date.setDate(date.getDate() + days)
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10)
}

export function addMonths(iso: string, months: number): string {
  const date = new Date(`${iso}T00:00:00`)
  date.setMonth(date.getMonth() + months)
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10)
}

/** `2026-03-01` -> `Apr 2026` (financial period label). */
export function formatPeriod(iso: string): string {
  const [year, month] = iso.split('-')
  const index = Number(month) - 1
  if (!MONTHS[index]) return iso
  return `${MONTHS[index]} ${year}`
}

export function isDateWithin(iso: string, from: string, to: string): boolean {
  if (!iso) return false
  if (from && iso < from) return false
  if (to && iso > to) return false
  return true
}

export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`).getTime()
  const b = new Date(`${to}T00:00:00`).getTime()
  return Math.round((b - a) / 86_400_000)
}
