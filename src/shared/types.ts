// 主进程、工作线程与界面之间共享的类型

export interface FileInfo {
  path: string
  name: string
  ext: string
  size: number
  /** 修改时间（毫秒） */
  mtime?: number
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

export interface PdfEncryptJob {
  type: 'pdf-encrypt'
  path: string
  /** 打开密码，可为空 */
  openPassword: string
  /** 权限密码（编辑密码），可为空 */
  ownerPassword: string
  allowPrint: boolean
  allowCopy: boolean
  allowModify: boolean
  allowAnnotate: boolean
  output: OutputTarget
  fileName: string
}

export interface PdfDecryptJob {
  type: 'pdf-decrypt'
  path: string
  password: string
  output: OutputTarget
  fileName: string
}

export type CompressLevel = 'low' | 'medium' | 'high'

export interface PdfCompressJob {
  type: 'pdf-compress'
  path: string
  level: CompressLevel
  output: OutputTarget
  fileName: string
}

export interface PdfRepairJob {
  type: 'pdf-repair'
  path: string
  output: OutputTarget
  fileName: string
}

/** 签名/印章在页面上的位置：页面可见坐标，原点在左上角，单位磅 */
export interface SignPlacement {
  page: number
  imageId: string
  x: number
  y: number
  w: number
  h: number
}

export interface SeamStamp {
  imageId: string
  /** 印章完整宽度（磅），会被平分到各页 */
  width: number
  /** 印章中心在页面高度上的位置 0~1（从上往下） */
  yRatio: number
  /** 参与骑缝的页面，空表示全部 */
  ranges?: string
}

export interface SignJob {
  type: 'pdf-sign'
  path: string
  /** 图片 id → PNG 的 base64 */
  images: Record<string, string>
  placements: SignPlacement[]
  seam?: SeamStamp
  output: OutputTarget
  fileName: string
}

export type OfficeFamily = 'word' | 'excel' | 'ppt'

export interface OfficeToPdfJob {
  type: 'office-to-pdf'
  paths: string[]
  /** 表格：每个工作表导出为一页 */
  sheetOnePage: boolean
  output: BatchOutput
}

export interface OfficeConvertJob {
  type: 'office-convert'
  paths: string[]
  /** modern：转为 docx/xlsx/pptx；legacy：转为 doc/xls/ppt */
  mode: 'modern' | 'legacy'
  output: BatchOutput
}

export interface OfficeStatus {
  /** 可用的转换引擎名称，例如 “Microsoft Office”、“WPS Office”、“LibreOffice” */
  engines: string[]
}

export interface PdfToWordJob {
  type: 'pdf-to-word'
  path: string
  ranges?: string
  output: OutputTarget
}

export interface PdfToExcelJob {
  type: 'pdf-to-excel'
  path: string
  /** 每页一个工作表，或全部放在一个工作表 */
  layout: 'per-page' | 'single'
  ranges?: string
  output: OutputTarget
}

export type OcrLang = 'chi' | 'eng'

export interface OcrImagesJob {
  type: 'ocr-images'
  paths: string[]
  lang: OcrLang
  /** each：每张图片一个 TXT；merged：合并为一个 TXT；docx：合并为一个 Word */
  format: 'each' | 'merged' | 'docx'
  output: BatchOutput
}

export interface OcrPdfJob {
  type: 'ocr-pdf'
  path: string
  lang: OcrLang
  /** searchable：生成可搜索、可复制的 PDF；txt / docx：导出文字 */
  format: 'searchable' | 'txt' | 'docx'
  ranges?: string
  output: OutputTarget
}

export interface RenameJob {
  type: 'rename'
  /** 同一文件夹内改名：from 为完整路径，to 为新文件名 */
  items: { from: string; to: string }[]
}

export type ImageFormat = 'jpg' | 'png' | 'webp' | 'avif' | 'tiff' | 'bmp' | 'ico' | 'gif'

/** 批量任务的输出：dir 为空表示各自保存在源文件所在文件夹 */
export interface BatchOutput {
  dir?: string
}

export interface ImageConvertJob {
  type: 'image-convert'
  paths: string[]
  format: ImageFormat
  quality: number
  background: string
  output: BatchOutput
}

export interface ImageCompressJob {
  type: 'image-compress'
  paths: string[]
  mode: 'quality' | 'target'
  quality: number
  targetKB: number
  /** 可选：宽度超过此值时等比缩小 */
  maxWidth?: number
  output: BatchOutput
}

export interface ImageResizeJob {
  type: 'image-resize'
  paths: string[]
  mode: 'percent' | 'width' | 'height' | 'box'
  percent: number
  width: number
  height: number
  fit: 'contain' | 'cover' | 'fill'
  background: string
  /** 为空时保持原格式 */
  format?: ImageFormat
  output: BatchOutput
}

export interface BatchResult {
  outputs: string[]
  /** 可在结果页直接查看、复制的文字（如识别结果） */
  preview?: string
  /** 每个文件的说明，例如压缩前后大小 */
  notes: string[]
  /** 失败的文件及原因 */
  failures: string[]
}

export type Job =
  | RenameJob
  | OcrImagesJob
  | OcrPdfJob
  | PdfToWordJob
  | PdfToExcelJob
  | OfficeToPdfJob
  | OfficeConvertJob
  | SignJob
  | PdfEncryptJob
  | PdfDecryptJob
  | PdfCompressJob
  | PdfRepairJob
  | ImageConvertJob
  | ImageCompressJob
  | ImageResizeJob
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
  preview?: string
  notes?: string[]
  failures?: string[]
}

export interface ImageThumb {
  /** JPEG/PNG data URL */
  url: string
  /** 原图像素尺寸（已按方向摆正） */
  width: number
  height: number
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
  imageThumb(path: string, size: number): Promise<ImageThumb | null>
  pdfEncryption(path: string): Promise<'none' | 'open' | 'restricted'>
  officeStatus(refresh?: boolean): Promise<OfficeStatus>
  openExternal(url: string): void
  runJob(jobId: string, job: Job): Promise<JobResult>
  cancelJob(jobId: string): void
  onJobProgress(handler: (p: JobProgress) => void): () => void
  openPath(path: string): Promise<void>
  showInFolder(path: string): void
  pathForFile(file: File): string
  windowControl(action: 'minimize' | 'maximize' | 'close'): void
}
