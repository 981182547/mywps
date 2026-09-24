import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import ExcelJS from 'exceljs'
import PptxGenJS from 'pptxgenjs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { familyOf, findLibreOffice, officeConvert, officeToPdf } from '../../src/main/engine/office'
import { openPdfJs } from '../../src/main/engine/render'
import { tempDir } from './helpers'

let dir: string
let cleanup: () => Promise<void>
beforeEach(async () => ({ dir, cleanup } = await tempDir()))
afterEach(() => cleanup())

const hasLO = !!findLibreOffice()

async function makeDocx(name = '报告.docx'): Promise<string> {
  const doc = new Document({
    sections: [{ children: [new Paragraph({ text: '年度工作总结', heading: HeadingLevel.HEADING_1 }), new Paragraph({ children: [new TextRun('今年完成了全部目标。')] })] }]
  })
  const p = join(dir, name)
  await writeFile(p, await Packer.toBuffer(doc))
  return p
}

async function makeXlsx(): Promise<string> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('销售')
  ws.addRow(['月份', '销售额'])
  ws.addRow(['一月', 1200])
  ws.addRow(['二月', 3400])
  const p = join(dir, '销售表.xlsx')
  await wb.xlsx.writeFile(p)
  return p
}

async function makePptx(): Promise<string> {
  const pptx = new PptxGenJS()
  pptx.addSlide().addText('产品发布会', { x: 1, y: 1, w: 8, h: 1, fontSize: 36 })
  pptx.addSlide().addText('第二页内容', { x: 1, y: 1, w: 8, h: 1, fontSize: 24 })
  const p = join(dir, '发布会.pptx')
  await writeFile(p, (await pptx.write({ outputType: 'nodebuffer' })) as Buffer)
  return p
}

async function pdfText(path: string): Promise<{ text: string; pages: number }> {
  const { doc, close } = await openPdfJs(path)
  let text = ''
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent()
    text += c.items.map((it) => ('str' in it ? it.str : '')).join('') + '\n'
  }
  const pages = doc.numPages
  await close()
  return { text, pages }
}

it('按扩展名识别文档类型', () => {
  expect(familyOf('a.DOCX')).toBe('word')
  expect(familyOf('a.wps')).toBe('word')
  expect(familyOf('a.et')).toBe('excel')
  expect(familyOf('a.dps')).toBe('ppt')
  expect(familyOf('a.pdf')).toBe(null)
})

describe.skipIf(!hasLO)('Office 转 PDF（LibreOffice）', () => {
  it('Word、Excel、PPT 批量转 PDF，内容正确', async () => {
    const files = [await makeDocx(), await makeXlsx(), await makePptx()]
    const r = await officeToPdf({ type: 'office-to-pdf', paths: files, sheetOnePage: false, output: {} }, () => undefined)
    expect(r.failures).toEqual([])
    expect(r.outputs.map((p) => basename(p))).toEqual(['报告.pdf', '销售表.pdf', '发布会.pdf'])
    expect((await pdfText(r.outputs[0])).text).toContain('年度工作总结')
    expect((await pdfText(r.outputs[1])).text).toContain('3400')
    const ppt = await pdfText(r.outputs[2])
    expect(ppt.pages).toBe(2)
    expect(ppt.text).toContain('产品发布会')
  }, 120_000)

  it('不覆盖已有的同名 PDF', async () => {
    const src = await makeDocx()
    await writeFile(join(dir, '报告.pdf'), 'old')
    const r = await officeToPdf({ type: 'office-to-pdf', paths: [src], sheetOnePage: false, output: {} })
    expect(basename(r.outputs[0])).toBe('报告 (2).pdf')
    expect(await readFile(join(dir, '报告.pdf'), 'utf8')).toBe('old')
  }, 60_000)

  it('损坏的文件单独报错，不影响其他文件', async () => {
    const bad = join(dir, '坏文件.docx')
    await writeFile(bad, 'not a docx at all')
    const good = await makeDocx()
    const r = await officeToPdf({ type: 'office-to-pdf', paths: [bad, good], sheetOnePage: false, output: {} })
    expect(r.outputs.map((p) => basename(p))).toEqual(['报告.pdf'])
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0]).toContain('坏文件.docx')
  }, 60_000)
})

describe.skipIf(!hasLO)('Office 格式互转（LibreOffice）', () => {
  it('docx → doc → docx 往返，内容保留', async () => {
    const src = await makeDocx()
    const legacy = await officeConvert({ type: 'office-convert', paths: [src], mode: 'legacy', output: {} })
    expect(basename(legacy.outputs[0])).toBe('报告.doc')
    const back = await officeConvert({ type: 'office-convert', paths: [legacy.outputs[0]], mode: 'modern', output: { dir: join(dir, 'back') } })
    expect(basename(back.outputs[0])).toBe('报告.docx')
    const pdf = await officeToPdf({ type: 'office-to-pdf', paths: [back.outputs[0]], sheetOnePage: false, output: { dir } })
    expect((await pdfText(pdf.outputs[0])).text).toContain('今年完成了全部目标')
  }, 120_000)

  it('WPS 文字格式（.wps）转 docx', async () => {
    const src = await makeDocx()
    const legacy = await officeConvert({ type: 'office-convert', paths: [src], mode: 'legacy', output: {} })
    const wps = join(dir, '通知.wps')
    await copyFile(legacy.outputs[0], wps)
    const r = await officeConvert({ type: 'office-convert', paths: [wps], mode: 'modern', output: {} })
    expect(basename(r.outputs[0])).toBe('通知.docx')
  }, 120_000)

  it('xlsx → xls，已经是目标格式时提示', async () => {
    const x = await makeXlsx()
    const r = await officeConvert({ type: 'office-convert', paths: [x], mode: 'legacy', output: {} })
    expect(basename(r.outputs[0])).toBe('销售表.xls')
    await expect(officeConvert({ type: 'office-convert', paths: [x], mode: 'modern', output: {} })).rejects.toThrow('已经是 XLSX 格式')
  }, 120_000)
})
