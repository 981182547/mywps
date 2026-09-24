// 图片格式转换、压缩、调整尺寸（sharp / libvips），支持批量
import { copyFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import sharp, { type Sharp, type SharpOptions } from 'sharp'
import { UserError } from '../../shared/ranges'
import type { BatchResult, ImageCompressJob, ImageConvertJob, ImageFormat, ImageResizeJob } from '../../shared/types'
import { ensureDir, readBytes, stem, uniquePath, writeFileAtomic } from './fsutil'
import { detectImageKind, type ImageKind } from './images'
import { noop, type Progress } from './pdf'

sharp.cache(false)

const KIND_LABEL: Record<ImageKind, string> = {
  png: 'PNG', jpeg: 'JPG', webp: 'WEBP', gif: 'GIF', bmp: 'BMP', tiff: 'TIFF', heic: 'HEIC', avif: 'AVIF', ico: 'ICO', svg: 'SVG', unknown: '未知'
}

export const EXT: Record<ImageFormat, string> = { jpg: 'jpg', png: 'png', webp: 'webp', avif: 'avif', tiff: 'tif', bmp: 'bmp', ico: 'ico', gif: 'gif' }

export interface Decoded {
  image: Sharp
  kind: ImageKind
  bytes: Uint8Array
}

async function rawFromCanvas(bytes: Uint8Array): Promise<Sharp> {
  const { loadImage, createCanvas } = await import('@napi-rs/canvas')
  const img = await loadImage(Buffer.from(bytes))
  const c = createCanvas(img.width, img.height)
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, img.width, img.height).data
  return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width: img.width, height: img.height, channels: 4 } })
}

async function rawFromHeic(bytes: Uint8Array): Promise<Sharp> {
  const decode = (await import('heic-decode')).default as (o: { buffer: Uint8Array }) => Promise<{ width: number; height: number; data: Uint8ClampedArray }>
  const { width, height, data } = await decode({ buffer: bytes })
  return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 } })
}

/** 读取任意支持的图片，自动按 EXIF 方向摆正 */
export async function decodeImage(path: string): Promise<Decoded> {
  const name = basename(path)
  let bytes: Uint8Array
  try {
    bytes = await readBytes(path)
  } catch {
    throw new UserError(`无法读取“${name}”，请确认文件存在且没有被占用`)
  }
  const kind = detectImageKind(bytes)
  const opts: SharpOptions = { failOn: 'none', limitInputPixels: 400_000_000 }
  try {
    let image: Sharp
    switch (kind) {
      case 'jpeg':
      case 'png':
      case 'webp':
      case 'gif':
      case 'tiff':
      case 'avif':
        image = sharp(bytes, opts)
        break
      case 'svg':
        image = sharp(bytes, { ...opts, density: 144 })
        break
      case 'heic':
        // sharp 自带的 libvips 能读 HEIC 信息但不含 HEVC 解码器，所以用专门的解码器
        image = await rawFromHeic(bytes)
        break
      case 'bmp':
      case 'ico':
        image = await rawFromCanvas(bytes)
        break
      default:
        throw new UserError(`“${name}”不是支持的图片格式`)
    }
    // 先转成像素并摆正方向，保证后续处理结果一致
    const { data, info } = await image.rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    return { image: sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }), kind, bytes }
  } catch (e) {
    if (e instanceof UserError) throw e
    throw new UserError(`“${name}”已损坏或格式不受支持（${KIND_LABEL[kind]}）`)
  }
}

/** 24 位 BMP 编码（透明区域以背景色填充） */
function encodeBmp(rgb: Buffer, width: number, height: number): Uint8Array {
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const size = 54 + rowSize * height
  const b = Buffer.alloc(size)
  b.write('BM', 0)
  b.writeUInt32LE(size, 2)
  b.writeUInt32LE(54, 10)
  b.writeUInt32LE(40, 14)
  b.writeInt32LE(width, 18)
  b.writeInt32LE(height, 22)
  b.writeUInt16LE(1, 26)
  b.writeUInt16LE(24, 28)
  b.writeUInt32LE(rowSize * height, 34)
  b.writeInt32LE(2835, 38)
  b.writeInt32LE(2835, 42)
  for (let y = 0; y < height; y++) {
    const dst = 54 + (height - 1 - y) * rowSize
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 3
      b[dst + x * 3] = rgb[s + 2]
      b[dst + x * 3 + 1] = rgb[s + 1]
      b[dst + x * 3 + 2] = rgb[s]
    }
  }
  return new Uint8Array(b)
}

/** ICO：多个尺寸的 PNG 打包在一起 */
async function encodeIco(image: Sharp): Promise<Uint8Array> {
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const pngs = await Promise.all(
    sizes.map((s) => image.clone().resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer())
  )
  const header = Buffer.alloc(6 + 16 * sizes.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  sizes.forEach((s, i) => {
    const e = 6 + i * 16
    header[e] = s >= 256 ? 0 : s
    header[e + 1] = s >= 256 ? 0 : s
    header.writeUInt16LE(1, e + 4)
    header.writeUInt16LE(32, e + 6)
    header.writeUInt32LE(pngs[i].length, e + 8)
    header.writeUInt32LE(offset, e + 12)
    offset += pngs[i].length
  })
  return new Uint8Array(Buffer.concat([header, ...pngs]))
}

export interface EncodeOptions {
  quality: number
  /** 转为不支持透明的格式时使用的背景色 */
  background: string
  /** PNG 调色板量化（压缩用） */
  palette?: boolean
}

export async function encodeImage(image: Sharp, format: ImageFormat, o: EncodeOptions): Promise<Uint8Array> {
  const q = Math.round(Math.min(100, Math.max(1, o.quality)))
  const flat = () => image.clone().flatten({ background: o.background || '#ffffff' })
  switch (format) {
    case 'jpg':
      return new Uint8Array(await flat().jpeg({ quality: q, mozjpeg: true, chromaSubsampling: q >= 90 ? '4:4:4' : '4:2:0' }).toBuffer())
    case 'png':
      return new Uint8Array(await image.clone().png(o.palette ? { palette: true, quality: q, compressionLevel: 9, effort: 8 } : { compressionLevel: 9 }).toBuffer())
    case 'webp':
      return new Uint8Array(await image.clone().webp({ quality: q, effort: 5 }).toBuffer())
    case 'avif':
      return new Uint8Array(await image.clone().avif({ quality: Math.max(1, q - 10), effort: 4 }).toBuffer())
    case 'tiff':
      return new Uint8Array(await image.clone().tiff({ compression: 'lzw' }).toBuffer())
    case 'gif':
      return new Uint8Array(await image.clone().gif().toBuffer())
    case 'bmp': {
      const { data, info } = await flat().removeAlpha().raw().toBuffer({ resolveWithObject: true })
      return encodeBmp(data, info.width, info.height)
    }
    case 'ico':
      return encodeIco(image)
  }
}

/** 批量处理：单个文件失败不影响其他文件，最后汇总 */
async function batch(
  paths: string[],
  customDir: string | undefined,
  progress: Progress,
  verb: string,
  each: (path: string, dir: string) => Promise<{ output: string; note?: string }>
): Promise<BatchResult> {
  if (paths.length === 0) throw new UserError('请先添加图片')
  const outputs: string[] = []
  const notes: string[] = []
  const failures: string[] = []
  for (let i = 0; i < paths.length; i++) {
    progress(i / paths.length, `正在${verb} ${basename(paths[i])}（${i + 1} / ${paths.length}）`)
    try {
      const dir = customDir ?? dirname(paths[i])
      await ensureDir(dir)
      const r = await each(paths[i], dir)
      outputs.push(r.output)
      if (r.note) notes.push(r.note)
    } catch (e) {
      failures.push(e instanceof UserError ? e.message : `“${basename(paths[i])}”处理失败`)
    }
  }
  progress(1, '完成')
  if (outputs.length === 0) throw new UserError(failures.length === 1 ? failures[0] : `全部 ${failures.length} 个文件处理失败：${failures[0]}`)
  return { outputs, notes, failures }
}

// ---------- 格式转换 ----------

export function convertImages(job: ImageConvertJob, progress: Progress = noop): Promise<BatchResult> {
  return batch(job.paths, job.output.dir, progress, '转换', async (path, dir) => {
    const { image } = await decodeImage(path)
    const data = await encodeImage(image, job.format, { quality: job.quality, background: job.background })
    const target = uniquePath(dir, `${stem(path)}.${EXT[job.format]}`)
    await writeFileAtomic(target, data)
    return { output: target }
  })
}

// ---------- 压缩 ----------

/** 压缩时的输出格式：保持原格式；不适合压缩的格式转为 JPG */
function compressFormat(kind: ImageKind, hasAlpha: boolean): ImageFormat {
  if (kind === 'png') return 'png'
  if (kind === 'webp') return 'webp'
  if (kind === 'avif') return 'avif'
  return hasAlpha && kind !== 'jpeg' ? 'png' : 'jpg'
}

async function hasTransparency(image: Sharp): Promise<boolean> {
  const stats = await image.clone().stats()
  return stats.channels.length === 4 && stats.channels[3].min < 255
}

export function compressImages(job: ImageCompressJob, progress: Progress = noop): Promise<BatchResult> {
  return batch(job.paths, job.output.dir, progress, '压缩', async (path, dir) => {
    const { image, kind, bytes } = await decodeImage(path)
    const format = compressFormat(kind, await hasTransparency(image))
    const meta = await image.metadata()
    let work = image
    if (job.maxWidth && meta.width && meta.width > job.maxWidth) work = sharp(await image.clone().resize({ width: job.maxWidth }).raw().toBuffer(), { raw: { width: job.maxWidth, height: Math.round((meta.height! * job.maxWidth) / meta.width), channels: 4 } })
    const enc = (img: Sharp, q: number) => encodeImage(img, format, { quality: q, background: '#ffffff', palette: true })

    let data: Uint8Array
    if (job.mode === 'quality') {
      data = await enc(work, job.quality)
    } else {
      const target = Math.max(5, job.targetKB) * 1024
      data = await enc(work, 90)
      let scale = 1
      const w0 = (await work.metadata()).width!
      const h0 = (await work.metadata()).height!
      for (let round = 0; round < 6 && data.length > target; round++) {
        const img =
          scale === 1
            ? work
            : sharp(await work.clone().resize(Math.max(1, Math.round(w0 * scale)), Math.max(1, Math.round(h0 * scale))).raw().toBuffer(), {
                raw: { width: Math.max(1, Math.round(w0 * scale)), height: Math.max(1, Math.round(h0 * scale)), channels: 4 }
              })
        // 二分查找满足大小的最高质量
        let lo = 30
        let hi = 92
        let best: Uint8Array | null = null
        while (lo <= hi) {
          const mid = Math.floor((lo + hi) / 2)
          const d = await enc(img, mid)
          if (d.length <= target) {
            best = d
            lo = mid + 1
          } else hi = mid - 1
        }
        if (best) {
          data = best
          break
        }
        data = await enc(img, 30)
        scale *= Math.max(0.35, Math.min(0.9, Math.sqrt(target / data.length)))
      }
    }

    const ext = EXT[format]
    const target = uniquePath(dir, `${stem(path)}_压缩.${ext}`)
    const sameFormat = (format === 'jpg' && kind === 'jpeg') || format === kind
    // 压缩后反而变大时，保留原文件内容
    if (sameFormat && !job.maxWidth && data.length >= bytes.length) {
      await copyFile(path, target)
      return { output: target, note: `${basename(path)}：已是最佳压缩` }
    }
    await writeFileAtomic(target, data)
    const pct = Math.round((1 - data.length / bytes.length) * 100)
    return { output: target, note: `${basename(path)}：${fmt(bytes.length)} → ${fmt(data.length)}${pct > 0 ? `（减小 ${pct}%）` : ''}` }
  })
}

function fmt(n: number): string {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}

// ---------- 调整尺寸 ----------

export function resizeImages(job: ImageResizeJob, progress: Progress = noop): Promise<BatchResult> {
  return batch(job.paths, job.output.dir, progress, '处理', async (path, dir) => {
    const { image, kind } = await decodeImage(path)
    const meta = await image.metadata()
    const w0 = meta.width!
    const h0 = meta.height!
    let w: number
    let h: number
    let fit: 'contain' | 'cover' | 'fill' = 'fill'
    if (job.mode === 'percent') {
      const p = Math.min(1000, Math.max(1, job.percent)) / 100
      w = Math.round(w0 * p)
      h = Math.round(h0 * p)
    } else if (job.mode === 'width') {
      w = job.width
      h = Math.round((h0 * job.width) / w0)
    } else if (job.mode === 'height') {
      h = job.height
      w = Math.round((w0 * job.height) / h0)
    } else {
      w = job.width
      h = job.height
      fit = job.fit
    }
    if (!(w >= 1 && h >= 1 && w <= 30000 && h <= 30000)) throw new UserError('目标尺寸必须在 1 ~ 30000 像素之间')
    const resized = image
      .clone()
      .resize(w, h, { fit, background: job.background || '#ffffff', position: 'attention', kernel: 'lanczos3' })
    const format: ImageFormat = job.format ?? compressFormat(kind, await hasTransparency(image))
    const buf = await resized.raw().toBuffer({ resolveWithObject: true })
    const out = sharp(buf.data, { raw: { width: buf.info.width, height: buf.info.height, channels: buf.info.channels as 4 } })
    const data = await encodeImage(out, format, { quality: 92, background: job.background || '#ffffff' })
    const target = uniquePath(dir, `${stem(path)}_${w}x${h}.${EXT[format]}`)
    await writeFileAtomic(target, data)
    return { output: target }
  })
}
