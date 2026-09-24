import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeftRight,
  Combine,
  Droplets,
  FileArchive,
  FileImage,
  FileLock2,
  FileOutput,
  FileSpreadsheet,
  FileText,
  FileType2,
  GalleryVertical,
  Hash,
  ImageDown,
  ImagePlus,
  Images,
  KeyRound,
  Layers,
  ListOrdered,
  MonitorPlay,
  PenLine,
  Presentation,
  RotateCw,
  RefreshCcw,
  ScanText,
  Scaling,
  Scissors,
  Sheet,
  ShieldCheck,
  Trash2,
  Type,
  Wrench
} from 'lucide-react'

export type CategoryId = 'pdf' | 'convert' | 'image' | 'security' | 'compress' | 'ocr'

export interface Category {
  id: CategoryId
  name: string
  desc: string
  icon: LucideIcon
  /** 图标底色渐变 */
  tint: string
}

export const CATEGORIES: Category[] = [
  { id: 'pdf', name: 'PDF 工具', desc: '合并、拆分、提取、旋转与页面整理', icon: FileText, tint: 'rose' },
  { id: 'convert', name: '格式转换', desc: 'PDF、Office 与图片之间互相转换', icon: ArrowLeftRight, tint: 'blue' },
  { id: 'image', name: '图片工具', desc: '格式转换、压缩与调整尺寸', icon: Images, tint: 'green' },
  { id: 'security', name: '安全与签名', desc: '加密、解密、签名与盖章', icon: ShieldCheck, tint: 'amber' },
  { id: 'compress', name: '压缩与修复', desc: '减小 PDF 体积，修复损坏的文件', icon: FileArchive, tint: 'violet' },
  { id: 'ocr', name: '文字识别', desc: '从图片和扫描件中提取文字', icon: ScanText, tint: 'cyan' }
]

export type ToolId =
  | 'pdf-merge'
  | 'pdf-split'
  | 'pdf-extract'
  | 'images-to-pdf'
  | 'pdf-rotate'
  | 'pdf-delete'
  | 'pdf-reorder'
  | 'pdf-watermark'
  | 'pdf-page-numbers'
  | 'pdf-to-images'
  | 'pdf-to-long-image'
  | 'pdf-to-txt'
  | 'pdf-to-ppt'
  | 'pdf-to-word'
  | 'word-to-pdf'
  | 'excel-to-pdf'
  | 'ppt-to-pdf'
  | 'pdf-to-excel'
  | 'office-convert'
  | 'image-convert'
  | 'image-compress'
  | 'image-resize'
  | 'pdf-encrypt'
  | 'pdf-decrypt'
  | 'pdf-sign'
  | 'pdf-compress'
  | 'pdf-repair'
  | 'ocr-image'

export interface ToolDef {
  id: ToolId
  name: string
  desc: string
  category: CategoryId
  icon: LucideIcon
  keywords: string[]
  ready: boolean
  /** 可接受的文件扩展名（用于拖放推荐） */
  accepts: string[]
}

const PDF = ['pdf']
const OFFICE_ALL = ['doc', 'docx', 'docm', 'dot', 'dotx', 'wps', 'wpt', 'rtf', 'odt', 'xls', 'xlsx', 'xlsm', 'xlt', 'xltx', 'et', 'ett', 'ods', 'ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'pot', 'potx', 'dps', 'dpt', 'odp']
export const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'bmp', 'tif', 'tiff', 'gif', 'avif', 'ico', 'svg']

export const TOOLS: ToolDef[] = [
  { id: 'pdf-merge', name: 'PDF 合并', desc: '把多个 PDF 按顺序合成一个，可只选部分页面', category: 'pdf', icon: Combine, keywords: ['合并', 'merge', '拼接', '组合'], ready: true, accepts: PDF },
  { id: 'pdf-split', name: 'PDF 拆分', desc: '按固定页数或自定义范围，拆成多个 PDF', category: 'pdf', icon: Scissors, keywords: ['拆分', 'split', '分割'], ready: true, accepts: PDF },
  { id: 'pdf-extract', name: '提取页面', desc: '挑出需要的页面，另存为一个新 PDF', category: 'pdf', icon: FileOutput, keywords: ['提取', 'extract', '抽取', '选页'], ready: true, accepts: PDF },
  { id: 'images-to-pdf', name: '图片转 PDF', desc: '多张图片合成一个 PDF，支持 HEIC 等格式，自动纠正方向', category: 'convert', icon: ImagePlus, keywords: ['图片', 'image', 'jpg', 'png', '照片', '转换'], ready: true, accepts: IMAGE_EXTS },
  { id: 'pdf-rotate', name: '旋转页面', desc: '旋转全部或指定页面，支持奇偶页快速选择', category: 'pdf', icon: RotateCw, keywords: ['旋转', 'rotate'], ready: true, accepts: PDF },
  { id: 'pdf-delete', name: '删除页面', desc: '点选缩略图删除不需要的页面，可撤销', category: 'pdf', icon: Trash2, keywords: ['删除', 'delete'], ready: true, accepts: PDF },
  { id: 'pdf-reorder', name: '页面排序', desc: '拖动缩略图调整页面顺序，一键倒序', category: 'pdf', icon: ListOrdered, keywords: ['排序', '顺序', 'reorder'], ready: true, accepts: PDF },
  { id: 'pdf-watermark', name: '添加水印', desc: '文字或图片水印，可调透明度与角度', category: 'pdf', icon: Droplets, keywords: ['水印', 'watermark'], ready: true, accepts: PDF },
  { id: 'pdf-page-numbers', name: '添加页码', desc: '六种位置、多种格式，可跳过封面', category: 'pdf', icon: Hash, keywords: ['页码', 'page number'], ready: true, accepts: PDF },
  { id: 'pdf-to-images', name: 'PDF 转图片', desc: '每页导出为高清 JPG 或 PNG', category: 'convert', icon: FileImage, keywords: ['图片', 'jpg', 'png', '转换'], ready: true, accepts: PDF },
  { id: 'pdf-to-long-image', name: 'PDF 转长图', desc: '所有页面拼成一张长图，方便手机查看', category: 'convert', icon: GalleryVertical, keywords: ['长图', '图片', '手机'], ready: true, accepts: PDF },
  { id: 'pdf-to-txt', name: 'PDF 转文字', desc: '提取文字保存为 TXT，支持中文排版', category: 'convert', icon: Type, keywords: ['文字', 'txt', '文本', '提取'], ready: true, accepts: PDF },
  { id: 'pdf-to-ppt', name: 'PDF 转 PPT', desc: '每页生成一张幻灯片，版面不变', category: 'convert', icon: MonitorPlay, keywords: ['ppt', 'pptx', '幻灯片', '演示'], ready: true, accepts: PDF },
  { id: 'pdf-to-word', name: 'PDF 转 Word', desc: '转为可编辑的 Word，保留标题、段落与图片', category: 'convert', icon: FileType2, keywords: ['word', 'docx', '转换'], ready: true, accepts: PDF },
  { id: 'pdf-to-excel', name: 'PDF 转 Excel', desc: '识别表格的行列，转为可编辑的 Excel', category: 'convert', icon: Sheet, keywords: ['excel', 'xlsx', '表格'], ready: true, accepts: PDF },
  { id: 'office-convert', name: 'Office 格式转换', desc: 'doc↔docx、xls↔xlsx、ppt↔pptx，WPS 格式转通用格式', category: 'convert', icon: RefreshCcw, keywords: ['doc', 'docx', 'xls', 'wps', 'et', 'dps', '格式', '旧版', '新版'], ready: true, accepts: OFFICE_ALL },
  { id: 'word-to-pdf', name: 'Word 转 PDF', desc: 'doc、docx、wps 批量转 PDF，版式不变', category: 'convert', icon: FileText, keywords: ['word', 'docx', 'doc', '转换'], ready: true, accepts: ['doc', 'docx', 'docm', 'dot', 'dotx', 'wps', 'wpt', 'rtf', 'odt', 'txt'] },
  { id: 'excel-to-pdf', name: 'Excel 转 PDF', desc: 'xls、xlsx、et 批量转 PDF，可每表一页', category: 'convert', icon: FileSpreadsheet, keywords: ['excel', 'xlsx', '表格'], ready: true, accepts: ['xls', 'xlsx', 'xlsm', 'xlt', 'xltx', 'et', 'ett', 'csv', 'ods'] },
  { id: 'ppt-to-pdf', name: 'PPT 转 PDF', desc: 'ppt、pptx、dps 批量转 PDF', category: 'convert', icon: Presentation, keywords: ['ppt', 'pptx', '幻灯片'], ready: true, accepts: ['ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'pot', 'potx', 'dps', 'dpt', 'odp'] },
  { id: 'image-convert', name: '图片格式转换', desc: 'HEIC、WEBP、PNG、JPG、BMP、ICO 等批量互转', category: 'image', icon: Layers, keywords: ['格式', 'webp', 'heic'], ready: true, accepts: IMAGE_EXTS },
  { id: 'image-compress', name: '图片压缩', desc: '按清晰度或指定大小批量压缩，绝不越压越大', category: 'image', icon: ImageDown, keywords: ['压缩', '减小'], ready: true, accepts: IMAGE_EXTS },
  { id: 'image-resize', name: '调整尺寸', desc: '按像素或比例缩放，支持证件照尺寸', category: 'image', icon: Scaling, keywords: ['尺寸', '大小', '缩放'], ready: true, accepts: IMAGE_EXTS },
  { id: 'pdf-encrypt', name: 'PDF 加密', desc: 'AES-256 加密，设置打开密码与打印、复制权限', category: 'security', icon: FileLock2, keywords: ['加密', '密码'], ready: true, accepts: PDF },
  { id: 'pdf-decrypt', name: 'PDF 解密', desc: '移除已知的打开密码，一键解除打印复制限制', category: 'security', icon: KeyRound, keywords: ['解密', '去密码'], ready: true, accepts: PDF },
  { id: 'pdf-sign', name: '签名与盖章', desc: '手写签名、印章拖放到页面，支持骑缝章', category: 'security', icon: PenLine, keywords: ['签名', '盖章', '印章'], ready: true, accepts: PDF },
  { id: 'pdf-compress', name: 'PDF 压缩', desc: '三档压缩强度，显示压缩前后大小', category: 'compress', icon: FileArchive, keywords: ['压缩', '瘦身', '减小'], ready: true, accepts: PDF },
  { id: 'pdf-repair', name: 'PDF 修复', desc: '打不开或提示损坏的 PDF，尝试恢复页面', category: 'compress', icon: Wrench, keywords: ['修复', '损坏', '打不开'], ready: true, accepts: PDF },
  { id: 'ocr-image', name: '图片转文字', desc: '识别图片中的中英文', category: 'ocr', icon: ScanText, keywords: ['ocr', '识别', '文字'], ready: false, accepts: IMAGE_EXTS }
]

export function toolById(id: ToolId): ToolDef {
  return TOOLS.find((t) => t.id === id)!
}

export function categoryById(id: CategoryId): Category {
  return CATEGORIES.find((c) => c.id === id)!
}

export function searchTools(q: string): ToolDef[] {
  const s = q.trim().toLowerCase()
  if (!s) return TOOLS
  return TOOLS.filter(
    (t) => t.name.toLowerCase().includes(s) || t.desc.toLowerCase().includes(s) || t.keywords.some((k) => k.toLowerCase().includes(s))
  )
}

/** 根据拖入的文件类型推荐可用的工具 */
export function suggestTools(exts: string[]): ToolDef[] {
  const set = new Set(exts)
  if (set.size === 0) return []
  return TOOLS.filter((t) => t.ready && [...set].every((e) => t.accepts.includes(e)))
}
