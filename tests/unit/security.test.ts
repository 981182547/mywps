import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { compressPdf } from '../../src/main/engine/compress'
import { mergePdfs } from '../../src/main/engine/pdf'
import { encryptionState } from '../../src/main/engine/qpdf'
import { openPdfJs } from '../../src/main/engine/render'
import { decryptPdf, encryptPdf, repairPdf } from '../../src/main/engine/security'
import { FIX, makePdf, renderPage, tempDir } from './helpers'

let dir: string
let cleanup: () => Promise<void>
beforeEach(async () => ({ dir, cleanup } = await tempDir()))
afterEach(() => cleanup())

const enc = (path: string, extra: Partial<Parameters<typeof encryptPdf>[0]> = {}) =>
  encryptPdf({
    type: 'pdf-encrypt',
    path,
    openPassword: '',
    ownerPassword: '',
    allowPrint: true,
    allowCopy: true,
    allowModify: true,
    allowAnnotate: true,
    output: { dir },
    fileName: 'enc',
    ...extra
  })

async function state(path: string) {
  return encryptionState(new Uint8Array(await readFile(path)))
}

describe('PDF 加密', () => {
  it('设置打开密码后需要密码才能打开（AES-256）', async () => {
    const src = await makePdf(dir, 'a.pdf', 3)
    const [out] = await enc(src, { openPassword: '密码123' })
    expect(await state(out)).toBe('open')
    await expect(openPdfJs(out)).rejects.toThrow('已加密')
    const { doc, close } = await openPdfJs(out, '密码123')
    expect(doc.numPages).toBe(3)
    await close()
  })

  it('只设权限密码：无需密码即可打开，但禁止打印和复制', async () => {
    const src = await makePdf(dir, 'a.pdf', 1)
    const [out] = await enc(src, { ownerPassword: 'boss', allowPrint: false, allowCopy: false })
    expect(await state(out)).toBe('restricted')
    const { doc, close } = await openPdfJs(out)
    const perms = (await doc.getPermissions()) ?? []
    // pdf.js 权限标志：4 打印，16 复制
    expect(perms).not.toContain(4)
    expect(perms).not.toContain(16)
    await close()
  })

  it('两个密码都为空、或两者相同时提示', async () => {
    const src = await makePdf(dir, 'a.pdf', 1)
    await expect(enc(src)).rejects.toThrow('请至少设置')
    await expect(enc(src, { openPassword: 'x', ownerPassword: 'x' })).rejects.toThrow('不能相同')
  })
})

describe('PDF 解密', () => {
  it('输入正确密码后移除密码', async () => {
    const [out] = await decryptPdf({ type: 'pdf-decrypt', path: join(FIX, 'encrypted.pdf'), password: '1234', output: { dir }, fileName: 'dec' })
    expect(await state(out)).toBe('none')
    expect((await PDFDocument.load(await readFile(out))).getPageCount()).toBe(1)
  })

  it('密码错误时提示', async () => {
    await expect(decryptPdf({ type: 'pdf-decrypt', path: join(FIX, 'encrypted.pdf'), password: '0000', output: { dir }, fileName: 'dec' })).rejects.toThrow('密码不正确')
  })

  it('未加密的文件提示无需解密', async () => {
    const src = await makePdf(dir, 'a.pdf', 1)
    await expect(decryptPdf({ type: 'pdf-decrypt', path: src, password: '', output: { dir }, fileName: 'dec' })).rejects.toThrow('没有加密')
  })

  it('只限制了权限的文件无需密码即可解除限制', async () => {
    const src = await makePdf(dir, 'a.pdf', 1)
    const [restricted] = await enc(src, { ownerPassword: 'boss', allowPrint: false })
    const [out] = await decryptPdf({ type: 'pdf-decrypt', path: restricted, password: '', output: { dir }, fileName: 'free' })
    expect(await state(out)).toBe('none')
  })
})

it('只限制了权限的 PDF 可以直接用于其他工具（例如合并）', async () => {
  const src = await makePdf(dir, 'a.pdf', 2)
  const [restricted] = await enc(src, { ownerPassword: 'boss', allowModify: false })
  const [out] = await mergePdfs({ type: 'pdf-merge', items: [{ path: restricted }, { path: src }], output: { dir }, fileName: 'm' })
  expect((await PDFDocument.load(await readFile(out))).getPageCount()).toBe(4)
})

it('设置了打开密码的 PDF 在其他工具中给出明确提示', async () => {
  const src = await makePdf(dir, 'a.pdf', 1)
  await expect(mergePdfs({ type: 'pdf-merge', items: [{ path: src }, { path: join(FIX, 'encrypted.pdf') }], output: { dir }, fileName: 'm' })).rejects.toThrow(
    '设置了打开密码，请先用“PDF 解密”工具移除密码'
  )
})

/** 生成包含大图片的 PDF（模拟扫描件） */
async function scannedPdf(withAlpha = false): Promise<string> {
  const w = 2400
  const h = 3200
  const raw = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3
      // 上半部分红色，下半部分蓝色，带细微噪点
      const n = (x * 31 + y * 17) % 23
      raw[o] = y < h / 2 ? 230 + (n % 20) : 20 + n
      raw[o + 1] = 20 + n
      raw[o + 2] = y < h / 2 ? 20 + n : 230 + (n % 20)
    }
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  if (withAlpha) {
    // 透明 PNG：中间是透明圆洞
    const png = await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
      .ensureAlpha()
      .composite([{ input: Buffer.from(`<svg width="${w}" height="${h}"><circle cx="${w / 2}" cy="${h / 2}" r="${w / 4}" fill="black"/></svg>`), blend: 'dest-out' }])
      .png()
      .toBuffer()
    page.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: { type: 'RGB', red: 0, green: 0.8, blue: 0 } as never })
    page.drawImage(await doc.embedPng(png), { x: 0, y: 0, width: 595, height: 842 })
  } else {
    const jpg = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 98 }).toBuffer()
    page.drawImage(await doc.embedJpg(jpg), { x: 0, y: 0, width: 595, height: 842 })
  }
  const path = join(dir, withAlpha ? 'alpha.pdf' : 'scan.pdf')
  await writeFile(path, await doc.save())
  return path
}

describe('PDF 压缩', () => {
  it('标准压缩：大图片重新编码，体积显著减小，画面保持', async () => {
    const src = await scannedPdf()
    const r = await compressPdf({ type: 'pdf-compress', path: src, level: 'medium', output: { dir }, fileName: 'c' })
    const before = (await stat(src)).size
    const after = (await stat(r.outputs[0])).size
    expect(after).toBeLessThan(before * 0.5)
    expect(r.notes[0]).toMatch(/减小 \d+%/)
    const page = await renderPage(r.outputs[0], 1, 0.5)
    const [red, , blue] = page.pixel(0.5, 0.25)
    expect(red).toBeGreaterThan(180)
    expect(blue).toBeLessThan(80)
    const [r2, , b2] = page.pixel(0.5, 0.75)
    expect(b2).toBeGreaterThan(180)
    expect(r2).toBeLessThan(80)
  })

  it('带透明通道的图片压缩后透明区域保持不变', async () => {
    const src = await scannedPdf(true)
    const r = await compressPdf({ type: 'pdf-compress', path: src, level: 'high', output: { dir }, fileName: 'c' })
    const page = await renderPage(r.outputs[0], 1, 0.5)
    // 中心透明，露出绿色背景
    const [cr, cg, cb] = page.pixel(0.5, 0.5)
    expect(cg).toBeGreaterThan(150)
    expect(cr + cb).toBeLessThan(120)
    const [tr] = page.pixel(0.1, 0.1)
    expect(tr).toBeGreaterThan(180)
  })

  it('已经很精简的文件不会变大', async () => {
    const src = await makePdf(dir, 'small.pdf', 1)
    const r = await compressPdf({ type: 'pdf-compress', path: src, level: 'low', output: { dir }, fileName: 'c' })
    expect((await stat(r.outputs[0])).size).toBeLessThanOrEqual((await stat(src)).size)
  })
})

describe('PDF 修复', () => {
  it('交叉引用表损坏的文件可以修复', async () => {
    const src = await makePdf(dir, 'a.pdf', 3)
    const text = Buffer.from(await readFile(src)).toString('latin1')
    // 破坏 startxref 偏移量
    const broken = text.replace(/startxref\s+\d+/, 'startxref\n999999')
    const bad = join(dir, 'broken.pdf')
    await writeFile(bad, Buffer.from(broken, 'latin1'))
    const r = await repairPdf({ type: 'pdf-repair', path: bad, output: { dir }, fileName: 'fixed' })
    expect((await PDFDocument.load(await readFile(r.outputs[0]))).getPageCount()).toBe(3)
    expect(r.notes[0]).toContain('3 页')
  })

  it('完全不是 PDF 的文件给出提示', async () => {
    const bad = join(dir, 'x.pdf')
    await writeFile(bad, 'hello world')
    await expect(repairPdf({ type: 'pdf-repair', path: bad, output: { dir }, fileName: 'fixed' })).rejects.toThrow('无法修复')
  })
})
