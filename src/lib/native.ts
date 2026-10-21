import { isTauri } from '@tauri-apps/api/core'

/**
 * True when the application is running inside the desktop shell.
 *
 * The browser build is a preview only: it has no local database, so it uses
 * the in-memory sample workspace and says so.
 */
export function isDesktopRuntime(): boolean {
  try {
    return isTauri()
  } catch {
    return false
  }
}
