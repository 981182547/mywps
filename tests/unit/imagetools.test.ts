import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { compressImages, convertImages, decodeImage, resizeImages } from '../../src/main/engine/imagetools'
import { detectImageKind } from '../../src/main/engine/images'
import { FIX, tempDir } from './helpers'

let dir: string
let cleanup: () => Promise<void>
beforeEach(async () => ({ dir, cleanup } = await tempDir()))
afterEach(() => cleanup())

/** 生成一张细节丰富的大照片（压缩测试用） */
async function bigPhoto(name = 'big.jpg'): Promise<string> {
  const w = 1600
  const h = 1200
  const raw = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3
      raw[o] = (x * 255) / w
      raw[o + 1] = (y * 255) / h
      raw[o + 2] = (x * y) % 256
    }
  const path = join(dir, name)
  await writeFile(path, await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 98 }).toBuffer())
  return path
}

async function pixelAt(path: string, fx: number, fy: number): Promise<number[]> {
  const { image } = await decodeImage(path)
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true })
  const o = (Math.floor(info.height * fy) * info.width + Math.floor(info.width * fx)) * info.channels
  return [data[o], data[o + 1], data[o + 2], data[o + 3]]
}

describe('读取各种图片格式', () => {
  for (const f of ['photo.bmp', 'photo.gif', 'photo.tiff', 'photo.heic', 'plain.jpg']) {
    it(`${f}：左红右蓝`, async () => {
      const [r1, , b1] = await pixelAt(join(FIX, f), 0.25, 0.5)
      const [r2, , b2] = await pixelAt(join(FIX, f), 0.75, 0.5)
      expect(r1).toBeGreaterThan(180)
      expect(b1).toBeLessThan(80)
      expect(b2).toBeGreaterThan(180)
      expect(r2).toBeLessThan(80)
    })
  }

  it('JPEG 按 EXIF 方向摆正', async () => {
    const { image } = await decodeImage(join(FIX, 'rotated-exif6.jpg'))
    const m = await image.metadata()
    expect([m.width, m.height]).toEqual([100, 200])
  })
})

describe('图片格式转换', () => {
  it('批量转换为多种格式，输出可被正确识别', async () => {
    for (const [format, kind] of [
      ['png', 'png'],
      ['jpg', 'jpeg'],
      ['webp', 'webp'],
      ['bmp', 'bmp'],
      ['tiff', 'tiff'],
      ['ico', 'ico'],
      ['avif', 'avif']
    ] as const) {
      const r = await convertImages({ type: 'image-convert', paths: [join(FIX, 'photo.heic')], format, quality: 85, background: '#ffffff', output: { dir } })
      expect(r.failures).toEqual([])
      expect(detectImageKind(new Uint8Array(await readFile(r.outputs[0])))).toBe(kind)
    }
  })

  it('BMP 输出内容正确', async () => {
    const r = await convertImages({ type: 'image-convert', paths: [join(FIX, 'plain.jpg')], format: 'bmp', quality: 90, background: '#ffffff', output: { dir } })
    const [red] = await pixelAt(r.outputs[0], 0.25, 0.5)
    expect(red).toBeGreaterThan(180)
  })

  it('透明 PNG 转 JPG 时用背景色填充', async () => {
    const r = await convertImages({ type: 'image-convert', paths: [join(FIX, 'transparent.png')], format: 'jpg', quality: 90, background: '#000000', output: { dir } })
    const [r0, g0, b0] = await pixelAt(r.outputs[0], 0.02, 0.02)
    expect(r0 + g0 + b0).toBeLessThan(30)
  })

  it('单个文件失败不影响其他文件', async () => {
    const bad = join(dir, '坏图.png')
    await writeFile(bad, 'nope')
    const r = await convertImages({ type: 'image-convert', paths: [bad, join(FIX, 'plain.jpg')], format: 'png', quality: 90, background: '#fff', output: { dir } })
    expect(r.outputs).toHaveLength(1)
    expect(r.failures[0]).toContain('坏图.png')
  })

  it('默认保存在源文件所在文件夹，不覆盖同名文件', async () => {
    const src = join(dir, 'a.png')
    await writeFile(src, await readFile(join(FIX, 'green.png')))
    const r = await convertImages({ type: 'image-convert', paths: [src], format: 'png', quality: 90, background: '#fff', output: {} })
    expect(r.outputs[0]).toBe(join(dir, 'a (2).png'))
  })
})

describe('图片压缩', () => {
  it('按质量压缩，体积明显减小', async () => {
    const src = await bigPhoto()
    const r = await compressImages({ type: 'image-compress', paths: [src], mode: 'quality', quality: 70, targetKB: 0, output: { dir } })
    const before = (await stat(src)).size
    const after = (await stat(r.outputs[0])).size
    expect(basename(r.outputs[0])).toBe('big_压缩.jpg')
    expect(after).toBeLessThan(before * 0.6)
    expect(r.notes[0]).toMatch(/减小 \d+%/)
  })

  it('压缩到指定大小以内', async () => {
    const src = await bigPhoto()
    const r = await compressImages({ type: 'image-compress', paths: [src], mode: 'target', quality: 0, targetKB: 60, output: { dir } })
    expect((await stat(r.outputs[0])).size).toBeLessThanOrEqual(60 * 1024)
  })

  it('限制最大宽度', async () => {
    const src = await bigPhoto()
    const r = await compressImages({ type: 'image-compress', paths: [src], mode: 'quality', quality: 80, targetKB: 0, maxWidth: 800, output: { dir } })
    expect((await sharp(await readFile(r.outputs[0])).metadata()).width).toBe(800)
  })

  it('已经很小的图片不会越压越大', async () => {
    const r = await compressImages({ type: 'image-compress', paths: [join(FIX, 'green.png')], mode: 'quality', quality: 95, targetKB: 0, output: { dir } })
    expect((await stat(r.outputs[0])).size).toBeLessThanOrEqual((await stat(join(FIX, 'green.png'))).size)
  })
})

describe('调整尺寸', () => {
  const base = { type: 'image-resize' as const, percent: 50, width: 0, height: 0, fit: 'fill' as const, background: '#ffffff' }
  it('按百分比', async () => {
    const r = await resizeImages({ ...base, paths: [join(FIX, 'plain.jpg')], mode: 'percent', output: { dir } })
    expect(basename(r.outputs[0])).toBe('plain_100x50.jpg')
  })
  it('按宽度等比缩放', async () => {
    const r = await resizeImages({ ...base, paths: [join(FIX, 'plain.jpg')], mode: 'width', width: 80, output: { dir } })
    const m = await sharp(await readFile(r.outputs[0])).metadata()
    expect([m.width, m.height]).toEqual([80, 40])
  })
  it('证件照：裁剪填满 295x413', async () => {
    const r = await resizeImages({ ...base, paths: [join(FIX, 'plain.jpg')], mode: 'box', width: 295, height: 413, fit: 'cover', output: { dir } })
    const m = await sharp(await readFile(r.outputs[0])).metadata()
    expect([m.width, m.height]).toEqual([295, 413])
  })
  it('尺寸非法时提示', async () => {
    const r = resizeImages({ ...base, paths: [join(FIX, 'plain.jpg')], mode: 'box', width: 0, height: 10, output: { dir } })
    await expect(r).rejects.toThrow('1 ~ 30000')
  })
})
