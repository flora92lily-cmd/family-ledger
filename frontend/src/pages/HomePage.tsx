import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { transactionApi, reimbursementApi, type Transaction, type MonthlySummary, type ReimbursementRecord } from '../api'
import { BankIcon } from '../components/BankIcon'

export default function HomePage() {
  const navigate = useNavigate()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [summary, setSummary] = useState<MonthlySummary | null>(null)
  const [selected, setSelected] = useState<Transaction | null>(null)
  const [linkedRecord, setLinkedRecord] = useState<ReimbursementRecord | null>(null)
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

  // 打开详情时，若交易已报销则查找关联的报销记录
  useEffect(() => {
    if (!selected || selected.reimbursement_status !== 'done') {
      setLinkedRecord(null)
      return
    }
    let cancelled = false
    reimbursementApi.list().then(r => {
      if (cancelled) return
      const rec = r.data.find(rec => rec.items.some(it => it.transaction_id === selected.id))
      setLinkedRecord(rec || null)
    })
    return () => { cancelled = true }
  }, [selected])

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

  // 列表行 icon：转账固定 🔄，其他用分类 icon 兜底💰
  const txnIcon = (txn: Transaction) =>
    txn.type === 'transfer' ? '🔄' : txn.category?.icon || '💰'

  // 列表第一行：分类名（转账特殊处理）
  const txnTitle = (txn: Transaction) => {
    if (txn.type === 'transfer') return txn.description || '转账'
    return txn.category?.name || '未分类'
  }

  // 列表第二行：备注（如有） + 家庭成员
  const txnSubMeta = (txn: Transaction) => {
    const parts: string[] = []
    if (txn.description) parts.push(txn.description)
    if (txn.member) parts.push(`${txn.member.avatar}${txn.member.name}`)
    return parts.join(' · ')
  }

  // 右侧第二行：账户（转账显示 from→to）
  const txnAccountEl = (txn: Transaction) => {
    if (txn.type === 'transfer') {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          {txn.account ? <><BankIcon icon={txn.account.icon} size={14} />{txn.account.name}</> : '?'}
          <span style={{ margin: '0 2px' }}>→</span>
          {txn.to_account ? <><BankIcon icon={txn.to_account.icon} size={14} />{txn.to_account.name}</> : '?'}
        </span>
      )
    }
    return txn.account ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><BankIcon icon={txn.account.icon} size={14} />{txn.account.name}</span> : null
  }

  const txnAmountStr = (txn: Transaction) => {
    const v = `¥${txn.amount.toFixed(2)}`
    if (txn.type === 'transfer') return v
    return (txn.type === 'expense' ? '-' : '+') + v
  }

  const txnAmountColor = (txn: Transaction) => {
    if (txn.type === 'transfer') return '#6366f1'
    return txn.type === 'expense' ? '#ef4444' : '#22c55e'
  }

  return (
    <div className="page-content">
      <div className="summary-header">
        <div className="month-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <button onClick={() => setViewDate(d => d.subtract(1, 'month'))}
            style={{ background: 'none', border: 'none', fontSize: 22, color: 'white', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>‹</button>
          <span>{year}年{month}月</span>
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
              {txns.map(txn => {
                const subMeta = txnSubMeta(txn)
                const accountEl = txnAccountEl(txn)
                return (
                  <div key={txn.id} className="txn-item" onClick={() => setSelected(txn)}>
                    <div className="icon">{txnIcon(txn)}</div>
                    <div className="info">
                      <div className="desc" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>{txnTitle(txn)}</span>
                        {txn.is_reimbursable && txn.reimbursement_status === 'pending' && (
                          <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, background: '#fef3c7', color: '#b45309', fontWeight: 500 }}>
                            待报销
                          </span>
                        )}
                        {txn.is_reimbursable && txn.reimbursement_status === 'done' && (
                          <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, background: '#dcfce7', color: '#15803d', fontWeight: 500 }}>
                            已报销
                          </span>
                        )}
                      </div>
                      {subMeta && <div className="meta">{subMeta}</div>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 0 }}>
                      <div className="amount" style={{ color: txnAmountColor(txn) }}>
                        {txnAmountStr(txn)}
                      </div>
                      {accountEl && (
                        <div className="meta" style={{ marginTop: 2, fontSize: 11, color: '#9ca3af', maxWidth: 160, overflow: 'hidden', whiteSpace: 'nowrap' }}>
                          {accountEl}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>

      {/* 交易详情底部弹窗 */}
      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}
          onClick={() => setSelected(null)}>
          <div style={{ width: '100%', background: 'white', borderRadius: '20px 20px 0 0', padding: 20 }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 18, fontWeight: 600 }}>
                {txnIcon(selected)} {txnTitle(selected)}
              </span>
              <span style={{ fontSize: 20, fontWeight: 700, color: txnAmountColor(selected) }}>
                {txnAmountStr(selected)}
              </span>
            </div>

            <div style={{ fontSize: 14, color: '#6b7280', lineHeight: 2 }}>
              <div>日期：{selected.date}</div>
              {selected.type === 'transfer' ? (
                <>
                  <div>类型：转账</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>转出：{selected.account ? <><BankIcon icon={selected.account.icon} size={16} /> {selected.account.name}</> : '未设置'}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>转入：{selected.to_account ? <><BankIcon icon={selected.to_account.icon} size={16} /> {selected.to_account.name}</> : '未设置'}</div>
                </>
              ) : (
                <>
                  <div>类型：{selected.type === 'expense' ? '支出' : '收入'}</div>
                  {selected.category && <div>分类：{selected.category.icon} {selected.category.name}</div>}
                  {selected.account && <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>账户：<BankIcon icon={selected.account.icon} size={16} /> {selected.account.name}</div>}
                </>
              )}
              <div>成员：{selected.member ? `${selected.member.avatar} ${selected.member.name}` : '未指定'}</div>
              {selected.tags.length > 0 && (
                <div>标签：{selected.tags.map(t => `${t.icon} ${t.name}`).join('、')}</div>
              )}
              {selected.counterparty && <div>对方：{selected.counterparty}</div>}
              {selected.description && <div>备注：{selected.description}</div>}
              <div>来源：{selected.source === 'manual' ? '手动记账' : selected.source}</div>

              {/* 报销信息 */}
              {selected.is_reimbursable && (
                <div style={{
                  marginTop: 12, padding: 10, borderRadius: 8,
                  background: selected.reimbursement_status === 'done' ? '#f0fdf4' : '#fffbeb',
                  border: `1px solid ${selected.reimbursement_status === 'done' ? '#bbf7d0' : '#fde68a'}`,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: selected.reimbursement_status === 'done' ? '#15803d' : '#b45309', marginBottom: 4 }}>
                    💼 {selected.reimbursement_status === 'done' ? '已报销' : '待报销'}
                  </div>
                  <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.8 }}>
                    <div>预期报销金额：¥{selected.reimbursable_amount.toFixed(2)}</div>
                    {linkedRecord && (
                      <>
                        <div>报销日期：{linkedRecord.date}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>到账账户：{linkedRecord.to_account ? <><BankIcon icon={linkedRecord.to_account.icon} size={16} /> {linkedRecord.to_account.name}</> : '未设置'}</div>
                        <div>实际到账金额：¥{linkedRecord.total_amount.toFixed(2)}</div>
                        {linkedRecord.note && <div>报销备注：{linkedRecord.note}</div>}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={() => setSelected(null)}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #e5e7eb', background: '#f9fafb', fontSize: 15, cursor: 'pointer' }}>
                关闭
              </button>
              <button onClick={() => handleEdit(selected)}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #2563eb', background: '#eff6ff', color: '#2563eb', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
                编辑
              </button>
              <button onClick={() => handleDelete(selected)}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: 'none', background: '#ef4444', color: 'white', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
