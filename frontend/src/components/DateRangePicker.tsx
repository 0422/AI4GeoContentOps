// 2026-10-23：本次修改原因：将开始和结束日期收进一个可确认的弹层，并保留完整悬停提示。
import { useEffect, useRef, useState } from 'react'

type Props = {
  start: string
  end: string
  onConfirm: (start: string, end: string) => void
  withTime?: boolean
  requireDifferentDays?: boolean
}

function localDay(offset: number): string {
  const value = new Date()
  value.setDate(value.getDate() + offset)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function display(value: string, withTime: boolean): string {
  const [day, time] = value.split(' ')
  return `${day?.replaceAll('-', '/') ?? ''}${withTime ? ` ${time || '00:00:00'}` : ''}`
}

export default function DateRangePicker({ start, end, onConfirm, withTime = false, requireDifferentDays = false }: Props) {
  const [open, setOpen] = useState(false)
  const [draftStart, setDraftStart] = useState(start)
  const [draftEnd, setDraftEnd] = useState(end)
  const [month, setMonth] = useState(() => new Date(`${start.slice(0, 10)}T12:00:00`))
  const [selectingEnd, setSelectingEnd] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const startDay = draftStart.slice(0, 10)
  const endDay = draftEnd.slice(0, 10)
  const startTime = withTime ? (draftStart.split(' ')[1] || '00:00:00').slice(0, 5) : ''
  const endTime = withTime ? (draftEnd.split(' ')[1] || '23:59:59').slice(0, 5) : ''

  useEffect(() => {
    if (!open) return
    function dismiss(event: MouseEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') setOpen(false)
      } else if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', dismiss)
    document.addEventListener('keydown', dismiss)
    return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', dismiss) }
  }, [open])

  function applyPreset(days: number | 'today') {
    const last = localDay(0)
    const first = days === 'today' ? last : localDay(days === 1 ? -1 : 1 - days)
    // 2026-10-23：本次修改原因：有时间精度时“近 24 小时”使用实际滚动窗口。
    const rollingStart = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const rollingEnd = new Date()
    const clock = (value: Date) => `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}:${String(value.getSeconds()).padStart(2, '0')}`
    setDraftStart(`${first}${withTime ? ` ${days === 1 ? clock(rollingStart) : '00:00:00'}` : ''}`)
    setDraftEnd(`${last}${withTime ? ` ${days === 1 ? clock(rollingEnd) : '23:59:59'}` : ''}`)
    setMonth(new Date(`${first}T12:00:00`))
    setSelectingEnd(false)
  }

  function chooseDay(day: string) {
    if (!selectingEnd || day < startDay) {
      setDraftStart(`${day}${withTime ? ` ${startTime}:00` : ''}`)
      setDraftEnd(`${day}${withTime ? ` ${endTime}:00` : ''}`)
      setSelectingEnd(true)
    } else {
      setDraftEnd(`${day}${withTime ? ` ${endTime}:00` : ''}`)
      setSelectingEnd(false)
    }
  }

  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1)
  const firstCell = new Date(monthStart)
  firstCell.setDate(firstCell.getDate() - firstCell.getDay())
  const days = Array.from({ length: 42 }, (_, index) => {
    const value = new Date(firstCell)
    value.setDate(value.getDate() + index)
    const day = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
    return { day, number: value.getDate(), outside: value.getMonth() !== month.getMonth() }
  })
  const fullLabel = `${display(start, withTime)} ~ ${display(end, withTime)}`

  return <div className="dateRangePicker" ref={root}>
    <button type="button" className="dateRangeTrigger" title={fullLabel} aria-expanded={open} onClick={() => {
      setDraftStart(start); setDraftEnd(end); setMonth(new Date(`${start.slice(0, 10)}T12:00:00`)); setOpen(!open)
    }}><span aria-hidden="true">▦</span><span className="dateRangeText">{fullLabel}</span>
      {/* <span aria-hidden="true">⌄</span> 2026-10-24：原文字下拉箭头留作对照。 */}
      {/* 2026-10-24：本次修改原因：日期箭头改由与采集筛选框共用的样式绘制。 */}
    </button>
    {open && <div className="dateRangePopover" role="dialog" aria-label="选择日期范围">
      <div className="dateRangePresets">{([...(requireDifferentDays ? [] : [['当天', 'today'] as const]), ['近 24 小时', 1], ['近 7 天', 7], ['近 14 天', 14], ['近 30 天', 30]] as const).map(([label, value]) =>
        <button key={label} type="button" onClick={() => applyPreset(value)}>{label}</button>)}</div>
      <div className="dateRangeBody">
        <div className="dateRangeInputs">
          <label>开始时间<input type="date" value={startDay} max={endDay} onChange={(event) => setDraftStart(`${event.target.value}${withTime ? ` ${startTime}:00` : ''}`)} />
            {withTime && <input type="time" value={startTime} onChange={(event) => setDraftStart(`${startDay} ${event.target.value}:00`)} />}</label>
          <label>结束时间<input type="date" value={endDay} min={startDay} onChange={(event) => setDraftEnd(`${event.target.value}${withTime ? ` ${endTime}:00` : ''}`)} />
            {withTime && <input type="time" value={endTime} onChange={(event) => setDraftEnd(`${endDay} ${event.target.value}:00`)} />}</label>
          <div className="dateRangeButtons"><button type="button" onClick={() => setOpen(false)}>取消</button>
            <button type="button" className="primaryButton" disabled={!startDay || !endDay || draftStart > draftEnd || (requireDifferentDays && startDay === endDay)} onClick={() => {
              onConfirm(draftStart, draftEnd); setOpen(false)
            }}>确定</button></div>
        </div>
        <div className="dateRangeCalendar"><div className="dateRangeMonth"><button type="button" aria-label="上个月" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
          <strong>{month.getFullYear()}年{month.getMonth() + 1}月</strong>
          <button type="button" aria-label="下个月" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button></div>
          <div className="dateRangeGrid">{'日一二三四五六'.split('').map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
            {days.map(({ day, number, outside }) => <button key={day} type="button" className={`${outside ? 'outside' : ''} ${day >= startDay && day <= endDay ? 'inRange' : ''} ${day === startDay || day === endDay ? 'edge' : ''}`}
              onClick={() => chooseDay(day)}>{number}</button>)}</div></div>
      </div>
    </div>}
  </div>
}
