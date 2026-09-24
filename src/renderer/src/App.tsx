import { useCallback, useState } from 'react'
import type { FileInfo } from '../../shared/types'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { CategoryPage } from './pages/CategoryPage'
import { Home } from './pages/Home'
import { ToolHost } from './tools/ToolHost'
import type { CategoryId, ToolId } from './tools/registry'

export type Route =
  | { view: 'home' }
  | { view: 'category'; id: CategoryId }
  | { view: 'tool'; id: ToolId; files?: FileInfo[]; from: 'home' | CategoryId }

export function App() {
  const [route, setRoute] = useState<Route>({ view: 'home' })
  // 每次打开工具生成新的 key，保证工具状态重新开始
  const [toolKey, setToolKey] = useState(0)

  const openTool = useCallback(
    (id: ToolId, files?: FileInfo[]) => {
      setToolKey((k) => k + 1)
      setRoute((r) => ({ view: 'tool', id, files, from: r.view === 'category' ? r.id : r.view === 'tool' ? r.from : 'home' }))
    },
    []
  )

  const goBack = useCallback(() => {
    setRoute((r) => (r.view === 'tool' && r.from !== 'home' ? { view: 'category', id: r.from } : { view: 'home' }))
  }, [])

  const activeNav = route.view === 'home' ? 'home' : route.view === 'category' ? route.id : route.from

  return (
    <div className="app">
      <TitleBar />
      <Sidebar
        active={activeNav}
        onHome={() => setRoute({ view: 'home' })}
        onCategory={(id) => setRoute({ view: 'category', id })}
      />
      <main className="main" id="main">
        {route.view === 'home' && <Home onOpenTool={openTool} />}
        {route.view === 'category' && <CategoryPage key={route.id} id={route.id} onOpenTool={openTool} />}
        {route.view === 'tool' && <ToolHost key={toolKey} id={route.id} initialFiles={route.files} onBack={goBack} />}
      </main>
    </div>
  )
}
