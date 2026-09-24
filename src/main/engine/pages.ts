import { basename } from 'node:path'
import {
  PDFDocument,
  PDFPage,
  concatTransformationMatrix,
  degrees,
  popGraphicsState,
  pushGraphicsState,
  type PDFImage
} from 'pdf-lib'
import { UserError, parseRanges } from '../../shared/ranges'
import { formatPageNumber, numberPosition, watermarkPlacements } from '../../shared/layout'
import type { PageEditJob, PageNumberJob, WatermarkJob } from '../../shared/types'
import { ensureDir, readBytes, sanitizeFileName, uniquePath } from './fsutil'
import { detectImageKind } from './images'
import { MM_TO_PT, loadPdf, newDocument, noop, save, type Progress } from './pdf'
import { renderText } from './textimg'

function normRotation(r: number): number {
  return (((Math.round(r / 90) * 90) % 360) + 360) % 360
}

export async function writeOut(doc: PDFDocument, dir: string, fileName: string): Promise<string> {
  await ensureDir(dir)
  const target = uniquePath(dir, sanitizeFileName(fileName, '.pdf'))
  await save(doc, target)
  return target
}

// ---------- 页面整理（旋转 / 删除 / 排序） ----------

export async function editPages(job: PageEditJob, progress: Progress = noop): Promise<string[]> {
  progress(0, `正在读取 ${basename(job.path)}`)
  const src = await loadPdf(job.path)
  const total = src.getPageCount()
  if (job.pages.length === 0) throw new UserError('至少需要保留 1 页')
  for (const p of job.pages) {
    if (!Number.isInteger(p.index) || p.index < 0 || p.index >= total) throw new UserError('页面信息有误，请重新打开文件')
  }
  const out = await newDocument()
  const copied = await out.copyPages(src, job.pages.map((p) => p.index))
  copied.forEach((page, i) => {
    const extra = normRotation(job.pages[i].rotate)
    if (extra) page.setRotation(degrees(normRotation(page.getRotation().angle + extra)))
    out.addPage(page)
    if (i % 20 === 0) progress(0.1 + (0.8 * i) / copied.length, `正在处理第 ${i + 1} 页`)
  })
  progress(0.95, '正在保存')
  const target = await writeOut(out, job.output.dir, job.fileName)
  progress(1, '完成')
  return [target]
}

// ---------- 在页面“可见坐标系”中绘制 ----------

interface VisualPage {
  width: number
  height: number
  /** 可见坐标 → 页面原始坐标 的变换矩阵 */
  matrix: [number, number, number, number, number, number]
}

/** 考虑裁剪框与页面旋转，得到用户看到的页面尺寸与坐标变换 */
export function visualPage(page: PDFPage): VisualPage {
  const box = page.getCropBox()
  const r = normRotation(page.getRotation().angle)
  const { x: cx, y: cy, width: cw, height: ch } = box
  switch (r) {
    case 90:
      return { width: ch, height: cw, matrix: [0, 1, -1, 0, cx + cw, cy] }
    case 180:
      return { width: cw, height: ch, matrix: [-1, 0, 0, -1, cx + cw, cy + ch] }
    case 270:
      return { width: ch, height: cw, matrix: [0, -1, 1, 0, cx, cy + ch] }
    default:
      return { width: cw, height: ch, matrix: [1, 0, 0, 1, cx, cy] }
  }
}

const wrapped = new WeakSet<PDFPage>()

/** 把原有内容包在 q/Q 中，防止原内容遗留的图形状态影响新增内容 */
export function isolateExisting(doc: PDFDocument, page: PDFPage): void {
  if (wrapped.has(page)) return
  const start = doc.context.register(doc.context.contentStream([pushGraphicsState()]))
  const end = doc.context.register(doc.context.contentStream([popGraphicsState()]))
  page.node.wrapContentStreams(start, end)
  wrapped.add(page)
}

/** 以中心点 (cx, cy)、逆时针角度 angle 在可见坐标系中绘制图片 */
export function drawCentered(page: PDFPage, vp: VisualPage, image: PDFImage, cx: number, cy: number, w: number, h: number, angle: number, opacity: number) {
  const rad = (angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  // 旋转后使图片中心仍位于 (cx, cy)
  const x = cx - (w / 2) * cos + (h / 2) * sin
  const y = cy - (w / 2) * sin - (h / 2) * cos
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...vp.matrix))
  page.drawImage(image, { x, y, width: w, height: h, rotate: degrees(angle), opacity })
  page.pushOperators(popGraphicsState())
}

async function embedImageFile(doc: PDFDocument, path: string): Promise<PDFImage> {
  const name = basename(path)
  let bytes: Uint8Array
  try {
    bytes = await readBytes(path)
  } catch {
    throw new UserError(`无法读取图片“${name}”`)
  }
  const kind = detectImageKind(bytes)
  try {
    if (kind === 'png') return await doc.embedPng(bytes)
    if (kind === 'jpeg') return await doc.embedJpg(bytes)
  } catch {
    throw new UserError(`图片“${name}”已损坏，无法读取`)
  }
  throw new UserError(`水印图片“${name}”格式不支持，请使用 JPG 或 PNG`)
}

// ---------- 水印 ----------

export async function addWatermark(job: WatermarkJob, progress: Progress = noop): Promise<string[]> {
  progress(0, `正在读取 ${basename(job.path)}`)
  const doc = await loadPdf(job.path)
  const pages = doc.getPages()
  const targets = parseRanges(job.ranges, pages.length)
  const opacity = Math.min(1, Math.max(0.02, job.opacity))

  let image: PDFImage
  let itemW: number
  let itemH: number
  let scaleByPage = false
  if (job.mode === 'text') {
    if (!job.text.trim()) throw new UserError('请填写水印文字')
    const t = await renderText(job.text, Math.min(300, Math.max(6, job.fontSize)), job.color, job.bold)
    image = await doc.embedPng(t.png)
    itemW = t.width
    itemH = t.height
  } else {
    if (!job.imagePath) throw new UserError('请选择水印图片')
    image = await embedImageFile(doc, job.imagePath)
    itemW = image.width
    itemH = image.height
    scaleByPage = true
  }

  for (let i = 0; i < targets.length; i++) {
    const page = pages[targets[i]]
    const vp = visualPage(page)
    let w = itemW
    let h = itemH
    if (scaleByPage) {
      w = vp.width * Math.min(1, Math.max(0.05, job.imageScale))
      h = (itemH / itemW) * w
    }
    isolateExisting(doc, page)
    for (const p of watermarkPlacements(vp.width, vp.height, w, h, job.angle, job.layout)) {
      drawCentered(page, vp, image, p.cx, p.cy, w, h, job.angle, opacity)
    }
    if (i % 10 === 0) progress(0.1 + (0.8 * i) / targets.length, `正在处理第 ${i + 1} / ${targets.length} 页`)
  }
  progress(0.95, '正在保存')
  const target = await writeOut(doc, job.output.dir, job.fileName)
  progress(1, '完成')
  return [target]
}

// ---------- 页码 ----------

export async function addPageNumbers(job: PageNumberJob, progress: Progress = noop): Promise<string[]> {
  progress(0, `正在读取 ${basename(job.path)}`)
  const doc = await loadPdf(job.path)
  const pages = doc.getPages()
  const targets = parseRanges(job.ranges, pages.length)
  const start = Number.isFinite(job.start) ? Math.floor(job.start) : 1
  const total = start - 1 + targets.length
  const margin = Math.max(0, job.marginMm) * MM_TO_PT
  const size = Math.min(72, Math.max(5, job.fontSize))
  const cache = new Map<string, { image: PDFImage; w: number; h: number }>()

  for (let i = 0; i < targets.length; i++) {
    const text = formatPageNumber(job.format, start + i, total)
    let item = cache.get(text)
    if (!item) {
      const t = await renderText(text, size, job.color)
      item = { image: await doc.embedPng(t.png), w: t.width, h: t.height }
      cache.set(text, item)
    }
    const page = pages[targets[i]]
    const vp = visualPage(page)
    const [x, y] = numberPosition(job.position, vp.width, vp.height, item.w, item.h, margin)
    isolateExisting(doc, page)
    drawCentered(page, vp, item.image, x + item.w / 2, y + item.h / 2, item.w, item.h, 0, 1)
    if (i % 20 === 0) progress(0.1 + (0.8 * i) / targets.length, `正在处理第 ${i + 1} / ${targets.length} 页`)
  }
  progress(0.95, '正在保存')
  const target = await writeOut(doc, job.output.dir, job.fileName)
  progress(1, '完成')
  return [target]
}
