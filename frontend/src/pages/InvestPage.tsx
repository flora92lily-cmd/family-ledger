import { useState, useEffect } from 'react'
import { holdingApi, tagApi, accountApi, memberApi, type Holding, type HoldingSummary, type AssetType, type Tag, type Account, type FamilyMember } from '../api'

const ASSET_LABELS: Record<AssetType, { label: string; icon: string }> = {
  fund: { label: '基金', icon: '📈' },
  stock: { label: 'A股', icon: '📊' },
  wealth: { label: '理财', icon: '🏦' },
}

const EMPTY_FORM = {
  name: '', code: '', asset_type: 'fund' as AssetType,
  shares: 0, cost_price: 0, current_price: 0, current_value: 0,
  account_id: null as number | null,
  member_id: null as number | null,
  note: '',
  tag_ids: [] as number[],
}

export default function InvestPage() {
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [summary, setSummary] = useState<HoldingSummary | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [members, setMembers] = useState<FamilyMember[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [refreshing, setRefreshing] = useState(false)
  const [refreshingId, setRefreshingId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const [h, s] = await Promise.all([holdingApi.list(), holdingApi.summary()])
    setHoldings(h.data)
    setSummary(s.data)
  }

  useEffect(() => {
    load()
    tagApi.list({ include_archived: false }).then(r => setTags(r.data))
    accountApi.list().then(r => setAccounts(r.data))
    memberApi.list().then(r => setMembers(r.data))
  }, [])

  const openAdd = () => {
    setEditId(null)
    setForm({ ...EMPTY_FORM })
    setShowModal(true)
  }

  const openEdit = (h: Holding) => {
    setEditId(h.id)
    setForm({
      name: h.name, code: h.code, asset_type: h.asset_type,
      shares: h.shares, cost_price: h.cost_price,
      current_price: h.current_price, current_value: h.current_value,
      account_id: h.account_id, member_id: h.member_id, note: h.note,
      tag_ids: h.tags.map(t => t.id),
    })
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!form.name) return alert('请填写持仓名称')
    // 自动计算市值（如果未填）
    const cv = form.current_value || parseFloat((form.shares * form.current_price).toFixed(2))
    const payload = { ...form, current_value: cv }
    setSaving(true)
    try {
      if (editId !== null) {
        await holdingApi.update(editId, payload)
      } else {
        await holdingApi.create(payload)
      }
      setShowModal(false)
      await load()
    } catch {
      alert('保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (h: Holding) => {
    if (!confirm(`确定删除「${h.name}」持仓？`)) return
    await holdingApi.delete(h.id)
    await load()
  }

  const handleRefreshOne = async (h: Holding) => {
    setRefreshingId(h.id)
    try {
      await holdingApi.refresh(h.id)
      await load()
      alert(`「${h.name}」行情已更新`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      alert('行情更新失败：' + (err.response?.data?.detail || '请检查网络或代码'))
    } finally {
      setRefreshingId(null)
    }
  }

  const handleRefreshAll = async () => {
    setRefreshing(true)
    try {
      const res = await holdingApi.refreshAll()
      const { updated, failed } = res.data
      let msg = `已更新 ${updated} 个持仓`
      if (failed.length) msg += `\n失败 ${failed.length} 个：${failed.map(f => f.name).join('、')}`
      alert(msg)
      await load()
    } catch {
      alert('批量刷新失败')
    } finally {
      setRefreshing(false)
    }
  }

  const gainColor = (v: number) => (v >= 0 ? '#ef4444' : '#22c55e')  // A股红涨绿跌
  const gainSign = (v: number) => (v >= 0 ? '+' : '')

  return (
    <div className="page-content">
      <div className="page-header">
        投资资产
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            onClick={handleRefreshAll}
            disabled={refreshing}
            style={{ fontSize: 13, background: 'none', border: '1px solid #d1d5db', borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}
          >
            {refreshing ? '更新中…' : '🔄'}
          </button>
          <button
            onClick={openAdd}
            style={{ fontSize: 22, background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}
          >
            +
          </button>
        </div>
      </div>

      {/* 投资总览卡 */}
      {summary && (
        <div className="card" style={{ margin: '8px 16px', background: 'linear-gradient(135deg,#1e40af,#3b82f6)', color: 'white', borderRadius: 16 }}>
          <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 4 }}>总市值</div>
          <div style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>¥{summary.total_value.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</div>
          <div style={{ display: 'flex', gap: 24 }}>
            <div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>总成本</div>
              <div style={{ fontSize: 15, fontWeight: 500 }}>¥{summary.total_cost.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>总收益</div>
              <div style={{ fontSize: 15, fontWeight: 500, color: summary.total_gain >= 0 ? '#fca5a5' : '#86efac' }}>
                {gainSign(summary.total_gain)}¥{Math.abs(summary.total_gain).toFixed(2)} ({gainSign(summary.gain_rate)}{summary.gain_rate}%)
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 持仓列表 */}
      <div style={{ padding: '0 16px' }}>
        {holdings.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 40 }}>
            <div className="empty-icon">📋</div>
            <div>还没有持仓记录</div>
            <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 4 }}>点击下方「+」添加基金、股票或理财</div>
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

              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={() => openEdit(h)}
                  style={{ flex: 1, padding: '5px 0', fontSize: 12, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer' }}>
                  编辑
                </button>
                {h.asset_type !== 'wealth' && h.code && (
                  <button onClick={() => handleRefreshOne(h)}
                    disabled={refreshingId === h.id}
                    style={{ flex: 1, padding: '5px 0', fontSize: 12, background: '#eff6ff', color: '#3b82f6', border: '1px solid #bfdbfe', borderRadius: 6, cursor: refreshingId === h.id ? 'not-allowed' : 'pointer', opacity: refreshingId === h.id ? 0.6 : 1 }}>
                    {refreshingId === h.id ? '更新中…' : '刷新行情'}
                  </button>
                )}
                <button onClick={() => handleDelete(h)}
                  style={{ padding: '5px 10px', fontSize: 12, background: '#fff1f2', color: '#ef4444', border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer' }}>
                  删除
                </button>
              </div>
            </div>
          ))
        )}

        <div style={{ height: 80 }} />
      </div>

      {/* 编辑/添加弹窗 */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ width: '100%', background: 'white', borderRadius: '20px 20px 0 0', padding: 20, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontWeight: 600, fontSize: 17, marginBottom: 16, textAlign: 'center' }}>
              {editId !== null ? '编辑持仓' : '添加持仓'}
            </div>

            <label style={labelStyle}>资产类型</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {(Object.entries(ASSET_LABELS) as [AssetType, { label: string; icon: string }][]).map(([k, v]) => (
                <button key={k} onClick={() => setForm(f => ({ ...f, asset_type: k }))}
                  style={{
                    flex: 1, padding: 8, borderRadius: 8, fontSize: 13, cursor: 'pointer',
                    background: form.asset_type === k ? '#3b82f6' : '#f3f4f6',
                    color: form.asset_type === k ? 'white' : '#374151',
                    border: 'none',
                  }}>
                  {v.icon} {v.label}
                </button>
              ))}
            </div>

            <label style={labelStyle}>名称 *</label>
            <input style={inputStyle} placeholder={form.asset_type === 'fund' ? '如：易方达蓝筹精选混合' : form.asset_type === 'stock' ? '如：平安银行' : '如：招行一年期理财'}
              value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />

            {form.asset_type !== 'wealth' && (
              <>
                <label style={labelStyle}>{form.asset_type === 'fund' ? '基金代码' : '股票代码'}</label>
                <input style={inputStyle}
                  placeholder={form.asset_type === 'fund' ? '如：005827' : '如：000001（自动识别沪深）'}
                  value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} />
              </>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>{form.asset_type === 'wealth' ? '本金（元）' : '持仓份额/股数'}</label>
                <input style={inputStyle} type="number" placeholder="0"
                  value={form.shares || ''} onChange={e => setForm(f => ({ ...f, shares: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>{form.asset_type === 'wealth' ? '当前收益率(%)' : '成本价（元/份）'}</label>
                <input style={inputStyle} type="number" placeholder="0" step="0.0001"
                  value={form.cost_price || ''} onChange={e => setForm(f => ({ ...f, cost_price: parseFloat(e.target.value) || 0 }))} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>{form.asset_type === 'wealth' ? '当前市值（元）' : '最新净值/价格'}</label>
                <input style={inputStyle} type="number" placeholder="0" step="0.0001"
                  value={form.current_price || ''} onChange={e => setForm(f => ({ ...f, current_price: parseFloat(e.target.value) || 0, current_value: 0 }))} />
              </div>
              {form.asset_type === 'wealth' && (
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>当前市值（元）</label>
                  <input style={inputStyle} type="number" placeholder="留空则自动计算"
                    value={form.current_value || ''} onChange={e => setForm(f => ({ ...f, current_value: parseFloat(e.target.value) || 0 }))} />
                </div>
              )}
            </div>

            {form.asset_type !== 'wealth' && (
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
                预计市值：¥{(form.shares * form.current_price).toFixed(2)}（保存后可刷新实时行情）
              </div>
            )}

            {/* 绑定投资账户 */}
            {accounts.filter(a => a.category === '投资理财').length > 0 && (
              <>
                <label style={labelStyle}>绑定账户（投资理财）</label>
                <select
                  value={form.account_id ?? ''}
                  onChange={e => setForm(f => ({ ...f, account_id: e.target.value ? parseInt(e.target.value) : null }))}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 15, marginBottom: 14 }}>
                  <option value="">不绑定账户</option>
                  {accounts.filter(a => a.category === '投资理财').map(a => (
                    <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
                  ))}
                </select>
              </>
            )}

            {members.length > 0 && (
              <>
                <label style={labelStyle}>归属成员（可选）</label>
                <div className="member-chips" style={{ marginBottom: 14 }}>
                  <div className={`chip ${form.member_id === null ? 'selected' : ''}`}
                    onClick={() => setForm(f => ({ ...f, member_id: null }))}>
                    未指定
                  </div>
                  {members.map(m => (
                    <div key={m.id} className={`chip ${form.member_id === m.id ? 'selected' : ''}`}
                      onClick={() => setForm(f => ({ ...f, member_id: m.id }))}>
                      {m.avatar} {m.name}
                    </div>
                  ))}
                </div>
              </>
            )}

            {tags.length > 0 && (
              <>
                <label style={labelStyle}>标签（可选，多选）</label>
                <div className="member-chips" style={{ marginBottom: 14 }}>
                  {tags.map(tag => (
                    <div key={tag.id}
                      className={`chip ${form.tag_ids.includes(tag.id) ? 'selected' : ''}`}
                      onClick={() => setForm(f => ({
                        ...f,
                        tag_ids: f.tag_ids.includes(tag.id)
                          ? f.tag_ids.filter(id => id !== tag.id)
                          : [...f.tag_ids, tag.id],
                      }))}>
                      {tag.icon} {tag.name}
                    </div>
                  ))}
                </div>
              </>
            )}

            <label style={labelStyle}>备注</label>
            <input style={inputStyle} placeholder="可选"
              value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />

            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button onClick={() => setShowModal(false)}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #e5e7eb', background: '#f9fafb', fontSize: 15, cursor: 'pointer' }}>
                取消
              </button>
              <button onClick={handleSave} disabled={saving}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: 'none', background: '#3b82f6', color: 'white', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 13, color: '#6b7280', marginBottom: 4
}
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px',
  border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 15,
  marginBottom: 14, outline: 'none',
}
