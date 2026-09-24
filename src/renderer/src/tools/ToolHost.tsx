import type { FileInfo } from '../../../shared/types'
import { ImagesToPdfTool } from './ImagesToPdfTool'
import { MergeTool } from './MergeTool'
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
    default:
      return null
  }
}
