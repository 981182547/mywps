// 签名、盖章与骑缝章
import { basename } from 'node:path'
import type { PDFImage } from 'pdf-lib'
import sharp from 'sharp'
import { UserError, parseRanges } from '../../shared/ranges'
import type { SignJob } from '../../shared/types'
import { drawCentered, isolateExisting, visualPage, writeOut } from './pages'
import { loadPdf, noop, type Progress } from './pdf'

function decodeBase64Png(b64: string): Uint8Array {
  const bytes = Buffer.from(b64.replace(/^data:image\/png;base64,/, ''), 'base64')
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) throw new UserError('签名图片数据有误，请重新添加')
  return new Uint8Array(bytes)
}

export async function signPdf(job: SignJob, progress: Progress = noop): Promise<string[]> {
  progress(0, `正在读取 ${basename(job.path)}`)
  if (job.placements.length === 0 && !job.seam) throw new UserError('请先在页面上放置签名或印章')
  const doc = await loadPdf(job.path)
  const pages = doc.getPages()
  const embedded = new Map<string, PDFImage>()
  const embed = async (id: string): Promise<PDFImage> => {
    let img = embedded.get(id)
    if (!img) {
      const b64 = job.images[id]
      if (!b64) throw new UserError('找不到签名图片，请重新添加')
      img = await doc.embedPng(decodeBase64Png(b64))
      embedded.set(id, img)
    }
    return img
  }

  for (let i = 0; i < job.placements.length; i++) {
    const p = job.placements[i]
    if (!Number.isInteger(p.page) || p.page < 0 || p.page >= pages.length) throw new UserError('签名位置有误，请重新放置')
    if (!(p.w > 0 && p.h > 0)) continue
    const page = pages[p.page]
    const vp = visualPage(page)
    isolateExisting(doc, page)
    const image = await embed(p.imageId)
    // 界面坐标原点在左上角，PDF 在左下角
    drawCentered(page, vp, image, p.x + p.w / 2, vp.height - (p.y + p.h / 2), p.w, p.h, 0, 1)
    progress(0.1 + (0.6 * i) / Math.max(1, job.placements.length), '正在放置签名')
  }

  if (job.seam) {
    const seam = job.seam
    const targets = parseRanges(seam.ranges, pages.length)
    if (targets.length < 2) throw new UserError('骑缝章至少需要 2 页')
    const png = decodeBase64Png(job.images[seam.imageId] ?? '')
    const meta = await sharp(png).metadata()
    const W = meta.width!
    const H = meta.height!
    const n = targets.length
    const fullW = Math.max(20, seam.width)
    const fullH = (fullW * H) / W
    const sliceW = fullW / n
    progress(0.75, '正在加盖骑缝章')
    for (let k = 0; k < n; k++) {
      // 第 k 页取印章从左到右的第 k 份
      const left = Math.floor((k * W) / n)
      const right = Math.floor(((k + 1) * W) / n)
      const piece = await sharp(png).extract({ left, top: 0, width: Math.max(1, right - left), height: H }).png().toBuffer()
      const page = pages[targets[k]]
      const vp = visualPage(page)
      isolateExisting(doc, page)
      const image = await doc.embedPng(piece)
      const cy = vp.height * (1 - Math.min(0.95, Math.max(0.05, seam.yRatio)))
      drawCentered(page, vp, image, vp.width - sliceW / 2, cy, sliceW, fullH, 0, 1)
    }
  }

  progress(0.95, '正在保存')
  const target = await writeOut(doc, job.output.dir, job.fileName)
  progress(1, '完成')
  return [target]
}
