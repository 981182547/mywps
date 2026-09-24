// PDF 加密、解密、修复
import { basename } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { UserError } from '../../shared/ranges'
import type { PdfDecryptJob, PdfEncryptJob, PdfRepairJob } from '../../shared/types'
import { ensureDir, readBytes, sanitizeFileName, uniquePath, writeFileAtomic } from './fsutil'
import { noop, type Progress } from './pdf'
import { encryptionState, passwordWorks, runQpdf } from './qpdf'

async function read(path: string): Promise<Uint8Array> {
  try {
    return await readBytes(path)
  } catch {
    throw new UserError(`无法读取文件“${basename(path)}”，请确认文件存在且没有被占用`)
  }
}

async function write(dir: string, fileName: string, data: Uint8Array): Promise<string> {
  await ensureDir(dir)
  const target = uniquePath(dir, sanitizeFileName(fileName, '.pdf'))
  await writeFileAtomic(target, data)
  return target
}

/** qpdf 命令行参数中不允许出现换行等控制字符 */
function checkPassword(pw: string, label: string): void {
  if (/[\u0000-\u001f]/.test(pw)) throw new UserError(`${label}不能包含换行等特殊字符`)
  if (pw.length > 127) throw new UserError(`${label}太长了（最多 127 个字符）`)
}

export async function encryptPdf(job: PdfEncryptJob, progress: Progress = noop): Promise<string[]> {
  const name = basename(job.path)
  const open = job.openPassword
  const owner = job.ownerPassword
  if (!open && !owner) throw new UserError('请至少设置打开密码或权限密码')
  checkPassword(open, '打开密码')
  checkPassword(owner, '权限密码')
  if (open && owner && open === owner) throw new UserError('打开密码和权限密码不能相同')
  progress(0.1, `正在读取 ${name}`)
  let bytes = await read(job.path)
  const state = await encryptionState(bytes)
  if (state === 'open') throw new UserError(`“${name}”已经设置了打开密码，请先解密后再重新加密`)
  if (state === 'restricted') {
    const r = await runQpdf(bytes, (i, o) => ['--decrypt', i, o])
    if (!r.output) throw new UserError(`“${name}”无法处理`)
    bytes = r.output
  }
  progress(0.4, '正在加密（AES-256）')
  // 只设打开密码时，权限密码与打开密码一致会被阅读器视为完全权限；这里使用随机权限密码并开放全部权限
  const ownerPw = owner || `qx-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  const restrict = owner
    ? [
        `--print=${job.allowPrint ? 'full' : 'none'}`,
        `--extract=${job.allowCopy ? 'y' : 'n'}`,
        `--modify=${job.allowModify ? 'all' : job.allowAnnotate ? 'annotate' : 'none'}`,
        `--annotate=${job.allowAnnotate || job.allowModify ? 'y' : 'n'}`
      ]
    : []
  const args = (i: string, o: string) => ['--encrypt', `--user-password=${open}`, `--owner-password=${ownerPw}`, '--bits=256', ...restrict, '--', i, o]
  let r = await runQpdf(bytes, args)
  if (!r.output) {
    // 结构不规范的文件先整理后重试
    const normalized = await normalize(bytes)
    if (normalized) r = await runQpdf(normalized, args)
  }
  if (!r.output) throw new UserError(`“${name}”加密失败，文件可能已损坏`)
  progress(0.9, '正在保存')
  const target = await write(job.output.dir, job.fileName, r.output)
  progress(1, '完成')
  return [target]
}

export async function decryptPdf(job: PdfDecryptJob, progress: Progress = noop): Promise<string[]> {
  const name = basename(job.path)
  progress(0.1, `正在读取 ${name}`)
  const bytes = await read(job.path)
  const state = await encryptionState(bytes)
  if (state === 'none') throw new UserError(`“${name}”没有加密，不需要解密`)
  checkPassword(job.password, '密码')
  if (state === 'open') {
    if (!job.password) throw new UserError('这个文件需要打开密码，请输入密码')
    if (!(await passwordWorks(bytes, job.password))) throw new UserError('密码不正确，请重新输入')
  }
  progress(0.5, '正在解除密码')
  const r = await runQpdf(bytes, (i, o) => [...(job.password ? [`--password=${job.password}`] : []), '--decrypt', i, o])
  if (!r.output) throw new UserError(state === 'open' ? '密码不正确，请重新输入' : `“${name}”解密失败`)
  const target = await write(job.output.dir, job.fileName, r.output)
  progress(1, '完成')
  return [target]
}

/** 用 pdf-lib 重新整理文件结构（其解析器按顺序扫描对象，不依赖可能已损坏的交叉引用表） */
async function normalize(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false })
    return await doc.save({ useObjectStreams: true })
  } catch {
    return null
  }
}

export async function repairPdf(job: PdfRepairJob, progress: Progress = noop): Promise<{ outputs: string[]; notes: string[] }> {
  const name = basename(job.path)
  progress(0.1, `正在读取 ${name}`)
  let bytes = await read(job.path)
  const state = await encryptionState(bytes)
  if (state === 'open') throw new UserError(`“${name}”设置了打开密码，请先解密`)
  if (state === 'restricted') {
    const r = await runQpdf(bytes, (i, o) => ['--decrypt', i, o])
    if (r.output) bytes = r.output
  }
  progress(0.4, '正在检查并重建文件结构')
  let src: PDFDocument
  try {
    src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false })
  } catch {
    throw new UserError(`“${name}”损坏过于严重，无法修复`)
  }
  const total = src.getPageCount()
  if (total === 0) throw new UserError(`“${name}”损坏过于严重，无法修复`)
  // 逐页复制到新文件，跳过无法恢复的页面
  const out = await PDFDocument.create()
  let lost = 0
  for (let i = 0; i < total; i++) {
    try {
      const [p] = await out.copyPages(src, [i])
      out.addPage(p)
    } catch {
      lost++
    }
  }
  if (out.getPageCount() === 0) throw new UserError(`“${name}”中没有可恢复的页面`)
  const target = await write(job.output.dir, job.fileName, await out.save({ useObjectStreams: true }))
  progress(1, '完成')
  return {
    outputs: [target],
    notes: [lost ? `已重建文件结构，恢复 ${out.getPageCount()} 页，${lost} 页损坏无法恢复` : `已重建文件结构，共恢复 ${out.getPageCount()} 页`]
  }
}
