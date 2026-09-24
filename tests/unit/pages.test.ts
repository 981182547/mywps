import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addPageNumbers, addWatermark, editPages } from '../../src/main/engine/pages'
import { formatPageNumber, watermarkPlacements } from '../../src/shared/layout'
import { FIX, loadDoc, makePdf, renderPage, tempDir } from './helpers'

let dir: string
let cleanup: () => Promise<void>
beforeEach(async () => ({ dir, cleanup } = await tempDir()))
afterEach(() => cleanup())

const out = () => ({ dir })

describe('页面整理', () => {
  it('按新顺序保留页面、删除未列出的页面、叠加旋转', async () => {
    const src = await makePdf(dir, 'a.pdf', 4, 100, 90)
    const [res] = await editPages({
      type: 'pdf-pages',
      path: src,
      pages: [
        { index: 3, rotate: 0 },
        { index: 0, rotate: 90 },
        { index: 2, rotate: -90 }
      ],
      output: out(),
      fileName: 'r'
    })
    const doc = await loadDoc(res)
    expect(doc.getPages().map((p) => Math.round(p.getWidth()))).toEqual([104, 101, 103])
    // 原本已旋转 90°：+0 → 90，+90 → 180，-90 → 0
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([90, 180, 0])
  })

  it('不允许删除全部页面', async () => {
    const src = await makePdf(dir, 'a.pdf', 2)
    await expect(editPages({ type: 'pdf-pages', path: src, pages: [], output: out(), fileName: 'r' })).rejects.toThrow('至少需要保留 1 页')
  })

  it('页面索引越界时报错', async () => {
    const src = await makePdf(dir, 'a.pdf', 2)
    await expect(editPages({ type: 'pdf-pages', path: src, pages: [{ index: 5, rotate: 0 }], output: out(), fileName: 'r' })).rejects.toThrow('页面信息有误')
  })
})

const wm = (path: string, extra: Partial<Parameters<typeof addWatermark>[0]> = {}) =>
  addWatermark({
    type: 'pdf-watermark',
    path,
    mode: 'text',
    text: '机密文件',
    fontSize: 40,
    color: '#ff0000',
    bold: true,
    opacity: 1,
    angle: 0,
    layout: 'center',
    imageScale: 0.3,
    output: out(),
    fileName: 'wm',
    ...extra
  })

describe('水印', () => {
  it('中文文字水印出现在页面中央，四角保持空白', async () => {
    const src = await makePdf(dir, 'a.pdf', 1, 400, 0, 400)
    const [res] = await wm(src)
    const r = await renderPage(res, 1, 1)
    expect(r.inkRatio(0.3, 0.44, 0.7, 0.56)).toBeGreaterThan(0.15)
    expect(r.inkRatio(0, 0, 0.2, 0.2)).toBe(0)
    expect(r.inkRatio(0.8, 0.8, 1, 1)).toBe(0)
  })

  it('页面自带旋转时，水印仍然居中且保持水平', async () => {
    // 宽 600 高 300，旋转 90° 后显示为 300 x 600 的竖页
    const src = await makePdf(dir, 'rot.pdf', 1, 599, 90, 300)
    const [res] = await wm(src, { text: 'WWWWWW', fontSize: 30 })
    const r = await renderPage(res, 1, 1)
    expect(r.height).toBeGreaterThan(r.width)
    // 文字水平：横向一条应有墨迹，同样宽度的竖向区域上下两端没有
    expect(r.inkRatio(0.2, 0.48, 0.8, 0.52)).toBeGreaterThan(0.1)
    expect(r.inkRatio(0.45, 0.1, 0.55, 0.3)).toBe(0)
    expect(r.inkRatio(0.45, 0.7, 0.55, 0.9)).toBe(0)
  })

  it('平铺水印覆盖整页', async () => {
    const src = await makePdf(dir, 'a.pdf', 1, 500, 0, 700)
    const [res] = await wm(src, { layout: 'tile', fontSize: 20, angle: 30, text: 'COPY' })
    const r = await renderPage(res, 1, 1)
    for (const [x, y] of [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]]) {
      expect(r.inkRatio(x, y, x + 0.5, y + 0.5)).toBeGreaterThan(0.005)
    }
  })

  it('只给指定页面加水印', async () => {
    const src = await makePdf(dir, 'a.pdf', 3, 400, 0, 400)
    const [res] = await wm(src, { ranges: '2' })
    expect((await renderPage(res, 1)).inkRatio(0, 0, 1, 1)).toBe(0)
    expect((await renderPage(res, 2)).inkRatio(0, 0, 1, 1)).toBeGreaterThan(0)
    expect((await renderPage(res, 3)).inkRatio(0, 0, 1, 1)).toBe(0)
  })

  it('图片水印', async () => {
    const src = await makePdf(dir, 'a.pdf', 1, 400, 0, 400)
    const [res] = await wm(src, { mode: 'image', imagePath: join(FIX, 'green.png'), imageScale: 0.5 })
    const r = await renderPage(res, 1, 1)
    const [red, green] = r.pixel(0.5, 0.5)
    expect(green).toBeGreaterThan(120)
    expect(red).toBeLessThan(60)
  })

  it('空文字给出提示', async () => {
    const src = await makePdf(dir, 'a.pdf', 1)
    await expect(wm(src, { text: '  ' })).rejects.toThrow('请填写水印文字')
  })
})

describe('页码', () => {
  it('右下角页码；页面自带 90° 旋转时依然在可见的右下角', async () => {
    const src = await makePdf(dir, 'rot.pdf', 2, 599, 90, 300)
    const [res] = await addPageNumbers({
      type: 'pdf-page-numbers',
      path: src,
      position: 'br',
      format: 'n',
      start: 1,
      fontSize: 24,
      color: '#000000',
      marginMm: 10,
      output: out(),
      fileName: 'pn'
    })
    const r = await renderPage(res, 1, 1)
    expect(r.inkRatio(0.6, 0.85, 1, 1)).toBeGreaterThan(0.003)
    expect(r.inkRatio(0.6, 0, 1, 0.15)).toBe(0)
    expect(r.inkRatio(0, 0, 0.4, 0.15)).toBe(0)
    expect(r.inkRatio(0, 0.85, 0.4, 1)).toBe(0)
  })

  it('跳过封面：从第 2 页开始编号为 1', async () => {
    const src = await makePdf(dir, 'a.pdf', 3, 400, 0, 400)
    const [res] = await addPageNumbers({
      type: 'pdf-page-numbers',
      path: src,
      position: 'bc',
      format: 'cn-total',
      start: 1,
      fontSize: 12,
      color: '#333333',
      marginMm: 8,
      ranges: '2-',
      output: out(),
      fileName: 'pn'
    })
    expect((await renderPage(res, 1)).inkRatio(0, 0, 1, 1)).toBe(0)
    expect((await renderPage(res, 2)).inkRatio(0.2, 0.85, 0.8, 1)).toBeGreaterThan(0)
  })

  it('页码格式', () => {
    expect(formatPageNumber('n-total', 3, 10)).toBe('3 / 10')
    expect(formatPageNumber('cn', 3, 10)).toBe('第 3 页')
    expect(formatPageNumber('cn-total', 3, 10)).toBe('第 3 页 共 10 页')
    expect(formatPageNumber('dash', 3, 10)).toBe('- 3 -')
    expect(formatPageNumber('page-of', 3, 10)).toBe('Page 3 of 10')
  })
})

describe('水印布局', () => {
  it('居中只有一个位置，平铺有多个且都与页面相交', () => {
    expect(watermarkPlacements(600, 800, 100, 30, 45, 'center')).toEqual([{ cx: 300, cy: 400 }])
    const tiles = watermarkPlacements(600, 800, 100, 30, 45, 'tile')
    expect(tiles.length).toBeGreaterThan(6)
  })
})
