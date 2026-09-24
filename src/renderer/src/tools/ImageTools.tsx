import { useState } from 'react'
import type { FileInfo, ImageFormat } from '../../../shared/types'
import { ImageBatchTool } from './ImageBatchTool'
import { Field, Segmented } from './ToolLayout'
import { ColorPicker, Slider, Toggle } from './controls'
import type { ToolDef } from './registry'

interface Props {
  tool: ToolDef
  initialFiles?: FileInfo[]
  onBack: () => void
}

const FORMATS: { value: ImageFormat; label: string; desc: string }[] = [
  { value: 'jpg', label: 'JPG', desc: '通用' },
  { value: 'png', label: 'PNG', desc: '无损透明' },
  { value: 'webp', label: 'WEBP', desc: '体积小' },
  { value: 'avif', label: 'AVIF', desc: '新一代' },
  { value: 'bmp', label: 'BMP', desc: '位图' },
  { value: 'tiff', label: 'TIFF', desc: '印刷' },
  { value: 'ico', label: 'ICO', desc: '图标' },
  { value: 'gif', label: 'GIF', desc: '静态' }
]
const LOSSY: ImageFormat[] = ['jpg', 'webp', 'avif']
const OPAQUE: ImageFormat[] = ['jpg', 'bmp']

export function ImageConvertTool({ tool, initialFiles, onBack }: Props) {
  const [format, setFormat] = useState<ImageFormat>('jpg')
  const [quality, setQuality] = useState(90)
  const [background, setBackground] = useState('#ffffff')
  return (
    <ImageBatchTool
      tool={tool}
      initialFiles={initialFiles}
      onBack={onBack}
      runLabel="开始转换"
      hint="支持 JPG、PNG、WEBP、HEIC（苹果照片）、BMP、TIFF、GIF 等格式，可批量转换"
      options={(running) => (
        <>
          <Field label="转换为">
            <div className="format-grid" role="radiogroup">
              {FORMATS.map((f) => (
                <button key={f.value} className={format === f.value ? 'on' : ''} onClick={() => setFormat(f.value)} role="radio" aria-checked={format === f.value} disabled={running} data-format={f.value}>
                  {f.label}
                  <small>{f.desc}</small>
                </button>
              ))}
            </div>
          </Field>
          {LOSSY.includes(format) && (
            <Field label="图片质量" hint="数值越高越清晰，文件也越大">
              <Slider value={quality} min={40} max={100} onChange={setQuality} format={(v) => `${v}%`} label="图片质量" disabled={running} />
            </Field>
          )}
          {OPAQUE.includes(format) && (
            <Field label="透明部分填充颜色" hint={`${format.toUpperCase()} 不支持透明背景`}>
              <ColorPicker value={background} onChange={setBackground} disabled={running} />
            </Field>
          )}
          {format === 'ico' && <div className="tip">生成包含 16 ~ 256 像素多种尺寸的图标文件，可直接用作软件或网站图标。</div>}
        </>
      )}
      buildJob={(paths, dir) => ({ type: 'image-convert', paths, format, quality, background, output: { dir } })}
    />
  )
}

const TARGETS = [100, 200, 500, 1024]

export function ImageCompressTool({ tool, initialFiles, onBack }: Props) {
  const [mode, setMode] = useState<'quality' | 'target'>('quality')
  const [quality, setQuality] = useState(75)
  const [target, setTarget] = useState('200')
  const [limitWidth, setLimitWidth] = useState(false)
  const [maxWidth, setMaxWidth] = useState('1920')
  const targetNum = Number(target)
  const widthNum = Number(maxWidth)
  return (
    <ImageBatchTool
      tool={tool}
      initialFiles={initialFiles}
      onBack={onBack}
      runLabel="开始压缩"
      hint="保持原格式压缩；HEIC、BMP、TIFF 会转为 JPG。压缩后不会比原图更大"
      validate={() => {
        if (mode === 'target' && !(targetNum >= 5 && targetNum <= 100000)) return '目标大小需在 5 ~ 100000 KB 之间'
        if (limitWidth && !(Number.isInteger(widthNum) && widthNum >= 16 && widthNum <= 30000)) return '最大宽度需在 16 ~ 30000 像素之间'
        return undefined
      }}
      options={(running) => (
        <>
          <Field label="压缩方式">
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: 'quality', label: '按清晰度' },
                { value: 'target', label: '指定大小' }
              ]}
            />
          </Field>
          {mode === 'quality' ? (
            <Field label="清晰度" hint={quality >= 85 ? '清晰度优先，体积减小较少' : quality >= 65 ? '推荐：肉眼几乎看不出差别' : '体积优先，细节会有损失'}>
              <Slider value={quality} min={30} max={95} onChange={setQuality} format={(v) => `${v}%`} label="清晰度" disabled={running} />
            </Field>
          ) : (
            <Field label="每张图片不超过" hint="自动寻找满足大小的最高清晰度，必要时缩小尺寸">
              <div className="input-suffix">
                <input className={`input${targetNum >= 5 ? '' : ' invalid'}`} type="number" min={5} value={target} onChange={(e) => setTarget(e.target.value)} aria-label="目标大小" disabled={running} />
                <span>KB</span>
              </div>
              <div className="quick-chips">
                {TARGETS.map((t) => (
                  <button key={t} className={targetNum === t ? 'on' : ''} onClick={() => setTarget(String(t))} disabled={running}>
                    {t >= 1024 ? `${t / 1024} MB` : `${t} KB`}
                  </button>
                ))}
              </div>
            </Field>
          )}
          <Toggle checked={limitWidth} onChange={setLimitWidth} label="同时限制最大宽度" disabled={running} />
          {limitWidth && (
            <div className="input-suffix">
              <input className="input" type="number" value={maxWidth} onChange={(e) => setMaxWidth(e.target.value)} aria-label="最大宽度" disabled={running} />
              <span>像素</span>
            </div>
          )}
        </>
      )}
      buildJob={(paths, dir) => ({
        type: 'image-compress',
        paths,
        mode,
        quality,
        targetKB: targetNum,
        maxWidth: limitWidth ? widthNum : undefined,
        output: { dir }
      })}
    />
  )
}

type ResizeMode = 'percent' | 'width' | 'height' | 'box'
const PRESETS = [
  { label: '一寸照', sub: '295 × 413', w: 295, h: 413 },
  { label: '二寸照', sub: '413 × 579', w: 413, h: 579 },
  { label: '小二寸', sub: '413 × 531', w: 413, h: 531 },
  { label: '大一寸', sub: '390 × 567', w: 390, h: 567 },
  { label: '1080P', sub: '1920 × 1080', w: 1920, h: 1080 },
  { label: '正方形头像', sub: '800 × 800', w: 800, h: 800 }
]

export function ImageResizeTool({ tool, initialFiles, onBack }: Props) {
  const [mode, setMode] = useState<ResizeMode>('percent')
  const [percent, setPercent] = useState(50)
  const [width, setWidth] = useState('1280')
  const [height, setHeight] = useState('720')
  const [fit, setFit] = useState<'contain' | 'cover' | 'fill'>('cover')
  const [background, setBackground] = useState('#ffffff')
  const [format, setFormat] = useState<'keep' | 'jpg' | 'png'>('keep')
  const w = Number(width)
  const h = Number(height)
  const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= 30000
  return (
    <ImageBatchTool
      tool={tool}
      initialFiles={initialFiles}
      onBack={onBack}
      runLabel="调整尺寸"
      hint="按比例、宽度、高度或指定尺寸缩放，内置证件照常用尺寸"
      validate={() => {
        if ((mode === 'width' || mode === 'box') && !valid(w)) return '宽度需在 1 ~ 30000 像素之间'
        if ((mode === 'height' || mode === 'box') && !valid(h)) return '高度需在 1 ~ 30000 像素之间'
        return undefined
      }}
      options={(running) => (
        <>
          <Field label="调整方式">
            <Segmented<ResizeMode>
              value={mode}
              onChange={setMode}
              options={[
                { value: 'percent', label: '按比例' },
                { value: 'width', label: '按宽度' },
                { value: 'height', label: '按高度' },
                { value: 'box', label: '指定尺寸' }
              ]}
            />
          </Field>
          {mode === 'percent' && (
            <Field label="缩放比例">
              <Slider value={percent} min={5} max={200} step={5} onChange={setPercent} format={(v) => `${v}%`} label="缩放比例" disabled={running} />
            </Field>
          )}
          {mode === 'width' && (
            <Field label="宽度" hint="高度按原图比例自动计算">
              <div className="input-suffix">
                <input className={`input${valid(w) ? '' : ' invalid'}`} type="number" value={width} onChange={(e) => setWidth(e.target.value)} aria-label="宽度" disabled={running} />
                <span>像素</span>
              </div>
            </Field>
          )}
          {mode === 'height' && (
            <Field label="高度" hint="宽度按原图比例自动计算">
              <div className="input-suffix">
                <input className={`input${valid(h) ? '' : ' invalid'}`} type="number" value={height} onChange={(e) => setHeight(e.target.value)} aria-label="高度" disabled={running} />
                <span>像素</span>
              </div>
            </Field>
          )}
          {mode === 'box' && (
            <>
              <Field label="常用尺寸">
                <div className="preset-grid">
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      className={w === p.w && h === p.h ? 'on' : ''}
                      onClick={() => {
                        setWidth(String(p.w))
                        setHeight(String(p.h))
                      }}
                      disabled={running}
                    >
                      {p.label}
                      <small>{p.sub}</small>
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="宽 × 高（像素）">
                <div className="dim-row">
                  <input className={`input${valid(w) ? '' : ' invalid'}`} type="number" value={width} onChange={(e) => setWidth(e.target.value)} aria-label="宽度" disabled={running} />
                  <span>×</span>
                  <input className={`input${valid(h) ? '' : ' invalid'}`} type="number" value={height} onChange={(e) => setHeight(e.target.value)} aria-label="高度" disabled={running} />
                </div>
              </Field>
              <Field label="比例不一致时" hint={fit === 'cover' ? '居中裁掉多余部分，适合证件照' : fit === 'contain' ? '完整保留画面，空白处填充颜色' : '直接拉伸，画面可能变形'}>
                <Segmented
                  value={fit}
                  onChange={setFit}
                  options={[
                    { value: 'cover', label: '裁剪填满' },
                    { value: 'contain', label: '完整留白' },
                    { value: 'fill', label: '拉伸' }
                  ]}
                />
              </Field>
              {fit === 'contain' && (
                <Field label="留白颜色">
                  <ColorPicker value={background} onChange={setBackground} disabled={running} />
                </Field>
              )}
            </>
          )}
          <Field label="输出格式">
            <Segmented
              value={format}
              onChange={setFormat}
              options={[
                { value: 'keep', label: '保持原格式' },
                { value: 'jpg', label: 'JPG' },
                { value: 'png', label: 'PNG' }
              ]}
            />
          </Field>
        </>
      )}
      buildJob={(paths, dir) => ({
        type: 'image-resize',
        paths,
        mode,
        percent,
        width: w,
        height: h,
        fit,
        background,
        format: format === 'keep' ? undefined : format,
        output: { dir }
      })}
    />
  )
}
