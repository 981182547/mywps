// Office 文档转换：Windows 优先调用已安装的 Microsoft Office / WPS，其次使用 LibreOffice
import { existsSync } from 'node:fs'
import { copyFile, mkdtemp, open, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { UserError } from '../../shared/ranges'
import type { BatchResult, OfficeConvertJob, OfficeFamily, OfficeStatus, OfficeToPdfJob } from '../../shared/types'
import { runChild } from './child'
import { ensureDir, stem, uniquePath } from './fsutil'
import { noop, type Progress } from './pdf'

export const FAMILY_EXTS: Record<OfficeFamily, string[]> = {
  word: ['doc', 'docx', 'docm', 'dot', 'dotx', 'wps', 'wpt', 'rtf', 'odt', 'txt'],
  excel: ['xls', 'xlsx', 'xlsm', 'xlt', 'xltx', 'et', 'ett', 'csv', 'ods'],
  ppt: ['ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'pot', 'potx', 'dps', 'dpt', 'odp']
}

export function familyOf(path: string): OfficeFamily | null {
  const ext = extname(path).slice(1).toLowerCase()
  for (const f of Object.keys(FAMILY_EXTS) as OfficeFamily[]) if (FAMILY_EXTS[f].includes(ext)) return f
  return null
}

const FAMILY_NAME: Record<OfficeFamily, string> = { word: '文字', excel: '表格', ppt: '演示' }
const MODERN: Record<OfficeFamily, string> = { word: 'docx', excel: 'xlsx', ppt: 'pptx' }
const LEGACY: Record<OfficeFamily, string> = { word: 'doc', excel: 'xls', ppt: 'ppt' }

// ---------- LibreOffice ----------

/** 设置 QX_OFFICE_DISABLED=1 可模拟“未安装办公软件”（用于测试界面提示） */
const disabled = () => process.env.QX_OFFICE_DISABLED === '1'

export function findLibreOffice(): string | null {
  if (disabled()) return null
  const env = process.env.QX_SOFFICE
  if (env && existsSync(env)) return env
  const candidates =
    process.platform === 'win32'
      ? [
          join(process.env.ProgramFiles ?? 'C:\\Program Files', 'LibreOffice', 'program', 'soffice.exe'),
          join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'LibreOffice', 'program', 'soffice.exe')
        ]
      : process.platform === 'darwin'
        ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice']
        : ['/usr/bin/soffice', '/usr/bin/libreoffice', '/usr/local/bin/soffice', '/usr/lib/libreoffice/program/soffice', '/opt/libreoffice/program/soffice', '/snap/bin/libreoffice']
  return candidates.find((p) => existsSync(p)) ?? null
}

async function convertWithLibreOffice(soffice: string, input: string, target: string, family: OfficeFamily, sheetOnePage: boolean): Promise<string> {
  const work = await mkdtemp(join(tmpdir(), 'qx-lo-'))
  try {
    const outDir = join(work, 'out')
    await ensureDir(outDir)
    // 复制为 ASCII 文件名，避免个别系统上命令行编码问题；WPS 格式改为对应的通用扩展名以便识别
    const ext = extname(input).slice(1).toLowerCase()
    const inExt = ({ wps: 'doc', wpt: 'doc', et: 'xls', ett: 'xls', dps: 'ppt', dpt: 'ppt' } as Record<string, string>)[ext] ?? ext
    const src = join(work, `input.${inExt}`)
    await copyFile(input, src)
    let convertTo = target
    if (target === 'pdf' && family === 'excel' && sheetOnePage) convertTo = 'pdf:calc_pdf_Export:{"SinglePageSheets":{"type":"boolean","value":"true"}}'
    const r = await runChild(
      soffice,
      ['--headless', '--norestore', '--nologo', '--nodefault', '--nolockcheck', `-env:UserInstallation=${pathToFileURL(join(work, 'profile')).href}`, '--convert-to', convertTo, '--outdir', outDir, src],
      180_000
    )
    if (r.timedOut) throw new UserError(`“${basename(input)}”转换超时，文件可能过大或设置了密码`)
    const produced = (await readdir(outDir)).find((f) => f.toLowerCase().endsWith(`.${target}`))
    if (!produced) throw new UserError(`“${basename(input)}”无法转换，文件可能已损坏、设置了密码或格式不受支持`)
    const keep = join(tmpdir(), `qx-out-${Date.now()}-${Math.random().toString(36).slice(2)}.${target}`)
    await rename(join(outDir, produced), keep).catch(async () => {
      await copyFile(join(outDir, produced), keep)
    })
    return keep
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
}

// ---------- Windows：Microsoft Office / WPS（COM 自动化） ----------

const PROG_IDS: Record<OfficeFamily, { id: string; name: string }[]> = {
  word: [
    { id: 'Word.Application', name: 'Microsoft Office' },
    { id: 'KWps.Application', name: 'WPS Office' }
  ],
  excel: [
    { id: 'Excel.Application', name: 'Microsoft Office' },
    { id: 'KET.Application', name: 'WPS Office' }
  ],
  ppt: [
    { id: 'PowerPoint.Application', name: 'Microsoft Office' },
    { id: 'KWPP.Application', name: 'WPS Office' }
  ]
}

// 各程序另存为格式代码：Word 17=PDF 16=docx 0=doc；Excel 51=xlsx 56=xls；PowerPoint 32=PDF 24=pptx 1=ppt
const COM_SCRIPT = `
param([string]$ProgId, [string]$Family, [string]$InPath, [string]$OutPath, [string]$Target, [string]$OnePage)
$ErrorActionPreference = 'Stop'
$app = $null
try {
  $app = New-Object -ComObject $ProgId
  try { $app.DisplayAlerts = 0 } catch {}
  if ($Family -eq 'word') {
    try { $app.Visible = $false } catch {}
    $doc = $app.Documents.Open($InPath, $false, $true, $false)
    if ($Target -eq 'pdf') { $doc.ExportAsFixedFormat($OutPath, 17) }
    elseif ($Target -eq 'docx') { $doc.SaveAs2($OutPath, 16) }
    else { $doc.SaveAs2($OutPath, 0) }
    $doc.Close(0)
  } elseif ($Family -eq 'excel') {
    try { $app.Visible = $false } catch {}
    $wb = $app.Workbooks.Open($InPath, 0, $true)
    if ($Target -eq 'pdf') {
      if ($OnePage -eq '1') { foreach ($ws in $wb.Worksheets) { try { $ws.PageSetup.Zoom = $false; $ws.PageSetup.FitToPagesWide = 1; $ws.PageSetup.FitToPagesTall = 1 } catch {} } }
      $wb.ExportAsFixedFormat(0, $OutPath)
    }
    elseif ($Target -eq 'xlsx') { $wb.SaveAs($OutPath, 51) }
    else { $wb.SaveAs($OutPath, 56) }
    $wb.Close($false)
  } else {
    $pres = $app.Presentations.Open($InPath, -1, 0, 0)
    if ($Target -eq 'pdf') { $pres.SaveAs($OutPath, 32) }
    elseif ($Target -eq 'pptx') { $pres.SaveAs($OutPath, 24) }
    else { $pres.SaveAs($OutPath, 1) }
    $pres.Close()
  }
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 3
} finally {
  if ($app -ne $null) { try { $app.Quit() } catch {} ; [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) }
}
`

const DETECT_SCRIPT = `
$ids = @(${Object.values(PROG_IDS)
  .flat()
  .map((p) => `'${p.id}'`)
  .join(',')})
foreach ($id in $ids) { if ([type]::GetTypeFromProgID($id)) { Write-Output $id } }
`

let comCache: Promise<string[]> | null = null

/** 检测已安装的 Office / WPS（仅 Windows） */
export function detectComApps(refresh = false): Promise<string[]> {
  if (process.platform !== 'win32' || disabled()) return Promise.resolve([])
  if (!comCache || refresh) {
    comCache = (async () => {
      const r = await runChild('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', DETECT_SCRIPT], 20_000)
      return r.stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
    })().catch(() => [])
  }
  return comCache
}

async function convertWithCom(progId: string, family: OfficeFamily, input: string, target: string, sheetOnePage: boolean): Promise<string> {
  const work = await mkdtemp(join(tmpdir(), 'qx-com-'))
  try {
    const script = join(work, 'convert.ps1')
    // 带 BOM 的 UTF-8，PowerShell 5 才能正确读取中文
    await writeFile(script, '\ufeff' + COM_SCRIPT, 'utf8')
    const out = join(tmpdir(), `qx-out-${Date.now()}-${Math.random().toString(36).slice(2)}.${target}`)
    const r = await runChild(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-ProgId', progId, '-Family', family, '-InPath', input, '-OutPath', out, '-Target', target, '-OnePage', sheetOnePage ? '1' : '0'],
      240_000
    )
    if (r.timedOut || r.code !== 0 || !existsSync(out)) throw new Error(r.stderr || `exit ${r.code}`)
    return out
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
}

// ---------- 统一入口 ----------

export async function officeStatus(refresh = false): Promise<OfficeStatus> {
  const com = await detectComApps(refresh)
  const names = new Set<string>()
  for (const list of Object.values(PROG_IDS)) for (const p of list) if (com.includes(p.id)) names.add(p.name)
  if (findLibreOffice()) names.add('LibreOffice')
  return { engines: [...names] }
}

const NO_ENGINE = '没有找到可用的办公软件。请安装免费的 LibreOffice，或 Microsoft Office、WPS Office 后重试'

const ZIP_EXTS = ['docx', 'docm', 'dotx', 'xlsx', 'xlsm', 'xltx', 'pptx', 'pptm', 'ppsx', 'potx', 'odt', 'ods', 'odp']
const OLE_EXTS = ['doc', 'dot', 'wps', 'wpt', 'xls', 'xlt', 'et', 'ett', 'ppt', 'pps', 'pot', 'dps', 'dpt']

/** 检查文件内容与扩展名是否相符，避免把损坏的文件当纯文本转换出一堆乱码 */
async function checkSignature(input: string): Promise<void> {
  const ext = extname(input).slice(1).toLowerCase()
  const fh = await open(input, 'r').catch(() => null)
  if (!fh) throw new UserError(`无法读取“${basename(input)}”，请确认文件存在且没有被占用`)
  const head = Buffer.alloc(16)
  try {
    await fh.read(head, 0, 16, 0)
  } finally {
    await fh.close()
  }
  const isZip = head[0] === 0x50 && head[1] === 0x4b
  const isOle = head.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
  const text = head.toString('utf8').trimStart().toLowerCase()
  // 一些 .doc/.xls 实际上是 RTF、HTML 或 XML，同样可以转换
  const isMarkup = text.startsWith('{\\rtf') || text.startsWith('<') || text.startsWith('\ufeff<')
  if (ZIP_EXTS.includes(ext) && !isZip) throw new UserError(`“${basename(input)}”已损坏或不是有效的 ${ext.toUpperCase()} 文件`)
  if (OLE_EXTS.includes(ext) && !isOle && !isMarkup && !isZip) throw new UserError(`“${basename(input)}”已损坏或不是有效的 ${ext.toUpperCase()} 文件`)
}

/** 转换单个文件，返回临时输出路径 */
async function convertOne(input: string, target: string, sheetOnePage: boolean): Promise<string> {
  const family = familyOf(input)
  if (!family) throw new UserError(`“${basename(input)}”不是支持的 Office 文档`)
  await checkSignature(input)
  const errors: string[] = []
  const com = await detectComApps()
  for (const p of PROG_IDS[family]) {
    if (!com.includes(p.id)) continue
    try {
      return await convertWithCom(p.id, family, input, target, sheetOnePage)
    } catch (e) {
      errors.push(`${p.name}：${(e as Error).message}`)
    }
  }
  const soffice = findLibreOffice()
  if (soffice) return convertWithLibreOffice(soffice, input, target, family, sheetOnePage)
  if (errors.length) throw new UserError(`“${basename(input)}”转换失败（${errors[0]}）`)
  throw new UserError(NO_ENGINE)
}

async function batch(paths: string[], outDir: string | undefined, progress: Progress, targetFor: (p: string) => string, sheetOnePage: boolean): Promise<BatchResult> {
  if (paths.length === 0) throw new UserError('请先添加文件')
  const status = await officeStatus()
  if (status.engines.length === 0) throw new UserError(NO_ENGINE)
  const outputs: string[] = []
  const failures: string[] = []
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i]
    progress(i / paths.length, `正在转换 ${basename(p)}（${i + 1} / ${paths.length}）`)
    try {
      const target = targetFor(p)
      const tmp = await convertOne(p, target, sheetOnePage)
      const dir = outDir ?? dirname(p)
      await ensureDir(dir)
      const dest = uniquePath(dir, `${stem(p)}.${target}`)
      await rename(tmp, dest).catch(async () => {
        await copyFile(tmp, dest)
        await rm(tmp, { force: true })
      })
      outputs.push(dest)
    } catch (e) {
      failures.push(e instanceof UserError ? e.message : `“${basename(p)}”转换失败`)
    }
  }
  progress(1, '完成')
  if (outputs.length === 0) throw new UserError(failures.length === 1 ? failures[0] : `全部 ${failures.length} 个文件转换失败：${failures[0]}`)
  return { outputs, notes: [`使用 ${status.engines[0]} 转换`], failures }
}

export function officeToPdf(job: OfficeToPdfJob, progress: Progress = noop): Promise<BatchResult> {
  return batch(job.paths, job.output.dir, progress, () => 'pdf', job.sheetOnePage)
}

export function officeConvert(job: OfficeConvertJob, progress: Progress = noop): Promise<BatchResult> {
  return batch(
    job.paths,
    job.output.dir,
    progress,
    (p) => {
      const family = familyOf(p)
      if (!family) throw new UserError(`“${basename(p)}”不是支持的 Office 文档`)
      const target = (job.mode === 'modern' ? MODERN : LEGACY)[family]
      if (extname(p).slice(1).toLowerCase() === target) throw new UserError(`“${basename(p)}”已经是 ${target.toUpperCase()} 格式`)
      return target
    },
    false
  )
}

export { FAMILY_NAME }
