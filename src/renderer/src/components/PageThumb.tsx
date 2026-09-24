import { FileText } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { PdfHandle } from '../lib/pdf'

/** 懒加载页面缩略图：滚动到可见区域时才渲染 */
export function PageThumb({ handle, index, width, rotate = 0 }: { handle: PdfHandle; index: number; width: number; rotate?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let alive = true
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect()
          handle
            .render(index, width)
            .then((s) => alive && setSrc(s))
            .catch(() => undefined)
        }
      },
      { rootMargin: '300px' }
    )
    io.observe(el)
    return () => {
      alive = false
      io.disconnect()
    }
  }, [handle, index, width])
  return (
    <div className="page-thumb" ref={ref}>
      {src ? (
        <img src={src} alt={`第 ${index + 1} 页`} draggable={false} style={{ transform: `rotate(${rotate}deg)` }} />
      ) : (
        <FileText size={20} />
      )}
    </div>
  )
}
