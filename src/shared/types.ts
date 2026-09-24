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

/** 页面整理：按顺序列出保留的页面，以及每页额外旋转角度（90 的倍数） */
export interface PageEditJob {
  type: 'pdf-pages'
  path: string
  pages: { index: number; rotate: number }[]
  output: OutputTarget
  fileName: string
}

export type WatermarkLayout = 'center' | 'tile'

export interface WatermarkJob {
  type: 'pdf-watermark'
  path: string
  mode: 'text' | 'image'
  text: string
  /** 字号，单位磅 */
  fontSize: number
  color: string
  bold: boolean
  /** 0 ~ 1 */
  opacity: number
  /** 逆时针角度 */
  angle: number
  layout: WatermarkLayout
  imagePath?: string
  /** 图片宽度占页面宽度的比例 0 ~ 1 */
  imageScale: number
  /** 需要加水印的页面，空表示全部 */
  ranges?: string
  output: OutputTarget
  fileName: string
}

export type NumberPosition = 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br'
export type NumberFormat = 'n' | 'n-total' | 'cn' | 'cn-total' | 'dash' | 'page-of'

export interface PageNumberJob {
  type: 'pdf-page-numbers'
  path: string
  position: NumberPosition
  format: NumberFormat
  start: number
  fontSize: number
  color: string
  marginMm: number
  /** 需要加页码的页面，空表示全部 */
  ranges?: string
  output: OutputTarget
  fileName: string
}

export interface PdfToImagesJob {
  type: 'pdf-to-images'
  path: string
  /** pages：每页一张；long：拼成长图 */
  mode: 'pages' | 'long'
  format: 'jpg' | 'png'
  dpi: number
  /** JPG 质量 1~100 */
  quality: number
  /** 长图中页面之间留缝 */
  gap: boolean
  ranges?: string
  output: OutputTarget
}

export interface PdfToTextJob {
  type: 'pdf-to-txt'
  path: string
  pageMarkers: boolean
  ranges?: string
  output: OutputTarget
}

export interface PdfToPptJob {
  type: 'pdf-to-ppt'
  path: string
  dpi: number
  ranges?: string
  output: OutputTarget
}

export type Job =
  | MergeJob
  | SplitJob
  | ImagesToPdfJob
  | PageEditJob
  | WatermarkJob
  | PageNumberJob
  | PdfToImagesJob
  | PdfToTextJob
  | PdfToPptJob

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
  cancelJob(jobId: string): void
  onJobProgress(handler: (p: JobProgress) => void): () => void
  openPath(path: string): Promise<void>
  showInFolder(path: string): void
  pathForFile(file: File): string
  windowControl(action: 'minimize' | 'maximize' | 'close'): void
}
