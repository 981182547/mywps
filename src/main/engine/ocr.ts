// 文字识别（OCR）：tesseract.js，中英文语言包随程序附带，完全离线
import { existsSync, statSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { Document, Packer, Paragraph } from 'docx'
import { PDFDocument, concatTransformationMatrix, popGraphicsState, pushGraphicsState } from 'pdf-lib'
import { OEM, createWorker, type Worker } from 'tesseract.js'
import { UserError, parseRanges } from '../../shared/ranges'
import type { BatchResult, OcrImagesJob, OcrLang, OcrPdfJob } from '../../shared/types'
import { ensureDir, stem, uniquePath, writeFileAtomic } from './fsutil'
import { decodeImage } from './imagetools'
import { isolateExisting, visualPage } from './pages'
import { loadPdf, noop, save, type Progress } from './pdf'
import { openPdfJs, renderPage } from './render'

const LANG_FILE: Record<OcrLang, string> = { chi: 'chi_sim', eng: 'eng' }

/** tesseract.js 要求所有语言包在同一目录，首次使用时复制到临时目录 */
async function tessdataDir(lang: OcrLang): Promise<string> {
  const name = LANG_FILE[lang]
  const req = createRequire(__filename)
  const src = join(dirname(req.resolve(`@tesseract.js-data/${name}/package.json`)), '4.0.0_best_int', `${name}.traineddata.gz`)
  const dir = join(tmpdir(), 'qingxiang-tessdata-v1')
  const dst = join(dir, `${name}.traineddata.gz`)
  if (!existsSync(dst) || statSync(dst).size !== statSync(src).size) {
    await mkdir(dir, { recursive: true })
    const tmp = `${dst}.${process.pid}.tmp`
    await copyFile(src, tmp)
    const { rename } = await import('node:fs/promises')
    await rename(tmp, dst)
  }
  return dir
}

async function makeWorker(lang: OcrLang, onProgress: (p: number) => void): Promise<Worker> {
  const langPath = await tessdataDir(lang)
  const w = await createWorker(LANG_FILE[lang], OEM.LSTM_ONLY, {
    langPath,
    cacheMethod: 'none',
    gzip: true,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress(m.progress)
    },
    errorHandler: () => undefined
  })
  return w
}

const CJK = '\\u2e80-\\u9fff\\uf900-\\ufaff'
const CJK_PUNCT = '，。、；：！？（）【】《》“”‘’…—'
const HALF_TO_FULL: Record<string, string> = { ',': '，', ':': '：', ';': '；', '!': '！', '?': '？', '(': '（', ')': '）' }

/** 整理识别结果：去掉中文之间多余的空格，中文语境中的半角标点改为全角 */
export function cleanOcrText(text: string): string {
  const cjk = new RegExp(`[${CJK}${CJK_PUNCT}]`)
  const lines = text.replace(/\r/g, '').split('\n')
  return lines
    .map((line) => {
      let s = line.replace(/[ \t]+/g, ' ').trim()
      // 中文语境中的半角标点改为全角，并去掉两侧空格
      s = s.replace(/\s*([,:;!?()])\s*/g, (m, p: string, off: number, all: string) => {
        const before = all.slice(0, off).trimEnd().slice(-1)
        const after = all.slice(off + m.length).trimStart()[0] ?? ''
        if (cjk.test(before) || cjk.test(after)) return HALF_TO_FULL[p]
        return m
      })
      // 去掉与中文字符相邻的空格（中文与中文、中文与数字之间）
      let prev = ''
      while (prev !== s) {
        prev = s
        s = s.replace(new RegExp(`([${CJK}${CJK_PUNCT}]) (?=[${CJK}${CJK_PUNCT}0-9])`, 'g'), '$1').replace(new RegExp(`([0-9]) (?=[${CJK}${CJK_PUNCT}])`, 'g'), '$1')
      }
      return s
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 小图片放大后识别更准确 */
async function prepareImage(path: string): Promise<Buffer> {
  const { image } = await decodeImage(path)
  const meta = await image.metadata()
  const scale = Math.max(meta.width!, meta.height!) < 1500 ? 2 : 1
  let img = image.flatten({ background: '#ffffff' })
  if (scale > 1) img = img.resize(Math.round(meta.width! * scale), Math.round(meta.height! * scale), { kernel: 'lanczos3' })
  return img.png().toBuffer()
}

function txtBytes(text: string): Uint8Array {
  return new TextEncoder().encode('﻿' + text.replace(/\n/g, '\r\n') + '\r\n')
}

async function docxBytes(sections: { title?: string; text: string }[]): Promise<Uint8Array> {
  const children: Paragraph[] = []
  sections.forEach((sec, i) => {
    if (sec.title) children.push(new Paragraph({ text: sec.title, heading: 'Heading2', pageBreakBefore: i > 0 }))
    for (const line of sec.text.split('\n')) children.push(new Paragraph({ text: line }))
  })
  const doc = new Document({ creator: '轻匣', styles: { default: { document: { run: { font: { ascii: 'Arial', eastAsia: '宋体', hAnsi: 'Arial' }, size: 22 } } } }, sections: [{ children }] })
  return new Uint8Array(await Packer.toBuffer(doc))
}

function previewOf(parts: string[]): string {
  const all = parts.join('\n\n')
  return all.length > 20000 ? all.slice(0, 20000) + '\n……' : all
}

// ---------- 图片识别 ----------

export async function ocrImages(job: OcrImagesJob, progress: Progress = noop): Promise<BatchResult> {
  if (job.paths.length === 0) throw new UserError('请先添加图片')
  let current = 0
  const n = job.paths.length
  progress(0, '正在加载文字识别模型')
  const worker = await makeWorker(job.lang, (p) => progress((current + p) / n, `正在识别 ${basename(job.paths[current])}（${current + 1} / ${n}）`))
  const results: { path: string; text: string }[] = []
  const failures: string[] = []
  try {
    for (current = 0; current < n; current++) {
      const p = job.paths[current]
      progress(current / n, `正在识别 ${basename(p)}（${current + 1} / ${n}）`)
      try {
        const r = await worker.recognize(await prepareImage(p))
        results.push({ path: p, text: cleanOcrText(r.data.text) })
      } catch (e) {
        failures.push(e instanceof UserError ? e.message : `“${basename(p)}”识别失败`)
      }
    }
  } finally {
    await worker.terminate()
  }
  if (results.length === 0) throw new UserError(failures[0] ?? '识别失败')
  const outputs: string[] = []
  const dirFor = (p: string) => job.output.dir ?? dirname(p)
  if (job.format === 'each') {
    for (const r of results) {
      await ensureDir(dirFor(r.path))
      const t = uniquePath(dirFor(r.path), `${stem(r.path)}_识别结果.txt`)
      await writeFileAtomic(t, txtBytes(r.text))
      outputs.push(t)
    }
  } else {
    const dir = dirFor(results[0].path)
    await ensureDir(dir)
    const name = `${stem(results[0].path)}${results.length > 1 ? `等${results.length}张` : ''}_识别结果`
    const sections = results.map((r) => ({ title: results.length > 1 ? basename(r.path) : undefined, text: r.text }))
    if (job.format === 'merged') {
      const t = uniquePath(dir, `${name}.txt`)
      await writeFileAtomic(t, txtBytes(sections.map((s) => (s.title ? `【${s.title}】\n${s.text}` : s.text)).join('\n\n')))
      outputs.push(t)
    } else {
      const t = uniquePath(dir, `${name}.docx`)
      await writeFileAtomic(t, await docxBytes(sections))
      outputs.push(t)
    }
  }
  const chars = results.reduce((s, r) => s + r.text.replace(/\s/g, '').length, 0)
  progress(1, '完成')
  return {
    outputs,
    notes: [chars ? `共识别 ${chars} 个字符` : '没有识别到文字，请确认图片清晰、文字方向正确'],
    failures,
    preview: previewOf(results.map((r) => (results.length > 1 ? `【${basename(r.path)}】\n${r.text}` : r.text)))
  }
}

// ---------- 扫描版 PDF 识别 ----------

const DPI = 300

export async function ocrPdf(job: OcrPdfJob, progress: Progress = noop): Promise<BatchResult> {
  const name = basename(job.path)
  progress(0, `正在读取 ${name}`)
  const { doc: pdfjsDoc, close } = await openPdfJs(job.path)
  const target = job.format === 'searchable' ? await loadPdf(job.path) : null
  const indices = parseRanges(job.ranges, pdfjsDoc.numPages)
  let current = 0
  progress(0.02, '正在加载文字识别模型')
  const worker = await makeWorker(job.lang, (p) => progress(0.03 + (0.9 * (current + p)) / indices.length, `正在识别第 ${indices[current] + 1} 页（${current + 1} / ${indices.length}）`))
  const texts: { page: number; text: string }[] = []
  let skipped = 0
  try {
    await worker.setParameters({ user_defined_dpi: String(DPI) })
    for (current = 0; current < indices.length; current++) {
      const idx = indices[current]
      progress(0.03 + (0.9 * current) / indices.length, `正在识别第 ${idx + 1} 页（${current + 1} / ${indices.length}）`)
      const page = await pdfjsDoc.getPage(idx + 1)
      // 已有文字的页面（电子版）不需要识别
      const existing = (await page.getTextContent()).items.filter((it) => 'str' in it && it.str.trim()).length
      if (existing > 20) {
        skipped++
        if (job.format !== 'searchable') {
          const c = await page.getTextContent()
          texts.push({ page: idx, text: c.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : '') : '')).join('') })
        }
        continue
      }
      const canvas = await renderPage(pdfjsDoc, idx, DPI)
      const png = Buffer.from(await canvas.encode('png'))
      const r = await worker.recognize(png, { pdfTextOnly: true, pdfTitle: '' }, { text: true, pdf: job.format === 'searchable' })
      texts.push({ page: idx, text: cleanOcrText(r.data.text) })
      if (target && r.data.pdf) {
        // 把只有隐形文字层的页面叠加到原页面上，外观不变但可以搜索、复制
        const layer = await PDFDocument.load(new Uint8Array(r.data.pdf))
        const [embedded] = await target.embedPdf(layer, [0])
        const pg = target.getPage(idx)
        const vp = visualPage(pg)
        isolateExisting(target, pg)
        pg.pushOperators(pushGraphicsState(), concatTransformationMatrix(...vp.matrix))
        pg.drawPage(embedded, { x: 0, y: 0, width: vp.width, height: vp.height })
        pg.pushOperators(popGraphicsState())
      }
      page.cleanup()
    }
  } finally {
    await worker.terminate()
    await close()
  }

  progress(0.95, '正在保存')
  await ensureDir(job.output.dir)
  let out: string
  if (job.format === 'searchable') {
    if (skipped === indices.length) throw new UserError('这个 PDF 的页面都已经包含文字，不需要识别')
    out = uniquePath(job.output.dir, `${stem(job.path)}_可搜索.pdf`)
    await save(target!, out)
  } else if (job.format === 'txt') {
    out = uniquePath(job.output.dir, `${stem(job.path)}_识别结果.txt`)
    await writeFileAtomic(out, txtBytes(texts.map((t) => `—— 第 ${t.page + 1} 页 ——\n${t.text}`).join('\n\n')))
  } else {
    out = uniquePath(job.output.dir, `${stem(job.path)}_识别结果.docx`)
    await writeFileAtomic(out, await docxBytes(texts.map((t) => ({ title: `第 ${t.page + 1} 页`, text: t.text }))))
  }
  progress(1, '完成')
  const chars = texts.reduce((s, t) => s + t.text.replace(/\s/g, '').length, 0)
  const notes = [`识别了 ${indices.length - skipped} 页，共 ${chars} 个字符`]
  if (skipped) notes.push(`${skipped} 页本身已包含文字，未重复识别`)
  return { outputs: [out], notes, failures: [], preview: previewOf(texts.map((t) => t.text)) }
}

