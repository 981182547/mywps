// 使用 pdf.js 在界面中读取页数、渲染缩略图
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface PdfPreview {
  pageCount: number
  /** 第一页缩略图（data URL）；加密文件为空 */
  thumb: string | null
  encrypted: boolean
  error?: string
}

const cache = new Map<string, Promise<PdfPreview>>()

// 限制同时渲染的数量，避免一次拖入大量文件时卡顿
let running = 0
const queue: (() => void)[] = []
async function limit<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>((r) => queue.push(r))
  running++
  try {
    return await fn()
  } finally {
    running--
    queue.shift()?.()
  }
}

async function renderFirstPage(doc: pdfjs.PDFDocumentProxy, targetWidth: number): Promise<string> {
  const page = await doc.getPage(1)
  const base = page.getViewport({ scale: 1 })
  const scale = (targetWidth * 2) / base.width
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas, canvasContext: ctx, viewport }).promise
  const url = canvas.toDataURL('image/jpeg', 0.85)
  page.cleanup()
  return url
}

export function previewPdf(path: string, targetWidth = 120): Promise<PdfPreview> {
  const key = `${path}@${targetWidth}`
  let p = cache.get(key)
  if (!p) {
    p = limit(async () => {
      let task: pdfjs.PDFDocumentLoadingTask | null = null
      try {
        const data = await window.qx.readFile(path)
        task = pdfjs.getDocument({ data })
        const doc = await task.promise
        const thumb = await renderFirstPage(doc, targetWidth)
        return { pageCount: doc.numPages, thumb, encrypted: false }
      } catch (e) {
        const name = (e as { name?: string })?.name
        if (name === 'PasswordException') return { pageCount: 0, thumb: null, encrypted: true }
        return { pageCount: 0, thumb: null, encrypted: false, error: '无法读取，文件可能已损坏' }
      } finally {
        task?.destroy()
      }
    })
    cache.set(key, p)
    // 失败的结果不缓存，允许重试
    p.then((r) => {
      if (r.error) cache.delete(key)
    })
  }
  return p
}
