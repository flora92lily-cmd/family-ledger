import { useEffect, useRef, useState } from 'react'
import dayjs from 'dayjs'

interface Props {
  open: boolean
  onClose: () => void
  mode: 'month' | 'year'
  year: number
  month?: number
  onChange: (year: number, month?: number) => void
  minYear?: number
}

export function PeriodPickerSheet({ open, onClose, mode, year, month, onChange, minYear }: Props) {
  const now = dayjs()
  const currentYear = now.year()
  const currentMonth = now.month() + 1
  const startYear = minYear ?? currentYear - 10
  const [draftYear, setDraftYear] = useState(year)
  const yearRowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) setDraftYear(year)
  }, [open, year])

  useEffect(() => {
    if (!open) return
    const el = yearRowRef.current?.querySelector<HTMLButtonElement>(`[data-year="${draftYear}"]`)
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' })
  }, [open, draftYear])

  if (!open) return null

  const years: number[] = []
  for (let y = currentYear; y >= startYear; y--) years.push(y)
  const months = Array.from({ length: 12 }, (_, i) => i + 1)

  const isMonthDisabled = (y: number, m: number) => y > currentYear || (y === currentYear && m > currentMonth)
  const isYearDisabled = (y: number) => y > currentYear

  const pickMonth = (m: number) => {
    if (isMonthDisabled(draftYear, m)) return
    onChange(draftYear, m)
    onClose()
  }
  const pickYear = (y: number) => {
    if (isYearDisabled(y)) return
    onChange(y)
    onClose()
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 300, display: 'flex', alignItems: 'flex-end' }}
      onClick={onClose}
    >
      <div
        style={{ width: '100%', background: 'white', borderRadius: '20px 20px 0 0', padding: '20px 16px 28px', maxHeight: '72vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: '#333' }}>
            {mode === 'month' ? '选择月份' : '选择年份'}
          </span>
          <button
            onClick={() => {
              if (mode === 'month') onChange(currentYear, currentMonth)
              else onChange(currentYear)
              onClose()
            }}
            style={{ background: '#f3f4f6', border: 'none', padding: '5px 14px', borderRadius: 14, fontSize: 13, color: '#333', cursor: 'pointer' }}
          >
            {mode === 'month' ? '本月' : '今年'}
          </button>
        </div>

        {/* Year row */}
        <div
          ref={yearRowRef}
          style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6, WebkitOverflowScrolling: 'touch' }}
        >
          {years.map(y => {
            const active = mode === 'month' ? y === draftYear : y === year
            const disabled = isYearDisabled(y)
            return (
              <button
                key={y}
                data-year={y}
                disabled={disabled}
                onClick={() => (mode === 'month' ? setDraftYear(y) : pickYear(y))}
                style={{
                  flexShrink: 0,
                  minWidth: 70,
                  padding: '9px 14px',
                  borderRadius: 10,
                  border: 'none',
                  background: active ? '#2196F3' : '#f3f4f6',
                  color: disabled ? '#ccc' : active ? '#fff' : '#333',
                  fontSize: 14,
                  fontWeight: active ? 600 : 400,
                  cursor: disabled ? 'default' : 'pointer',
                }}
              >
                {y}
              </button>
            )
          })}
        </div>

        {/* Month grid (month mode only) */}
        {mode === 'month' && (
          <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {months.map(m => {
              const active = draftYear === year && m === month
              const disabled = isMonthDisabled(draftYear, m)
              const isCurrent = draftYear === currentYear && m === currentMonth
              return (
                <button
                  key={m}
                  disabled={disabled}
                  onClick={() => pickMonth(m)}
                  style={{
                    padding: '14px 0',
                    borderRadius: 10,
                    border: active ? '2px solid #2196F3' : '1px solid #e5e7eb',
                    background: active ? '#e3f2fd' : '#fff',
                    color: disabled ? '#ccc' : '#333',
                    fontSize: 14,
                    fontWeight: active ? 600 : 400,
                    cursor: disabled ? 'default' : 'pointer',
                    position: 'relative',
                  }}
                >
                  {m}月
                  {isCurrent && !active && (
                    <span style={{ position: 'absolute', top: 4, right: 8, width: 6, height: 6, background: '#2196F3', borderRadius: '50%' }} />
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
