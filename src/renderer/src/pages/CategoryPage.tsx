import type { FileInfo } from '../../../shared/types'
import { ToolCard } from '../components/ToolCard'
import { TOOLS, categoryById, type CategoryId, type ToolId } from '../tools/registry'

interface Props {
  id: CategoryId
  onOpenTool: (id: ToolId, files?: FileInfo[]) => void
}

export function CategoryPage({ id, onOpenTool }: Props) {
  const c = categoryById(id)
  const Icon = c.icon
  const tools = TOOLS.filter((t) => t.category === id).sort((a, b) => Number(b.ready) - Number(a.ready))
  return (
    <div className="page">
      <div className={`cat-hero tint-${c.tint}`}>
        <div className="ch-icon icon-solid">
          <Icon size={24} />
        </div>
        <div>
          <h1>{c.name}</h1>
          <p>{c.desc}</p>
        </div>
      </div>
      <div className="tool-grid">
        {tools.map((t) => (
          <ToolCard key={t.id} tool={t} onOpen={() => onOpenTool(t.id)} />
        ))}
      </div>
    </div>
  )
}
