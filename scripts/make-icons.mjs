// 生成应用图标：build/icon.png（1024）与 build/icon.ico（多尺寸）
import { writeFileSync } from 'node:fs'
import { createCanvas } from '@napi-rs/canvas'
import sharp from 'sharp'

function draw(size) {
  const c = createCanvas(size, size)
  const g = c.getContext('2d')
  const s = size / 1024
  const r = 230 * s
  const pad = 64 * s
  // 圆角方形 + 紫色渐变
  const grad = g.createLinearGradient(pad, pad, size - pad, size - pad)
  grad.addColorStop(0, '#6d5dfc')
  grad.addColorStop(0.55, '#8b5cf6')
  grad.addColorStop(1, '#a855f7')
  g.fillStyle = grad
  g.beginPath()
  g.roundRect(pad, pad, size - pad * 2, size - pad * 2, r)
  g.fill()
  // 顶部高光
  const hl = g.createLinearGradient(0, pad, 0, size / 2)
  hl.addColorStop(0, 'rgba(255,255,255,0.28)')
  hl.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = hl
  g.beginPath()
  g.roundRect(pad, pad, size - pad * 2, size - pad * 2, r)
  g.fill()
  // 盒子图形（与界面中的 Box 图标一致）
  g.strokeStyle = '#ffffff'
  g.lineWidth = 58 * s
  g.lineJoin = 'round'
  g.lineCap = 'round'
  const cx = size / 2
  const top = 262 * s
  const w = 250 * s
  const h = 145 * s
  const depth = 290 * s
  g.beginPath()
  g.moveTo(cx, top)
  g.lineTo(cx + w, top + h)
  g.lineTo(cx + w, top + h + depth)
  g.lineTo(cx, top + 2 * h + depth)
  g.lineTo(cx - w, top + h + depth)
  g.lineTo(cx - w, top + h)
  g.closePath()
  g.stroke()
  g.beginPath()
  g.moveTo(cx - w, top + h)
  g.lineTo(cx, top + 2 * h)
  g.lineTo(cx + w, top + h)
  g.moveTo(cx, top + 2 * h)
  g.lineTo(cx, top + 2 * h + depth)
  g.stroke()
  return c
}

const big = await draw(1024).encode('png')
writeFileSync('build/icon.png', big)
const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = await Promise.all(sizes.map((s) => (s <= 48 ? draw(s).encode('png') : sharp(big).resize(s, s).png().toBuffer())))
const header = Buffer.alloc(6 + 16 * sizes.length)
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
writeFileSync('build/icon.ico', Buffer.concat([header, ...pngs]))
console.log('icons written')
