import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import {
  reimbursementApi, accountApi,
  type Transaction, type ReimbursementRecord, type Account,
} from '../api'

type Tab = 'pending' | 'done' | 'all'

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, color: '#6b7280', marginBottom: 4 }
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px',
  border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 15, marginBottom: 14, outline: 'none',
}

/**
 * 把 axios 抛出的错误格式化为人类可读字符串。
 * - 422 校验错：detail 是数组，逐条拼接
 * - 普通 4xx/5xx：detail 是字符串
 * - 网络错：没有 response，提示连接问题
 * 同时把完整错误对象打到 console 便于在 DevTools 排查
 */
function formatApiError(e: unknown, ctx: string): string {
  console.error(ctx, e)
  const err = e as {
    response?: { status?: number; data?: { detail?: unknown } }
    message?: string
  }
  if (!err.response) {
    return `网络错误：${err.message || '无法连接后端，请确认后端已启动并监听 8000 端口'}`
  }
  const { status, data } = err.response
  const detail = data?.detail
  let msg: string
  if (Array.isArray(detail)) {
    msg = detail
      .map((d: { loc?: unknown[]; msg?: string }) =>
        `${(d.loc || []).join('.')}: ${d.msg || '校验失败'}`
      )
      .join('；')
  } else if (typeof detail === 'string' && detail) {
    msg = detail
  } else {
    msg = err.message || '未知错误（请查看 DevTools Console / Network）'
  }
  return `[${status}] ${msg}`
}

export default function ReimbursementPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('pending')
  const [pending, setPending] = useState<Transaction[]>([])
  const [records, setRecords] = useState<ReimbursementRecord[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [selectedRecord, setSelectedRecord] = useState<ReimbursementRecord | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // 提交报销弹层
  const [showSubmit, setShowSubmit] = useState(false)
  const [submitDate, setSubmitDate] = useState(dayjs().format('YYYY-MM-DD'))
  const [submitToAccount, setSubmitToAccount] = useState<number | null>(null)
  const [submitAmount, setSubmitAmount] = useState('')
  const [submitNote, setSubmitNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const load = async () => {
    setLoadError(null)
    try {
      const [p, r, a] = await Promise.all([
        reimbursementApi.listPending(),
        reimbursementApi.list(),
        accountApi.list(),
      ])
      setPending(p.data)
      setRecords(r.data)
      setAccounts(a.data)
    } catch (e: unknown) {
      setLoadError(formatApiError(e, 'ReimbursementPage load'))
    }
  }

  useEffect(() => { load() }, [])

  const toggleSelect = (id: number) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  const selectedTxns = useMemo(
    () => pending.filter(t => selectedIds.has(t.id)),
    [pending, selectedIds]
  )

  const selectedSum = selectedTxns.reduce(
    (s, t) => s + (t.reimbursable_amount || t.amount), 0
  )

  const openSubmit = () => {
    if (selectedIds.size === 0) return
    setSubmitDate(dayjs().format('YYYY-MM-DD'))
    setSubmitToAccount(accounts[0]?.id ?? null)
    setSubmitAmount(selectedSum.toFixed(2))
    setSubmitNote('')
    setShowSubmit(true)
  }

  const handleSubmitReim = async () => {
    if (!submitToAccount) return alert('请选择到账账户')
    const total = parseFloat(submitAmount)
    if (!total || total <= 0) return alert('请输入到账金额')
    setSubmitting(true)
    try {
      await reimbursementApi.create({
        date: submitDate,
        to_account_id: submitToAccount,
        total_amount: total,
        note: submitNote,
        transaction_ids: Array.from(selectedIds),
      })
      setShowSubmit(false)
      setSelectedIds(new Set())
      await load()
      setTab('done')
    } catch (e: unknown) {
      alert(formatApiError(e, '提交报销失败'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleRevoke = async (rec: ReimbursementRecord) => {
    if (!confirm(`确认撤销这条报销记录（¥${rec.total_amount.toFixed(2)}）？关联的 ${rec.items.length} 笔账单将回到"未报"状态。`)) return
    try {
      await reimbursementApi.delete(rec.id)
      setSelectedRecord(null)
      await load()
    } catch (e: unknown) {
      alert(formatApiError(e, '撤销报销失败'))
    }
  }

  // 按月分组未报销
  const pendingByMonth = useMemo(() => {
    const groups: Record<string, { total: number; reimbursable: number; items: Transaction[] }> = {}
    for (const t of pending) {
      const m = dayjs(t.date).format('YYYY年MM月')
      if (!groups[m]) groups[m] = { total: 0, reimbursable: 0, items: [] }
      groups[m].items.push(t)
      groups[m].total += t.amount
      groups[m].reimbursable += t.reimbursable_amount || t.amount
    }
    return groups
  }, [pending])

  // 按月分组已报销记录
  const recordsByMonth = useMemo(() => {
    const groups: Record<string, { total: number; items: ReimbursementRecord[] }> = {}
    for (const r of records) {
      const m = dayjs(r.date).format('YYYY年MM月')
      if (!groups[m]) groups[m] = { total: 0, items: [] }
      groups[m].items.push(r)
      groups[m].total += r.total_amount
    }
    return groups
  }, [records])

  const TabButton = ({ v, label, count }: { v: Tab; label: string; count?: number }) => (
    <button
      onClick={() => { setTab(v); setSelectedIds(new Set()) }}
      style={{
        padding: '7px 18px', borderRadius: 20, fontSize: 14, cursor: 'pointer',
        border: 'none',
        background: tab === v ? '#dbeafe' : '#f3f4f6',
        color: tab === v ? '#1d4ed8' : '#6b7280',
        fontWeight: tab === v ? 600 : 400,
      }}
    >
      {label}{count !== undefined && count > 0 ? ` (${count})` : ''}
    </button>
  )

  return (
    <div className="page-content" style={{ paddingBottom: selectedIds.size > 0 && tab === 'pending' ? 80 : 60 }}>
      <div className="page-header">
        <button className="back-btn" onClick={() => navigate('/settings')}>←</button>
        报销管理
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, padding: '12px 16px 0', justifyContent: 'center' }}>
        <TabButton v="pending" label="未报" count={pending.length} />
        <TabButton v="done" label="已报" count={records.length} />
        <TabButton v="all" label="全部" />
      </div>

      <div style={{ padding: '12px 16px' }}>

        {/* 加载失败提示 */}
        {loadError && (
          <div style={{ margin: '4px 0 12px', padding: '12px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, fontSize: 13, color: '#991b1b' }}>
            ⚠️ 数据加载失败：{loadError}
            <button onClick={load} style={{ display: 'block', marginTop: 6, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 0 }}>
              点击重试
            </button>
          </div>
        )}

        {/* 未报销 */}
        {(tab === 'pending' || tab === 'all') && Object.keys(pendingByMonth).length === 0 && tab === 'pending' && !loadError && (
          <div className="empty-state">
            <div className="empty-icon">✅</div>
            <div>没有待报销账单</div>
            <div style={{ marginTop: 8, fontSize: 13, color: '#9ca3af' }}>
              记账时勾选"可报销"即可在此管理
            </div>
          </div>
        )}

        {(tab === 'pending' || tab === 'all') && Object.entries(pendingByMonth).map(([month, g]) => (
          <div key={`p-${month}`} className="card" style={{ marginBottom: 12, padding: 0 }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{month}</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                  共 {g.items.length} 笔，总计 ¥{g.total.toFixed(2)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 15, color: '#3b82f6', fontWeight: 600 }}>
                  ¥{g.reimbursable.toFixed(2)}
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>待报销</div>
              </div>
            </div>
            {g.items.map(t => {
              const reimAmt = t.reimbursable_amount || t.amount
              const selected = selectedIds.has(t.id)
              return (
                <div key={t.id}
                  onClick={() => toggleSelect(t.id)}
                  style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #f9fafb', cursor: 'pointer', background: selected ? '#eff6ff' : 'white' }}>
                  <input type="checkbox" checked={selected} readOnly
                    style={{ width: 18, height: 18, marginRight: 10, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.category?.icon || '💰'} {t.description || t.category?.name || '未命名'}
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                      {dayjs(t.date).format('MM-DD')}
                      {t.account && ` · ${t.account.icon}${t.account.name}`}
                      {t.tags.length > 0 && ` · ${t.tags.map(x => x.name).join('/')}`}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#3b82f6' }}>
                      ¥{reimAmt.toFixed(2)}
                    </div>
                    {Math.abs(reimAmt - t.amount) > 0.001 && (
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                        实付 ¥{t.amount.toFixed(2)}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}

        {/* 已报销 */}
        {(tab === 'done' || tab === 'all') && Object.keys(recordsByMonth).length === 0 && tab === 'done' && (
          <div className="empty-state">
            <div className="empty-icon">📋</div>
            <div>还没有报销记录</div>
          </div>
        )}

        {(tab === 'done' || tab === 'all') && Object.entries(recordsByMonth).map(([month, g]) => (
          <div key={`d-${month}`} className="card" style={{ marginBottom: 12, padding: 0 }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{month}</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                  共 {g.items.length} 条报销，合计 ¥{g.total.toFixed(2)}
                </div>
              </div>
              <div style={{ fontSize: 15, color: '#10b981', fontWeight: 600 }}>
                +¥{g.total.toFixed(2)}
              </div>
            </div>
            {g.items.map(r => (
              <div key={r.id}
                onClick={() => setSelectedRecord(r)}
                style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #f9fafb', cursor: 'pointer' }}>
                <div style={{ fontSize: 20, marginRight: 10 }}>💰</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>
                    报销到账（{r.items.length} 笔）
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {dayjs(r.date).format('MM-DD')}
                    {r.to_account && ` · ${r.to_account.icon}${r.to_account.name}`}
                    {r.source !== 'manual' && ` · ${r.source}`}
                  </div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#10b981', flexShrink: 0, marginLeft: 8 }}>
                  +¥{r.total_amount.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* 底部浮动：提交报销 */}
      {tab === 'pending' && selectedIds.size > 0 && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, padding: 12,
          background: 'white', borderTop: '1px solid #e5e7eb', zIndex: 100,
          display: 'flex', alignItems: 'center', gap: 10,
          maxWidth: 500, margin: '0 auto',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: '#6b7280' }}>已选 {selectedIds.size} 笔</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#3b82f6' }}>
              合计 ¥{selectedSum.toFixed(2)}
            </div>
          </div>
          <button onClick={openSubmit}
            style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: '#3b82f6', color: 'white', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
            提交报销
          </button>
        </div>
      )}

      {/* 提交报销弹层 */}
      {showSubmit && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}
          onClick={() => setShowSubmit(false)}>
          <div style={{ width: '100%', background: 'white', borderRadius: '20px 20px 0 0', padding: 20, maxHeight: '85vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, fontSize: 17, marginBottom: 16, textAlign: 'center' }}>
              提交报销（{selectedIds.size} 笔 · ¥{selectedSum.toFixed(2)}）
            </div>

            <label style={labelStyle}>入账日期 *</label>
            <input style={inputStyle} type="date"
              value={submitDate} onChange={e => setSubmitDate(e.target.value)} />

            <label style={labelStyle}>到账账户 *</label>
            <div className="member-chips" style={{ marginBottom: 14 }}>
              {accounts.map(a => (
                <div key={a.id}
                  className={`chip ${submitToAccount === a.id ? 'selected' : ''}`}
                  onClick={() => setSubmitToAccount(a.id)}>
                  {a.icon} {a.name}
                </div>
              ))}
            </div>

            <label style={labelStyle}>
              实际到账金额 *
              <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 4 }}>
                默认=待报销合计，可改
              </span>
            </label>
            <input style={inputStyle} type="number" inputMode="decimal"
              value={submitAmount} onChange={e => setSubmitAmount(e.target.value)} />

            <label style={labelStyle}>备注</label>
            <input style={inputStyle} placeholder="可选"
              value={submitNote} onChange={e => setSubmitNote(e.target.value)} />

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button onClick={() => setShowSubmit(false)} disabled={submitting}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #e5e7eb', background: '#f9fafb', fontSize: 15, cursor: 'pointer' }}>取消</button>
              <button onClick={handleSubmitReim} disabled={submitting}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: 'none', background: '#3b82f6', color: 'white', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
                {submitting ? '提交中...' : '确认提交'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 报销记录详情 */}
      {selectedRecord && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}
          onClick={() => setSelectedRecord(null)}>
          <div style={{ width: '100%', background: 'white', borderRadius: '20px 20px 0 0', padding: 20, maxHeight: '85vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 18, fontWeight: 600 }}>💰 报销记录</span>
              <span style={{ fontSize: 20, fontWeight: 700, color: '#10b981' }}>
                +¥{selectedRecord.total_amount.toFixed(2)}
              </span>
            </div>

            <div style={{ fontSize: 14, color: '#6b7280', lineHeight: 2 }}>
              <div>到账日期：{selectedRecord.date}</div>
              <div>到账账户：
                {selectedRecord.to_account
                  ? `${selectedRecord.to_account.icon} ${selectedRecord.to_account.name}`
                  : '未设置'}
              </div>
              {selectedRecord.note && <div>备注：{selectedRecord.note}</div>}
              <div>来源：{selectedRecord.source === 'manual' ? '手动提交' : selectedRecord.source}</div>
            </div>

            <div style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: '#374151' }}>
              关联账单（{selectedRecord.items.length} 笔）
            </div>
            <div style={{ marginTop: 8 }}>
              {selectedRecord.items.map(item => (
                <div key={item.transaction_id}
                  style={{ display: 'flex', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f9fafb' }}>
                  <div style={{ fontSize: 18, marginRight: 8 }}>{item.category_icon || '💰'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13 }}>{item.description || item.category_name || '未命名'}</div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                      {item.date ? dayjs(item.date).format('MM-DD') : ''}
                      {item.amount_paid && Math.abs(item.amount_paid - item.amount) > 0.001
                        ? ` · 实付 ¥${item.amount_paid.toFixed(2)}` : ''}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#3b82f6' }}>
                    ¥{item.amount.toFixed(2)}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={() => setSelectedRecord(null)}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #e5e7eb', background: '#f9fafb', fontSize: 15, cursor: 'pointer' }}>
                关闭
              </button>
              <button onClick={() => handleRevoke(selectedRecord)}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: 'none', background: '#ef4444', color: 'white', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
                撤销报销
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
