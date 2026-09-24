import { ImageOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ImageThumb } from '../../../shared/types'

const cache = new Map<string, Promise<ImageThumb | null>>()

export function loadThumb(path: string, size = 320): Promise<ImageThumb | null> {
  const key = `${path}@${size}`
  let p = cache.get(key)
  if (!p) {
    p = window.qx.imageThumb(path, size)
    cache.set(key, p)
  }
  return p
}

export function useImageThumb(path: string, size = 320): ImageThumb | null | undefined {
  const [t, setT] = useState<ImageThumb | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    loadThumb(path, size).then((r) => alive && setT(r))
    return () => {
      alive = false
    }
  }, [path, size])
  return t
}

/** 图片缩略图：undefined 加载中，null 无法读取 */
export function ImageThumbView({ thumb, ext }: { thumb: ImageThumb | null | undefined; ext: string }) {
  if (thumb) return <img src={thumb.url} alt="" draggable={false} />
  if (thumb === null)
    return (
      <span className="it-fmt" style={{ display: 'grid', placeItems: 'center', gap: 4, color: 'var(--danger)' }}>
        <ImageOff size={20} />
        无法读取
      </span>
    )
  return <span className="it-fmt">{ext.toUpperCase()}</span>
}
