// 后台工作线程：执行耗时的文件处理，避免阻塞界面
import { parentPort, workerData } from 'node:worker_threads'
import { UserError } from '../shared/ranges'
import type { Job, JobResult } from '../shared/types'
import { compressImages, convertImages, resizeImages } from './engine/imagetools'
import { addPageNumbers, addWatermark, editPages } from './engine/pages'
import { imagesToPdf, mergePdfs, splitPdf, type Progress } from './engine/pdf'
import { pdfToImages, pdfToPpt, pdfToText } from './engine/render'
import { compressPdf } from './engine/compress'
import { decryptPdf, encryptPdf, repairPdf } from './engine/security'
import { signPdf } from './engine/sign'

export type WorkerMessage =
  | { kind: 'progress'; ratio: number; message: string }
  | { kind: 'done'; result: JobResult }
  | { kind: 'error'; message: string; user: boolean }

function run(job: Job, progress: Progress): Promise<string[] | JobResult> {
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
    case 'pdf-to-images':
      return pdfToImages(job, progress)
    case 'pdf-to-txt':
      return pdfToText(job, progress)
    case 'pdf-to-ppt':
      return pdfToPpt(job, progress)
    case 'image-convert':
      return convertImages(job, progress)
    case 'image-compress':
      return compressImages(job, progress)
    case 'image-resize':
      return resizeImages(job, progress)
    case 'pdf-encrypt':
      return encryptPdf(job, progress)
    case 'pdf-decrypt':
      return decryptPdf(job, progress)
    case 'pdf-compress':
      return compressPdf(job, progress)
    case 'pdf-repair':
      return repairPdf(job, progress)
    case 'pdf-sign':
      return signPdf(job, progress)
  }
}

const port = parentPort!
const post = (m: WorkerMessage) => port.postMessage(m)

run(workerData as Job, (ratio, message) => post({ kind: 'progress', ratio, message }))
  .then((r) => post({ kind: 'done', result: Array.isArray(r) ? { outputs: r } : r }))
  .catch((e: unknown) => {
    const user = e instanceof UserError
    post({ kind: 'error', message: user ? (e as Error).message : String((e as Error)?.stack ?? e), user })
  })
