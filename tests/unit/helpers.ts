import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { PDFDocument, degrees } from 'pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

export const FIX = join(__dirname, '../fixtures')

export async function tempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'qx-test-'))
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

/** 生成测试 PDF：第 i 页宽度为 base + i；可指定页面自带的旋转角度 */
export async function makePdf(dir: string, name: string, pages: number, base = 300, rotate = 0, height = 500): Promise<string> {
  const doc = await PDFDocument.create()
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([base + i, height])
    if (rotate) p.setRotation(degrees(rotate))
  }
  const path = join(dir, name)
  await writeFile(path, await doc.save())
  return path
}

export async function loadDoc(path: string): Promise<PDFDocument> {
  return PDFDocument.load(await readFile(path))
}

export type RGB = [number, number, number]

/** 真实渲染 PDF 某一页，返回取色函数（fx, fy 为 0~1 的相对位置，原点左上） */
export async function renderPage(path: string, pageNumber = 1, scale = 1) {
  const data = new Uint8Array(await readFile(path))
  const task = getDocument({ data })
  const doc = await task.promise
  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale })
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  const W = canvas.width
  const H = canvas.height
  const pixel = (fx: number, fy: number): RGB => {
    const x = Math.min(W - 1, Math.floor(W * fx))
    const y = Math.min(H - 1, Math.floor(H * fy))
    const o = (y * W + x) * 4
    return [img[o], img[o + 1], img[o + 2]]
  }
  /** 统计区域内“非白色”像素占比 */
  const inkRatio = (x0: number, y0: number, x1: number, y1: number): number => {
    let ink = 0
    let n = 0
    for (let y = Math.floor(H * y0); y < Math.floor(H * y1); y++) {
      for (let x = Math.floor(W * x0); x < Math.floor(W * x1); x++) {
        const o = (y * W + x) * 4
        if (img[o] < 235 || img[o + 1] < 235 || img[o + 2] < 235) ink++
        n++
      }
    }
    return n ? ink / n : 0
  }
  await task.destroy()
  return { pixel, inkRatio, width: W, height: H }
}

export const isRed = ([r, g, b]: RGB) => r > 200 && g < 60 && b < 60
export const isBlue = ([r, g, b]: RGB) => b > 200 && r < 60 && g < 60
