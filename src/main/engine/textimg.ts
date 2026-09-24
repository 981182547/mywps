// 用系统字体把文字渲染成透明 PNG（支持中文），用于水印和页码
import { createCanvas } from '@napi-rs/canvas'

import { FONT_STACK, textBox } from '../../shared/layout'

/** 每磅对应的像素数：4 约等于 288 DPI，打印也清晰 */
const PX_PER_PT = 4

export interface TextImage {
  png: Uint8Array
  /** 以磅为单位的尺寸 */
  width: number
  height: number
}

export function parseColor(hex: string): string {
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#000000'
}

export async function renderText(text: string, fontSizePt: number, color: string, bold = false): Promise<TextImage> {
  const px = Math.max(4, fontSizePt * PX_PER_PT)
  const font = `${bold ? 'bold ' : ''}${px}px ${FONT_STACK}`
  const lines = text.split(/\r?\n/)
  const probe = createCanvas(8, 8).getContext('2d')
  probe.font = font
  const box = textBox(lines.map((l) => probe.measureText(l).width), px)
  const lineH = box.lineH
  const width = Math.ceil(box.width)
  const height = Math.ceil(box.height)
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.font = font
  ctx.fillStyle = parseColor(color)
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  lines.forEach((l, i) => ctx.fillText(l, width / 2, lineH * (i + 0.5) + px * 0.05))
  const png = await canvas.encode('png')
  return { png: new Uint8Array(png), width: width / PX_PER_PT, height: height / PX_PER_PT }
}
