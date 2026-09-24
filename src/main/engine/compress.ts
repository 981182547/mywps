// PDF 压缩：重新编码过大的图片 + qpdf 结构优化
import { copyFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { inflateSync } from 'node:zlib'
import { PDFArray, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, type PDFObject } from 'pdf-lib'
import sharp, { type Sharp } from 'sharp'
import { UserError } from '../../shared/ranges'
import type { CompressLevel, PdfCompressJob } from '../../shared/types'
import { ensureDir, readBytes, sanitizeFileName, uniquePath, writeFileAtomic } from './fsutil'
import { noop, type Progress } from './pdf'
import { encryptionState, runQpdf } from './qpdf'

const SETTINGS: Record<Exclude<CompressLevel, 'low'>, { maxDim: number; quality: number }> = {
  medium: { maxDim: 2000, quality: 72 },
  high: { maxDim: 1400, quality: 50 }
}

const N = (s: string) => PDFName.of(s)

function num(o: PDFObject | undefined): number | null {
  return o instanceof PDFNumber ? o.asNumber() : null
}

/** 返回颜色通道数；不适合处理的颜色空间返回 null */
function channels(doc: PDFDocument, cs: PDFObject | undefined): 1 | 3 | null {
  if (cs === N('DeviceRGB')) return 3
  if (cs === N('DeviceGray')) return 1
  if (cs instanceof PDFArray && cs.size() === 2 && cs.get(0) === N('ICCBased')) {
    const icc = doc.context.lookup(cs.get(1))
    if (icc instanceof PDFStream) {
      const n = num(icc.dict.lookup(N('N')))
      if (n === 3) return 3
      if (n === 1) return 1
    }
  }
  return null
}

function filterName(f: PDFObject | undefined): string | null {
  if (f instanceof PDFName) return f.decodeText()
  if (f instanceof PDFArray && f.size() === 1) {
    const x = f.get(0)
    return x instanceof PDFName ? x.decodeText() : null
  }
  return f === undefined ? 'none' : null
}

/** 重新压缩图片，返回处理的图片数量 */
export async function recompressImages(doc: PDFDocument, level: Exclude<CompressLevel, 'low'>, progress: Progress): Promise<number> {
  const { maxDim, quality } = SETTINGS[level]
  const objects = doc.context.enumerateIndirectObjects()
  // 被当作透明蒙版使用的图片不能有损压缩
  const maskRefs = new Set<string>()
  for (const [, obj] of objects) {
    if (obj instanceof PDFRawStream) {
      const sm = obj.dict.get(N('SMask'))
      if (sm instanceof PDFRef) maskRefs.add(sm.toString())
    }
  }
  const images = objects.filter(([ref, obj]) => obj instanceof PDFRawStream && obj.dict.get(N('Subtype')) === N('Image') && !maskRefs.has(ref.toString()))
  let changed = 0
  for (let i = 0; i < images.length; i++) {
    const [ref, obj] = images[i] as [PDFRef, PDFRawStream]
    if (i % 5 === 0) progress(0.1 + (0.6 * i) / images.length, `正在压缩图片（${i + 1} / ${images.length}）`)
    const d = obj.dict
    if (d.has(N('ImageMask')) || d.has(N('Mask')) || d.has(N('Decode'))) continue
    const w = num(d.lookup(N('Width')))
    const h = num(d.lookup(N('Height')))
    const bpc = num(d.lookup(N('BitsPerComponent')))
    const ch = channels(doc, d.lookup(N('ColorSpace')))
    const filter = filterName(d.lookup(N('Filter')))
    if (!w || !h || !ch || w * h < 40_000) continue
    try {
      let input: Sharp
      if (filter === 'DCTDecode') {
        const meta = await sharp(obj.contents).metadata()
        if (meta.channels !== ch || meta.space === 'cmyk') continue
        input = sharp(obj.contents)
      } else if (filter === 'FlateDecode' && bpc === 8 && !d.has(N('DecodeParms'))) {
        const raw = inflateSync(obj.contents)
        if (raw.length < w * h * ch) continue
        input = sharp(raw.subarray(0, w * h * ch), { raw: { width: w, height: h, channels: ch } })
      } else continue

      const scale = Math.min(1, maxDim / Math.max(w, h))
      const nw = Math.max(1, Math.round(w * scale))
      const nh = Math.max(1, Math.round(h * scale))
      let pipeline = scale < 1 ? input.resize(nw, nh, { kernel: 'lanczos3' }) : input
      if (ch === 1) pipeline = pipeline.toColourspace('b-w')
      const jpeg = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer()
      if (jpeg.length >= obj.contents.length * 0.9) continue

      const stream = doc.context.stream(jpeg, {
        Type: 'XObject',
        Subtype: 'Image',
        Width: nw,
        Height: nh,
        ColorSpace: ch === 1 ? 'DeviceGray' : 'DeviceRGB',
        BitsPerComponent: 8,
        Filter: 'DCTDecode'
      })
      for (const key of ['SMask', 'Interpolate', 'Intent']) {
        const v = d.get(N(key))
        if (v) stream.dict.set(N(key), v)
      }
      doc.context.assign(ref, stream)
      changed++
    } catch {
      // 单张图片处理失败时保留原图
    }
  }
  return changed
}

function fmt(n: number): string {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}

export async function compressPdf(job: PdfCompressJob, progress: Progress = noop): Promise<{ outputs: string[]; notes: string[] }> {
  const name = basename(job.path)
  progress(0, `正在读取 ${name}`)
  let original: Uint8Array
  try {
    original = await readBytes(job.path)
  } catch {
    throw new UserError(`无法读取文件“${name}”，请确认文件存在且没有被占用`)
  }
  const state = await encryptionState(original)
  if (state === 'open') throw new UserError(`“${name}”设置了打开密码，请先用“PDF 解密”工具移除密码`)
  let bytes = original
  if (state === 'restricted') {
    const r = await runQpdf(bytes, (i, o) => ['--decrypt', i, o])
    if (!r.output) throw new UserError(`“${name}”无法处理`)
    bytes = r.output
  }

  let images = 0
  if (job.level !== 'low') {
    let doc: PDFDocument
    try {
      doc = await PDFDocument.load(bytes, { updateMetadata: false })
    } catch {
      throw new UserError(`“${name}”不是有效的 PDF 文件，或文件已损坏`)
    }
    images = await recompressImages(doc, job.level, progress)
    if (images > 0) bytes = await doc.save({ useObjectStreams: true })
  }

  progress(0.8, '正在优化文件结构')
  const r = await runQpdf(bytes, (i, o) => ['--object-streams=generate', '--compress-streams=y', '--recompress-flate', '--compression-level=9', i, o])
  if (r.output && r.output.length < bytes.length) bytes = r.output

  await ensureDir(job.output.dir)
  const target = uniquePath(job.output.dir, sanitizeFileName(job.fileName, '.pdf'))
  if (bytes.length >= original.length * 0.98) {
    await copyFile(job.path, target)
    progress(1, '完成')
    return { outputs: [target], notes: [`文件已经很精简（${fmt(original.length)}），无法进一步压缩${job.level !== 'high' ? '，可以尝试“强力压缩”' : ''}`] }
  }
  await writeFileAtomic(target, bytes)
  progress(1, '完成')
  const pct = Math.round((1 - bytes.length / original.length) * 100)
  return {
    outputs: [target],
    notes: [`${fmt(original.length)} → ${fmt(bytes.length)}，减小 ${pct}%${images ? `（重新压缩了 ${images} 张图片）` : ''}`]
  }
}
