import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { transactionApi, type Transaction, type MonthlySummary } from '../api'
import { TxnDetailSheet } from '../components/TxnDetailSheet'
import { PeriodPickerSheet } from '../components/PeriodPickerSheet'
import { TransactionCard } from '../components/TransactionCard'

export default function HomePage() {
  const navigate = useNavigate()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [summary, setSummary] = useState<MonthlySummary | null>(null)
  const [selected, setSelected] = useState<Transaction | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const now = dayjs()
  const [viewDate, setViewDate] = useState(now.startOf('month'))
  const year = viewDate.year()
  const month = viewDate.month() + 1
  const isCurrentMonth = viewDate.isSame(now, 'month')

  const load = () => {
    transactionApi.list({ year, month }).then(r => setTransactions(r.data))
    transactionApi.monthlySummary(year).then(r => {
      const key = `${year}-${String(month).padStart(2, '0')}`
      setSummary(r.data.find(s => s.month === key) || { month: key, total_income: 0, total_expense: 0, balance: 0 })
    })
  }

  useEffect(() => { load() }, [year, month])

  const handleDelete = async (txn: Transaction) => {
    if (!confirm(`确认删除这条记录？`)) return
    await transactionApi.delete(txn.id)
    setSelected(null)
    load()
  }

  const handleEdit = (txn: Transaction) => {
    setSelected(null)
    navigate(`/add?id=${txn.id}`)
  }

  // Group transactions by date
  const grouped = transactions.reduce<Record<string, Transaction[]>>((acc, txn) => {
    const d = txn.date
    if (!acc[d]) acc[d] = []
    acc[d].push(txn)
    return acc
  }, {})

  const dayName = (d: string) => ['周日','周一','周二','周三','周四','周五','周六'][dayjs(d).day()]

  return (
    <div className="page-content">
      <div className="summary-header" style={{ position: 'relative' }}>
        <button
          onClick={() => navigate('/search')}
          aria-label="搜索账单"
          style={{
            position: 'absolute', top: 12, right: 12,
            width: 32, height: 32, padding: 0,
            background: 'transparent', border: 'none',
            color: 'white', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
        <div className="month-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <button onClick={() => setViewDate(d => d.subtract(1, 'month'))}
            style={{ background: 'none', border: 'none', fontSize: 22, color: 'white', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>‹</button>
          <button
            onClick={() => setPickerOpen(true)}
            style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4, font: 'inherit' }}
          >
            <span>{year}年{month}月</span>
            <span style={{ fontSize: 12, opacity: 0.8 }}>▾</span>
          </button>
          <button onClick={() => setViewDate(d => d.add(1, 'month'))}
            disabled={isCurrentMonth}
            style={{ background: 'none', border: 'none', fontSize: 22, color: isCurrentMonth ? 'rgba(255,255,255,0.3)' : 'white', cursor: isCurrentMonth ? 'default' : 'pointer', lineHeight: 1, padding: '0 4px' }}>›</button>
        </div>
        <div className="balance">
          <div className="label">本月结余</div>
          {summary ? `¥${summary.balance.toFixed(2)}` : '¥0.00'}
        </div>
        <div className="row">
          <div className="item">
            <div className="label">收入</div>
            <div className="value">¥{summary?.total_income.toFixed(2) || '0.00'}</div>
          </div>
          <div className="item">
            <div className="label">支出</div>
            <div className="value">¥{summary?.total_expense.toFixed(2) || '0.00'}</div>
          </div>
        </div>
      </div>

      <div className="txn-list">
        {Object.keys(grouped).length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📝</div>
            <div>本月还没有记录</div>
            <div style={{ marginTop: 8, fontSize: 14 }}>点击下方 + 开始记账</div>
          </div>
        ) : (
          Object.entries(grouped).map(([date, txns]) => (
            <div key={date} className="txn-date-group">
              <div className="date-header">
                {dayjs(date).format('MM月DD日')} {dayName(date)}
              </div>
              {txns.map(txn => (
                <TransactionCard key={txn.id} txn={txn} onClick={setSelected} />
              ))}
            </div>
          ))
        )}
      </div>

      {selected && (
        <TxnDetailSheet
          txn={selected}
          onClose={() => setSelected(null)}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      )}

      <PeriodPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        mode="month"
        year={year}
        month={month}
        onChange={(y, m) => setViewDate(dayjs().year(y).month((m || 1) - 1).startOf('month'))}
      />
    </div>
  )
}
