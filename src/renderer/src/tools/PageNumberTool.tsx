import { AlertTriangle, Lock, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { FONT_STACK, formatPageNumber, numberPosition, textBox } from '../../../shared/layout'
import { parseRanges } from '../../../shared/ranges'
import type { FileInfo, NumberFormat, NumberPosition } from '../../../shared/types'
import { PagePreview, type PreviewDrawArgs } from '../components/PagePreview'
import { dirOf, stemOf } from '../lib/format'
import { useJob, useOutputDir } from '../lib/hooks'
import { useSinglePdf } from '../lib/single'
import { Field, OutputField, ResultView, RunFooter, ToolLayout } from './ToolLayout'
import { EmptyDrop, IgnoredNotice } from './common'
import { ColorPicker, Slider } from './controls'
import type { ToolDef } from './registry'

const MM_TO_PT = 72 / 25.4
const FORMATS: { value: NumberFormat; label: string }[] = [
  { value: 'n', label: '1' },
  { value: 'n-total', label: '1 / 10' },
  { value: 'dash', label: '- 1 -' },
  { value: 'cn', label: '第 1 页' },
  { value: 'cn-total', label: '第 1 页 共 10 页' },
  { value: 'page-of', label: 'Page 1 of 10' }
]
const POSITIONS: NumberPosition[] = ['tl', 'tc', 'tr', 'bl', 'bc', 'br']
const POS_LABEL: Record<NumberPosition, string> = { tl: '左上', tc: '顶部居中', tr: '右上', bl: '左下', bc: '底部居中', br: '右下' }

export function PageNumberTool({ tool, initialFiles, onBack }: { tool: ToolDef; initialFiles?: FileInfo[]; onBack: () => void }) {
  const job = useJob()
  const out = useOutputDir()
  const pdf = useSinglePdf(initialFiles, () => job.reset())
  const [position, setPosition] = useState<NumberPosition>('bc')
  const [format, setFormat] = useState<NumberFormat>('n-total')
  const [start, setStart] = useState('1')
  const [fontSize, setFontSize] = useState(11)
  const [color, setColor] = useState('#111827')
  const [margin, setMargin] = useState(12)
  const [ranges, setRanges] = useState('')
  const [fileName, setFileName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const running = job.state.status === 'running'

  const pageCount = pdf.handle?.pageCount ?? 0
  const startNum = Number(start)
  const startValid = Number.isInteger(startNum) && startNum >= 0 && startNum < 100000
  const rangeState = useMemo(() => {
    if (!pageCount) return { list: null as number[] | null, error: '' }
    try {
      return { list: parseRanges(ranges, pageCount), error: '' }
    } catch (e) {
      return { list: null, error: (e as Error).message }
    }
  }, [ranges, pageCount])

  const draw = ({ ctx, scale, pageW, pageH, pageIndex }: PreviewDrawArgs) => {
    const list = rangeState.list
    if (!list || !startValid) return
    const pos = list.indexOf(pageIndex)
    if (pos === -1) return
    const text = formatPageNumber(format, startNum + pos, startNum - 1 + list.length)
    const px = fontSize * scale
    ctx.font = `${px}px ${FONT_STACK}`
    const b = textBox([ctx.measureText(text).width], px)
    const [x, y] = numberPosition(position, pageW, pageH, b.width / scale, b.height / scale, margin * MM_TO_PT)
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const cx = (x + b.width / scale / 2) * scale
    const cy = (pageH - y - b.height / scale / 2) * scale
    ctx.fillText(text, cx, cy - b.height / 2 + b.lineH / 2 + px * 0.05)
  }

  const file = pdf.file
  const defaultName = file ? `${stemOf(file.name)}_页码` : ''
  const effectiveName = nameTouched ? fileName : defaultName

  let reason: string | undefined
  if (!file) reason = '请先添加一个 PDF 文件'
  else if (pdf.error) reason = pdf.error.message
  else if (!pdf.handle) reason = '正在读取文件…'
  else if (!startValid) reason = '起始页码必须是 0 或正整数'
  else if (rangeState.error) reason = rangeState.error
  else if (!effectiveName.trim()) reason = '请填写文件名'

  const run = () => {
    if (!file) return
    job.run({
      type: 'pdf-page-numbers',
      path: file.path,
      position,
      format,
      start: startNum,
      fontSize,
      color,
      marginMm: margin,
      ranges: ranges.trim() || undefined,
      output: { dir: out.custom ?? dirOf(file.path) },
      fileName: effectiveName
    })
  }

  const filesPanel = (
    <section className={`panel files-panel${pdf.dragging ? ' dragging' : ''}`} {...pdf.bind}>
      {!file ? (
        <EmptyDrop tool={tool} dragging={pdf.dragging} onPick={pdf.pick} title="添加要加页码的 PDF 文件" formats={['PDF']} hint="右侧调整样式，左侧实时预览效果" />
      ) : (
        <>
          <div className="files-toolbar">
            <div className="summary" title={file.path}>
              {file.name}
              <span>{pdf.handle ? `${pdf.handle.pageCount} 页` : ''}</span>
            </div>
            <div className="grow" />
            <button className="btn ghost sm" onClick={pdf.pick} disabled={running}>
              <RefreshCw size={14} /> 更换文件
            </button>
          </div>
          <IgnoredNotice count={pdf.ignored} onClose={pdf.clearIgnored} what="1 个 PDF 文件" />
          {pdf.error && (
            <div className="alert error" style={{ margin: 14 }}>
              {pdf.error.encrypted ? <Lock size={15} /> : <AlertTriangle size={15} />} {pdf.error.message}
            </div>
          )}
          {pdf.handle && <PagePreview handle={pdf.handle} draw={draw} deps={[position, format, start, fontSize, color, margin, rangeState]} />}
        </>
      )}
    </section>
  )

  const side =
    job.state.status === 'done' ? (
      <ResultView outputs={job.state.outputs} notes={job.state.notes} failures={job.state.failures} preview={job.state.preview} onReset={() => { job.reset(); pdf.clear(); setNameTouched(false) }} />
    ) : (
      <>
        <Field label="位置">
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <div className="pos-picker" role="radiogroup" aria-label="页码位置">
              {POSITIONS.slice(0, 3).map((p) => (
                <button key={p} className={position === p ? 'on' : ''} onClick={() => setPosition(p)} title={POS_LABEL[p]} aria-label={POS_LABEL[p]} role="radio" aria-checked={position === p}>
                  <span />
                </button>
              ))}
              <div className="mid" />
              {POSITIONS.slice(3).map((p) => (
                <button key={p} className={position === p ? 'on' : ''} onClick={() => setPosition(p)} title={POS_LABEL[p]} aria-label={POS_LABEL[p]} role="radio" aria-checked={position === p}>
                  <span />
                </button>
              ))}
            </div>
            <div style={{ color: 'var(--text-2)', fontSize: 13 }}>{POS_LABEL[position]}</div>
          </div>
        </Field>
        <Field label="格式">
          <select className="input" value={format} onChange={(e) => setFormat(e.target.value as NumberFormat)} aria-label="页码格式" disabled={running}>
            {FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="起始页码">
          <input className={`input${startValid ? '' : ' invalid'}`} type="number" min={0} value={start} onChange={(e) => setStart(e.target.value)} aria-label="起始页码" disabled={running} />
        </Field>
        <Field label="字号">
          <Slider value={fontSize} min={6} max={36} onChange={setFontSize} format={(v) => `${v} 磅`} label="字号" disabled={running} />
        </Field>
        <Field label="颜色">
          <ColorPicker value={color} onChange={setColor} disabled={running} />
        </Field>
        <Field label="距页面边缘">
          <Slider value={margin} min={3} max={40} onChange={setMargin} format={(v) => `${v} 毫米`} label="距页面边缘" disabled={running} />
        </Field>
        <Field label="加页码的页面" hint={rangeState.error ? <span style={{ color: 'var(--danger)' }}>{rangeState.error}</span> : '留空表示全部页面；跳过的页面不占用编号'}>
          <input className={`input${rangeState.error ? ' invalid' : ''}`} value={ranges} onChange={(e) => setRanges(e.target.value)} placeholder="全部页面" aria-label="加页码的页面" disabled={running} />
          <div className="quick-chips">
            <button className={ranges === '' ? 'on' : ''} onClick={() => setRanges('')}>
              全部页面
            </button>
            <button className={ranges === '2-' ? 'on' : ''} onClick={() => setRanges('2-')}>
              跳过封面
            </button>
            <button className={ranges === '3-' ? 'on' : ''} onClick={() => setRanges('3-')}>
              跳过前 2 页
            </button>
          </div>
        </Field>
        <Field label="文件名">
          <div className="input-suffix">
            <input
              className="input"
              value={effectiveName}
              onChange={(e) => {
                setNameTouched(true)
                setFileName(e.target.value)
              }}
              aria-label="输出文件名"
              disabled={running || !file}
            />
            <span>.pdf</span>
          </div>
        </Field>
        <OutputField sourcePath={file?.path} custom={out.custom} onChoose={out.choose} onClear={out.clear} />
      </>
    )

  return (
    <ToolLayout
      tool={tool}
      onBack={onBack}
      files={filesPanel}
      side={side}
      footer={job.state.status === 'done' ? null : <RunFooter state={job.state} onCancel={job.cancel} label="添加页码" disabled={!!reason || running} disabledReason={reason} onRun={run} />}
    />
  )
}
