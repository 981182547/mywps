// 使用 pdf.js 在界面中读取页数、渲染缩略图
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

// 未嵌入字体的 PDF（包括中文）需要这些资源才能正确显示
const ASSETS = {
  standardFontDataUrl: new URL('./pdfjs/standard_fonts/', document.baseURI).href,
  cMapUrl: new URL('./pdfjs/cmaps/', document.baseURI).href,
  cMapPacked: true
}

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
        task = pdfjs.getDocument({ data, ...ASSETS })
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

// ---------- 打开整个文档：页面缩略图、页面尺寸 ----------

export interface PdfHandle {
  pageCount: number
  /** 页面可见尺寸（磅，已考虑页面自带旋转） */
  pageSize(index: number): Promise<{ width: number; height: number }>
  /** 渲染第 index 页（0 起始）为 data URL */
  render(index: number, width: number): Promise<string>
  destroy(): void
}

export type OpenResult = { ok: true; handle: PdfHandle } | { ok: false; encrypted: boolean; error: string }

export async function openPdf(path: string): Promise<OpenResult> {
  let task: pdfjs.PDFDocumentLoadingTask | null = null
  try {
    const data = await window.qx.readFile(path)
    task = pdfjs.getDocument({ data, ...ASSETS })
    const doc = await task.promise
    const t = task
    const cache = new Map<string, Promise<string>>()
    let queue: Promise<unknown> = Promise.resolve()
    let destroyed = false
    const handle: PdfHandle = {
      pageCount: doc.numPages,
      async pageSize(index) {
        const page = await doc.getPage(index + 1)
        const vp = page.getViewport({ scale: 1 })
        return { width: vp.width, height: vp.height }
      },
      render(index, width) {
        const key = `${index}@${width}`
        let p = cache.get(key)
        if (!p) {
          // 串行渲染，避免同时渲染大量页面占满内存
          p = queue.then(async () => {
            if (destroyed) throw new Error('closed')
            const page = await doc.getPage(index + 1)
            const base = page.getViewport({ scale: 1 })
            const viewport = page.getViewport({ scale: (width * (window.devicePixelRatio || 1)) / base.width })
            const canvas = document.createElement('canvas')
            canvas.width = Math.ceil(viewport.width)
            canvas.height = Math.ceil(viewport.height)
            const ctx = canvas.getContext('2d')!
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(0, 0, canvas.width, canvas.height)
            await page.render({ canvas, canvasContext: ctx, viewport }).promise
            page.cleanup()
            return canvas.toDataURL('image/jpeg', 0.85)
          })
          queue = p.catch(() => undefined)
          cache.set(key, p)
        }
        return p
      },
      destroy() {
        destroyed = true
        t.destroy()
      }
    }
    return { ok: true, handle }
  } catch (e) {
    task?.destroy()
    const name = (e as { name?: string })?.name
    if (name === 'PasswordException') return { ok: false, encrypted: true, error: '文件设置了打开密码，请先用“PDF 解密”工具移除密码' }
    return { ok: false, encrypted: false, error: '无法读取，文件可能已损坏' }
  }
}
