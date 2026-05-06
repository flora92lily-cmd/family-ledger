import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  recurringRuleApi, accountApi, memberApi, tagApi, categoryApi,
  type RecurringRule, type RecurrenceType, type EndType, type TxnType,
  type Account, type FamilyMember, type Tag,
} from '../api'
import type { CategoryTree } from '../api'

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

const EMPTY_RULE_FORM = {
  recurrence_type: 'monthly' as RecurrenceType,
  recurrence_day: 1,
  start_date: '',
  end_type: 'never' as EndType,
  end_date: '',
  max_count: '' as number | '',
  type: 'expense' as TxnType,
  category_id: null as number | null,
  account_id: null as number | null,
  to_account_id: null as number | null,
  amount: '' as number | '',
  member_id: null as number | null,
  description: '',
  tag_ids: [] as number[],
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, color: '#6b7280', marginBottom: 4 }
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px',
  border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 15, marginBottom: 14, outline: 'none',
}

export default function RecurringPage() {
  const navigate = useNavigate()

  const [rules, setRules] = useState<RecurringRule[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editRuleId, setEditRuleId] = useState<number | null>(null)
  const [ruleForm, setRuleForm] = useState({ ...EMPTY_RULE_FORM })
  const [expandedParent, setExpandedParent] = useState<number | null>(null)

  const [accounts, setAccounts] = useState<Account[]>([])
  const [members, setMembers] = useState<FamilyMember[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [catTree, setCatTree] = useState<CategoryTree[]>([])

  const loadAll = async () => {
    const [r, a, m, t, c] = await Promise.all([
      recurringRuleApi.list(),
      accountApi.list(),
      memberApi.list(),
      tagApi.list({ include_archived: false }),
      categoryApi.tree(),
    ])
    setRules(r.data)
    setAccounts(a.data)
    setMembers(m.data)
    setAllTags(t.data)
    setCatTree(c.data)
  }

  useEffect(() => { loadAll() }, [])

  const openAdd = () => {
    setEditRuleId(null)
    const today = new Date().toISOString().slice(0, 10)
    setRuleForm({ ...EMPTY_RULE_FORM, start_date: today })
    setExpandedParent(null)
    setShowModal(true)
  }

  const openEdit = (r: RecurringRule) => {
    setEditRuleId(r.id)
    setRuleForm({
      recurrence_type: r.recurrence_type,
      recurrence_day: r.recurrence_day,
      start_date: r.start_date,
      end_type: r.end_type,
      end_date: r.end_date || '',
      max_count: r.max_count || '',
      type: r.type,
      category_id: r.category_id,
      account_id: r.account_id,
      to_account_id: r.to_account_id,
      amount: r.amount,
      member_id: r.member_id,
      description: r.description,
      tag_ids: r.tag_ids,
    })
    setExpandedParent(null)
    setShowModal(true)
  }

  const saveRule = async () => {
    if (!ruleForm.amount || Number(ruleForm.amount) <= 0) return alert('请输入金额')
    if (ruleForm.type !== 'transfer' && !ruleForm.category_id) return alert('请选择分类')
    if (!ruleForm.account_id) return alert('请选择账户')
    if (ruleForm.type === 'transfer' && !ruleForm.to_account_id) return alert('请选择转入账户')
    if (!ruleForm.description.trim()) return alert('请输入描述/备注')
    try {
      const payload: Record<string, unknown> = {
        ...ruleForm,
        amount: Number(ruleForm.amount),
        max_count: ruleForm.end_type === 'count' ? Number(ruleForm.max_count) || null : null,
        end_date: ruleForm.end_type === 'date' ? ruleForm.end_date : null,
      }
      if (editRuleId !== null) {
        await recurringRuleApi.update(editRuleId, payload)
      } else {
        await recurringRuleApi.create(payload)
      }
      setShowModal(false)
      loadAll()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      alert(err.response?.data?.detail || '保存失败')
    }
  }

  const deleteRule = async (r: RecurringRule) => {
    if (!confirm(`确认删除周期规则「${r.description}」？已生成的交易不会被删除。`)) return
    await recurringRuleApi.delete(r.id)
    loadAll()
  }

  const filteredCatTree = catTree.filter(c => c.type === ruleForm.type)

  return (
    <div className="page-content">
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <button onClick={() => navigate('/settings')}
          style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', padding: '0 12px 0 0', color: '#374151' }}>
          ←
        </button>
        <div className="page-header" style={{ marginBottom: 0 }}>周期记账</div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button onClick={openAdd}
          style={{ background: '#3b82f6', border: 'none', color: 'white', fontSize: 14, fontWeight: 600, cursor: 'pointer', borderRadius: 8, padding: '8px 20px' }}>
          + 新建规则
        </button>
      </div>

      {rules.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: '#9ca3af', fontSize: 14, padding: '24px 0' }}>
          还没有周期记账规则
          <div style={{ fontSize: 12, marginTop: 4 }}>点击「新建规则」添加工资、房租、公积金等周期性账单</div>
        </div>
      ) : (
        rules.map(r => {
          const typeEmoji = r.type === 'expense' ? '📤' : r.type === 'income' ? '📥' : '🔄'
          const recurDesc = r.recurrence_type === 'weekly'
            ? `每周${WEEKDAY_LABELS[r.recurrence_day - 1]}`
            : `每月${r.recurrence_day}日`
          return (
            <div key={r.id} className="card" style={{ marginBottom: 10, padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                <span style={{ fontSize: 22, marginRight: 12, marginTop: 2 }}>{typeEmoji}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>
                    {r.description}
                    <span style={{ marginLeft: 10, color: r.type === 'income' ? '#10b981' : r.type === 'expense' ? '#ef4444' : '#8b5cf6' }}>
                      ¥{r.amount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                    {r.category ? `${r.category.icon} ${r.category.name}` : ''}
                    {r.account ? ` · ${r.account.name}` : ''}
                    {r.to_account ? ` → ${r.to_account.name}` : ''}
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                    {recurDesc} · {r.start_date} 起
                    {r.end_type === 'date' && r.end_date ? ` · 至 ${r.end_date}` : ''}
                    {r.end_type === 'count' ? ` · 共 ${r.max_count} 次（已执行 ${r.executed_count}）` : ' · 永不到期'}
                  </div>
                  {r.member && (
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                      {r.member.avatar} {r.member.name}
                    </div>
                  )}
                  {r.tag_ids.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      {allTags.filter(t => r.tag_ids.includes(t.id)).map(t => (
                        <span key={t.id} style={{ fontSize: 11, background: '#f0f9ff', color: '#0369a1', borderRadius: 4, padding: '1px 5px', marginRight: 4 }}>
                          {t.icon} {t.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {!r.is_active && (
                    <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 600 }}>已停用</span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
                <button onClick={() => openEdit(r)}
                  style={{ background: 'none', border: '1px solid #d1d5db', fontSize: 13, color: '#374151', cursor: 'pointer', borderRadius: 6, padding: '4px 14px' }}>编辑</button>
                <button onClick={() => deleteRule(r)}
                  style={{ background: 'none', border: '1px solid #fca5a5', fontSize: 13, color: '#ef4444', cursor: 'pointer', borderRadius: 6, padding: '4px 14px' }}>删除</button>
              </div>
            </div>
          )
        })
      )}

      {/* ─── 编辑弹窗 ─── */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ width: '100%', background: 'white', borderRadius: '20px 20px 0 0', padding: 20, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontWeight: 600, fontSize: 17, marginBottom: 16, textAlign: 'center' }}>
              {editRuleId !== null ? '编辑周期规则' : '新建周期规则'}
            </div>

            {/* 类型选择 */}
            <label style={labelStyle}>类型</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {(['expense', 'income', 'transfer'] as TxnType[]).map(t => (
                <button key={t} onClick={() => {
                  setRuleForm(f => ({ ...f, type: t, category_id: null }))
                  setExpandedParent(null)
                }}
                  style={{
                    flex: 1, padding: '8px 0', borderRadius: 20, fontSize: 14, cursor: 'pointer',
                    border: ruleForm.type === t ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                    background: ruleForm.type === t ? '#eff6ff' : 'white',
                    color: ruleForm.type === t ? '#3b82f6' : '#374151',
                    fontWeight: ruleForm.type === t ? 600 : 400,
                  }}>
                  {t === 'expense' ? '📤 支出' : t === 'income' ? '📥 收入' : '🔄 转账'}
                </button>
              ))}
            </div>

            {/* 分类选择 */}
            {ruleForm.type !== 'transfer' && (
              <>
                <label style={labelStyle}>分类 *</label>
                <div style={{ marginBottom: 14 }}>
                  {filteredCatTree.map(parent => (
                    <div key={parent.id} style={{ marginBottom: 4 }}>
                      <button
                        onClick={() => setExpandedParent(expandedParent === parent.id ? null : parent.id)}
                        style={{
                          width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                          border: '1px solid #e5e7eb', background: '#f9fafb', textAlign: 'left',
                          display: 'flex', justifyContent: 'space-between',
                        }}>
                        <span>{parent.icon} {parent.name}</span>
                        <span style={{ color: '#9ca3af' }}>{expandedParent === parent.id ? '▲' : '▼'}</span>
                      </button>
                      {expandedParent === parent.id && parent.children.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '6px 0 6px 8px' }}>
                          {parent.children.map(child => (
                            <button key={child.id} onClick={() => setRuleForm(f => ({ ...f, category_id: child.id }))}
                              style={{
                                padding: '5px 12px', borderRadius: 16, fontSize: 12, cursor: 'pointer',
                                border: ruleForm.category_id === child.id ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                                background: ruleForm.category_id === child.id ? '#eff6ff' : 'white',
                                color: ruleForm.category_id === child.id ? '#3b82f6' : '#374151',
                                fontWeight: ruleForm.category_id === child.id ? 600 : 400,
                              }}>
                              {child.icon} {child.name}
                            </button>
                          ))}
                          <button onClick={() => setRuleForm(f => ({ ...f, category_id: parent.id }))}
                            style={{
                              padding: '5px 12px', borderRadius: 16, fontSize: 12, cursor: 'pointer',
                              border: ruleForm.category_id === parent.id ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                              background: ruleForm.category_id === parent.id ? '#eff6ff' : 'white',
                              color: ruleForm.category_id === parent.id ? '#3b82f6' : '#374151',
                              fontWeight: ruleForm.category_id === parent.id ? 600 : 400,
                            }}>
                            {parent.icon} {parent.name}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {filteredCatTree.length === 0 && (
                    <div style={{ fontSize: 12, color: '#9ca3af', padding: '8px 0' }}>暂无该类型的分类</div>
                  )}
                </div>
              </>
            )}

            {/* 账户选择 */}
            <label style={labelStyle}>{ruleForm.type === 'transfer' ? '转出账户 *' : '账户 *'}</label>
            <select
              value={ruleForm.account_id || ''}
              onChange={e => setRuleForm(f => ({ ...f, account_id: e.target.value ? parseInt(e.target.value) : null }))}
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, marginBottom: 14 }}>
              <option value="">请选择</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
              ))}
            </select>

            {ruleForm.type === 'transfer' && (
              <>
                <label style={labelStyle}>转入账户 *</label>
                <select
                  value={ruleForm.to_account_id || ''}
                  onChange={e => setRuleForm(f => ({ ...f, to_account_id: e.target.value ? parseInt(e.target.value) : null }))}
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, marginBottom: 14 }}>
                  <option value="">请选择</option>
                  {accounts.filter(a => a.id !== ruleForm.account_id).map(a => (
                    <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
                  ))}
                </select>
              </>
            )}

            {/* 金额 */}
            <label style={labelStyle}>金额 *</label>
            <input style={inputStyle} type="number" placeholder="0.00"
              value={ruleForm.amount}
              onChange={e => setRuleForm(f => ({ ...f, amount: e.target.value }))} />

            {/* 备注 */}
            <label style={labelStyle}>备注/描述 *</label>
            <input style={inputStyle} placeholder="如：工资、公积金、房租"
              value={ruleForm.description}
              onChange={e => setRuleForm(f => ({ ...f, description: e.target.value }))} />

            {/* 重复周期 */}
            <label style={labelStyle}>重复周期</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button onClick={() => setRuleForm(f => ({ ...f, recurrence_type: 'weekly', recurrence_day: 1 }))}
                style={{
                  padding: '6px 16px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
                  border: ruleForm.recurrence_type === 'weekly' ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                  background: ruleForm.recurrence_type === 'weekly' ? '#eff6ff' : 'white',
                  color: ruleForm.recurrence_type === 'weekly' ? '#3b82f6' : '#374151',
                  fontWeight: ruleForm.recurrence_type === 'weekly' ? 600 : 400,
                }}>每周</button>
              <button onClick={() => setRuleForm(f => ({ ...f, recurrence_type: 'monthly', recurrence_day: 1 }))}
                style={{
                  padding: '6px 16px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
                  border: ruleForm.recurrence_type === 'monthly' ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                  background: ruleForm.recurrence_type === 'monthly' ? '#eff6ff' : 'white',
                  color: ruleForm.recurrence_type === 'monthly' ? '#3b82f6' : '#374151',
                  fontWeight: ruleForm.recurrence_type === 'monthly' ? 600 : 400,
                }}>每月</button>
            </div>

            {ruleForm.recurrence_type === 'weekly' ? (
              <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
                {WEEKDAY_LABELS.map((label, i) => (
                  <button key={i} onClick={() => setRuleForm(f => ({ ...f, recurrence_day: i + 1 }))}
                    style={{
                      width: 40, height: 40, borderRadius: 20, fontSize: 14, cursor: 'pointer',
                      border: ruleForm.recurrence_day === i + 1 ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                      background: ruleForm.recurrence_day === i + 1 ? '#eff6ff' : 'white',
                      color: ruleForm.recurrence_day === i + 1 ? '#3b82f6' : '#374151',
                      fontWeight: ruleForm.recurrence_day === i + 1 ? 600 : 400,
                    }}>{label}</button>
                ))}
              </div>
            ) : (
              <select
                value={ruleForm.recurrence_day}
                onChange={e => setRuleForm(f => ({ ...f, recurrence_day: parseInt(e.target.value) }))}
                style={{ width: '100%', padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, marginBottom: 14 }}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                  <option key={d} value={d}>每月 {d} 日</option>
                ))}
              </select>
            )}

            {/* 开始日期 */}
            <label style={labelStyle}>开始日期（含当天）</label>
            <input style={inputStyle} type="date"
              value={ruleForm.start_date}
              onChange={e => setRuleForm(f => ({ ...f, start_date: e.target.value }))} />

            {/* 结束方式 */}
            <label style={labelStyle}>结束方式</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              {(['never', 'date', 'count'] as EndType[]).map(et => (
                <button key={et} onClick={() => setRuleForm(f => ({ ...f, end_type: et }))}
                  style={{
                    padding: '6px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
                    border: ruleForm.end_type === et ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                    background: ruleForm.end_type === et ? '#eff6ff' : 'white',
                    color: ruleForm.end_type === et ? '#3b82f6' : '#374151',
                    fontWeight: ruleForm.end_type === et ? 600 : 400,
                  }}>
                  {et === 'never' ? '永不到期' : et === 'date' ? '结束日期' : '执行次数'}
                </button>
              ))}
            </div>

            {ruleForm.end_type === 'date' && (
              <input style={inputStyle} type="date"
                value={ruleForm.end_date}
                onChange={e => setRuleForm(f => ({ ...f, end_date: e.target.value }))} />
            )}
            {ruleForm.end_type === 'count' && (
              <input style={inputStyle} type="number" placeholder="执行次数"
                value={ruleForm.max_count}
                onChange={e => setRuleForm(f => ({ ...f, max_count: e.target.value }))} />
            )}

            {/* 家庭成员 */}
            {members.length > 0 && (
              <>
                <label style={labelStyle}>归属成员（可选）</label>
                <div className="member-chips" style={{ marginBottom: 14 }}>
                  <div className={`chip ${ruleForm.member_id === null ? 'selected' : ''}`}
                    onClick={() => setRuleForm(f => ({ ...f, member_id: null }))}>
                    未指定
                  </div>
                  {members.map(m => (
                    <div key={m.id} className={`chip ${ruleForm.member_id === m.id ? 'selected' : ''}`}
                      onClick={() => setRuleForm(f => ({ ...f, member_id: m.id }))}>
                      {m.avatar} {m.name}
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* 标签 */}
            {allTags.length > 0 && (
              <>
                <label style={labelStyle}>标签（可选）</label>
                <div className="member-chips" style={{ marginBottom: 14 }}>
                  {allTags.map(tag => (
                    <div key={tag.id} className={`chip ${ruleForm.tag_ids.includes(tag.id) ? 'selected' : ''}`}
                      onClick={() => setRuleForm(f => ({
                        ...f,
                        tag_ids: f.tag_ids.includes(tag.id) ? f.tag_ids.filter(id => id !== tag.id) : [...f.tag_ids, tag.id],
                      }))}>
                      {tag.icon} {tag.name}
                    </div>
                  ))}
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button onClick={() => setShowModal(false)}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #e5e7eb', background: '#f9fafb', fontSize: 15, cursor: 'pointer' }}>取消</button>
              <button onClick={saveRule}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: 'none', background: '#3b82f6', color: 'white', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
