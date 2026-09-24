import { FileText, Lock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { previewPdf, type PdfPreview } from '../lib/pdf'

export function usePdfPreview(path: string | undefined, width = 120): PdfPreview | null {
  const [p, setP] = useState<PdfPreview | null>(null)
  useEffect(() => {
    if (!path) return
    let alive = true
    setP(null)
    previewPdf(path, width).then((r) => alive && setP(r))
    return () => {
      alive = false
    }
  }, [path, width])
  return p
}

export function PdfThumb({ preview, className = 'thumb', iconSize = 18 }: { preview: PdfPreview | null; className?: string; iconSize?: number }) {
  return (
    <div className={className}>
      {preview?.thumb ? (
        <img src={preview.thumb} alt="" draggable={false} />
      ) : preview?.encrypted ? (
        <Lock size={iconSize} />
      ) : (
        <FileText size={iconSize} />
      )}
    </div>
  )
}

/** 本地文件路径转为 file:// 地址，用于显示图片 */
export function fileUrl(path: string): string {
  let p = path.replace(/\\/g, '/')
  if (!p.startsWith('/')) p = '/' + p
  return 'file://' + encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F')
}
