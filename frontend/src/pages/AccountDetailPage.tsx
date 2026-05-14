import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import dayjs from 'dayjs'
import {
  accountApi, transactionApi, holdingApi,
  type Account, type Transaction, type Holding, type AssetType,
} from '../api'
import { BankIcon } from '../components/BankIcon'
import { TxnDetailSheet } from '../components/TxnDetailSheet'
import {
  txnIcon, txnTitle, txnSubMeta, txnAccountEl, txnAmountStr, txnAmountColor,
} from '../utils/txnRender'

const ASSET_LABELS: Record<AssetType, { label: string; icon: string }> = {
  fund: { label: '基金', icon: '📈' },
  stock: { label: 'A股', icon: '📊' },
  wealth: { label: '理财', icon: '🏦' },
}

const gainColor = (v: number) => (v >= 0 ? '#ef4444' : '#22c55e')
const gainSign = (v: number) => (v >= 0 ? '+' : '')

export default function AccountDetailPage() {
  const navigate = useNavigate()
  const { id: idStr } = useParams<{ id: string }>()
  const id = Number(idStr)

  const [account, setAccount] = useState<Account | null>(null)
  const [txns, setTxns] = useState<Transaction[]>([])
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [selected, setSelected] = useState<Transaction | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const [accRes, txnRes] = await Promise.all([
      accountApi.list(),
      transactionApi.list({ account_id: id }),
    ])
    const acc = accRes.data.find(a => a.id === id) || null
    setAccount(acc)
    setTxns(txnRes.data)
    if (acc?.category === '投资理财') {
      const hRes = await holdingApi.list()
      setHoldings(hRes.data.filter(h => h.account_id === id))
    } else {
      setHoldings([])
    }
    setLoading(false)
  }

  useEffect(() => { if (id) load() }, [id])

  const handleDelete = async (txn: Transaction) => {
    if (!confirm('确认删除这条记录？')) return
    await transactionApi.delete(txn.id)
    setSelected(null)
    load()
  }

  const handleEdit = (txn: Transaction) => {
    setSelected(null)
    navigate(`/add?id=${txn.id}`)
  }

  // 按日期分组
  const grouped = txns.reduce<Record<string, Transaction[]>>((acc, t) => {
    if (!acc[t.date]) acc[t.date] = []
    acc[t.date].push(t)
    return acc
  }, {})
  const dayName = (d: string) => ['周日','周一','周二','周三','周四','周五','周六'][dayjs(d).day()]

  if (loading) {
    return <div className="page-content"><div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>加载中…</div></div>
  }
  if (!account) {
    return (
      <div className="page-content">
        <div style={{ padding: 20 }}>
          <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', fontSize: 16, color: '#2563eb', cursor: 'pointer' }}>‹ 返回</button>
          <div style={{ marginTop: 40, textAlign: 'center', color: '#ef4444' }}>账户不存在</div>
        </div>
      </div>
    )
  }

  const isCreditOrDebt = account.category === '信用卡' || account.category === '债务'
  const balanceColor = isCreditOrDebt
    ? '#ef4444'
    : account.current_balance < 0 ? '#ef4444' : '#10b981'
  const balanceStr = isCreditOrDebt
    ? `-¥${Math.abs(account.current_balance).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`
    : `${account.current_balance < 0 ? '-' : ''}¥${Math.abs(account.current_balance).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`

  return (
    <div className="page-content" style={{ paddingBottom: 40 }}>
      {/* 顶部 header */}
      <div style={{ background: 'white', padding: '12px 16px', borderBottom: '1px solid #f3f4f6' }}>
        <button onClick={() => navigate(-1)}
          style={{ background: 'none', border: 'none', fontSize: 15, color: '#2563eb', cursor: 'pointer', padding: 0, marginBottom: 8 }}>
          ‹ 返回
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <BankIcon icon={account.icon} size={32} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{account.name}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
              <span style={{ background: '#f3f4f6', borderRadius: 4, padding: '1px 6px', marginRight: 6 }}>{account.category}</span>
              {account.member && <span>{account.member.avatar} {account.member.name}</span>}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, color: '#9ca3af' }}>当前余额</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: balanceColor }}>{balanceStr}</div>
          </div>
        </div>
        {account.note && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#9ca3af' }}>{account.note}</div>
        )}
      </div>

      {/* 投资理财专属：持仓 */}
      {account.category === '投资理财' && (
        <div style={{ padding: '12px 16px 0' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#6b7280', marginBottom: 8 }}>
            持仓 ({holdings.length})
          </div>
          {holdings.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af', background: 'white', borderRadius: 8 }}>
              暂无关联持仓
            </div>
          ) : (
            holdings.map(h => (
              <div key={h.id} className="card" style={{ margin: '8px 0', padding: '12px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 16 }}>{ASSET_LABELS[h.asset_type].icon}</span>
                      <span style={{ fontSize: 15, fontWeight: 600 }}>{h.name}</span>
                      <span style={{ fontSize: 11, background: '#f3f4f6', color: '#6b7280', borderRadius: 4, padding: '1px 5px' }}>
                        {ASSET_LABELS[h.asset_type].label}
                      </span>
                    </div>
                    {h.code && (
                      <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>{h.code}</div>
                    )}
                    {h.member && (
                      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>
                        {h.member.avatar} {h.member.name}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
                      <div>
                        <span style={{ color: '#6b7280' }}>持仓成本 </span>
                        <span>¥{h.cost_total.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</span>
                      </div>
                      {h.current_price > 0 && (
                        <div>
                          <span style={{ color: '#6b7280' }}>最新净值 </span>
                          <span>{h.current_price.toFixed(4)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 8 }}>
                    <div style={{ fontSize: 17, fontWeight: 700 }}>
                      ¥{h.current_value.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                    </div>
                    <div style={{ fontSize: 13, color: gainColor(h.gain) }}>
                      {gainSign(h.gain)}¥{Math.abs(h.gain).toFixed(2)} ({gainSign(h.gain_rate)}{h.gain_rate}%)
                    </div>
                  </div>
                </div>
                {h.price_updated_at && (
                  <div style={{ fontSize: 11, color: '#d1d5db', marginTop: 6 }}>
                    行情更新：{new Date(h.price_updated_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* 交易流水 */}
      <div style={{ padding: '12px 16px 0' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#6b7280', marginBottom: 8 }}>
          交易流水 ({txns.length})
        </div>
      </div>

      <div className="txn-list">
        {Object.keys(grouped).length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📝</div>
            <div>暂无交易记录</div>
          </div>
        ) : (
          Object.entries(grouped).map(([date, items]) => (
            <div key={date} className="txn-date-group">
              <div className="date-header">
                {dayjs(date).format('MM月DD日')} {dayName(date)}
              </div>
              {items.map(txn => {
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

      {selected && (
        <TxnDetailSheet
          txn={selected}
          onClose={() => setSelected(null)}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}
