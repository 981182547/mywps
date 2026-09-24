// 真实渲染生成的 PDF，检查像素，确认照片方向被正确纠正
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { imagesToPdf } from '../../src/main/engine/pdf'

const FIX = join(__dirname, '../fixtures')
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qx-render-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function renderFirstPage(path: string) {
  const data = new Uint8Array(await readFile(path))
  const task = getDocument({ data })
  const doc = await task.promise
  const page = await doc.getPage(1)
  const viewport = page.getViewport({ scale: 2 })
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const ctx = canvas.getContext('2d')
  await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise
  const pixel = (fx: number, fy: number) => {
    const d = ctx.getImageData(Math.floor(canvas.width * fx), Math.floor(canvas.height * fy), 1, 1).data
    return [d[0], d[1], d[2]]
  }
  const size = [canvas.width, canvas.height]
  await task.destroy()
  return { pixel, size }
}

const isRed = ([r, g, b]: number[]) => r > 200 && g < 60 && b < 60
const isBlue = ([r, g, b]: number[]) => b > 200 && r < 60 && g < 60

describe('图片转 PDF 渲染结果', () => {
  it('EXIF 方向 6 的照片：原图左红右蓝，纠正后应为上红下蓝', async () => {
    const [out] = await imagesToPdf({
      type: 'images-to-pdf',
      images: [join(FIX, 'rotated-exif6.jpg')],
      pageSize: 'fit',
      orientation: 'auto',
      marginMm: 0,
      output: { dir },
      fileName: 'r'
    })
    const { pixel, size } = await renderFirstPage(out)
    expect(size[1]).toBeGreaterThan(size[0])
    expect(isRed(pixel(0.5, 0.25))).toBe(true)
    expect(isBlue(pixel(0.5, 0.75))).toBe(true)
  })

  it('普通照片保持原样：左红右蓝', async () => {
    const [out] = await imagesToPdf({
      type: 'images-to-pdf',
      images: [join(FIX, 'plain.jpg')],
      pageSize: 'A4',
      orientation: 'auto',
      marginMm: 0,
      output: { dir },
      fileName: 'p'
    })
    const { pixel, size } = await renderFirstPage(out)
    expect(size[0]).toBeGreaterThan(size[1]) // 横图 → 横向 A4
    expect(isRed(pixel(0.45, 0.5))).toBe(true)
    expect(isBlue(pixel(0.55, 0.5))).toBe(true)
  })
})
