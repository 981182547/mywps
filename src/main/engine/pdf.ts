import { basename } from 'node:path'
import {
  PDFDocument,
  PageSizes,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState
} from 'pdf-lib'
import type { ImagesToPdfJob, MergeJob, PdfMeta, SplitJob } from '../../shared/types'
import { ensureDir, readBytes, sanitizeFileName, stem, uniquePath, writeFileAtomic } from './fsutil'
import { detectImageKind, orientedMatrix, readJpegOrientation, swapsDimensions } from './images'
import { UserError, parseRangeGroups, parseRanges } from '../../shared/ranges'

export type Progress = (ratio: number, message: string) => void
const noop: Progress = () => {}

const PRODUCER = '轻匣'
const MM_TO_PT = 72 / 25.4

function newDocument(): Promise<PDFDocument> {
  return PDFDocument.create().then((doc) => {
    doc.setProducer(PRODUCER)
    doc.setCreator(PRODUCER)
    return doc
  })
}

export async function loadPdf(path: string): Promise<PDFDocument> {
  const name = basename(path)
  let bytes: Uint8Array
  try {
    bytes = await readBytes(path)
  } catch {
    throw new UserError(`无法读取文件“${name}”，请确认文件存在且没有被占用`)
  }
  let doc: PDFDocument
  try {
    // 先忽略加密标记加载，再根据 isEncrypted 判断，比匹配错误类型更可靠
    doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  } catch {
    throw new UserError(`“${name}”不是有效的 PDF 文件，或文件已损坏`)
  }
  if (doc.isEncrypted) throw new UserError(`“${name}”已加密，请先解除密码后再处理`)
  return doc
}

export async function pdfMeta(path: string): Promise<PdfMeta> {
  try {
    const doc = await loadPdf(path)
    return { pageCount: doc.getPageCount(), encrypted: false }
  } catch (e) {
    if (e instanceof UserError && e.message.includes('已加密')) return { pageCount: 0, encrypted: true }
    throw e
  }
}

async function save(doc: PDFDocument, path: string): Promise<void> {
  const bytes = await doc.save({ useObjectStreams: true })
  await writeFileAtomic(path, bytes)
}

// ---------- 合并 ----------

export async function mergePdfs(job: MergeJob, progress: Progress = noop): Promise<string[]> {
  if (job.items.length < 2) throw new UserError('请至少添加 2 个 PDF 文件')
  const out = await newDocument()
  for (let i = 0; i < job.items.length; i++) {
    const item = job.items[i]
    progress(i / job.items.length, `正在读取 ${basename(item.path)}`)
    const src = await loadPdf(item.path)
    let indices: number[]
    try {
      indices = parseRanges(item.ranges, src.getPageCount())
    } catch (e) {
      throw new UserError(`“${basename(item.path)}”：${(e as Error).message}`)
    }
    const pages = await out.copyPages(src, indices)
    for (const p of pages) out.addPage(p)
  }
  progress(0.95, '正在保存')
  await ensureDir(job.output.dir)
  const target = uniquePath(job.output.dir, sanitizeFileName(job.fileName, '.pdf'))
  await save(out, target)
  progress(1, '完成')
  return [target]
}

// ---------- 拆分 ----------

function pageLabel(indices: number[]): string {
  if (indices.length === 1) return `第${indices[0] + 1}页`
  const first = indices[0] + 1
  const last = indices[indices.length - 1] + 1
  const contiguous = indices.every((v, i) => i === 0 || Math.abs(v - indices[i - 1]) === 1)
  return contiguous ? `第${first}-${last}页` : `第${first}页等${indices.length}页`
}

export async function splitPdf(job: SplitJob, progress: Progress = noop): Promise<string[]> {
  progress(0, `正在读取 ${basename(job.path)}`)
  const src = await loadPdf(job.path)
  const total = src.getPageCount()
  const base = stem(job.path)

  let groups: number[][]
  const mode = job.mode
  if (mode.kind === 'every') {
    const n = Math.floor(mode.n)
    if (!Number.isFinite(n) || n < 1) throw new UserError('每份页数必须是大于 0 的整数')
    groups = []
    for (let s = 0; s < total; s += n) {
      groups.push(Array.from({ length: Math.min(n, total - s) }, (_, i) => s + i))
    }
  } else if (mode.kind === 'ranges') {
    groups = parseRangeGroups(mode.ranges, total)
  } else {
    groups = [parseRangeGroups(mode.ranges, total).flat()]
  }

  // 多个输出文件时放入单独的文件夹，避免把源目录弄乱
  let dir = job.output.dir
  if (groups.length > 1) {
    dir = uniquePath(dir, `${base}_拆分`)
  }
  await ensureDir(dir)

  const outputs: string[] = []
  for (let i = 0; i < groups.length; i++) {
    progress(i / groups.length, `正在生成第 ${i + 1} / ${groups.length} 个文件`)
    const doc = await newDocument()
    const pages = await doc.copyPages(src, groups[i])
    for (const p of pages) doc.addPage(p)
    const suffix = mode.kind === 'extract' ? '提取' : pageLabel(groups[i])
    const target = uniquePath(dir, sanitizeFileName(`${base}_${suffix}`, '.pdf'))
    await save(doc, target)
    outputs.push(target)
  }
  progress(1, '完成')
  return outputs
}

// ---------- 图片转 PDF ----------

const PAGE_SIZES: Record<Exclude<ImagesToPdfJob['pageSize'], 'fit'>, [number, number]> = {
  A4: PageSizes.A4 as [number, number],
  A3: PageSizes.A3 as [number, number],
  Letter: PageSizes.Letter as [number, number]
}

const KIND_NAMES: Record<string, string> = {
  webp: 'WEBP',
  gif: 'GIF',
  bmp: 'BMP',
  tiff: 'TIFF',
  heic: 'HEIC',
  unknown: '未知'
}

export async function imagesToPdf(job: ImagesToPdfJob, progress: Progress = noop): Promise<string[]> {
  if (job.images.length === 0) throw new UserError('请至少添加 1 张图片')
  const margin = Math.max(0, Math.min(50, job.marginMm || 0)) * MM_TO_PT
  const doc = await newDocument()

  for (let i = 0; i < job.images.length; i++) {
    const path = job.images[i]
    const name = basename(path)
    progress(i / job.images.length, `正在处理 ${name}`)
    let bytes: Uint8Array
    try {
      bytes = await readBytes(path)
    } catch {
      throw new UserError(`无法读取图片“${name}”`)
    }
    const kind = detectImageKind(bytes)
    if (kind !== 'png' && kind !== 'jpeg') {
      throw new UserError(`“${name}”是 ${KIND_NAMES[kind]} 格式，目前仅支持 JPG 和 PNG 图片`)
    }
    let image
    try {
      image = kind === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
    } catch {
      throw new UserError(`图片“${name}”已损坏，无法读取`)
    }
    const orientation = kind === 'jpeg' ? readJpegOrientation(bytes) : 1
    // 显示尺寸（按 96 DPI 换算为磅）
    let imgW = image.width * 0.75
    let imgH = image.height * 0.75
    if (swapsDimensions(orientation)) [imgW, imgH] = [imgH, imgW]

    let pageW: number
    let pageH: number
    if (job.pageSize === 'fit') {
      pageW = imgW + margin * 2
      pageH = imgH + margin * 2
    } else {
      const [a, b] = PAGE_SIZES[job.pageSize]
      const landscape = job.orientation === 'landscape' || (job.orientation === 'auto' && imgW > imgH)
      ;[pageW, pageH] = landscape ? [b, a] : [a, b]
    }

    const boxW = Math.max(1, pageW - margin * 2)
    const boxH = Math.max(1, pageH - margin * 2)
    const scale = Math.min(1, boxW / imgW, boxH / imgH)
    const w = imgW * scale
    const h = imgH * scale
    const x = (pageW - w) / 2
    const y = (pageH - h) / 2

    const page = doc.addPage([pageW, pageH])
    const xObject = page.node.newXObject('Image', image.ref)
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(...orientedMatrix(orientation, x, y, w, h)),
      drawObject(xObject),
      popGraphicsState()
    )
  }

  progress(0.95, '正在保存')
  await ensureDir(job.output.dir)
  const target = uniquePath(job.output.dir, sanitizeFileName(job.fileName, '.pdf'))
  await save(doc, target)
  progress(1, '完成')
  return [target]
}
