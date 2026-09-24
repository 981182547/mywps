import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { PDFDocument, PageSizes } from 'pdf-lib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { imagesToPdf, mergePdfs, pdfMeta, splitPdf } from '../../src/main/engine/pdf'
import { orientedMatrix, readJpegOrientation } from '../../src/main/engine/images'
import { uniquePath, sanitizeFileName } from '../../src/main/engine/fsutil'

const FIX = join(__dirname, '../fixtures')
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qx-test-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** 生成测试 PDF：第 i 页宽度为 base + i，便于识别页面来源 */
async function makePdf(name: string, pages: number, base: number): Promise<string> {
  const doc = await PDFDocument.create()
  for (let i = 1; i <= pages; i++) doc.addPage([base + i, 500])
  const path = join(dir, name)
  await writeFile(path, await doc.save())
  return path
}

async function widths(path: string): Promise<number[]> {
  const doc = await PDFDocument.load(await readFile(path))
  return doc.getPages().map((p) => Math.round(p.getWidth()))
}

describe('PDF 合并', () => {
  it('按顺序合并全部页面', async () => {
    const a = await makePdf('a.pdf', 2, 100)
    const b = await makePdf('b.pdf', 3, 200)
    const out = await mergePdfs({ type: 'pdf-merge', items: [{ path: b }, { path: a }], output: { dir }, fileName: '合并结果' })
    expect(out).toHaveLength(1)
    expect(basename(out[0])).toBe('合并结果.pdf')
    expect(await widths(out[0])).toEqual([201, 202, 203, 101, 102])
  })

  it('支持每个文件单独指定页码范围', async () => {
    const a = await makePdf('a.pdf', 5, 100)
    const b = await makePdf('b.pdf', 3, 200)
    const out = await mergePdfs({
      type: 'pdf-merge',
      items: [{ path: a, ranges: '5,1-2' }, { path: b, ranges: '3' }],
      output: { dir },
      fileName: 'x.pdf'
    })
    expect(await widths(out[0])).toEqual([105, 101, 102, 203])
  })

  it('不覆盖已有文件', async () => {
    const a = await makePdf('a.pdf', 1, 100)
    const job = { type: 'pdf-merge' as const, items: [{ path: a }, { path: a }], output: { dir }, fileName: 'r' }
    const first = await mergePdfs(job)
    const second = await mergePdfs(job)
    expect(basename(first[0])).toBe('r.pdf')
    expect(basename(second[0])).toBe('r (2).pdf')
  })

  it('页码错误时提示是哪个文件', async () => {
    const a = await makePdf('a.pdf', 2, 100)
    const b = await makePdf('b.pdf', 2, 200)
    await expect(
      mergePdfs({ type: 'pdf-merge', items: [{ path: a }, { path: b, ranges: '9' }], output: { dir }, fileName: 'r' })
    ).rejects.toThrow('“b.pdf”：页码 9 超出范围（文件共 2 页）')
  })

  it('损坏的文件给出友好提示，且不留下输出文件', async () => {
    const a = await makePdf('a.pdf', 1, 100)
    const bad = join(dir, 'bad.pdf')
    await writeFile(bad, 'this is not a pdf')
    await expect(
      mergePdfs({ type: 'pdf-merge', items: [{ path: a }, { path: bad }], output: { dir }, fileName: 'r' })
    ).rejects.toThrow('“bad.pdf”不是有效的 PDF 文件')
    expect(existsSync(join(dir, 'r.pdf'))).toBe(false)
  })

  it('加密的文件给出提示', async () => {
    const a = await makePdf('a.pdf', 1, 100)
    await expect(
      mergePdfs({ type: 'pdf-merge', items: [{ path: a }, { path: join(FIX, 'encrypted.pdf') }], output: { dir }, fileName: 'r' })
    ).rejects.toThrow('“encrypted.pdf”设置了打开密码，请先用“PDF 解密”工具移除密码')
    expect(await pdfMeta(join(FIX, 'encrypted.pdf'))).toEqual({ pageCount: 0, encrypted: true })
  })

  it('少于 2 个文件时提示', async () => {
    const a = await makePdf('a.pdf', 1, 100)
    await expect(mergePdfs({ type: 'pdf-merge', items: [{ path: a }], output: { dir }, fileName: 'r' })).rejects.toThrow('至少添加 2 个')
  })

  it('报告进度', async () => {
    const a = await makePdf('a.pdf', 1, 100)
    const seen: number[] = []
    await mergePdfs({ type: 'pdf-merge', items: [{ path: a }, { path: a }], output: { dir }, fileName: 'r' }, (r) => seen.push(r))
    expect(seen[0]).toBe(0)
    expect(seen[seen.length - 1]).toBe(1)
  })
})

describe('PDF 拆分', () => {
  it('每 N 页拆分，多个文件放入单独文件夹', async () => {
    const src = await makePdf('报告.pdf', 5, 100)
    const out = await splitPdf({ type: 'pdf-split', path: src, mode: { kind: 'every', n: 2 }, output: { dir } })
    expect(out.map((p) => basename(p))).toEqual(['报告_第1-2页.pdf', '报告_第3-4页.pdf', '报告_第5页.pdf'])
    expect(out.every((p) => p.startsWith(join(dir, '报告_拆分')))).toBe(true)
    expect(await widths(out[0])).toEqual([101, 102])
    expect(await widths(out[2])).toEqual([105])
  })

  it('按自定义范围拆分', async () => {
    const src = await makePdf('a.pdf', 6, 100)
    const out = await splitPdf({ type: 'pdf-split', path: src, mode: { kind: 'ranges', ranges: '1-2, 6, 3-5' }, output: { dir } })
    expect(out).toHaveLength(3)
    expect(await widths(out[1])).toEqual([106])
    expect(await widths(out[2])).toEqual([103, 104, 105])
  })

  it('提取页面到单个文件，直接放在输出目录', async () => {
    const src = await makePdf('a.pdf', 6, 100)
    const out = await splitPdf({ type: 'pdf-split', path: src, mode: { kind: 'extract', ranges: '2,4-5' }, output: { dir } })
    expect(out).toEqual([join(dir, 'a_提取.pdf')])
    expect(await widths(out[0])).toEqual([102, 104, 105])
  })

  it('每份页数非法时提示', async () => {
    const src = await makePdf('a.pdf', 2, 100)
    await expect(splitPdf({ type: 'pdf-split', path: src, mode: { kind: 'every', n: 0 }, output: { dir } })).rejects.toThrow('大于 0')
  })
})

describe('读取 PDF 信息', () => {
  it('返回页数', async () => {
    const src = await makePdf('a.pdf', 4, 100)
    expect(await pdfMeta(src)).toEqual({ pageCount: 4, encrypted: false })
  })
})

describe('图片转 PDF', () => {
  it('A4 页面，横图自动横向，每张图一页', async () => {
    const out = await imagesToPdf({
      type: 'images-to-pdf',
      images: [join(FIX, 'green.png'), join(FIX, 'plain.jpg')],
      pageSize: 'A4',
      orientation: 'auto',
      marginMm: 10,
      output: { dir },
      fileName: '图片'
    })
    const doc = await PDFDocument.load(await readFile(out[0]))
    expect(doc.getPageCount()).toBe(2)
    const [w, h] = PageSizes.A4
    expect(Math.round(doc.getPage(0).getWidth())).toBe(Math.round(h)) // 横向
    expect(Math.round(doc.getPage(0).getHeight())).toBe(Math.round(w))
  })

  it('带 EXIF 方向的照片按正确方向排版（竖图 → 纵向页面）', async () => {
    const out = await imagesToPdf({
      type: 'images-to-pdf',
      images: [join(FIX, 'rotated-exif6.jpg')],
      pageSize: 'fit',
      orientation: 'auto',
      marginMm: 0,
      output: { dir },
      fileName: 'photo'
    })
    const doc = await PDFDocument.load(await readFile(out[0]))
    // 存储尺寸 200x100 像素，显示为 100x200 → 75x150 磅
    expect(Math.round(doc.getPage(0).getWidth())).toBe(75)
    expect(Math.round(doc.getPage(0).getHeight())).toBe(150)
  })

  it('WEBP、HEIC、BMP、GIF、TIFF 也能转成 PDF', async () => {
    const images = ['tiny.webp', 'photo.heic', 'photo.bmp', 'photo.gif', 'photo.tiff'].map((f) => join(FIX, f))
    const out = await imagesToPdf({ type: 'images-to-pdf', images, pageSize: 'fit', orientation: 'auto', marginMm: 0, output: { dir }, fileName: 'x' })
    const doc = await PDFDocument.load(await readFile(out[0]))
    expect(doc.getPageCount()).toBe(5)
    // BMP 200x100 像素 → 150x75 磅
    expect(Math.round(doc.getPage(2).getWidth())).toBe(150)
  })

  it('不是图片的文件给出明确提示', async () => {
    const txt = join(dir, '说明.jpg')
    await writeFile(txt, 'hello')
    await expect(
      imagesToPdf({ type: 'images-to-pdf', images: [txt], pageSize: 'A4', orientation: 'auto', marginMm: 0, output: { dir }, fileName: 'x' })
    ).rejects.toThrow('“说明.jpg”不是支持的图片格式')
  })
})

describe('图片方向', () => {
  it('读取 EXIF 方向', async () => {
    expect(readJpegOrientation(new Uint8Array(await readFile(join(FIX, 'rotated-exif6.jpg'))))).toBe(6)
    expect(readJpegOrientation(new Uint8Array(await readFile(join(FIX, 'plain.jpg'))))).toBe(1)
  })

  it('方向 6（顺时针 90°）：原图左上角显示在右上角', () => {
    const [a, b, c, d, e, f] = orientedMatrix(6, 0, 0, 100, 200)
    const map = (u: number, v: number) => [a * u + c * v + e, b * u + d * v + f]
    // 原图左上角 = 图像空间 (0,1)，应落在页面右上角 (100,200)
    expect(map(0, 1)).toEqual([100, 200])
    // 原图右上角 = (1,1)，顺时针旋转后应在右下角 (100,0)
    expect(map(1, 1)).toEqual([100, 0])
  })

  it('方向 1 为普通缩放', () => {
    expect(orientedMatrix(1, 10, 20, 30, 40)).toEqual([30, 0, 0, 40, 10, 20])
  })
})

describe('文件名工具', () => {
  it('清理非法字符并补全扩展名', () => {
    expect(sanitizeFileName('a/b:c*?', '.pdf')).toBe('a_b_c__.pdf')
    expect(sanitizeFileName('报告.PDF', '.pdf')).toBe('报告.pdf')
    expect(sanitizeFileName('   ', '.pdf')).toBe('未命名.pdf')
  })

  it('重名自动编号', async () => {
    await writeFile(join(dir, 'x.pdf'), '')
    expect(basename(uniquePath(dir, 'x.pdf'))).toBe('x (2).pdf')
    expect(basename(uniquePath(dir, 'y.pdf'))).toBe('y.pdf')
  })
})
