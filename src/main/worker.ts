// 后台工作线程：执行耗时的文件处理，避免阻塞界面
import { parentPort, workerData } from 'node:worker_threads'
import type { Job } from '../shared/types'
import { imagesToPdf, mergePdfs, splitPdf, type Progress } from './engine/pdf'
import { UserError } from '../shared/ranges'
import { addPageNumbers, addWatermark, editPages } from './engine/pages'

export type WorkerMessage =
  | { kind: 'progress'; ratio: number; message: string }
  | { kind: 'done'; outputs: string[] }
  | { kind: 'error'; message: string; user: boolean }

function run(job: Job, progress: Progress): Promise<string[]> {
  switch (job.type) {
    case 'pdf-merge':
      return mergePdfs(job, progress)
    case 'pdf-split':
      return splitPdf(job, progress)
    case 'images-to-pdf':
      return imagesToPdf(job, progress)
    case 'pdf-pages':
      return editPages(job, progress)
    case 'pdf-watermark':
      return addWatermark(job, progress)
    case 'pdf-page-numbers':
      return addPageNumbers(job, progress)
  }
}

const port = parentPort!
const post = (m: WorkerMessage) => port.postMessage(m)

run(workerData as Job, (ratio, message) => post({ kind: 'progress', ratio, message }))
  .then((outputs) => post({ kind: 'done', outputs }))
  .catch((e: unknown) => {
    const user = e instanceof UserError
    post({ kind: 'error', message: user ? (e as Error).message : String((e as Error)?.stack ?? e), user })
  })
