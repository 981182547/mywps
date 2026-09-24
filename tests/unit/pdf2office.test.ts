// 用 LibreOffice 生成真实的 PDF（含中文段落、标题、图片、表格），再转换回 Word / Excel 检查结果
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findLibreOffice, officeToPdf } from '../../src/main/engine/office'
import { pdfToExcel, pdfToWord } from '../../src/main/engine/pdf2office'
import { FIX, tempDir } from './helpers'

let dir: string
let cleanup: () => Promise<void>
beforeEach(async () => ({ dir, cleanup } = await tempDir()))
afterEach(() => cleanup())

const hasLO = !!findLibreOffice()
const LONG = '为深入贯彻落实年度工作部署，进一步提升服务质量和工作效率，现将有关事项通知如下。各部门要高度重视，认真组织实施，确保各项任务按时保质完成。'

async function docxToPdf(doc: Document, name: string): Promise<string> {
  const src = join(dir, name)
  await writeFile(src, await Packer.toBuffer(doc))
  const r = await officeToPdf({ type: 'office-to-pdf', paths: [src], sheetOnePage: false, output: {} })
  return r.outputs[0]
}

async function docText(path: string): Promise<{ xml: string; text: string; media: string[] }> {
  const zip = await JSZip.loadAsync(await readFile(path))
  const xml = await zip.file('word/document.xml')!.async('string')
  const paras = xml.split('</w:p>').map((p) => [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(''))
  return { xml, text: paras.filter(Boolean).join('\n'), media: Object.keys(zip.files).filter((f) => f.startsWith('word/media/') && !zip.files[f].dir) }
}

describe.skipIf(!hasLO)('PDF 转 Word', () => {
  it('还原标题、段落（自动换行合并）、居中与图片', async () => {
    const png = await sharp({ create: { width: 300, height: 150, channels: 3, background: { r: 30, g: 120, b: 220 } } }).png().toBuffer()
    const pdf = await docxToPdf(
      new Document({
        sections: [
          {
            children: [
              new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun({ text: '关于开展年度检查的通知', size: 44, bold: true })] }),
              new Paragraph({ children: [new TextRun({ text: LONG + LONG, size: 24 })] }),
              new Paragraph({ children: [new ImageRun({ type: 'png', data: png, transformation: { width: 300, height: 150 } })] }),
              new Paragraph({ children: [new TextRun({ text: '第二段：请于月底前提交材料。Deadline is Friday.', size: 24 })] })
            ]
          }
        ]
      }),
      '通知.docx'
    )
    const [out] = (await pdfToWord({ type: 'pdf-to-word', path: pdf, output: { dir: join(dir, 'w') } })).outputs
    const { xml, text, media } = await docText(out)
    const lines = text.split('\n')
    expect(lines[0]).toBe('关于开展年度检查的通知')
    // 长段落在 PDF 中被自动换行，转换后应合并为一个段落
    expect(lines.some((l) => l.includes(LONG + LONG))).toBe(true)
    expect(text).toContain('第二段：请于月底前提交材料。Deadline is Friday.')
    expect(media.length).toBe(1)
    expect(xml).toContain('w:jc w:val="center"')
    // 顺序：标题 → 正文 → 第二段
    expect(text.indexOf('关于开展')).toBeLessThan(text.indexOf('为深入贯彻'))
    expect(text.indexOf('为深入贯彻')).toBeLessThan(text.indexOf('第二段'))
    // 生成的 Word 能被办公软件正常打开
    const back = await officeToPdf({ type: 'office-to-pdf', paths: [out], sheetOnePage: false, output: { dir: join(dir, 'back') } })
    expect(back.outputs).toHaveLength(1)
  }, 120_000)

  it('中文未嵌入字体的 PDF 也能转换', async () => {
    const [out] = (await pdfToWord({ type: 'pdf-to-word', path: join(FIX, 'cjk-nonembedded.pdf'), output: { dir } })).outputs
    const { text } = await docText(out)
    expect(text).toContain('关于印发工作方案的通知')
    expect(text).toContain('各部门：现将有关事项通知如下。')
  })
})

describe.skipIf(!hasLO)('PDF 转 Excel', () => {
  it('识别表格的行列，数字转为数值', async () => {
    const cell = (t: string) => new TableCell({ width: { size: 2500, type: WidthType.DXA }, children: [new Paragraph(t)] })
    const rows = [
      ['姓名', '部门', '工号', '销售额'],
      ['张三', '市场部', '0012', '12,500'],
      ['李四', '技术部', '0027', '8300.5'],
      ['王五', '财务部', '0031', '999']
    ]
    const pdf = await docxToPdf(new Document({ sections: [{ children: [new Table({ columnWidths: [2500, 2500, 2500, 2500], rows: rows.map((r) => new TableRow({ children: r.map(cell) })) })] }] }), '业绩.docx')
    const r = await pdfToExcel({ type: 'pdf-to-excel', path: pdf, layout: 'per-page', output: { dir: join(dir, 'x') } })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(r.outputs[0])
    const ws = wb.worksheets[0]
    const got = ws.getSheetValues().filter(Boolean).map((row) => (row as unknown[]).slice(1))
    expect(got[0]).toEqual(['姓名', '部门', '工号', '销售额'])
    expect(got[1]).toEqual(['张三', '市场部', '0012', 12500])
    expect(got[2]).toEqual(['李四', '技术部', '0027', 8300.5])
    expect(got[3]).toEqual(['王五', '财务部', '0031', 999])
  }, 120_000)
})
