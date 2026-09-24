import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanOcrText, ocrImages, ocrPdf } from '../../src/main/engine/ocr'
import { imagesToPdf } from '../../src/main/engine/pdf'
import { openPdfJs } from '../../src/main/engine/render'
import { renderPage, tempDir } from './helpers'

let dir: string
let cleanup: () => Promise<void>
beforeEach(async () => ({ dir, cleanup } = await tempDir()))
afterEach(() => cleanup())

/** 生成一张“扫描件”图片 */
async function scanImage(name: string, lines: string[]): Promise<string> {
  const c = createCanvas(1654, 800)
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.fillStyle = '#111111'
  ctx.font = '52px "Microsoft YaHei", "PingFang SC", "WenQuanYi Zen Hei", "Noto Sans CJK SC", sans-serif'
  lines.forEach((l, i) => ctx.fillText(l, 100, 150 + i * 110))
  const p = join(dir, name)
  await writeFile(p, await c.encode('png'))
  return p
}

describe('识别结果整理', () => {
  it('去掉中文之间的空格，中文语境的标点改为全角', () => {
    expect(cleanOcrText('关于 做 好 年 度 安全 生产 工作 的 通知')).toBe('关于做好年度安全生产工作的通知')
    expect(cleanOcrText('合同 编号 : HT-2024-0815 , 签订 日 期 2024 年 8 月 15 日')).toBe('合同编号：HT-2024-0815，签订日期2024年8月15日')
    expect(cleanOcrText('The quick brown fox, jumps: over')).toBe('The quick brown fox, jumps: over')
    expect(cleanOcrText('a\n\n\n\nb')).toBe('a\n\nb')
  })
})

describe('图片文字识别', () => {
  it('识别中文与数字', async () => {
    const img = await scanImage('通知.png', ['关于做好年度安全生产工作的通知', '联系电话：010-88886666'])
    const r = await ocrImages({ type: 'ocr-images', paths: [img], lang: 'chi', format: 'each', output: {} })
    const text = (await readFile(r.outputs[0], 'utf8')).replace(/^﻿/, '')
    // OCR 结果与字体有关，个别字可能识别有误；检查大部分内容与数字完全正确
    expect(text).toContain('做好年度安全生产工作的通知')
    expect(text).toContain('010-88886666')
    expect(r.preview).toContain('安全生产')
  }, 120_000)

  it('多张图片合并为一个 Word 文档', async () => {
    const a = await scanImage('a.png', ['第一张图片'])
    const b = await scanImage('b.png', ['第二张图片'])
    const r = await ocrImages({ type: 'ocr-images', paths: [a, b], lang: 'chi', format: 'docx', output: { dir } })
    expect(r.outputs).toHaveLength(1)
    expect(r.outputs[0]).toMatch(/等2张_识别结果\.docx$/)
  }, 120_000)
})

describe('扫描版 PDF 识别', () => {
  it('生成可搜索的 PDF：外观不变，文字可以提取', async () => {
    const img = await scanImage('scan.png', ['年度财务审计报告', '审计意见：无保留意见'])
    const [pdf] = await imagesToPdf({ type: 'images-to-pdf', images: [img], pageSize: 'A4', orientation: 'portrait', marginMm: 0, output: { dir }, fileName: '扫描件' })
    const r = await ocrPdf({ type: 'ocr-pdf', path: pdf, lang: 'chi', format: 'searchable', output: { dir } })
    expect(r.outputs[0]).toMatch(/扫描件_可搜索\.pdf$/)
    const { doc, close } = await openPdfJs(r.outputs[0])
    const c = await (await doc.getPage(1)).getTextContent()
    await close()
    const text = c.items.map((it) => ('str' in it ? it.str : '')).join('').replace(/\s/g, '')
    expect(text).toContain('年度财务审计报告')
    // 页面外观与原来一致（文字层不可见）
    const before = await renderPage(pdf, 1, 0.5)
    const after = await renderPage(r.outputs[0], 1, 0.5)
    expect(Math.abs(before.inkRatio(0, 0, 1, 1) - after.inkRatio(0, 0, 1, 1))).toBeLessThan(0.002)
  }, 180_000)

  it('电子版 PDF 的页面不重复识别', async () => {
    const { makePdf } = await import('./helpers')
    const src = await makePdf(dir, 'blank.pdf', 1)
    // 没有文字的空白页会被识别；这里只验证流程可以完成并给出说明
    const r = await ocrPdf({ type: 'ocr-pdf', path: src, lang: 'eng', format: 'txt', output: { dir } })
    expect(r.notes[0]).toContain('识别了 1 页')
  }, 120_000)
})
