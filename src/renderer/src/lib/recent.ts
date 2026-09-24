import type { ToolId } from '../tools/registry'

const KEY = 'qx.recentTools'

export function loadRecent(): ToolId[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is ToolId => typeof x === 'string').slice(0, 4) : []
  } catch {
    return []
  }
}

export function pushRecent(id: ToolId): void {
  try {
    const next = [id, ...loadRecent().filter((x) => x !== id)].slice(0, 4)
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* 忽略 */
  }
}
