import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileInfo, Job } from '../../../shared/types'
import { uid } from './format'

/** 外部文件拖放：只响应系统文件，不干扰列表内部的拖动排序 */
export function useFileDrop(onFiles: (files: FileInfo[]) => void) {
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)
  const cb = useRef(onFiles)
  cb.current = onFiles

  const isFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

  const bind = {
    onDragEnter: (e: React.DragEvent) => {
      if (!isFiles(e)) return
      e.preventDefault()
      depth.current += 1
      setDragging(true)
    },
    onDragOver: (e: React.DragEvent) => {
      if (!isFiles(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!isFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDragging(false)
    },
    onDrop: async (e: React.DragEvent) => {
      if (!isFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setDragging(false)
      const paths = Array.from(e.dataTransfer.files)
        .map((f) => window.qx.pathForFile(f))
        .filter(Boolean)
      if (paths.length === 0) return
      const infos = await window.qx.statFiles(paths)
      if (infos.length > 0) cb.current(infos)
    }
  }
  return { dragging, bind }
}

export type JobState =
  | { status: 'idle' }
  | { status: 'running'; ratio: number; message: string }
  | { status: 'done'; outputs: string[]; notes: string[]; failures: string[] }
  | { status: 'error'; message: string }

function cleanError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export function useJob() {
  const [state, setState] = useState<JobState>({ status: 'idle' })
  const current = useRef<string | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      // 离开页面时取消仍在运行的任务
      if (current.current) window.qx.cancelJob(current.current)
    }
  }, [])

  const run = useCallback(async (job: Job) => {
    const id = uid('job')
    current.current = id
    setState({ status: 'running', ratio: 0, message: '准备中…' })
    const off = window.qx.onJobProgress((p) => {
      if (p.jobId === id && alive.current) setState({ status: 'running', ratio: p.ratio, message: p.message })
    })
    try {
      const r = await window.qx.runJob(id, job)
      if (alive.current) setState({ status: 'done', outputs: r.outputs, notes: r.notes ?? [], failures: r.failures ?? [] })
    } catch (e) {
      const message = cleanError(e)
      if (alive.current) setState(message === '已取消' ? { status: 'idle' } : { status: 'error', message })
    } finally {
      off()
      if (current.current === id) current.current = null
    }
  }, [])

  const cancel = useCallback(() => {
    if (current.current) window.qx.cancelJob(current.current)
  }, [])
  const reset = useCallback(() => setState({ status: 'idle' }), [])
  return { state, run, reset, cancel }
}

const OUT_KEY = 'qx.outputDir'

/** 输出目录：默认与源文件相同；用户选择的目录会被记住 */
export function useOutputDir() {
  const [custom, setCustom] = useState<string | null>(() => {
    try {
      return localStorage.getItem(OUT_KEY)
    } catch {
      return null
    }
  })
  const choose = useCallback(async () => {
    const d = await window.qx.pickDir()
    if (!d) return
    setCustom(d)
    try {
      localStorage.setItem(OUT_KEY, d)
    } catch {
      /* 忽略 */
    }
  }, [])
  const clear = useCallback(() => {
    setCustom(null)
    try {
      localStorage.removeItem(OUT_KEY)
    } catch {
      /* 忽略 */
    }
  }, [])
  return { custom, choose, clear }
}

/** 列表拖动排序 */
export function useReorder<T>(items: T[], setItems: (items: T[]) => void) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [over, setOver] = useState<{ index: number; after: boolean } | null>(null)

  const itemProps = (index: number, vertical = true) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData('application/x-qx-row', String(index))
      e.dataTransfer.effectAllowed = 'move'
      setDragIndex(index)
    },
    onDragOver: (e: React.DragEvent) => {
      if (dragIndex === null) return
      e.preventDefault()
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const after = vertical ? e.clientY > rect.top + rect.height / 2 : e.clientX > rect.left + rect.width / 2
      if (!over || over.index !== index || over.after !== after) setOver({ index, after })
    },
    onDrop: (e: React.DragEvent) => {
      if (dragIndex === null || !over) return
      e.preventDefault()
      e.stopPropagation()
      let to = over.index + (over.after ? 1 : 0)
      const next = items.slice()
      const [moved] = next.splice(dragIndex, 1)
      if (to > dragIndex) to -= 1
      next.splice(to, 0, moved)
      setItems(next)
      setDragIndex(null)
      setOver(null)
    },
    onDragEnd: () => {
      setDragIndex(null)
      setOver(null)
    }
  })

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return
    const next = items.slice()
    const [m] = next.splice(from, 1)
    next.splice(to, 0, m)
    setItems(next)
  }

  return { dragIndex, over, itemProps, move }
}
