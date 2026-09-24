import { useEffect, useState } from 'react'
import type { FileInfo } from '../../../shared/types'
import { useFileDrop } from './hooks'
import { openPdf, type PdfHandle } from './pdf'

/** 单个 PDF 文件的选择、拖放与打开 */
export function useSinglePdf(initialFiles?: FileInfo[], onChange?: () => void) {
  const [file, setFile] = useState<FileInfo | null>(null)
  const [ignored, setIgnored] = useState(0)
  const [handle, setHandle] = useState<PdfHandle | null>(null)
  const [error, setError] = useState<{ encrypted: boolean; message: string } | null>(null)

  const accept = (files: FileInfo[]) => {
    const pdfs = files.filter((f) => f.ext === 'pdf')
    setIgnored(files.length - Math.min(1, pdfs.length))
    if (pdfs[0]) {
      setFile(pdfs[0])
      onChange?.()
    }
  }

  useEffect(() => {
    if (initialFiles?.length) accept(initialFiles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!file) return
    let alive = true
    let opened: PdfHandle | null = null
    setHandle(null)
    setError(null)
    openPdf(file.path).then((r) => {
      if (!alive) {
        if (r.ok) r.handle.destroy()
        return
      }
      if (r.ok) {
        opened = r.handle
        setHandle(r.handle)
      } else setError({ encrypted: r.encrypted, message: r.error })
    })
    return () => {
      alive = false
      opened?.destroy()
    }
  }, [file])

  const pick = async () => accept(await window.qx.pickFiles([{ name: 'PDF 文件', extensions: ['pdf'] }], false))
  const drop = useFileDrop(accept)
  const clear = () => setFile(null)
  return { file, handle, error, ignored, clearIgnored: () => setIgnored(0), pick, clear, ...drop }
}
