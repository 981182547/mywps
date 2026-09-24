import { ChevronRight, FileQuestion, Search, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FileInfo } from '../../../shared/types'
import { ToolCard } from '../components/ToolCard'
import { useFileDrop } from '../lib/hooks'
import { CATEGORIES, TOOLS, categoryById, searchTools, suggestTools, type ToolId } from '../tools/registry'

interface Props {
  onOpenTool: (id: ToolId, files?: FileInfo[]) => void
}

const FEATURED: ToolId[] = ['pdf-merge', 'pdf-split', 'images-to-pdf', 'pdf-extract']

export function Home({ onOpenTool }: Props) {
  const [query, setQuery] = useState('')
  const [dropped, setDropped] = useState<FileInfo[] | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const { dragging, bind } = useFileDrop(setDropped)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key === 'Escape') setDropped(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const results = useMemo(() => searchTools(query), [query])

  const pickAny = async () => {
    const files = await window.qx.pickFiles([{ name: '所有文件', extensions: ['*'] }], true)
    if (files.length) setDropped(files)
  }

  return (
    <div className="page" {...bind}>
      <div className="hero">
        <div>
          <h1>今天要处理什么文件？</h1>
          <p>全部免费，没有水印，不限次数。文件只在你的电脑上处理，不会上传。</p>
        </div>
        <div className="search">
          <Search size={16} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索工具，例如“合并”"
            aria-label="搜索工具"
          />
          <span className="kbd">Ctrl K</span>
        </div>
      </div>

      {!query && (
        <div className={`drop-hero${dragging ? ' dragging' : ''}`} onClick={pickAny} role="button" tabIndex={0}>
          <div className="dh-icon">
            <Upload size={24} />
          </div>
          <div style={{ position: 'relative' }}>
            <h2>{dragging ? '松开鼠标，为你推荐工具' : '把文件拖到这里'}</h2>
            <p>自动识别文件类型，推荐合适的工具；也可以点击选择文件</p>
          </div>
          <div className="dh-formats">
            <span className="chip">PDF</span>
            <span className="chip">JPG</span>
            <span className="chip">PNG</span>
          </div>
        </div>
      )}

      {query ? (
        <section className="section">
          <div className="section-head">
            <h3>搜索结果</h3>
            <span className="sub">找到 {results.length} 个工具</span>
          </div>
          {results.length === 0 ? (
            <div className="empty-search">没有找到“{query}”相关的工具</div>
          ) : (
            <div className="tool-grid">
              {results.map((t) => (
                <ToolCard key={t.id} tool={t} onOpen={() => onOpenTool(t.id)} />
              ))}
            </div>
          )}
        </section>
      ) : (
        <>
          <section className="section">
            <div className="section-head">
              <h3>常用工具</h3>
            </div>
            <div className="tool-grid featured-grid">
              {FEATURED.map((id) => {
                const t = TOOLS.find((x) => x.id === id)!
                return <ToolCard key={id} tool={t} featured onOpen={() => onOpenTool(id)} />
              })}
            </div>
          </section>
          {CATEGORIES.map((c) => {
            const tools = TOOLS.filter((t) => t.category === c.id)
            return (
              <section className="section" key={c.id}>
                <div className="section-head">
                  <h3>{c.name}</h3>
                  <span className="sub">{c.desc}</span>
                </div>
                <div className="tool-grid">
                  {tools.map((t) => (
                    <ToolCard key={t.id} tool={t} onOpen={() => onOpenTool(t.id)} />
                  ))}
                </div>
              </section>
            )
          })}
        </>
      )}

      {dropped && <SuggestPopup files={dropped} onClose={() => setDropped(null)} onOpenTool={onOpenTool} />}
    </div>
  )
}

function SuggestPopup({ files, onClose, onOpenTool }: { files: FileInfo[]; onClose: () => void; onOpenTool: Props['onOpenTool'] }) {
  const exts = [...new Set(files.map((f) => f.ext))]
  const tools = suggestTools(exts)
  const kinds = exts.map((e) => e.toUpperCase() || '无扩展名').join('、')

  return (
    <div className="suggest-pop" onClick={onClose}>
      <div className="suggest-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="推荐工具">
        <h3>已选择 {files.length} 个文件</h3>
        <p>类型：{kinds}</p>
        {tools.length > 0 ? (
          <div className="suggest-list">
            {tools.map((t) => {
              const Icon = t.icon
              return (
                <button key={t.id} className={`suggest-item tint-${categoryById(t.category).tint}`} onClick={() => onOpenTool(t.id, files)}>
                  <span className="si-icon icon-solid">
                    <Icon size={18} />
                  </span>
                  <span>
                    <b>{t.name}</b>
                    <small>{t.desc}</small>
                  </span>
                  <ChevronRight className="chev" size={16} />
                </button>
              )
            })}
          </div>
        ) : (
          <div className="alert info">
            <FileQuestion size={16} />
            <span>暂时没有能直接处理这些文件的工具。目前支持 PDF、JPG、PNG，更多格式正在开发中；如果选了多种类型的文件，可以分开处理。</span>
          </div>
        )}
        <div className="foot">
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
