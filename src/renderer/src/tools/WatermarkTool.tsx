import { AlertTriangle, ImagePlus, Lock, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { FONT_STACK, textBox, watermarkPlacements } from '../../../shared/layout'
import { parseRanges } from '../../../shared/ranges'
import type { FileInfo, WatermarkLayout } from '../../../shared/types'
import { PagePreview, type PreviewDrawArgs } from '../components/PagePreview'
import { fileUrl } from '../components/Thumbs'
import { baseName, dirOf, stemOf } from '../lib/format'
import { useJob, useOutputDir } from '../lib/hooks'
import { useSinglePdf } from '../lib/single'
import { Field, OutputField, ResultView, RunFooter, Segmented, ToolLayout } from './ToolLayout'
import { EmptyDrop, IgnoredNotice } from './common'
import { ColorPicker, Slider, Toggle } from './controls'
import type { ToolDef } from './registry'

type Mode = 'text' | 'image'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

export function WatermarkTool({ tool, initialFiles, onBack }: { tool: ToolDef; initialFiles?: FileInfo[]; onBack: () => void }) {
  const job = useJob()
  const out = useOutputDir()
  const pdf = useSinglePdf(initialFiles, () => job.reset())
  const [mode, setMode] = useState<Mode>('text')
  const [text, setText] = useState('内部资料 请勿外传')
  const [fontSize, setFontSize] = useState(40)
  const [color, setColor] = useState('#9ca3af')
  const [bold, setBold] = useState(true)
  const [opacity, setOpacity] = useState(30)
  const [angle, setAngle] = useState(45)
  const [layout, setLayout] = useState<WatermarkLayout>('center')
  const [imagePath, setImagePath] = useState<string | null>(null)
  const [imageEl, setImageEl] = useState<HTMLImageElement | null>(null)
  const [imageScale, setImageScale] = useState(40)
  const [ranges, setRanges] = useState('')
  const [fileName, setFileName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const running = job.state.status === 'running'

  useEffect(() => {
    if (!imagePath) return setImageEl(null)
    let alive = true
    loadImage(fileUrl(imagePath))
      .catch(async () => loadImage(URL.createObjectURL(new Blob([(await window.qx.readFile(imagePath)) as BlobPart]))))
      .then((img) => alive && setImageEl(img))
      .catch(() => alive && setImageEl(null))
    return () => {
      alive = false
    }
  }, [imagePath])

  const pickImage = async () => {
    const [f] = await window.qx.pickFiles([{ name: '图片', extensions: ['png', 'jpg', 'jpeg'] }], false)
    if (f) setImagePath(f.path)
  }

  const pageCount = pdf.handle?.pageCount ?? 0
  const rangeState = useMemo(() => {
    if (!pageCount) return { set: null as Set<number> | null, error: '' }
    try {
      return { set: new Set(parseRanges(ranges, pageCount)), error: '' }
    } catch (e) {
      return { set: null, error: (e as Error).message }
    }
  }, [ranges, pageCount])

  const draw = ({ ctx, scale, pageW, pageH, pageIndex }: PreviewDrawArgs) => {
    if (rangeState.set && !rangeState.set.has(pageIndex)) return
    ctx.globalAlpha = opacity / 100
    const rad = (-angle * Math.PI) / 180
    if (mode === 'text') {
      if (!text.trim()) return
      const px = fontSize * scale
      ctx.font = `${bold ? 'bold ' : ''}${px}px ${FONT_STACK}`
      const lines = text.split(/\r?\n/)
      const b = textBox(lines.map((l) => ctx.measureText(l).width), px)
      ctx.fillStyle = color
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const p of watermarkPlacements(pageW, pageH, b.width / scale, b.height / scale, angle, layout)) {
        ctx.save()
        ctx.translate(p.cx * scale, (pageH - p.cy) * scale)
        ctx.rotate(rad)
        lines.forEach((l, i) => ctx.fillText(l, 0, -b.height / 2 + b.lineH * (i + 0.5) + px * 0.05))
        ctx.restore()
      }
    } else if (imageEl) {
      const w = pageW * (imageScale / 100)
      const h = (imageEl.naturalHeight / imageEl.naturalWidth) * w
      for (const p of watermarkPlacements(pageW, pageH, w, h, angle, layout)) {
        ctx.save()
        ctx.translate(p.cx * scale, (pageH - p.cy) * scale)
        ctx.rotate(rad)
        ctx.drawImage(imageEl, (-w / 2) * scale, (-h / 2) * scale, w * scale, h * scale)
        ctx.restore()
      }
    }
  }

  const file = pdf.file
  const defaultName = file ? `${stemOf(file.name)}_水印` : ''
  const effectiveName = nameTouched ? fileName : defaultName

  let reason: string | undefined
  if (!file) reason = '请先添加一个 PDF 文件'
  else if (pdf.error) reason = pdf.error.message
  else if (!pdf.handle) reason = '正在读取文件…'
  else if (mode === 'text' && !text.trim()) reason = '请填写水印文字'
  else if (mode === 'image' && !imagePath) reason = '请选择水印图片'
  else if (rangeState.error) reason = rangeState.error
  else if (!effectiveName.trim()) reason = '请填写文件名'

  const run = () => {
    if (!file) return
    job.run({
      type: 'pdf-watermark',
      path: file.path,
      mode,
      text,
      fontSize,
      color,
      bold,
      opacity: opacity / 100,
      angle,
      layout,
      imagePath: imagePath ?? undefined,
      imageScale: imageScale / 100,
      ranges: ranges.trim() || undefined,
      output: { dir: out.custom ?? dirOf(file.path) },
      fileName: effectiveName
    })
  }

  const filesPanel = (
    <section className={`panel files-panel${pdf.dragging ? ' dragging' : ''}`} {...pdf.bind}>
      {!file ? (
        <EmptyDrop tool={tool} dragging={pdf.dragging} onPick={pdf.pick} title="添加要加水印的 PDF 文件" formats={['PDF']} hint="右侧调整样式，左侧实时预览效果" />
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
          {pdf.handle && (
            <PagePreview
              handle={pdf.handle}
              draw={draw}
              deps={[mode, text, fontSize, color, bold, opacity, angle, layout, imageEl, imageScale, rangeState]}
            />
          )}
        </>
      )}
    </section>
  )

  const side =
    job.state.status === 'done' ? (
      <ResultView outputs={job.state.outputs} notes={job.state.notes} failures={job.state.failures} preview={job.state.preview} onReset={() => { job.reset(); pdf.clear(); setNameTouched(false) }} />
    ) : (
      <>
        <Segmented<Mode>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'text', label: '文字水印' },
            { value: 'image', label: '图片水印' }
          ]}
        />
        {mode === 'text' ? (
          <>
            <Field label="水印文字">
              <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} rows={2} aria-label="水印文字" disabled={running} />
            </Field>
            <Field label="字号">
              <Slider value={fontSize} min={10} max={120} onChange={setFontSize} format={(v) => `${v} 磅`} label="字号" disabled={running} />
            </Field>
            <Field label="颜色">
              <ColorPicker value={color} onChange={setColor} disabled={running} />
            </Field>
            <Toggle checked={bold} onChange={setBold} label="加粗" disabled={running} />
          </>
        ) : (
          <>
            <Field label="水印图片" hint="建议使用透明背景的 PNG 图片">
              <button className="btn" onClick={pickImage} disabled={running} style={{ justifyContent: 'flex-start' }}>
                <ImagePlus size={15} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{imagePath ? baseName(imagePath) : '选择图片'}</span>
              </button>
            </Field>
            <Field label="图片大小（占页面宽度）">
              <Slider value={imageScale} min={5} max={100} onChange={setImageScale} format={(v) => `${v}%`} label="图片大小" disabled={running} />
            </Field>
          </>
        )}
        <Field label="透明度">
          <Slider value={opacity} min={5} max={100} onChange={setOpacity} format={(v) => `${v}%`} label="透明度" disabled={running} />
        </Field>
        <Field label="旋转角度">
          <Slider value={angle} min={-90} max={90} step={5} onChange={setAngle} format={(v) => `${v}°`} label="旋转角度" disabled={running} />
          <div className="quick-chips">
            {[0, 30, 45, -45, 90].map((a) => (
              <button key={a} className={angle === a ? 'on' : ''} onClick={() => setAngle(a)} disabled={running}>
                {a}°
              </button>
            ))}
          </div>
        </Field>
        <Field label="排列方式">
          <Segmented<WatermarkLayout>
            value={layout}
            onChange={setLayout}
            options={[
              { value: 'center', label: '居中单个' },
              { value: 'tile', label: '平铺满页' }
            ]}
          />
        </Field>
        <Field label="应用到页面" hint={rangeState.error ? <span style={{ color: 'var(--danger)' }}>{rangeState.error}</span> : '留空表示全部页面，例如 1-3,5'}>
          <input className={`input${rangeState.error ? ' invalid' : ''}`} value={ranges} onChange={(e) => setRanges(e.target.value)} placeholder="全部页面" aria-label="应用到页面" disabled={running} />
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
      footer={job.state.status === 'done' ? null : <RunFooter state={job.state} onCancel={job.cancel} label="添加水印" disabled={!!reason || running} disabledReason={reason} onRun={run} />}
    />
  )
}
