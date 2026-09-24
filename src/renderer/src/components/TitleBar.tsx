import { Box, Minus, Monitor, Moon, Square, Sun, X } from 'lucide-react'
import { useState } from 'react'
import { applyTheme, loadTheme, type ThemeMode } from '../lib/theme'

const NEXT: Record<ThemeMode, ThemeMode> = { system: 'light', light: 'dark', dark: 'system' }
const LABEL: Record<ThemeMode, string> = { system: '跟随系统', light: '浅色', dark: '深色' }

export function TitleBar() {
  const [theme, setTheme] = useState<ThemeMode>(loadTheme)
  const isMac = window.qx.platform === 'darwin'
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor

  const cycleTheme = () => {
    const next = NEXT[theme]
    setTheme(next)
    applyTheme(next)
  }

  return (
    <header className={`titlebar${isMac ? ' mac' : ''}`}>
      <div className="brand">
        <div className="logo">
          <Box size={14} strokeWidth={2.4} />
        </div>
        轻匣 <small>文件处理工具箱</small>
      </div>
      <div className="spacer" />
      <div className="actions">
        <button className="tb-btn" onClick={cycleTheme} title={`主题：${LABEL[theme]}`} aria-label="切换主题">
          <ThemeIcon size={16} />
        </button>
        {!isMac && (
          <div className="win-controls">
            <button className="win-btn" onClick={() => window.qx.windowControl('minimize')} aria-label="最小化">
              <Minus size={16} />
            </button>
            <button className="win-btn" onClick={() => window.qx.windowControl('maximize')} aria-label="最大化">
              <Square size={12} />
            </button>
            <button className="win-btn close" onClick={() => window.qx.windowControl('close')} aria-label="关闭">
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
