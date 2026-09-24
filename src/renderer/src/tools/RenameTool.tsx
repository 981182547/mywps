import { ArrowRight, FilePlus2, Trash2, Undo2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { applyRule, findConflicts, type RenameRule } from '../../../shared/rename'
import type { FileInfo } from '../../../shared/types'
import { baseName, dirOf, uid } from '../lib/format'
import { useFileDrop, useJob } from '../lib/hooks'
import { Field, ResultView, RunFooter, Segmented, ToolLayout } from './ToolLayout'
import { EmptyDrop } from './common'
import type { ToolDef } from './registry'

const TOKENS = [
  { token: '{name}', label: '原文件名' },
  { token: '{n}', label: '序号' },
  { token: '{date}', label: '修改日期' }
]

export function RenameTool({ tool, initialFiles, onBack }: { tool: ToolDef; initialFiles?: FileInfo[]; onBack: () => void }) {
  const [items, setItems] = useState<{ key: string; info: FileInfo }[]>([])
  const [rule, setRule] = useState<RenameRule>({ template: '{name}_{n}', start: 1, digits: 2, find: '', replace: '', extCase: 'keep' })
  const [lastDone, setLastDone] = useState<{ from: string; to: string }[] | null>(null)
  const job = useJob()
  const undoJob = useJob()
  const running = job.state.status === 'running' || undoJob.state.status === 'running'

  const addFiles = (files: FileInfo[]) => {
    setItems((prev) => {
      const seen = new Set(prev.map((p) => p.info.path))
      return [...prev, ...files.filter((f) => !seen.has(f.path)).map((info) => ({ key: uid('rn'), info }))]
    })
    job.reset()
  }
  useEffect(() => {
    if (initialFiles?.length) addFiles(initialFiles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const pick = async () => addFiles(await window.qx.pickFiles([{ name: '所有文件', extensions: ['*'] }], true))
  const { dragging, bind } = useFileDrop(addFiles)

  const set = (patch: Partial<RenameRule>) => setRule((r) => ({ ...r, ...patch }))
  const newNames = useMemo(() => applyRule(items.map((i) => ({ name: i.info.name, mtime: i.info.mtime })), rule), [items, rule])
  const problems = useMemo(() => findConflicts(items.map((i) => dirOf(i.info.path)), newNames), [items, newNames])
  const changed = newNames.filter((n, i) => n !== items[i]?.info.name).length
  const problemCount = problems.filter(Boolean).length

  let reason: string | undefined
  if (items.length === 0) reason = '请先添加文件'
  else if (problemCount) reason = `有 ${problemCount} 个新名称需要修改`
  else if (changed === 0) reason = '新名称与原名称相同'

  const run = async () => {
    const mapping = items.map((it, i) => ({ from: it.info.path, to: newNames[i] })).filter((m) => baseName(m.from) !== m.to)
    setLastDone(mapping.map((m) => ({ from: `${dirOf(m.from)}${m.from.includes('\\') ? '\\' : '/'}${m.to}`, to: baseName(m.from) })))
    await job.run({ type: 'rename', items: mapping })
  }

  const undo = async () => {
    if (!lastDone) return
    await undoJob.run({ type: 'rename', items: lastDone })
  }
  useEffect(() => {
    if (undoJob.state.status !== 'done' || !lastDone) return
    // 撤销后列表恢复为原文件名
    const back = new Map(lastDone.map((m) => [m.from, m.to]))
    setItems((prev) =>
      prev.map((it) => {
        const name = back.get(it.info.path)
        if (!name) return it
        const sep = it.info.path.includes('\\') ? '\\' : '/'
        return { ...it, info: { ...it.info, path: `${dirOf(it.info.path)}${sep}${name}`, name } }
      })
    )
    setLastDone(null)
    job.reset()
    undoJob.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoJob.state.status])

  // 完成后把列表中的路径更新为新名称，便于继续调整
  useEffect(() => {
    if (job.state.status !== 'done') return
    const outs = job.state.outputs
    let k = 0
    setItems((prev) =>
      prev.map((it, i) => {
        if (newNames[i] === it.info.name) return it
        const path = outs[k++]
        return path ? { ...it, info: { ...it.info, path, name: baseName(path), ext: it.info.ext } } : it
      })
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.state.status])

  const filesPanel = (
    <section className={`panel files-panel${dragging ? ' dragging' : ''}`} {...bind}>
      {items.length === 0 ? (
        <EmptyDrop tool={tool} dragging={dragging} onPick={pick} title="添加要重命名的文件" formats={['任意类型']} hint="设置规则后实时预览新名称，确认后再执行，可以撤销" />
      ) : (
        <>
          <div className="files-toolbar">
            <div className="summary">
              {items.length} 个文件<span>{changed} 个将被改名</span>
            </div>
            <div className="grow" />
            <button className="btn ghost sm danger" onClick={() => setItems([])} disabled={running}>
              <Trash2 size={14} /> 清空
            </button>
            <button className="btn sm" onClick={pick} disabled={running}>
              <FilePlus2 size={14} /> 添加文件
            </button>
          </div>
          <div className="files-scroll">
            <table className="rename-table" data-testid="rename-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>原名称</th>
                  <th style={{ width: 28 }} />
                  <th>新名称</th>
                  <th style={{ width: 36 }} />
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={it.key} className={problems[i] ? 'bad' : newNames[i] !== it.info.name ? 'changed' : ''}>
                    <td className="num">{i + 1}</td>
                    <td className="old" title={it.info.path}>
                      {it.info.name}
                    </td>
                    <td>
                      <ArrowRight size={14} />
                    </td>
                    <td className="new">
                      {newNames[i]}
                      {problems[i] && <div className="problem">{problems[i]}</div>}
                    </td>
                    <td>
                      <button className="btn ghost icon sm danger" onClick={() => setItems((p) => p.filter((x) => x.key !== it.key))} disabled={running} aria-label="移除">
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )

  const side =
    job.state.status === 'done' ? (
      <ResultView
        outputs={job.state.outputs}
        notes={job.state.notes}
        failures={job.state.failures}
        onReset={() => {
          job.reset()
          setLastDone(null)
        }}
        actions={
          lastDone && (
            <button className="btn block" style={{ marginTop: 8 }} onClick={undo} disabled={running} data-action="undo-rename">
              <Undo2 size={14} /> 撤销重命名
            </button>
          )
        }
      />
    ) : (
      <>
        <Field label="新名称规则">
          <input className="input" value={rule.template} onChange={(e) => set({ template: e.target.value })} aria-label="名称模板" disabled={running} />
          <div className="quick-chips">
            {TOKENS.map((t) => (
              <button key={t.token} onClick={() => set({ template: rule.template + t.token })} disabled={running} title={`插入${t.label}`}>
                {t.token} {t.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="序号">
          <div className="dim-row">
            <div className="input-suffix">
              <input className="input" type="number" value={rule.start} onChange={(e) => set({ start: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} aria-label="起始序号" disabled={running} />
              <span>起始</span>
            </div>
            <span />
            <div className="input-suffix">
              <input className="input" type="number" min={1} max={8} value={rule.digits} onChange={(e) => set({ digits: Math.min(8, Math.max(1, Math.floor(Number(e.target.value) || 1))) })} aria-label="序号位数" disabled={running} />
              <span>位数</span>
            </div>
          </div>
        </Field>
        <Field label="查找并替换" hint="在原文件名中查找文字并替换，替换为空即删除">
          <div className="dim-row">
            <input className="input" value={rule.find} onChange={(e) => set({ find: e.target.value })} placeholder="查找" aria-label="查找" disabled={running} />
            <ArrowRight size={14} style={{ color: 'var(--text-3)' }} />
            <input className="input" value={rule.replace} onChange={(e) => set({ replace: e.target.value })} placeholder="替换为" aria-label="替换为" disabled={running} />
          </div>
        </Field>
        <Field label="扩展名">
          <Segmented
            value={rule.extCase}
            onChange={(v) => set({ extCase: v })}
            options={[
              { value: 'keep', label: '保持不变' },
              { value: 'lower', label: '小写' },
              { value: 'upper', label: '大写' }
            ]}
          />
        </Field>
        {undoJob.state.status === 'error' && <div className="alert error">{undoJob.state.message}</div>}
      </>
    )

  return (
    <ToolLayout
      tool={tool}
      onBack={onBack}
      files={filesPanel}
      side={side}
      footer={job.state.status === 'done' ? null : <RunFooter state={job.state} label={changed ? `重命名 ${changed} 个文件` : '重命名'} disabled={!!reason || running} disabledReason={reason} onRun={run} />}
    />
  )
}
