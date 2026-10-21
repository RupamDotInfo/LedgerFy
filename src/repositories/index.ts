import { isDesktopRuntime } from '@/lib/native'
import { DemoRepository } from '@/repositories/demo/demoRepository'
import { SqliteRepository } from '@/repositories/sqlite/sqliteRepository'
import type { LedgerFyRepository } from '@/repositories/contracts'

/**
 * The repository the application reads and writes through.
 *
 * In the desktop shell this is the local SQLite database, which survives a
 * restart. In a browser it is the in-memory sample workspace, which the
 * interface labels as a preview. A failure to open the local database is
 * reported to the user; it is never quietly replaced with sample data.
 */
const sqliteRepository = new SqliteRepository()
const demoRepository = new DemoRepository()

export function getRepository(): LedgerFyRepository {
  return isDesktopRuntime() ? sqliteRepository : demoRepository
}

export { demoRepository, sqliteRepository }
export type { LedgerFyRepository }
