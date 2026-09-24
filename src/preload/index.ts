import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { JobProgress, QingxiangApi } from '../shared/types'

const api: QingxiangApi = {
  platform: process.platform,
  pickFiles: (filters, multi) => ipcRenderer.invoke('dialog:pick-files', filters, multi),
  pickDir: () => ipcRenderer.invoke('dialog:pick-dir'),
  statFiles: (paths) => ipcRenderer.invoke('file:stat', paths),
  readFile: (path) => ipcRenderer.invoke('file:read', path),
  pdfMeta: (path) => ipcRenderer.invoke('pdf:meta', path),
  imageThumb: (path, size) => ipcRenderer.invoke('image:thumb', path, size),
  pdfEncryption: (path) => ipcRenderer.invoke('pdf:encryption', path),
  officeStatus: (refresh) => ipcRenderer.invoke('office:status', refresh),
  openExternal: (url) => ipcRenderer.send('shell:open-external', url),
  runJob: (jobId, job) => ipcRenderer.invoke('job:run', jobId, job),
  cancelJob: (jobId) => ipcRenderer.send('job:cancel', jobId),
  onJobProgress: (handler) => {
    const listener = (_e: unknown, p: JobProgress) => handler(p)
    ipcRenderer.on('job:progress', listener)
    return () => ipcRenderer.removeListener('job:progress', listener)
  },
  openPath: (path) => ipcRenderer.invoke('shell:open-path', path),
  showInFolder: (path) => ipcRenderer.send('shell:show-in-folder', path),
  pathForFile: (file) => webUtils.getPathForFile(file),
  windowControl: (action) => ipcRenderer.send('window:control', action)
}

contextBridge.exposeInMainWorld('qx', api)
