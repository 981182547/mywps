import type { FileInfo } from '../../../shared/types'
import { PdfToImagesTool, PdfToPptTool, PdfToTextTool } from './ConvertTools'
import { ImagesToPdfTool } from './ImagesToPdfTool'
import { PdfCompressTool, PdfDecryptTool, PdfEncryptTool, PdfRepairTool } from './SecurityTools'
import { ImageCompressTool, ImageConvertTool, ImageResizeTool } from './ImageTools'
import { MergeTool } from './MergeTool'
import { OcrImageTool, OcrPdfTool } from './OcrTools'
import { ExcelToPdfTool, OfficeConvertTool, PdfToExcelTool, PdfToWordTool, PptToPdfTool, WordToPdfTool } from './OfficeTools'
import { PageNumberTool } from './PageNumberTool'
import { PageOrganizer } from './PageOrganizer'
import { WatermarkTool } from './WatermarkTool'
import { RenameTool } from './RenameTool'
import { SignTool } from './SignTool'
import { SplitTool } from './SplitTool'
import { toolById, type ToolId } from './registry'

interface Props {
  id: ToolId
  initialFiles?: FileInfo[]
  onBack: () => void
}

export function ToolHost({ id, initialFiles, onBack }: Props) {
  const tool = toolById(id)
  switch (id) {
    case 'pdf-merge':
      return <MergeTool tool={tool} initialFiles={initialFiles} onBack={onBack} />
    case 'pdf-split':
      return <SplitTool tool={tool} initialFiles={initialFiles} onBack={onBack} initialMode="every" />
    case 'pdf-extract':
      return <SplitTool tool={tool} initialFiles={initialFiles} onBack={onBack} initialMode="extract" />
    case 'images-to-pdf':
      return <ImagesToPdfTool tool={tool} initialFiles={initialFiles} onBack={onBack} />
    case 'pdf-rotate':
      return <PageOrganizer tool={tool} initialFiles={initialFiles} onBack={onBack} mode="rotate" />
    case 'pdf-delete':
      return <PageOrganizer tool={tool} initialFiles={initialFiles} onBack={onBack} mode="delete" />
    case 'pdf-reorder':
      return <PageOrganizer tool={tool} initialFiles={initialFiles} onBack={onBack} mode="reorder" />
    case 'pdf-watermark':
      return <WatermarkTool tool={tool} initialFiles={initialFiles} onBack={onBack} />
    case 'pdf-page-numbers':
      return <PageNumberTool tool={tool} initialFiles={initialFiles} onBack={onBack} />
    case 'pdf-to-images':
      return <PdfToImagesTool tool={tool} initialFiles={initialFiles} onBack={onBack} initialMode="pages" />
    case 'pdf-to-long-image':
      return <PdfToImagesTool tool={tool} initialFiles={initialFiles} onBack={onBack} initialMode="long" />
    case 'pdf-to-txt':
      return <PdfToTextTool tool={tool} initialFiles={initialFiles} onBack={onBack} />
    case 'pdf-to-ppt':
      return <PdfToPptTool tool={tool} initialFiles={initialFiles} onBack={onBack} />
    case 'image-convert':
      return <ImageConvertTool tool={tool} initialFiles={initialFiles} onBack={onBack} />
    case 'image-compress':
      return <ImageCompressTool tool={tool} initialFiles={initialFiles} onBack={onBack} />
    case 'image-resize':
      return <ImageResizeTool tool={tool} initialFiles={initialFiles} onBack={onBack} />
    case 'pdf-encrypt':
      return <PdfEncryptTool tool={tool} initialFiles={initialFiles} onBack={onBack} />
    case 'pdf-decrypt':
      return <PdfDecryptTool tool={tool} initialFiles={initialFiles} onBack={onBack} />
    case 'pdf-compress':
      return <PdfCompressTool tool={tool} initialFiles={initialFiles} onBack={onBack} />
    case 'pdf-repair':
      return <PdfRepairTool tool={tool} initialFiles={initialFiles} onBack={onBack} />
    case 'pdf-sign':
      return <SignTool tool={tool} initialFiles={initialFiles} onBack={onBack} />
    case 'word-to-pdf':
      return <WordToPdfTool tool={tool} initialFiles={initialFiles} onBack={onBack} />
    case 'excel-to-pdf':
      return <ExcelToPdfTool tool={tool} initialFiles={initialFiles} onBack={onBack} />
    case 'ppt-to-pdf':
      return <PptToPdfTool tool={tool} initialFiles={initialFiles} onBack={onBack} />
    case 'office-convert':
      return <OfficeConvertTool tool={tool} initialFiles={initialFiles} onBack={onBack} />
    case 'pdf-to-word':
      return <PdfToWordTool tool={tool} initialFiles={initialFiles} onBack={onBack} />
    case 'pdf-to-excel':
      return <PdfToExcelTool tool={tool} initialFiles={initialFiles} onBack={onBack} />
    case 'ocr-image':
      return <OcrImageTool tool={tool} initialFiles={initialFiles} onBack={onBack} />
    case 'ocr-pdf':
      return <OcrPdfTool tool={tool} initialFiles={initialFiles} onBack={onBack} />
    case 'batch-rename':
      return <RenameTool tool={tool} initialFiles={initialFiles} onBack={onBack} />
    default:
      return null
  }
}
