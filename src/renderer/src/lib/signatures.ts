// 签名/印章库：只保存在本机
export interface SignatureItem {
  id: string
  name: string
  /** 裁剪好的透明 PNG */
  dataUrl: string
  width: number
  height: number
  kind: 'draw' | 'text' | 'image'
}

const KEY = 'qx.signatures'

export function loadSignatures(): SignatureItem[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as SignatureItem[]) : []
    return Array.isArray(list) ? list.filter((s) => typeof s?.dataUrl === 'string' && s.dataUrl.startsWith('data:image/png')) : []
  } catch {
    return []
  }
}

export function saveSignatures(list: SignatureItem[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

/** 裁掉四周透明区域并留少许边距 */
export function trimCanvas(src: HTMLCanvasElement, pad = 6): HTMLCanvasElement | null {
  const ctx = src.getContext('2d')!
  const { width, height } = src
  const data = ctx.getImageData(0, 0, width, height).data
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  minX = Math.max(0, minX - pad)
  minY = Math.max(0, minY - pad)
  maxX = Math.min(width - 1, maxX + pad)
  maxY = Math.min(height - 1, maxY + pad)
  const out = document.createElement('canvas')
  out.width = maxX - minX + 1
  out.height = maxY - minY + 1
  out.getContext('2d')!.drawImage(src, minX, minY, out.width, out.height, 0, 0, out.width, out.height)
  return out
}

export function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

/**
 * 去除白色（浅色）背景：亮度高于阈值的像素变透明，边缘柔和过渡。
 * 适合拍照或扫描得到的签名、印章。
 */
export function removeLightBackground(img: HTMLImageElement, threshold: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, c.width, c.height)
  const p = d.data
  const soft = 40
  for (let i = 0; i < p.length; i += 4) {
    const lum = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]
    // 彩色印章（如红章）按“离白色的距离”判断，避免把浅红色抠掉
    const chroma = Math.max(p[i], p[i + 1], p[i + 2]) - Math.min(p[i], p[i + 1], p[i + 2])
    const score = lum - chroma * 0.8
    if (score >= threshold) p[i + 3] = 0
    else if (score > threshold - soft) p[i + 3] = Math.round((p[i + 3] * (threshold - score)) / soft)
  }
  ctx.putImageData(d, 0, 0)
  return c
}
