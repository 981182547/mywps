import { useEffect, useState } from 'react'
import { parseRanges } from '../../../shared/ranges'
import type { FileInfo } from '../../../shared/types'
import type { PdfHandle } from '../lib/pdf'
import { SinglePdfTool, type SingleCtx } from './SinglePdfTool'
import { Field, Segmented } from './ToolLayout'
import { Slider, Toggle } from './controls'
import type { ToolDef } from './registry'

interface Props {
  tool: ToolDef
  initialFiles?: FileInfo[]
  onBack: () => void
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

function RangeField({ value, onChange, c }: { value: string; onChange: (v: string) => void; c: SingleCtx }) {
  const err = rangeError(value, c)
  return (
    <Field label="页面范围" hint={err ? <span style={{ color: 'var(--danger)' }}>{err}</span> : '留空表示全部页面，例如 1-3,5'}>
      <input className={`input${err ? ' invalid' : ''}`} value={value} onChange={(e) => onChange(e.target.value)} placeholder="全部页面" aria-label="页面范围" disabled={c.running} />
    </Field>
  )
}

function OutputSizeInfo({ handle, dpi, long }: { handle: PdfHandle | null; dpi: number; long: boolean }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    let alive = true
    handle?.pageSize(0).then((s) => alive && setSize({ w: s.width, h: s.height }))
    return () => {
      alive = false
    }
  }, [handle])
  if (!size) return null
  return (
    <div className="tip">
      <span>
        第 1 页输出尺寸约{' '}
        <b>
          {Math.round((size.w * dpi) / 72)} × {Math.round((size.h * dpi) / 72)}
        </b>{' '}
        像素{long ? '；长图过长时会自动分成多张，保证能正常打开' : ''}
      </span>
    </div>
  )
}

const DPI_OPTIONS = [
  { value: '96', label: '标准' },
  { value: '150', label: '高清' },
  { value: '220', label: '超清' },
  { value: '300', label: '印刷' }
] as const
type DpiValue = (typeof DPI_OPTIONS)[number]['value']

export function PdfToImagesTool({ tool, initialFiles, onBack, initialMode }: Props & { initialMode: 'pages' | 'long' }) {
  const [mode, setMode] = useState<'pages' | 'long'>(initialMode)
  const [format, setFormat] = useState<'jpg' | 'png'>('jpg')
  const [dpi, setDpi] = useState<DpiValue>('150')
  const [quality, setQuality] = useState(90)
  const [gap, setGap] = useState(false)
  const [ranges, setRanges] = useState('')

  return (
    <SinglePdfTool
      tool={tool}
      initialFiles={initialFiles}
      onBack={onBack}
      runLabel={mode === 'long' ? '生成长图' : '开始转换'}
      hint={mode === 'long' ? '所有页面按顺序拼接成一张长图，适合发手机查看' : '每一页导出为一张图片'}
      validate={(c) => rangeError(ranges, c)}
      info={(c) => <OutputSizeInfo handle={c.handle} dpi={Number(dpi)} long={mode === 'long'} />}
      options={(c) => (
        <>
          <Field label="输出方式">
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: 'pages', label: '每页一张' },
                { value: 'long', label: '拼成长图' }
              ]}
            />
          </Field>
          <Field label="图片格式" hint={format === 'png' ? 'PNG 无损，文件较大' : 'JPG 体积小，适合分享'}>
            <Segmented
              value={format}
              onChange={setFormat}
              options={[
                { value: 'jpg', label: 'JPG' },
                { value: 'png', label: 'PNG' }
              ]}
            />
          </Field>
          <Field label="清晰度" hint={`${dpi} DPI`}>
            <Segmented<DpiValue> value={dpi} onChange={setDpi} options={DPI_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
          </Field>
          {format === 'jpg' && (
            <Field label="图片质量">
              <Slider value={quality} min={40} max={100} onChange={setQuality} format={(v) => `${v}%`} label="图片质量" disabled={c.running} />
            </Field>
          )}
          {mode === 'long' && <Toggle checked={gap} onChange={setGap} label="页面之间留出间隔" disabled={c.running} />}
          <RangeField value={ranges} onChange={setRanges} c={c} />
        </>
      )}
      buildJob={(file, dir) => ({
        type: 'pdf-to-images',
        path: file.path,
        mode,
        format,
        dpi: Number(dpi),
        quality,
        gap,
        ranges: ranges.trim() || undefined,
        output: { dir }
      })}
    />
  )
}

export function PdfToTextTool({ tool, initialFiles, onBack }: Props) {
  const [markers, setMarkers] = useState(true)
  const [ranges, setRanges] = useState('')
  return (
    <SinglePdfTool
      tool={tool}
      initialFiles={initialFiles}
      onBack={onBack}
      runLabel="提取文字"
      hint="提取 PDF 中的文字，保存为 TXT 文本文件"
      validate={(c) => rangeError(ranges, c)}
      info={() => (
        <div className="tip">
          <span>适用于电子版 PDF。扫描件或图片型 PDF 请使用“文字识别”。</span>
        </div>
      )}
      options={(c) => (
        <>
          <Toggle checked={markers} onChange={setMarkers} label="标注每页页码" disabled={c.running} />
          <RangeField value={ranges} onChange={setRanges} c={c} />
        </>
      )}
      buildJob={(file, dir) => ({ type: 'pdf-to-txt', path: file.path, pageMarkers: markers, ranges: ranges.trim() || undefined, output: { dir } })}
    />
  )
}

export function PdfToPptTool({ tool, initialFiles, onBack }: Props) {
  const [dpi, setDpi] = useState<DpiValue>('150')
  const [ranges, setRanges] = useState('')
  return (
    <SinglePdfTool
      tool={tool}
      initialFiles={initialFiles}
      onBack={onBack}
      runLabel="转换为 PPT"
      hint="每一页生成一张幻灯片，保留原有版面"
      validate={(c) => rangeError(ranges, c)}
      info={() => (
        <div className="tip">
          <span>每页以高清图片形式放入幻灯片，版面与原文件完全一致；幻灯片中的文字不可直接编辑。</span>
        </div>
      )}
      options={(c) => (
        <>
          <Field label="清晰度" hint={`${dpi} DPI`}>
            <Segmented<DpiValue> value={dpi} onChange={setDpi} options={DPI_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
          </Field>
          <RangeField value={ranges} onChange={setRanges} c={c} />
        </>
      )}
      buildJob={(file, dir) => ({ type: 'pdf-to-ppt', path: file.path, dpi: Number(dpi), ranges: ranges.trim() || undefined, output: { dir } })}
    />
  )
}
