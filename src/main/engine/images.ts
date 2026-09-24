// 图片格式识别与 JPEG 方向（EXIF Orientation）读取

export type ImageKind = 'png' | 'jpeg' | 'webp' | 'gif' | 'bmp' | 'tiff' | 'heic' | 'avif' | 'ico' | 'svg' | 'unknown'

export function detectImageKind(b: Uint8Array): ImageKind {
  const at = (i: number) => b[i] ?? -1
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'png'
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'jpeg'
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return 'gif'
  if (at(0) === 0x42 && at(1) === 0x4d) return 'bmp'
  if ((at(0) === 0x49 && at(1) === 0x49 && at(2) === 0x2a) || (at(0) === 0x4d && at(1) === 0x4d && at(3) === 0x2a)) return 'tiff'
  const ascii = (s: number, e: number) => String.fromCharCode(...b.subarray(s, e))
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp'
  if (b.length >= 12 && ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12)
    if (brand === 'avif' || brand === 'avis') return 'avif'
    if (/^(heic|heix|hevc|hevx|mif1|msf1|heim|heis)/.test(brand)) return 'heic'
  }
  if (at(0) === 0 && at(1) === 0 && at(2) === 1 && at(3) === 0) return 'ico'
  const head = new TextDecoder().decode(b.subarray(0, 512)).trimStart()
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg'
  return 'unknown'
}

/** 读取 JPEG 的 EXIF 方向，1~8；读不到返回 1 */
export function readJpegOrientation(b: Uint8Array): number {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let off = 2
  while (off + 4 <= b.length) {
    if (b[off] !== 0xff) return 1
    const marker = b[off + 1]
    // 独立标记（无长度）
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      off += 2
      continue
    }
    if (marker === 0xda || marker === 0xd9) return 1 // 图像数据开始，不再有 EXIF
    const len = view.getUint16(off + 2)
    if (len < 2) return 1
    if (marker === 0xe1 && off + 10 <= b.length) {
      const sig = String.fromCharCode(...b.subarray(off + 4, off + 10))
      if (sig === 'Exif\0\0') return parseTiffOrientation(view, off + 10, Math.min(b.length, off + 2 + len))
    }
    off += 2 + len
  }
  return 1
}

function parseTiffOrientation(view: DataView, tiff: number, end: number): number {
  if (tiff + 8 > end) return 1
  const bo = view.getUint16(tiff)
  const le = bo === 0x4949
  if (!le && bo !== 0x4d4d) return 1
  const ifd = tiff + view.getUint32(tiff + 4, le)
  if (ifd + 2 > end) return 1
  const count = view.getUint16(ifd, le)
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > end) return 1
    if (view.getUint16(entry, le) === 0x0112) {
      const v = view.getUint16(entry + 8, le)
      return v >= 1 && v <= 8 ? v : 1
    }
  }
  return 1
}

/**
 * 根据 EXIF 方向，把“存储图像坐标”(s 向右, t 向下, 取值 0~1) 映射为“显示坐标”(p 向右, q 向下)
 */
export function orientPoint(o: number, s: number, t: number): [number, number] {
  switch (o) {
    case 2: return [1 - s, t]
    case 3: return [1 - s, 1 - t]
    case 4: return [s, 1 - t]
    case 5: return [t, s]
    case 6: return [1 - t, s]
    case 7: return [1 - t, 1 - s]
    case 8: return [t, 1 - s]
    default: return [s, t]
  }
}

/** 方向 5~8 时宽高互换 */
export function swapsDimensions(o: number): boolean {
  return o >= 5 && o <= 8
}

/**
 * 计算 PDF 变换矩阵：把图像单位正方形画到页面矩形 (x, y, w, h) 中，并按 EXIF 方向纠正
 * PDF 图像空间：u 向右，v 向上（v=1 为图像第一行）
 */
export function orientedMatrix(o: number, x: number, y: number, w: number, h: number): [number, number, number, number, number, number] {
  const P = (u: number, v: number): [number, number] => {
    const [p, q] = orientPoint(o, u, 1 - v)
    return [x + p * w, y + (1 - q) * h]
  }
  const [e, f] = P(0, 0)
  const [ux, uy] = P(1, 0)
  const [vx, vy] = P(0, 1)
  return [ux - e, uy - f, vx - e, vy - f, e, f]
}
