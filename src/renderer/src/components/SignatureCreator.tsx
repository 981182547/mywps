import { Eraser, ImagePlus, PenLine, Type, Undo2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { uid } from '../lib/format'
import { loadImageEl, removeLightBackground, trimCanvas, type SignatureItem } from '../lib/signatures'
import { Segmented } from '../tools/ToolLayout'
import { ColorPicker, Slider, Toggle } from '../tools/controls'

type Tab = 'draw' | 'text' | 'image'
type Point = { x: number; y: number; t: number }

const INK = ['#111827', '#1d4ed8', '#dc2626']
const TEXT_FONTS = [
  { label: '楷体', css: '"KaiTi", "STKaiti", "Kaiti SC", "楷体", "AR PL UKai CN", serif' },
  { label: '行书', css: '"STXingkai", "华文行楷", "Xingkai SC", "KaiTi", "Kaiti SC", serif' },
  { label: '宋体', css: '"SimSun", "Songti SC", "Noto Serif CJK SC", serif' },
  { label: '黑体', css: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif' }
]

function DrawPad({ color, width, onReady }: { color: string; width: number; onReady: (c: HTMLCanvasElement | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const strokes = useRef<Point[][]>([])
  const current = useRef<Point[] | null>(null)
  const [count, setCount] = useState(0)

  const redraw = () => {
    const c = ref.current!
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.strokeStyle = color
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const scale = c.width / c.clientWidth
    for (const s of [...strokes.current, ...(current.current ? [current.current] : [])]) {
      if (s.length === 1) {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(s[0].x * scale, s[0].y * scale, (width * scale) / 2, 0, Math.PI * 2)
        ctx.fill()
        continue
      }
      // 根据书写速度调整笔画粗细，更像真实签名
      for (let i = 1; i < s.length; i++) {
        const a = s[i - 1]
        const b = s[i]
        const v = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, b.t - a.t)
        ctx.lineWidth = Math.max(width * 0.45, width * (1.2 - Math.min(0.75, v * 0.35))) * scale
        const mx = (a.x + b.x) / 2
        const my = (a.y + b.y) / 2
        ctx.beginPath()
        const prev = i > 1 ? { x: (s[i - 2].x + a.x) / 2, y: (s[i - 2].y + a.y) / 2 } : a
        ctx.moveTo(prev.x * scale, prev.y * scale)
        ctx.quadraticCurveTo(a.x * scale, a.y * scale, mx * scale, my * scale)
        ctx.stroke()
      }
    }
  }

  useEffect(() => {
    redraw()
    onReady(strokes.current.length ? ref.current : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color, width, count])

  const pos = (e: React.PointerEvent): Point => {
    const r = ref.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp }
  }

  return (
    <div className="sig-pad-wrap">
      <canvas
        ref={ref}
        className="sig-pad"
        width={1120}
        height={400}
        data-testid="sig-pad"
        onPointerDown={(e) => {
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          current.current = [pos(e)]
          redraw()
        }}
        onPointerMove={(e) => {
          if (!current.current) return
          current.current.push(pos(e))
          redraw()
        }}
        onPointerUp={() => {
          if (current.current) strokes.current.push(current.current)
          current.current = null
          setCount((n) => n + 1)
        }}
      />
      {count === 0 && <div className="sig-pad-hint">在这里用鼠标或手写笔签名</div>}
      <div className="sig-pad-actions">
        <button
          className="btn ghost sm"
          onClick={() => {
            strokes.current.pop()
            setCount((n) => n + 1)
          }}
          disabled={strokes.current.length === 0}
        >
          <Undo2 size={14} /> 撤销
        </button>
        <button
          className="btn ghost sm"
          onClick={() => {
            strokes.current = []
            setCount(0)
          }}
        >
          <Eraser size={14} /> 清除
        </button>
      </div>
    </div>
  )
}

export function SignatureCreator({ onSave, onClose }: { onSave: (s: SignatureItem) => void; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('draw')
  const [color, setColor] = useState(INK[0])
  const [penWidth, setPenWidth] = useState(5)
  const [drawCanvas, setDrawCanvas] = useState<HTMLCanvasElement | null>(null)
  const [text, setText] = useState('')
  const [font, setFont] = useState(TEXT_FONTS[0].css)
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null)
  const [removeBg, setRemoveBg] = useState(true)
  const [threshold, setThreshold] = useState(200)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState('')

  // 生成最终图片（透明 PNG，已裁剪）
  const build = (): HTMLCanvasElement | null => {
    if (tab === 'draw') return drawCanvas ? trimCanvas(drawCanvas) : null
    if (tab === 'text') {
      if (!text.trim()) return null
      const c = document.createElement('canvas')
      const ctx = c.getContext('2d')!
      const px = 160
      ctx.font = `${px}px ${font}`
      const w = Math.ceil(ctx.measureText(text).width + px)
      c.width = w
      c.height = Math.ceil(px * 1.6)
      ctx.font = `${px}px ${font}`
      ctx.fillStyle = color
      ctx.textBaseline = 'middle'
      ctx.fillText(text, px / 2, c.height / 2)
      return trimCanvas(c)
    }
    if (!imgEl) return null
    if (removeBg) return trimCanvas(removeLightBackground(imgEl, threshold))
    const c = document.createElement('canvas')
    c.width = imgEl.naturalWidth
    c.height = imgEl.naturalHeight
    c.getContext('2d')!.drawImage(imgEl, 0, 0)
    return c
  }

  useEffect(() => {
    if (tab === 'draw') return setPreview(null)
    const c = build()
    setPreview(c ? c.toDataURL('image/png') : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, text, font, color, imgEl, removeBg, threshold])

  const pickImage = async () => {
    setError('')
    const [f] = await window.qx.pickFiles([{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'heic', 'bmp'] }], false)
    if (!f) return
    const t = await window.qx.imageThumb(f.path, 1200)
    if (!t) return setError('无法读取这张图片')
    setImgEl(await loadImageEl(t.url))
  }

  const save = () => {
    const c = build()
    if (!c) return setError(tab === 'draw' ? '请先签名' : tab === 'text' ? '请输入文字' : '请先选择图片')
    // 过大的图片缩小，减少存储与文件体积
    let out = c
    const max = 1200
    if (c.width > max || c.height > max) {
      const s = max / Math.max(c.width, c.height)
      out = document.createElement('canvas')
      out.width = Math.round(c.width * s)
      out.height = Math.round(c.height * s)
      out.getContext('2d')!.drawImage(c, 0, 0, out.width, out.height)
    }
    onSave({
      id: uid('sig'),
      name: tab === 'text' ? text : tab === 'draw' ? '手写签名' : '印章',
      dataUrl: out.toDataURL('image/png'),
      width: out.width,
      height: out.height,
      kind: tab
    })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="新建签名或印章">
        <div className="modal-head">
          <h3>新建签名 / 印章</h3>
          <button className="btn ghost icon sm" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <Segmented<Tab>
          value={tab}
          onChange={(t) => {
            setTab(t)
            setError('')
          }}
          options={[
            { value: 'draw', label: '手写签名' },
            { value: 'text', label: '输入文字' },
            { value: 'image', label: '导入图片' }
          ]}
        />
        <div className="modal-body">
          {tab === 'draw' && (
            <>
              <DrawPad color={color} width={penWidth} onReady={setDrawCanvas} />
              <div className="sig-options">
                <div className="swatches">
                  {INK.map((c) => (
                    <button key={c} className={`swatch${color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
                  ))}
                </div>
                <div style={{ flex: 1, maxWidth: 240 }}>
                  <Slider value={penWidth} min={2} max={12} onChange={setPenWidth} label="笔画粗细" format={(v) => `${v}`} />
                </div>
                <PenLine size={16} style={{ color: 'var(--text-3)' }} />
              </div>
            </>
          )}
          {tab === 'text' && (
            <>
              <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="输入姓名，例如：张三" aria-label="签名文字" autoFocus />
              <div className="sig-options">
                <div className="quick-chips">
                  {TEXT_FONTS.map((f) => (
                    <button key={f.label} className={font === f.css ? 'on' : ''} onClick={() => setFont(f.css)} style={{ fontFamily: f.css }}>
                      {f.label}
                    </button>
                  ))}
                </div>
                <ColorPicker value={color} onChange={setColor} />
              </div>
              <div className="sig-preview">{preview ? <img src={preview} alt="预览" /> : <span><Type size={18} /> 输入文字后预览</span>}</div>
            </>
          )}
          {tab === 'image' && (
            <>
              <div className="sig-preview checker" onClick={pickImage} role="button" style={{ cursor: 'pointer' }}>
                {preview ? <img src={preview} alt="预览" /> : <span><ImagePlus size={18} /> 选择签名或印章的照片、扫描件</span>}
              </div>
              <div className="sig-options">
                <button className="btn sm" onClick={pickImage}>
                  <ImagePlus size={14} /> {imgEl ? '更换图片' : '选择图片'}
                </button>
                <Toggle checked={removeBg} onChange={setRemoveBg} label="去除白色背景" />
              </div>
              {removeBg && imgEl && (
                <div className="sig-options">
                  <span style={{ fontSize: 12.5, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>去除程度</span>
                  <div style={{ flex: 1 }}>
                    <Slider value={threshold} min={120} max={250} onChange={setThreshold} label="去除程度" format={(v) => `${Math.round(((v - 120) / 130) * 100)}%`} />
                  </div>
                </div>
              )}
            </>
          )}
          {error && <div className="alert error">{error}</div>}
          <div className="tip">
            <span>签名只保存在这台电脑上，不会上传。</span>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={save} data-action="save-signature">
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
