// PDF 转 Word / Excel：根据文字坐标、字体与图片位置重建可编辑文档
import { basename } from 'node:path'
import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun, type ISectionOptions } from 'docx'
import ExcelJS from 'exceljs'
import sharp from 'sharp'
import { UserError, parseRanges } from '../../shared/ranges'
import type { PdfToExcelJob, PdfToWordJob } from '../../shared/types'
import { ensureDir, stem, uniquePath, writeFileAtomic } from './fsutil'
import { noop, type Progress } from './pdf'
import { openPdfJs } from './render'

type PdfDoc = Awaited<ReturnType<typeof openPdfJs>>['doc']
type PdfPage = Awaited<ReturnType<PdfDoc['getPage']>>

interface Span {
  text: string
  x: number
  /** 顶部坐标（从页面上边缘向下，单位磅） */
  top: number
  width: number
  size: number
  bold: boolean
  italic: boolean
  font: string
}

interface Line {
  spans: Span[]
  x: number
  right: number
  top: number
  size: number
}

interface ImageBlock {
  kind: 'image'
  top: number
  x: number
  width: number
  height: number
  png: Buffer
  pixelW: number
  pixelH: number
}

interface ParaBlock {
  kind: 'para'
  top: number
  lines: Line[]
  size: number
  align: 'left' | 'center' | 'right'
  indent: number
}

type Block = ImageBlock | ParaBlock

const CJK = /[⺀-鿿豈-﫿＀-￯　-〿]/

/** 把 PDF 字体名映射为常用中文字体 */
function mapFont(name: string): string {
  const n = name.toLowerCase()
  if (/yahei/.test(n)) return '微软雅黑'
  if (/hei|gothic|sans/.test(n)) return '黑体'
  if (/kai/.test(n)) return '楷体'
  if (/fang/.test(n)) return '仿宋'
  if (/song|simsun|stsong|ming|serif|times/.test(n)) return '宋体'
  if (/arial|helvetica/.test(n)) return 'Arial'
  return '宋体'
}

async function pageSpans(page: PdfPage, height: number): Promise<Span[]> {
  const content = await page.getTextContent()
  const spans: Span[] = []
  for (const it of content.items) {
    // 纯空白片段常用来“填充”列间距，丢弃后按实际间距推断空格
    if (!('str' in it) || !it.str || !it.str.trim()) continue
    const [a, b, c, d, e, f] = it.transform as number[]
    // 忽略旋转的文字（如侧边竖排）
    if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01) continue
    const size = Math.abs(d) || Math.abs(a) || it.height || 10
    let bold = false
    let italic = false
    let font = ''
    try {
      const fo = page.commonObjs.get(it.fontName) as { name?: string; bold?: boolean; italic?: boolean; black?: boolean } | undefined
      font = fo?.name ?? ''
      bold = !!fo?.bold || !!fo?.black || /bold|black|heavy|semibold|hei-?b/i.test(font)
      italic = !!fo?.italic || /italic|oblique/i.test(font)
    } catch {
      /* 字体未加载时使用默认值 */
    }
    spans.push({ text: it.str, x: e, top: height - f - size * 0.85, width: it.width, size, bold, italic, font })
  }
  return spans
}

function toLines(spans: Span[]): Line[] {
  const sorted = [...spans].sort((p, q) => p.top - q.top || p.x - q.x)
  const lines: Line[] = []
  for (const s of sorted) {
    const line = lines.find((l) => Math.abs(l.top - s.top) < Math.min(l.size, s.size) * 0.5)
    if (line) {
      line.spans.push(s)
      line.size = Math.max(line.size, s.size)
    } else lines.push({ spans: [s], x: 0, right: 0, top: s.top, size: s.size })
  }
  for (const l of lines) {
    l.spans.sort((p, q) => p.x - q.x)
    l.x = l.spans[0].x
    l.right = Math.max(...l.spans.map((s) => s.x + s.width))
  }
  return lines.sort((p, q) => p.top - q.top)
}

function lineText(l: Line): string {
  let out = ''
  let end = -Infinity
  for (const s of l.spans) {
    const gap = s.x - end
    if (out && !/\s$/.test(out)) {
      const cjkPair = CJK.test(out.slice(-1)) && CJK.test(s.text[0] ?? '')
      if (cjkPair ? gap > l.size * 0.9 : gap > l.size * 0.25) out += cjkPair ? '\u3000' : ' '
    }
    out += s.text
    end = s.x + s.width
  }
  return out
}

function median(nums: number[]): number {
  if (!nums.length) return 10
  const s = [...nums].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** 把行合并成段落：行距正常、字号一致且没有缩进变化时视为同一段 */
function toParagraphs(lines: Line[], pageW: number, marginL: number, marginR: number): ParaBlock[] {
  const paras: ParaBlock[] = []
  const contentW = pageW - marginL - marginR
  let cur: ParaBlock | null = null
  for (const l of lines) {
    const center = (l.x + l.right) / 2
    const narrow = l.right - l.x < contentW * 0.75
    const align: ParaBlock['align'] = narrow && Math.abs(center - pageW / 2) < contentW * 0.06 ? 'center' : narrow && l.x > pageW / 2 && Math.abs(l.right - (pageW - marginR)) < 12 ? 'right' : 'left'
    const prev: Line | undefined = cur?.lines[cur.lines.length - 1]
    const gap = prev ? l.top - (prev.top + prev.size) : Infinity
    const sameSize = prev ? Math.abs(prev.size - l.size) < 0.6 : false
    // 上一行接近右边距（自动换行）且本行从左边距开始
    const wrapped = prev ? prev.right > pageW - marginR - l.size * 3 && Math.abs(l.x - marginL) < l.size * 1.5 : false
    if (cur && sameSize && gap < l.size * 0.9 && wrapped && align === 'left' && cur.align === 'left') {
      cur.lines.push(l)
    } else {
      cur = { kind: 'para', top: l.top, lines: [l], size: l.size, align, indent: align === 'left' ? Math.max(0, l.x - marginL) : 0 }
      paras.push(cur)
    }
  }
  return paras
}

/** 提取页面中的图片及其位置 */
async function pageImages(lib: typeof import('pdfjs-dist/legacy/build/pdf.mjs'), page: PdfPage, pageH: number): Promise<ImageBlock[]> {
  const ops = await page.getOperatorList()
  const { OPS } = lib
  const stack: number[][] = []
  let m = [1, 0, 0, 1, 0, 0]
  const mul = (a: number[], b: number[]) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]]
  const out: ImageBlock[] = []
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]
    const args = ops.argsArray[i] as unknown[]
    if (fn === OPS.save) stack.push(m)
    else if (fn === OPS.restore) m = stack.pop() ?? [1, 0, 0, 1, 0, 0]
    else if (fn === OPS.transform) m = mul(args as number[], m)
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      try {
        const img = (fn === OPS.paintImageXObject ? await new Promise((res) => page.objs.get(args[0] as string, res)) : args[0]) as { width: number; height: number; kind: number; data?: Uint8ClampedArray }
        if (!img?.data || img.width < 16 || img.height < 16) continue
        const channels = img.kind === 3 ? 4 : img.kind === 2 ? 3 : 0
        if (!channels) continue
        const png = await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: img.width, height: img.height, channels } })
          .png({ compressionLevel: 8 })
          .toBuffer()
        // 单位正方形经变换后的外接矩形
        const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]]
        const ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]]
        const x0 = Math.min(...xs)
        const y1 = Math.max(...ys)
        out.push({ kind: 'image', top: pageH - y1, x: x0, width: Math.max(...xs) - x0, height: y1 - Math.min(...ys), png, pixelW: img.width, pixelH: img.height })
      } catch {
        /* 无法解码的图片跳过 */
      }
    }
  }
  return out
}

export async function pdfToWord(job: PdfToWordJob, progress: Progress = noop): Promise<{ outputs: string[]; notes: string[] }> {
  progress(0, `正在读取 ${basename(job.path)}`)
  const { doc, close } = await openPdfJs(job.path)
  try {
    const lib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const indices = parseRanges(job.ranges, doc.numPages)
    const first = (await doc.getPage(indices[0] + 1)).getViewport({ scale: 1 })
    const children: Paragraph[] = []
    let textChars = 0
    let imageCount = 0
    let margins = { l: 72, r: 72, t: 72, b: 72 }

    for (let pi = 0; pi < indices.length; pi++) {
      progress(0.05 + (0.85 * pi) / indices.length, `正在分析第 ${indices[pi] + 1} 页（${pi + 1} / ${indices.length}）`)
      const page = await doc.getPage(indices[pi] + 1)
      const vp = page.getViewport({ scale: 1 })
      const images = await pageImages(lib, page, vp.height)
      const spans = await pageSpans(page, vp.height)
      const lines = toLines(spans)
      const marginL = lines.length ? Math.max(18, Math.min(...lines.map((l) => l.x))) : 72
      const marginR = lines.length ? Math.max(18, vp.width - Math.max(...lines.map((l) => l.right))) : 72
      if (pi === 0) {
        const tops = lines.map((l) => l.top)
        margins = { l: marginL, r: marginR, t: tops.length ? Math.max(18, Math.min(...tops)) : 72, b: 54 }
      }
      const paras = toParagraphs(lines, vp.width, marginL, marginR)
      const body = median(spans.map((s) => s.size))
      const blocks: Block[] = [...paras, ...images].sort((p, q) => p.top - q.top)
      let firstOnPage = true
      for (const b of blocks) {
        const pageBreak = pi > 0 && firstOnPage
        firstOnPage = false
        if (b.kind === 'image') {
          const maxW = vp.width - margins.l - margins.r
          const w = Math.min(maxW, b.width)
          const h = (b.pixelH / b.pixelW) * w
          children.push(
            new Paragraph({
              pageBreakBefore: pageBreak,
              alignment: Math.abs(b.x + b.width / 2 - vp.width / 2) < vp.width * 0.08 ? AlignmentType.CENTER : AlignmentType.LEFT,
              children: [new ImageRun({ type: 'png', data: b.png, transformation: { width: Math.round((w * 96) / 72), height: Math.round((h * 96) / 72) } })]
            })
          )
          imageCount++
          continue
        }
        const ratio = b.size / body
        const heading = ratio >= 1.8 ? HeadingLevel.HEADING_1 : ratio >= 1.45 ? HeadingLevel.HEADING_2 : ratio >= 1.2 && b.lines.length === 1 ? HeadingLevel.HEADING_3 : undefined
        const runs: TextRun[] = []
        let prevText = ''
        b.lines.forEach((l, li) => {
          const text = lineText(l)
          textChars += text.replace(/\s/g, '').length
          // 合并自动换行：中文之间不加空格，英文单词之间补一个空格
          const sep = li === 0 || CJK.test(prevText.slice(-1)) || CJK.test(text[0] ?? '') || /[-\s]$/.test(prevText) ? '' : ' '
          prevText = text
          const bold = l.spans.filter((s) => s.bold).length > l.spans.length / 2
          const italic = l.spans.every((s) => s.italic)
          const font = mapFont(l.spans[0].font)
          runs.push(new TextRun({ text: sep + text, bold, italics: italic, size: Math.round(l.size * 2), font: { ascii: font === '宋体' ? 'Times New Roman' : font, eastAsia: font, hAnsi: font === '宋体' ? 'Times New Roman' : font } }))
        })
        children.push(
          new Paragraph({
            pageBreakBefore: pageBreak,
            heading,
            alignment: b.align === 'center' ? AlignmentType.CENTER : b.align === 'right' ? AlignmentType.RIGHT : AlignmentType.JUSTIFIED,
            indent: b.indent > 4 && b.align === 'left' ? { firstLine: Math.round(b.indent * 20) } : undefined,
            spacing: { after: 80 },
            children: runs
          })
        )
      }
      page.cleanup()
    }
    if (children.length === 0) children.push(new Paragraph({ children: [] }))
    // 标题样式使用黑色、不改字号（字号由文字本身决定）
    const section: ISectionOptions = {
      properties: {
        page: {
          size: { width: Math.round(first.width * 20), height: Math.round(first.height * 20) },
          margin: { top: Math.round(margins.t * 20), bottom: Math.round(margins.b * 20), left: Math.round(margins.l * 20), right: Math.round(margins.r * 20) }
        }
      },
      children
    }
    const docx = new Document({
      creator: '轻匣',
      styles: {
        default: { document: { run: { font: { ascii: 'Times New Roman', eastAsia: '宋体', hAnsi: 'Times New Roman' } } } },
        paragraphStyles: ['Heading1', 'Heading2', 'Heading3'].map((id) => ({ id, name: id.replace('Heading', 'Heading '), basedOn: 'Normal', next: 'Normal', run: { color: '000000' } }))
      },
      sections: [section]
    })
    progress(0.95, '正在生成 Word 文档')
    await ensureDir(job.output.dir)
    const target = uniquePath(job.output.dir, `${stem(job.path)}.docx`)
    await writeFileAtomic(target, new Uint8Array(await Packer.toBuffer(docx)))
    progress(1, '完成')
    const notes = [`已转换 ${indices.length} 页${imageCount ? `，包含 ${imageCount} 张图片` : ''}`]
    if (textChars === 0) notes.push('没有识别到文字，这可能是扫描件，建议先使用“文字识别”')
    return { outputs: [target], notes }
  } finally {
    await close()
  }
}

// ---------- PDF 转 Excel ----------

function parseCell(text: string): string | number {
  const t = text.trim()
  // 保留前导零（如编号 0012）与过长的数字（如身份证号）
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) || /^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(t)) {
    const n = Number(t.replace(/,/g, ''))
    if (Number.isFinite(n)) return n
  }
  return t
}

/** 根据文字的横坐标推断列：把各行片段的起点聚类 */
export function tableFromSpans(spans: Span[]): (string | number)[][] {
  const lines = toLines(spans)
  if (!lines.length) return []
  const size = median(spans.map((s) => s.size))
  // 同一行内相距很近的片段先合并为一个单元格
  const rows = lines.map((l) => {
    const cells: { x: number; right: number; text: string }[] = []
    for (const s of l.spans) {
      const last = cells[cells.length - 1]
      if (last && s.x - last.right < size * 0.8) {
        last.text += (CJK.test(last.text.slice(-1)) || s.x - last.right < size * 0.15 ? '' : ' ') + s.text
        last.right = s.x + s.width
      } else cells.push({ x: s.x, right: s.x + s.width, text: s.text })
    }
    return cells
  })
  const starts = rows.flat().map((c) => c.x).sort((a, b) => a - b)
  const cols: number[] = []
  for (const x of starts) if (!cols.length || x - cols[cols.length - 1] > size * 1.5) cols.push(x)
  return rows.map((cells) => {
    const row: (string | number)[] = new Array(cols.length).fill('')
    for (const c of cells) {
      let idx = 0
      for (let i = 0; i < cols.length; i++) if (cols[i] <= c.x + size * 0.75) idx = i
      row[idx] = row[idx] === '' ? parseCell(c.text) : `${row[idx]} ${c.text}`
    }
    return row
  })
}

export async function pdfToExcel(job: PdfToExcelJob, progress: Progress = noop): Promise<{ outputs: string[]; notes: string[] }> {
  progress(0, `正在读取 ${basename(job.path)}`)
  const { doc, close } = await openPdfJs(job.path)
  try {
    const indices = parseRanges(job.ranges, doc.numPages)
    const wb = new ExcelJS.Workbook()
    wb.creator = '轻匣'
    let single: ExcelJS.Worksheet | null = null
    let cells = 0
    for (let pi = 0; pi < indices.length; pi++) {
      progress(0.05 + (0.85 * pi) / indices.length, `正在识别第 ${indices[pi] + 1} 页的表格`)
      const page = await doc.getPage(indices[pi] + 1)
      const vp = page.getViewport({ scale: 1 })
      await page.getOperatorList()
      const table = tableFromSpans(await pageSpans(page, vp.height))
      const ws = job.layout === 'single' ? (single ??= wb.addWorksheet('表格')) : wb.addWorksheet(`第${indices[pi] + 1}页`)
      if (job.layout === 'single' && pi > 0 && table.length) ws.addRow([])
      for (const r of table) {
        ws.addRow(r)
        cells += r.filter((v) => v !== '').length
      }
      page.cleanup()
    }
    if (cells === 0) throw new UserError('没有识别到文字。这个 PDF 可能是扫描件，请先使用“文字识别”')
    // 列宽按内容自动调整
    wb.eachSheet((ws) => {
      ws.columns.forEach((col) => {
        let max = 6
        col.eachCell?.({ includeEmpty: false }, (c) => {
          const len = [...String(c.value ?? '')].reduce((s, ch) => s + (CJK.test(ch) ? 2 : 1), 0)
          max = Math.max(max, Math.min(60, len + 2))
        })
        col.width = max
      })
      ws.getRow(1).font = { bold: true }
    })
    progress(0.95, '正在生成 Excel 文件')
    await ensureDir(job.output.dir)
    const target = uniquePath(job.output.dir, `${stem(job.path)}.xlsx`)
    await writeFileAtomic(target, new Uint8Array(await wb.xlsx.writeBuffer()))
    progress(1, '完成')
    return { outputs: [target], notes: [`识别了 ${indices.length} 页，共 ${cells} 个单元格`] }
  } finally {
    await close()
  }
}
