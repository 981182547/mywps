import { Check } from 'lucide-react'

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  format = (v) => String(v),
  label,
  disabled
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  format?: (v: number) => string
  label: string
  disabled?: boolean
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="slider-row">
      <input
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ '--pct': `${pct}%` } as React.CSSProperties}
        aria-label={label}
        disabled={disabled}
      />
      <span className="slider-value">{format(value)}</span>
    </div>
  )
}

const SWATCHES = ['#9ca3af', '#111827', '#e11d48', '#2563eb', '#059669', '#d97706']

export function ColorPicker({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const custom = !SWATCHES.includes(value.toLowerCase())
  return (
    <div className="swatches" role="radiogroup" aria-label="颜色">
      {SWATCHES.map((c) => (
        <button
          key={c}
          className={`swatch${value.toLowerCase() === c ? ' on' : ''}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
          aria-label={c}
          role="radio"
          aria-checked={value.toLowerCase() === c}
          disabled={disabled}
        >
          {value.toLowerCase() === c && <Check size={13} />}
        </button>
      ))}
      <label className={`swatch custom${custom ? ' on' : ''}`} title="自定义颜色" style={custom ? { background: value } : undefined}>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
        {custom && <Check size={13} />}
      </label>
    </div>
  )
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={`toggle${disabled ? ' disabled' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span className="track">
        <span className="knob" />
      </span>
      {label}
    </label>
  )
}
