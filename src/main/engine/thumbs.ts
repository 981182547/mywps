// 图片缩略图：统一在主进程生成，支持 HEIC、TIFF、BMP 等浏览器无法直接显示的格式
import { stat } from 'node:fs/promises'
import sharp, { type Sharp } from 'sharp'
import type { ImageThumb } from '../../shared/types'
import { decodeImage } from './imagetools'

const cache = new Map<string, ImageThumb>()

async function encode(image: Sharp, size: number, width: number, height: number, hasAlpha: boolean): Promise<ImageThumb> {
  const resized = image.resize(size, size, { fit: 'inside', withoutEnlargement: true })
  const buf = hasAlpha ? await resized.png().toBuffer() : await resized.flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer()
  return { url: `data:image/${hasAlpha ? 'png' : 'jpeg'};base64,${buf.toString('base64')}`, width, height }
}

export async function imageThumb(path: string, size: number): Promise<ImageThumb | null> {
  let key = ''
  try {
    const s = await stat(path)
    key = `${path}|${s.mtimeMs}|${size}`
    const hit = cache.get(key)
    if (hit) return hit
  } catch {
    return null
  }
  let thumb: ImageThumb | null = null
  try {
    // 快速路径：sharp 原生支持的格式可以边读边缩小，大照片也很快
    const meta = await sharp(path, { failOn: 'none' }).metadata()
    if (meta.format === 'heif' && meta.compression === 'hevc') throw new Error('hevc')
    const w = meta.autoOrient?.width ?? meta.width!
    const h = meta.autoOrient?.height ?? meta.height!
    thumb = await encode(sharp(path, { failOn: 'none' }).rotate(), size, w, h, !!meta.hasAlpha)
  } catch {
    try {
      const { image } = await decodeImage(path)
      const meta = await image.metadata()
      const hasAlpha = (await image.clone().stats()).channels[3]?.min < 255
      thumb = await encode(image, size, meta.width!, meta.height!, hasAlpha)
    } catch {
      return null
    }
  }
  if (cache.size > 500) cache.clear()
  cache.set(key, thumb)
  return thumb
}
