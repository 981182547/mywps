import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { PdfHandle } from '../lib/pdf'

export interface PreviewDrawArgs {
  ctx: CanvasRenderingContext2D
  /** 每磅对应的显示像素 */
  scale: number
  pageW: number
  pageH: number
  pageIndex: number
}

/** 大尺寸页面预览，并在上方叠加一层画布，用于实时展示水印、页码等效果 */
export function PagePreview({ handle, draw, deps }: { handle: PdfHandle; draw: (a: PreviewDrawArgs) => void | Promise<void>; deps: unknown[] }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [index, setIndex] = useState(0)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [box, setBox] = useState({ w: 600, h: 600 })
  const [img, setImg] = useState<string | null>(null)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    let alive = true
    handle.pageSize(index).then((s) => alive && setSize({ w: s.width, h: s.height }))
    return () => {
      alive = false
    }
  }, [handle, index])

  const pad = 40
  const scale = size ? Math.max(0.1, Math.min((box.w - pad) / size.w, (box.h - pad) / size.h)) : 1
  const dispW = size ? Math.round(size.w * scale) : 0
  const dispH = size ? Math.round(size.h * scale) : 0
  // 渲染宽度取整到 100，避免窗口缩放时频繁重绘
  const renderW = Math.max(200, Math.ceil(dispW / 100) * 100)

  useEffect(() => {
    let alive = true
    setImg(null)
    handle.render(index, renderW).then((s) => alive && setImg(s)).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [handle, index, renderW])

  useEffect(() => {
    const c = canvasRef.current
    if (!c || !size) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(dispW * dpr)
    c.height = Math.round(dispH * dpr)
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, dispW, dispH)
    void draw({ ctx, scale, pageW: size.w, pageH: size.h, pageIndex: index })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, dispW, dispH, index, ...deps])

  return (
    <div className="page-preview">
      <div className="pp-stage" ref={boxRef}>
        {size && (
          <div className="pp-page" style={{ width: dispW, height: dispH }}>
            {img && <img src={img} alt="" draggable={false} />}
            <canvas ref={canvasRef} style={{ width: dispW, height: dispH }} data-testid="preview-overlay" />
          </div>
        )}
      </div>
      <div className="pp-nav">
        <button className="btn ghost icon sm" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0} aria-label="上一页">
          <ChevronLeft size={16} />
        </button>
        <span>
          第 {index + 1} / {handle.pageCount} 页
        </span>
        <button className="btn ghost icon sm" onClick={() => setIndex((i) => Math.min(handle.pageCount - 1, i + 1))} disabled={index >= handle.pageCount - 1} aria-label="下一页">
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}
