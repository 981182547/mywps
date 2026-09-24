import { Eye, EyeOff, KeyRound, ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CompressLevel, FileInfo } from '../../../shared/types'
import { formatBytes, stemOf } from '../lib/format'
import { SinglePdfTool } from './SinglePdfTool'
import { Field } from './ToolLayout'
import { Toggle } from './controls'
import type { ToolDef } from './registry'

interface Props {
  tool: ToolDef
  initialFiles?: FileInfo[]
  onBack: () => void
}

type EncState = 'none' | 'open' | 'restricted' | null

function useEncryption(file: FileInfo | null): EncState {
  const [state, setState] = useState<EncState>(null)
  useEffect(() => {
    setState(null)
    if (!file) return
    let alive = true
    window.qx.pdfEncryption(file.path).then((s) => alive && setState(s))
    return () => {
      alive = false
    }
  }, [file])
  return state
}

function PasswordInput({ value, onChange, label, placeholder, disabled, invalid }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; disabled?: boolean; invalid?: boolean }) {
  const [show, setShow] = useState(false)
  return (
    <div className="input-suffix password">
      <input
        className={`input${invalid ? ' invalid' : ''}`}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="new-password"
        spellCheck={false}
      />
      <button type="button" className="pw-eye" onClick={() => setShow((s) => !s)} aria-label={show ? '隐藏密码' : '显示密码'} tabIndex={-1}>
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  )
}

function stateTip(state: EncState) {
  if (state === null) return null
  if (state === 'none')
    return (
      <div className="tip">
        <ShieldOff size={15} />
        <span>这个文件目前没有加密。</span>
      </div>
    )
  if (state === 'restricted')
    return (
      <div className="tip">
        <ShieldAlert size={15} />
        <span>
          这个文件<b>只限制了打印、复制等权限</b>，打开不需要密码。
        </span>
      </div>
    )
  return (
    <div className="tip">
      <KeyRound size={15} />
      <span>
        这个文件<b>设置了打开密码</b>。
      </span>
    </div>
  )
}

export function PdfEncryptTool({ tool, initialFiles, onBack }: Props) {
  const [file, setFile] = useState<FileInfo | null>(null)
  const state = useEncryption(file)
  const [open, setOpen] = useState('')
  const [open2, setOpen2] = useState('')
  const [owner, setOwner] = useState('')
  const [print, setPrint] = useState(false)
  const [copy, setCopy] = useState(false)
  const [modify, setModify] = useState(false)
  const [annotate, setAnnotate] = useState(true)
  const mismatch = open !== '' && open2 !== '' && open !== open2
  return (
    <SinglePdfTool
      tool={tool}
      initialFiles={initialFiles}
      onBack={onBack}
      onFileChange={setFile}
      runLabel="加密文件"
      hint="设置打开密码，或限制打印、复制、编辑"
      info={() => stateTip(state)}
      validate={() => {
        if (state === 'open') return '这个文件已经设置了打开密码'
        if (!open && !owner) return '请至少设置打开密码或权限密码'
        if (open && open !== open2) return open2 ? '两次输入的打开密码不一致' : '请再次输入打开密码'
        if (open && owner && open === owner) return '打开密码和权限密码不能相同'
        return undefined
      }}
      options={(c) => (
        <>
          <Field label="打开密码" hint="打开文件时需要输入这个密码">
            <PasswordInput value={open} onChange={setOpen} label="打开密码" placeholder="不设置可留空" disabled={c.running} />
            {open && <PasswordInput value={open2} onChange={setOpen2} label="确认打开密码" placeholder="再次输入" disabled={c.running} invalid={mismatch} />}
            {mismatch && <span style={{ color: 'var(--danger)', fontSize: 12 }}>两次输入不一致</span>}
          </Field>
          <Field label="权限密码" hint="用于限制打印、复制、编辑；持有此密码可解除限制">
            <PasswordInput value={owner} onChange={setOwner} label="权限密码" placeholder="不设置可留空" disabled={c.running} />
          </Field>
          {owner && (
            <Field label="允许的操作">
              <div style={{ display: 'grid', gap: 10 }}>
                <Toggle checked={print} onChange={setPrint} label="允许打印" disabled={c.running} />
                <Toggle checked={copy} onChange={setCopy} label="允许复制文字和图片" disabled={c.running} />
                <Toggle checked={modify} onChange={setModify} label="允许编辑内容" disabled={c.running} />
                <Toggle checked={annotate} onChange={setAnnotate} label="允许添加批注、填写表单" disabled={c.running} />
              </div>
            </Field>
          )}
          <div className="tip warn">
            <ShieldCheck size={15} />
            <span>使用 AES-256 加密。请牢记密码，忘记后将无法打开文件。</span>
          </div>
        </>
      )}
      buildJob={(f, dir) => ({
        type: 'pdf-encrypt',
        path: f.path,
        openPassword: open,
        ownerPassword: owner,
        allowPrint: print,
        allowCopy: copy,
        allowModify: modify,
        allowAnnotate: annotate,
        output: { dir },
        fileName: `${stemOf(f.name)}_已加密`
      })}
    />
  )
}

export function PdfDecryptTool({ tool, initialFiles, onBack }: Props) {
  const [file, setFile] = useState<FileInfo | null>(null)
  const state = useEncryption(file)
  const [password, setPassword] = useState('')
  return (
    <SinglePdfTool
      tool={tool}
      initialFiles={initialFiles}
      onBack={onBack}
      onFileChange={(f) => {
        setFile(f)
        setPassword('')
      }}
      lenient
      runLabel={state === 'restricted' ? '解除限制' : '移除密码'}
      hint="输入密码后移除，以后打开无需再输入；只限制了权限的文件无需密码即可解除"
      info={() => stateTip(state)}
      validate={() => {
        if (state === null) return '正在检查文件…'
        if (state === 'none') return '这个文件没有加密，不需要解密'
        if (state === 'open' && !password) return '请输入打开密码'
        return undefined
      }}
      options={(c) =>
        state === 'open' ? (
          <Field label="打开密码" hint="需要知道正确的密码才能移除">
            <PasswordInput value={password} onChange={setPassword} label="密码" disabled={c.running} />
          </Field>
        ) : state === 'restricted' ? (
          <div className="tip">
            <ShieldCheck size={15} />
            <span>解除后可以正常打印、复制和编辑。</span>
          </div>
        ) : null
      }
      buildJob={(f, dir) => ({ type: 'pdf-decrypt', path: f.path, password, output: { dir }, fileName: `${stemOf(f.name)}_已解密` })}
    />
  )
}

const LEVELS: { value: CompressLevel; title: string; desc: string }[] = [
  { value: 'low', title: '无损优化', desc: '只优化文件结构，画质完全不变' },
  { value: 'medium', title: '标准压缩（推荐）', desc: '图片适度压缩，阅读和打印不受影响' },
  { value: 'high', title: '强力压缩', desc: '体积最小，适合发送和上传，图片略有损失' }
]

export function PdfCompressTool({ tool, initialFiles, onBack }: Props) {
  const [level, setLevel] = useState<CompressLevel>('medium')
  return (
    <SinglePdfTool
      tool={tool}
      initialFiles={initialFiles}
      onBack={onBack}
      runLabel="开始压缩"
      hint="减小 PDF 体积，扫描件和图片多的文件效果最明显"
      info={(c) => (c.file ? <div className="tip">当前大小 <b>{formatBytes(c.file.size)}</b>，压缩完成后会显示压缩效果</div> : null)}
      options={(c) => (
        <Field label="压缩强度">
          <div className="option-cards" role="radiogroup">
            {LEVELS.map((l) => (
              <div
                key={l.value}
                className={`option-card${level === l.value ? ' on' : ''}`}
                onClick={() => !c.running && setLevel(l.value)}
                role="radio"
                aria-checked={level === l.value}
                tabIndex={0}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setLevel(l.value)}
                data-level={l.value}
              >
                <span className="radio" />
                <div>
                  <div className="oc-title">{l.title}</div>
                  <div className="oc-desc">{l.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </Field>
      )}
      buildJob={(f, dir) => ({ type: 'pdf-compress', path: f.path, level, output: { dir }, fileName: `${stemOf(f.name)}_压缩` })}
    />
  )
}

export function PdfRepairTool({ tool, initialFiles, onBack }: Props) {
  return (
    <SinglePdfTool
      tool={tool}
      initialFiles={initialFiles}
      onBack={onBack}
      lenient
      runLabel="开始修复"
      hint="打不开、提示已损坏的 PDF，尝试重建文件结构并恢复页面"
      info={() => (
        <div className="tip">
          <span>修复会重建文件结构并逐页恢复内容，原文件保持不变。</span>
        </div>
      )}
      options={() => null}
      buildJob={(f, dir) => ({ type: 'pdf-repair', path: f.path, output: { dir }, fileName: `${stemOf(f.name)}_已修复` })}
    />
  )
}
