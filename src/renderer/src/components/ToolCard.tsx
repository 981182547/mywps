import { ArrowUpRight } from 'lucide-react'
import { categoryById, type ToolDef } from '../tools/registry'

interface Props {
  tool: ToolDef
  onOpen: () => void
  featured?: boolean
}

export function ToolCard({ tool, onOpen, featured }: Props) {
  const Icon = tool.icon
  const tint = categoryById(tool.category).tint
  const cls = `tool-card tint-${tint}${tool.ready ? '' : ' soon'}${featured ? ' featured' : ''}`
  return (
    <button className={cls} onClick={tool.ready ? onOpen : undefined} disabled={!tool.ready} data-tool={tool.id}>
      <div className={`tc-icon ${featured ? 'icon-solid' : 'icon-soft'}`}>
        <Icon size={20} strokeWidth={2} />
      </div>
      <div>
        <h4>{tool.name}</h4>
        <p>{tool.desc}</p>
      </div>
      {tool.ready ? <ArrowUpRight className="arrow" size={16} /> : <span className="badge-soon">即将推出</span>}
    </button>
  )
}
