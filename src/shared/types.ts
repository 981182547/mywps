// 主进程、工作线程与界面之间共享的类型

export interface FileInfo {
  path: string
  name: string
  ext: string
  size: number
}

/** 输出位置：与第一个源文件相同目录，或用户指定目录 */
export interface OutputTarget {
  dir: string
}

export interface MergeItem {
  path: string
  /** 页码范围，例如 "1-3,5"；为空表示全部页面 */
  ranges?: string
}

export interface MergeJob {
  type: 'pdf-merge'
  items: MergeItem[]
  output: OutputTarget
  fileName: string
}

export type SplitMode =
  | { kind: 'every'; n: number }
  | { kind: 'ranges'; ranges: string }
  | { kind: 'extract'; ranges: string }

export interface SplitJob {
  type: 'pdf-split'
  path: string
  mode: SplitMode
  output: OutputTarget
}

export type PageSizeOption = 'A4' | 'A3' | 'Letter' | 'fit'
export type OrientationOption = 'auto' | 'portrait' | 'landscape'

export interface ImagesToPdfJob {
  type: 'images-to-pdf'
  images: string[]
  pageSize: PageSizeOption
  orientation: OrientationOption
  /** 页边距，单位毫米 */
  marginMm: number
  output: OutputTarget
  fileName: string
}

export type Job = MergeJob | SplitJob | ImagesToPdfJob

export interface JobProgress {
  jobId: string
  /** 0 ~ 1 */
  ratio: number
  message: string
}

export interface JobResult {
  outputs: string[]
}

export interface PdfMeta {
  pageCount: number
  encrypted: boolean
}

export interface QingxiangApi {
  platform: NodeJS.Platform
  pickFiles(filters: { name: string; extensions: string[] }[], multi: boolean): Promise<FileInfo[]>
  pickDir(): Promise<string | null>
  statFiles(paths: string[]): Promise<FileInfo[]>
  readFile(path: string): Promise<Uint8Array>
  pdfMeta(path: string): Promise<PdfMeta>
  runJob(jobId: string, job: Job): Promise<JobResult>
  onJobProgress(handler: (p: JobProgress) => void): () => void
  openPath(path: string): Promise<void>
  showInFolder(path: string): void
  pathForFile(file: File): string
  windowControl(action: 'minimize' | 'maximize' | 'close'): void
}
