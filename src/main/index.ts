import { stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { BrowserWindow, Menu, app, dialog, ipcMain, nativeTheme, shell } from 'electron'
import type { FileInfo, Job, JobProgress } from '../shared/types'
import { readBytes } from './engine/fsutil'
import { pdfMeta } from './engine/pdf'
import createJobWorker from './worker?nodeWorker'
import type { WorkerMessage } from './worker'

const isMac = process.platform === 'darwin'
let mainWindow: BrowserWindow | null = null
/** 正在运行的任务，用于取消 */
const runningJobs = new Map<string, { cancel: () => void }>()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: '轻匣',
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1115' : '#f5f6f8',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function toFileInfo(path: string): Promise<FileInfo | null> {
  try {
    const s = await stat(path)
    if (!s.isFile()) return null
    return { path, name: basename(path), ext: extname(path).slice(1).toLowerCase(), size: s.size }
  } catch {
    return null
  }
}

async function statFiles(paths: string[]): Promise<FileInfo[]> {
  const infos = await Promise.all(paths.map(toFileInfo))
  return infos.filter((i): i is FileInfo => i !== null)
}

function registerIpc(): void {
  ipcMain.handle('dialog:pick-files', async (e, filters: Electron.FileFilter[], multi: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, {
      properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters
    })
    return r.canceled ? [] : statFiles(r.filePaths)
  })

  ipcMain.handle('dialog:pick-dir', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('file:stat', (_e, paths: string[]) => statFiles(paths))
  ipcMain.handle('file:read', (_e, path: string) => readBytes(path))
  ipcMain.handle('pdf:meta', (_e, path: string) => pdfMeta(path))

  ipcMain.handle('job:run', (e, jobId: string, job: Job) => {
    return new Promise<{ outputs: string[] }>((resolve, reject) => {
      const worker = createJobWorker({ workerData: job })
      let settled = false
      runningJobs.set(jobId, {
        cancel: () => {
          if (settled) return
          settled = true
          worker.terminate()
          reject(new Error('已取消'))
        }
      })
      worker.on('exit', () => runningJobs.delete(jobId))
      worker.on('message', (m: WorkerMessage) => {
        if (m.kind === 'progress') {
          const p: JobProgress = { jobId, ratio: m.ratio, message: m.message }
          if (!e.sender.isDestroyed()) e.sender.send('job:progress', p)
        } else if (m.kind === 'done') {
          settled = true
          resolve({ outputs: m.outputs })
        } else {
          settled = true
          if (!m.user) console.error(m.message)
          reject(new Error(m.user ? m.message : '处理时发生意外错误，请重试。如果问题持续出现，请反馈给我们。'))
        }
      })
      worker.on('error', (err) => {
        console.error(err)
        if (!settled) reject(new Error('处理时发生意外错误，请重试'))
        settled = true
      })
      worker.on('exit', (code) => {
        if (!settled) reject(new Error(code === 0 ? '处理意外中断' : '处理进程异常退出，文件可能过大'))
      })
    })
  })

  ipcMain.on('job:cancel', (_e, jobId: string) => runningJobs.get(jobId)?.cancel())

  ipcMain.handle('shell:open-path', async (_e, path: string) => {
    const err = await shell.openPath(path)
    if (err) throw new Error(err)
  })
  ipcMain.on('shell:show-in-folder', (_e, path: string) => shell.showItemInFolder(path))

  ipcMain.on('window:control', (e, action: 'minimize' | 'maximize' | 'close') => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    if (action === 'minimize') win.minimize()
    else if (action === 'maximize') (win.isMaximized() ? win.unmaximize() : win.maximize())
    else win.close()
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    if (!isMac) Menu.setApplicationMenu(null)
    registerIpc()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })
}
