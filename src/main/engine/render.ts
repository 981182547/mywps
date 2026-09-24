// 在后台线程中用 pdf.js 渲染 PDF 页面（PDF 转图片 / 长图 / PPT / 文字）
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { createCanvas, type Canvas } from '@napi-rs/canvas'
import { UserError, parseRanges } from '../../shared/ranges'
import type { PdfToImagesJob, PdfToPptJob, PdfToTextJob } from '../../shared/types'
import { ensureDir, readBytes, stem, uniquePath, writeFileAtomic } from './fsutil'
import { noop, type Progress } from './pdf'

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
type PdfDoc = Awaited<ReturnType<PdfJs['getDocument']>['promise']>

let pdfjsPromise: Promise<PdfJs> | null = null
function pdfjs(): Promise<PdfJs> {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjsPromise
}

/** pdf.js 附带的字体映射等资源目录（中文 PDF 未嵌入字体时需要 CMap） */
function assetDirs() {
  const req = createRequire(__filename)
  const root = dirname(req.resolve('pdfjs-dist/package.json'))
  const dir = (name: string) => join(root, name) + '/'
  return { cMapUrl: dir('cmaps'), standardFontDataUrl: dir('standard_fonts'), wasmUrl: dir('wasm'), iccUrl: dir('iccs') }
}

export async function openPdfJs(path: string, password?: string): Promise<{ doc: PdfDoc; close: () => Promise<void> }> {
  const name = basename(path)
  let data: Uint8Array
  try {
    data = await readBytes(path)
  } catch {
    throw new UserError(`无法读取文件“${name}”，请确认文件存在且没有被占用`)
  }
  const lib = await pdfjs()
  const task = lib.getDocument({ data, ...assetDirs(), cMapPacked: true, password, isEvalSupported: false, isOffscreenCanvasSupported: false, verbosity: 0 } as Parameters<PdfJs['getDocument']>[0])
  try {
    const doc = await task.promise
    return { doc, close: () => task.destroy() }
  } catch (e) {
    await task.destroy()
    if ((e as { name?: string })?.name === 'PasswordException') throw new UserError(`“${name}”已加密，请先解除密码后再处理`)
    throw new UserError(`“${name}”不是有效的 PDF 文件，或文件已损坏`)
  }
}

export async function renderPage(doc: PdfDoc, pageIndex: number, dpi: number): Promise<Canvas> {
  const page = await doc.getPage(pageIndex + 1)
  const viewport = page.getViewport({ scale: dpi / 72 })
  const w = Math.max(1, Math.round(viewport.width))
  const h = Math.max(1, Math.round(viewport.height))
  if (w * h > 120_000_000) throw new UserError(`第 ${pageIndex + 1} 页尺寸过大，请降低清晰度后重试`)
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise
  page.cleanup()
  return canvas
}

async function encode(canvas: Canvas, format: 'jpg' | 'png', quality = 90): Promise<Uint8Array> {
  const buf = format === 'png' ? await canvas.encode('png') : await canvas.encode('jpeg', quality)
  return new Uint8Array(buf)
}

function pad(n: number, total: number): string {
  return String(n).padStart(Math.max(2, String(total).length), '0')
}

// ---------- PDF 转图片 / 长图 ----------

/** JPEG 单边上限 65535 像素，留出余量 */
const LONG_MAX_HEIGHT = 60000

export async function pdfToImages(job: PdfToImagesJob, progress: Progress = noop): Promise<string[]> {
  progress(0, `正在读取 ${basename(job.path)}`)
  const { doc, close } = await openPdfJs(job.path)
  try {
    const indices = parseRanges(job.ranges, doc.numPages)
    const dpi = Math.min(600, Math.max(36, job.dpi))
    const base = stem(job.path)
    const outputs: string[] = []

    if (job.mode === 'pages') {
      const dir = indices.length > 1 ? uniquePath(job.output.dir, `${base}_图片`) : job.output.dir
      await ensureDir(dir)
      for (let i = 0; i < indices.length; i++) {
        progress(i / indices.length, `正在转换第 ${indices[i] + 1} 页（${i + 1} / ${indices.length}）`)
        const canvas = await renderPage(doc, indices[i], dpi)
        const target = uniquePath(dir, `${base}_${pad(indices[i] + 1, doc.numPages)}.${job.format}`)
        await writeFileAtomic(target, await encode(canvas, job.format, job.quality))
        outputs.push(target)
      }
    } else {
      // 长图：所有页面缩放到同一宽度后纵向拼接；超过高度上限时自动分成多张
      const pages: Canvas[] = []
      let width = 0
      for (let i = 0; i < indices.length; i++) {
        progress((i / indices.length) * 0.8, `正在渲染第 ${indices[i] + 1} 页（${i + 1} / ${indices.length}）`)
        const c = await renderPage(doc, indices[i], dpi)
        width = Math.max(width, c.width)
        pages.push(c)
      }
      const gap = job.gap ? Math.round(dpi / 6) : 0
      const heights = pages.map((c) => Math.round((c.height * width) / c.width))
      const groups: number[][] = [[]]
      let acc = 0
      heights.forEach((h, i) => {
        const cur = groups[groups.length - 1]
        const add = h + (cur.length ? gap : 0)
        if (cur.length && acc + add > LONG_MAX_HEIGHT) {
          groups.push([i])
          acc = h
        } else {
          cur.push(i)
          acc += add
        }
      })
      await ensureDir(job.output.dir)
      for (let g = 0; g < groups.length; g++) {
        progress(0.8 + (0.2 * g) / groups.length, '正在拼接长图')
        const idx = groups[g]
        const totalH = idx.reduce((s, i) => s + heights[i], 0) + gap * (idx.length - 1)
        const canvas = createCanvas(width, Math.min(LONG_MAX_HEIGHT, totalH))
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = job.gap ? '#e5e7eb' : '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        let y = 0
        for (const i of idx) {
          ctx.drawImage(pages[i], 0, y, width, heights[i])
          y += heights[i] + gap
        }
        const suffix = groups.length > 1 ? `_长图${g + 1}` : '_长图'
        const target = uniquePath(job.output.dir, `${base}${suffix}.${job.format}`)
        await writeFileAtomic(target, await encode(canvas, job.format, job.quality))
        outputs.push(target)
      }
    }
    progress(1, '完成')
    return outputs
  } finally {
    await close()
  }
}

// ---------- PDF 转文字 ----------

interface TextItem {
  str: string
  transform: number[]
  width: number
  height: number
  hasEOL?: boolean
}

/** 按坐标把文字片段还原成行：同一基线的片段拼成一行，行间距过大时插入空行 */
export function itemsToLines(items: TextItem[]): string[] {
  const rows: { y: number; h: number; parts: { x: number; w: number; s: string }[] }[] = []
  for (const it of items) {
    if (!it.str) continue
    const x = it.transform[4]
    const y = it.transform[5]
    const h = Math.abs(it.height || it.transform[3] || 10)
    const row = rows.find((r) => Math.abs(r.y - y) < Math.max(2, Math.min(r.h, h) * 0.5))
    if (row) row.parts.push({ x, w: it.width, s: it.str })
    else rows.push({ y, h, parts: [{ x, w: it.width, s: it.str }] })
  }
  rows.sort((a, b) => b.y - a.y)
  const lines: string[] = []
  let prev: (typeof rows)[number] | null = null
  for (const r of rows) {
    r.parts.sort((a, b) => a.x - b.x)
    let line = ''
    let end = -Infinity
    for (const p of r.parts) {
      // 片段间距明显时补一个空格（中文之间不补）
      if (line && p.x - end > r.h * 0.3 && !/[一-鿿，。、；：！？]$/.test(line)) line += ' '
      line += p.s
      end = p.x + p.w
    }
    if (prev && prev.y - r.y > Math.max(prev.h, r.h) * 2.2) lines.push('')
    lines.push(line.replace(/\s+$/, ''))
    prev = r
  }
  return lines
}

export async function pdfToText(job: PdfToTextJob, progress: Progress = noop): Promise<string[]> {
  progress(0, `正在读取 ${basename(job.path)}`)
  const { doc, close } = await openPdfJs(job.path)
  try {
    const indices = parseRanges(job.ranges, doc.numPages)
    const parts: string[] = []
    let chars = 0
    for (let i = 0; i < indices.length; i++) {
      progress(i / indices.length, `正在提取第 ${indices[i] + 1} 页`)
      const page = await doc.getPage(indices[i] + 1)
      const content = await page.getTextContent()
      const lines = itemsToLines(content.items as TextItem[])
      const text = lines.join('\r\n').trim()
      chars += text.replace(/\s/g, '').length
      parts.push(job.pageMarkers ? `—— 第 ${indices[i] + 1} 页 ——\r\n${text}` : text)
      page.cleanup()
    }
    if (chars === 0) {
      throw new UserError('没有提取到文字。这个 PDF 可能是扫描件或图片，请使用“文字识别”功能')
    }
    await ensureDir(job.output.dir)
    const target = uniquePath(job.output.dir, `${stem(job.path)}.txt`)
    // 带 BOM 的 UTF-8，旧版记事本也能正确显示中文
    const body = '﻿' + parts.join('\r\n\r\n') + '\r\n'
    await writeFileAtomic(target, new TextEncoder().encode(body))
    progress(1, '完成')
    return [target]
  } finally {
    await close()
  }
}

// ---------- PDF 转 PPT ----------

export async function pdfToPpt(job: PdfToPptJob, progress: Progress = noop): Promise<string[]> {
  progress(0, `正在读取 ${basename(job.path)}`)
  const { doc, close } = await openPdfJs(job.path)
  try {
    const indices = parseRanges(job.ranges, doc.numPages)
    const PptxGenJS = (await import('pptxgenjs')).default
    const pptx = new PptxGenJS()
    // 幻灯片尺寸取第一页的宽高比，宽度固定 13.333 英寸（16:9 的标准宽度）
    const first = (await doc.getPage(indices[0] + 1)).getViewport({ scale: 1 })
    const slideW = 13.333
    const slideH = Math.min(56, Math.max(1, (slideW * first.height) / first.width))
    pptx.defineLayout({ name: 'PDF', width: slideW, height: slideH })
    pptx.layout = 'PDF'
    pptx.title = stem(job.path)
    const dpi = Math.min(300, Math.max(72, job.dpi))
    for (let i = 0; i < indices.length; i++) {
      progress((i / indices.length) * 0.9, `正在转换第 ${indices[i] + 1} 页（${i + 1} / ${indices.length}）`)
      const canvas = await renderPage(doc, indices[i], dpi)
      const data = Buffer.from(await encode(canvas, 'jpg', 88)).toString('base64')
      const slide = pptx.addSlide()
      // 页面比例与幻灯片不同时居中放置
      const scale = Math.min(slideW / canvas.width, slideH / canvas.height)
      const w = canvas.width * scale
      const h = canvas.height * scale
      slide.addImage({ data: `data:image/jpeg;base64,${data}`, x: (slideW - w) / 2, y: (slideH - h) / 2, w, h })
    }
    progress(0.95, '正在保存')
    const buf = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer
    await ensureDir(job.output.dir)
    const target = uniquePath(job.output.dir, `${stem(job.path)}.pptx`)
    await writeFileAtomic(target, new Uint8Array(buf))
    progress(1, '完成')
    return [target]
  } finally {
    await close()
  }
}

