import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { signPdf } from '../../src/main/engine/sign'
import { makePdf, renderPage, tempDir } from './helpers'

let dir: string
let cleanup: () => Promise<void>
beforeEach(async () => ({ dir, cleanup } = await tempDir()))
afterEach(() => cleanup())

async function solid(r: number, g: number, b: number, w = 60, h = 30): Promise<string> {
  return (await sharp({ create: { width: w, height: h, channels: 4, background: { r, g, b, alpha: 1 } } }).png().toBuffer()).toString('base64')
}

/** 左红、中绿、右蓝的三色印章 */
async function triColor(): Promise<string> {
  const w = 90
  const h = 90
  const raw = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      raw[o] = x < 30 ? 255 : 0
      raw[o + 1] = x >= 30 && x < 60 ? 200 : 0
      raw[o + 2] = x >= 60 ? 255 : 0
      raw[o + 3] = 255
    }
  return (await sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()).toString('base64')
}

describe('签名', () => {
  it('按左上角坐标放置在指定页面', async () => {
    const src = await makePdf(dir, 'a.pdf', 2, 399, 0, 400)
    const [out] = await signPdf({
      type: 'pdf-sign',
      path: src,
      images: { s: await solid(255, 0, 0) },
      placements: [{ page: 1, imageId: 's', x: 20, y: 20, w: 100, h: 50 }],
      output: { dir },
      fileName: 'signed'
    })
    expect((await renderPage(out, 1)).inkRatio(0, 0, 1, 1)).toBe(0)
    const r = await renderPage(out, 2)
    const [red, g] = r.pixel(0.15, 0.1)
    expect(red).toBeGreaterThan(200)
    expect(g).toBeLessThan(60)
    expect(r.inkRatio(0.5, 0.5, 1, 1)).toBe(0)
  })

  it('页面自带旋转时，签名仍在看到的左上角', async () => {
    const src = await makePdf(dir, 'rot.pdf', 1, 599, 90, 300) // 显示为 300 x 600
    const [out] = await signPdf({
      type: 'pdf-sign',
      path: src,
      images: { s: await solid(0, 0, 255) },
      placements: [{ page: 0, imageId: 's', x: 10, y: 10, w: 90, h: 45 }],
      output: { dir },
      fileName: 'signed'
    })
    const r = await renderPage(out, 1)
    expect(r.height).toBeGreaterThan(r.width)
    const [, , blue] = r.pixel(0.1, 0.03)
    expect(blue).toBeGreaterThan(200)
    expect(r.inkRatio(0, 0.5, 1, 1)).toBe(0)
  })

  it('没有放置任何内容时提示', async () => {
    const src = await makePdf(dir, 'a.pdf', 1)
    await expect(signPdf({ type: 'pdf-sign', path: src, images: {}, placements: [], output: { dir }, fileName: 'x' })).rejects.toThrow('请先在页面上放置')
  })
})

describe('骑缝章', () => {
  it('印章平分到每页右侧边缘：第 1 页红、第 2 页绿、第 3 页蓝', async () => {
    const src = await makePdf(dir, 'a.pdf', 3, 399, 0, 500)
    const [out] = await signPdf({
      type: 'pdf-sign',
      path: src,
      images: { stamp: await triColor() },
      placements: [],
      seam: { imageId: 'stamp', width: 120, yRatio: 0.5 },
      output: { dir },
      fileName: 'seam'
    })
    const expectColor = [
      (c: number[]) => c[0] > 200 && c[1] < 60,
      (c: number[]) => c[1] > 150 && c[0] < 60,
      (c: number[]) => c[2] > 200 && c[0] < 60
    ]
    for (let p = 1; p <= 3; p++) {
      const r = await renderPage(out, p)
      // 每页只在右边缘 40 磅（120/3）范围内有印章
      expect(expectColor[p - 1](r.pixel(0.97, 0.5))).toBe(true)
      expect(r.inkRatio(0, 0, 0.85, 1)).toBe(0)
    }
  })

  it('骑缝章至少需要 2 页', async () => {
    const src = await makePdf(dir, 'a.pdf', 1)
    await expect(
      signPdf({ type: 'pdf-sign', path: src, images: { s: await triColor() }, placements: [], seam: { imageId: 's', width: 100, yRatio: 0.5 }, output: { dir }, fileName: 'x' })
    ).rejects.toThrow('至少需要 2 页')
  })
})
