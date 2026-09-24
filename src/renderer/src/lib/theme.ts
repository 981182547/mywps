export type ThemeMode = 'system' | 'light' | 'dark'

const KEY = 'qx.theme'

export function loadTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* 存储不可用时使用默认值 */
  }
  return 'system'
}

export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement
  if (mode === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', mode)
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    /* 忽略 */
  }
}
