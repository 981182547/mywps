import { useState } from 'react'
import { parseRanges } from '../../../shared/ranges'
import type { FileInfo } from '../../../shared/types'
import { DocBatchTool, OFFICE_EXTS } from './DocBatchTool'
import { SinglePdfTool, type SingleCtx } from './SinglePdfTool'
import { Field, Segmented } from './ToolLayout'
import { Toggle } from './controls'
import type { ToolDef } from './registry'

interface Props {
  tool: ToolDef
  initialFiles?: FileInfo[]
  onBack: () => void
}

export function WordToPdfTool(p: Props) {
  return (
    <DocBatchTool
      {...p}
      accepts={OFFICE_EXTS.word}
      formats={['DOC', 'DOCX', 'WPS', 'RTF', 'ODT', 'TXT']}
      runLabel="转换为 PDF"
      hint="支持批量转换，版式与原文件保持一致"
      buildJob={(paths, dir) => ({ type: 'office-to-pdf', paths, sheetOnePage: false, output: { dir } })}
    />
  )
}

export function ExcelToPdfTool(p: Props) {
  const [onePage, setOnePage] = useState(false)
  return (
    <DocBatchTool
      {...p}
      accepts={OFFICE_EXTS.excel}
      formats={['XLS', 'XLSX', 'ET', 'CSV', 'ODS']}
      runLabel="转换为 PDF"
      hint="支持批量转换，所有工作表都会导出"
      options={(running) => (
        <Field label="页面设置" hint={onePage ? '每个工作表缩放到一页，适合较宽的表格' : '按表格原有的分页设置导出'}>
          <Toggle checked={onePage} onChange={setOnePage} label="每个工作表导出为一页" disabled={running} />
        </Field>
      )}
      buildJob={(paths, dir) => ({ type: 'office-to-pdf', paths, sheetOnePage: onePage, output: { dir } })}
    />
  )
}

export function PptToPdfTool(p: Props) {
  return (
    <DocBatchTool
      {...p}
      accepts={OFFICE_EXTS.ppt}
      formats={['PPT', 'PPTX', 'DPS', 'ODP']}
      runLabel="转换为 PDF"
      hint="每张幻灯片生成一页 PDF，支持批量转换"
      buildJob={(paths, dir) => ({ type: 'office-to-pdf', paths, sheetOnePage: false, output: { dir } })}
    />
  )
}

export function OfficeConvertTool(p: Props) {
  const [mode, setMode] = useState<'modern' | 'legacy'>('modern')
  return (
    <DocBatchTool
      {...p}
      accepts={OFFICE_EXTS.all}
      formats={['DOC', 'DOCX', 'WPS', 'XLS', 'XLSX', 'ET', 'PPT', 'PPTX', 'DPS']}
      runLabel="开始转换"
      hint="新旧版 Office 格式互转，WPS 格式转为通用的 Office 格式"
      options={() => (
        <Field label="转换为" hint={mode === 'modern' ? 'doc→docx、xls→xlsx、ppt→pptx，WPS 格式同样转为新版格式' : 'docx→doc、xlsx→xls、pptx→ppt，兼容老版本 Office'}>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'modern', label: '新版格式' },
              { value: 'legacy', label: '旧版格式' }
            ]}
          />
        </Field>
      )}
      buildJob={(paths, dir) => ({ type: 'office-convert', paths, mode, output: { dir } })}
    />
  )
}

function rangeError(ranges: string, c: SingleCtx): string | undefined {
  if (!c.handle || !ranges.trim()) return undefined
  try {
    parseRanges(ranges, c.handle.pageCount)
    return undefined
  } catch (e) {
    return (e as Error).message
  }
}

function Ranges({ value, onChange, c }: { value: string; onChange: (v: string) => void; c: SingleCtx }) {
  const err = rangeError(value, c)
  return (
    <Field label="页面范围" hint={err ? <span style={{ color: 'var(--danger)' }}>{err}</span> : '留空表示全部页面，例如 1-3,5'}>
      <input className={`input${err ? ' invalid' : ''}`} value={value} onChange={(e) => onChange(e.target.value)} placeholder="全部页面" aria-label="页面范围" disabled={c.running} />
    </Field>
  )
}

export function PdfToWordTool(p: Props) {
  const [ranges, setRanges] = useState('')
  return (
    <SinglePdfTool
      {...p}
      runLabel="转换为 Word"
      hint="转换为可编辑的 Word 文档，保留标题、段落、字号与图片"
      validate={(c) => rangeError(ranges, c)}
      info={() => (
        <div className="tip">
          <span>适合以文字为主的电子版 PDF。多栏排版、复杂表格可能需要稍作调整；扫描件请先使用“文字识别”。</span>
        </div>
      )}
      options={(c) => <Ranges value={ranges} onChange={setRanges} c={c} />}
      buildJob={(f, dir) => ({ type: 'pdf-to-word', path: f.path, ranges: ranges.trim() || undefined, output: { dir } })}
    />
  )
}

export function PdfToExcelTool(p: Props) {
  const [ranges, setRanges] = useState('')
  const [layout, setLayout] = useState<'per-page' | 'single'>('per-page')
  return (
    <SinglePdfTool
      {...p}
      runLabel="转换为 Excel"
      hint="识别 PDF 中的表格，转换为可编辑的 Excel"
      validate={(c) => rangeError(ranges, c)}
      info={() => (
        <div className="tip">
          <span>根据文字位置自动识别行和列，数字会转为数值格式，编号的前导零会保留。</span>
        </div>
      )}
      options={(c) => (
        <>
          <Field label="工作表">
            <Segmented
              value={layout}
              onChange={setLayout}
              options={[
                { value: 'per-page', label: '每页一个' },
                { value: 'single', label: '合并为一个' }
              ]}
            />
          </Field>
          <Ranges value={ranges} onChange={setRanges} c={c} />
        </>
      )}
      buildJob={(f, dir) => ({ type: 'pdf-to-excel', path: f.path, layout, ranges: ranges.trim() || undefined, output: { dir } })}
    />
  )
}
