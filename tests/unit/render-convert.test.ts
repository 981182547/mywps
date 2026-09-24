import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { imagesToPdf } from '../../src/main/engine/pdf'
import { itemsToLines, pdfToImages, pdfToPpt, pdfToText } from '../../src/main/engine/render'
import { FIX, makePdf, tempDir } from './helpers'

let dir: string
let cleanup: () => Promise<void>
beforeEach(async () => ({ dir, cleanup } = await tempDir()))
afterEach(() => cleanup())

/** 读取 PNG / JPEG 的像素尺寸 */
function imageSize(b: Buffer): [number, number] {
  if (b[0] === 0x89) return [b.readUInt32BE(16), b.readUInt32BE(20)]
  let o = 2
  while (o < b.length) {
    const m = b[o + 1]
    const len = b.readUInt16BE(o + 2)
    if (m >= 0xc0 && m <= 0xc3) return [b.readUInt16BE(o + 7), b.readUInt16BE(o + 5)]
    o += 2 + len
  }
  throw new Error('bad jpeg')
}

describe('PDF 转图片', () => {
  it('每页一张，按 DPI 计算像素尺寸，多张放入文件夹', async () => {
    const src = await makePdf(dir, '文档.pdf', 3, 143, 0, 72) // 144x72 磅 = 2x1 英寸
    const out = await pdfToImages({ type: 'pdf-to-images', path: src, mode: 'pages', format: 'png', dpi: 150, quality: 90, gap: false, output: { dir } })
    expect(out.map((p) => p.split(/[\\/]/).slice(-2).join('/'))).toEqual(['文档_图片/文档_01.png', '文档_图片/文档_02.png', '文档_图片/文档_03.png'])
    expect(imageSize(await readFile(out[0]))).toEqual([300, 150])
  })

  it('只转换指定页面，单张直接放在输出目录', async () => {
    const src = await makePdf(dir, 'a.pdf', 5, 143, 0, 72)
    const out = await pdfToImages({ type: 'pdf-to-images', path: src, mode: 'pages', format: 'jpg', dpi: 72, quality: 80, gap: false, ranges: '4', output: { dir } })
    expect(out).toEqual([join(dir, 'a_04.jpg')])
    const b = await readFile(out[0])
    expect(b[0]).toBe(0xff)
    expect(imageSize(b)).toEqual([147, 72])
  })

  it('长图：页面纵向拼接', async () => {
    const src = await makePdf(dir, 'a.pdf', 3, 143, 0, 72)
    const [out] = await pdfToImages({ type: 'pdf-to-images', path: src, mode: 'long', format: 'jpg', dpi: 72, quality: 85, gap: false, output: { dir } })
    expect(out).toBe(join(dir, 'a_长图.jpg'))
    // 页宽 144..146，统一缩放到最宽 146
    const [w, h] = imageSize(await readFile(out))
    expect(w).toBe(146)
    expect(h).toBeGreaterThan(200)
  })

  it('长图超过高度上限时自动分成多张', async () => {
    const src = await makePdf(dir, 'tall.pdf', 3, 99, 0, 14000) // 每页 14000 磅，150 DPI 下约 29167 像素
    const out = await pdfToImages({ type: 'pdf-to-images', path: src, mode: 'long', format: 'jpg', dpi: 150, quality: 60, gap: false, output: { dir } })
    expect(out.length).toBe(2)
    for (const p of out) expect(imageSize(await readFile(p))[1]).toBeLessThanOrEqual(60000)
  })

  it('照片内容渲染正确（颜色未失真）', async () => {
    const [pdf] = await imagesToPdf({ type: 'images-to-pdf', images: [join(FIX, 'plain.jpg')], pageSize: 'fit', orientation: 'auto', marginMm: 0, output: { dir }, fileName: 'p' })
    const [png] = await pdfToImages({ type: 'pdf-to-images', path: pdf, mode: 'pages', format: 'png', dpi: 96, quality: 90, gap: false, output: { dir } })
    const { createCanvas, loadImage } = await import('@napi-rs/canvas')
    const img = await loadImage(await readFile(png))
    const c = createCanvas(img.width, img.height)
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const [r, g, b] = ctx.getImageData(Math.floor(img.width * 0.25), Math.floor(img.height / 2), 1, 1).data
    expect(r).toBeGreaterThan(200)
    expect(g + b).toBeLessThan(100)
  })
})

describe('PDF 转文字', () => {
  it('未嵌入字体的中文 PDF 能正确提取，按行输出', async () => {
    const [out] = await pdfToText({ type: 'pdf-to-txt', path: join(FIX, 'cjk-nonembedded.pdf'), pageMarkers: false, output: { dir } })
    const text = (await readFile(out, 'utf8')).replace(/^﻿/, '')
    expect(text).toContain('关于印发工作方案的通知')
    expect(text).toContain('各部门：现将有关事项通知如下。')
    expect(text).toContain('第二段 Hello 2024 年')
    const lines = text.split(/\r\n/).filter(Boolean)
    expect(lines[0]).toBe('关于印发工作方案的通知')
  })

  it('没有文字的 PDF（扫描件）给出提示', async () => {
    const src = await makePdf(dir, 'scan.pdf', 2)
    await expect(pdfToText({ type: 'pdf-to-txt', path: src, pageMarkers: true, output: { dir } })).rejects.toThrow('可能是扫描件')
  })

  it('行还原：同一行的片段按横坐标拼接，大间距插入空行', () => {
    const it = (s: string, x: number, y: number, w = 20) => ({ str: s, transform: [10, 0, 0, 10, x, y], width: w, height: 10 })
    expect(itemsToLines([it('世界', 40, 700), it('你好', 10, 700), it('B', 10, 686), it('C', 10, 600)])).toEqual(['你好世界', 'B', '', 'C'])
    expect(itemsToLines([it('Hello', 10, 700, 25), it('World', 45, 700, 25)])).toEqual(['Hello World'])
  })
})

describe('PDF 转 PPT', () => {
  it('每页生成一张幻灯片', async () => {
    const src = await makePdf(dir, '汇报.pdf', 3, 959, 0, 540)
    const [out] = await pdfToPpt({ type: 'pdf-to-ppt', path: src, dpi: 72, output: { dir } })
    expect(out).toBe(join(dir, '汇报.pptx'))
    const zip = await JSZip.loadAsync(await readFile(out))
    const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    expect(slides).toHaveLength(3)
    const media = Object.keys(zip.files).filter((f) => f.startsWith('ppt/media/') && !zip.files[f].dir)
    expect(media.length).toBe(3)
  })
})

it('输出目录下没有残留临时文件', async () => {
  const src = await makePdf(dir, 'a.pdf', 2)
  await pdfToImages({ type: 'pdf-to-images', path: src, mode: 'pages', format: 'jpg', dpi: 36, quality: 50, gap: false, output: { dir } })
  const all = await readdir(dir, { recursive: true })
  expect(all.filter((f) => String(f).endsWith('.tmp'))).toEqual([])
})
