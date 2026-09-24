// 水印与页码的版面计算：引擎与界面预览共用，保证预览与结果一致
import type { NumberFormat, NumberPosition, WatermarkLayout } from './types'

/** 水印、页码文字使用的字体（优先中文系统字体） */
export const FONT_STACK =
  '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "WenQuanYi Zen Hei", "Heiti SC", sans-serif'

/** 多行文字的外框尺寸（与字号同单位） */
export function textBox(lineWidths: number[], size: number): { width: number; height: number; lineH: number } {
  const lineH = size * 1.25
  return { width: Math.max(1, ...lineWidths) + size * 0.2, height: lineH * lineWidths.length + size * 0.1, lineH }
}

export interface Placement {
  /** 中心点，页面可见坐标系（原点在左下角，单位磅） */
  cx: number
  cy: number
}

/** 旋转后外接矩形尺寸 */
function rotatedBox(w: number, h: number, angle: number): [number, number] {
  const r = (angle * Math.PI) / 180
  const c = Math.abs(Math.cos(r))
  const s = Math.abs(Math.sin(r))
  return [w * c + h * s, w * s + h * c]
}

export function watermarkPlacements(pageW: number, pageH: number, itemW: number, itemH: number, angle: number, layout: WatermarkLayout): Placement[] {
  if (layout === 'center') return [{ cx: pageW / 2, cy: pageH / 2 }]
  const [bw, bh] = rotatedBox(itemW, itemH, angle)
  const stepX = Math.max(bw * 1.1 + 24, 60)
  const stepY = Math.max(bh * 1.1 + 24, 60)
  const out: Placement[] = []
  let row = 0
  for (let y = pageH / 2 - Math.ceil(pageH / 2 / stepY + 1) * stepY; y <= pageH + stepY; y += stepY, row++) {
    const offset = row % 2 === 0 ? 0 : stepX / 2
    for (let x = pageW / 2 - Math.ceil(pageW / 2 / stepX + 1) * stepX + offset; x <= pageW + stepX; x += stepX) {
      // 只保留与页面有交集的位置
      if (x + bw / 2 < 0 || x - bw / 2 > pageW || y + bh / 2 < 0 || y - bh / 2 > pageH) continue
      out.push({ cx: x, cy: y })
    }
  }
  return out
}

export function formatPageNumber(format: NumberFormat, n: number, total: number): string {
  switch (format) {
    case 'n': return `${n}`
    case 'n-total': return `${n} / ${total}`
    case 'cn': return `第 ${n} 页`
    case 'cn-total': return `第 ${n} 页 共 ${total} 页`
    case 'dash': return `- ${n} -`
    case 'page-of': return `Page ${n} of ${total}`
  }
}

/** 页码位置：返回文字框左下角坐标 */
export function numberPosition(pos: NumberPosition, pageW: number, pageH: number, textW: number, textH: number, margin: number): [number, number] {
  const x = pos[1] === 'l' ? margin : pos[1] === 'r' ? pageW - margin - textW : (pageW - textW) / 2
  const y = pos[0] === 'b' ? margin : pageH - margin - textH
  return [x, y]
}
