import { useState } from 'react'
import { parseRanges } from '../../../shared/ranges'
import type { FileInfo, OcrLang } from '../../../shared/types'
import { ImageBatchTool } from './ImageBatchTool'
import { SinglePdfTool, type SingleCtx } from './SinglePdfTool'
import { Field, Segmented } from './ToolLayout'
import type { ToolDef } from './registry'

interface Props {
  tool: ToolDef
  initialFiles?: FileInfo[]
  onBack: () => void
}

const LANGS: { value: OcrLang; label: string }[] = [
  { value: 'chi', label: '中文（含英文）' },
  { value: 'eng', label: '纯英文' }
]

export function OcrImageTool(p: Props) {
  const [lang, setLang] = useState<OcrLang>('chi')
  const [format, setFormat] = useState<'each' | 'merged' | 'docx'>('merged')
  return (
    <ImageBatchTool
      {...p}
      runLabel="开始识别"
      hint="截图、照片、扫描件中的文字都可以识别，完全在本机完成"
      options={() => (
        <>
          <Field label="识别语言">
            <Segmented value={lang} onChange={setLang} options={LANGS} />
          </Field>
          <Field label="保存为" hint="识别完成后也可以在右侧直接复制文字">
            <Segmented
              value={format}
              onChange={setFormat}
              options={[
                { value: 'merged', label: '一个 TXT' },
                { value: 'each', label: '每张一个' },
                { value: 'docx', label: 'Word' }
              ]}
            />
          </Field>
          <div className="tip">
            <span>图片越清晰、文字越端正，识别越准确。手机拍照时尽量对齐页面、避免反光。</span>
          </div>
        </>
      )}
      buildJob={(paths, dir) => ({ type: 'ocr-images', paths, lang, format, output: { dir } })}
    />
  )
}

function rangeError(ranges: string, c: SingleCtx): string | undefined {
  if (!c.handle || !ranges.trim()) return undefined
  try {
    parseRanges(ranges, c.handle.pageCount)
    return undefined
  } catch (e) {
    return (e as Error).message
  }
}

export function OcrPdfTool(p: Props) {
  const [lang, setLang] = useState<OcrLang>('chi')
  const [format, setFormat] = useState<'searchable' | 'txt' | 'docx'>('searchable')
  const [ranges, setRanges] = useState('')
  return (
    <SinglePdfTool
      {...p}
      runLabel="开始识别"
      hint="扫描件、拍照生成的 PDF 转为可搜索、可复制文字的 PDF，或导出为文字"
      validate={(c) => rangeError(ranges, c)}
      info={() => (
        <div className="tip">
          <span>每页约需几秒钟。生成的“可搜索 PDF”外观与原文件完全相同，但可以搜索和复制文字。</span>
        </div>
      )}
      options={(c) => {
        const err = rangeError(ranges, c)
        return (
          <>
            <Field label="识别语言">
              <Segmented value={lang} onChange={setLang} options={LANGS} />
            </Field>
            <Field label="输出">
              <Segmented
                value={format}
                onChange={setFormat}
                options={[
                  { value: 'searchable', label: '可搜索 PDF' },
                  { value: 'docx', label: 'Word' },
                  { value: 'txt', label: 'TXT' }
                ]}
              />
            </Field>
            <Field label="页面范围" hint={err ? <span style={{ color: 'var(--danger)' }}>{err}</span> : '留空表示全部页面'}>
              <input className={`input${err ? ' invalid' : ''}`} value={ranges} onChange={(e) => setRanges(e.target.value)} placeholder="全部页面" aria-label="页面范围" disabled={c.running} />
            </Field>
          </>
        )
      }}
      buildJob={(f, dir) => ({ type: 'ocr-pdf', path: f.path, lang, format, ranges: ranges.trim() || undefined, output: { dir } })}
    />
  )
}
