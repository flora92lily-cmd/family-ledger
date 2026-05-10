import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import dayjs from 'dayjs'
import { transactionApi, categoryApi, tagApi, accountApi, memberApi, type CategoryTree, type Tag, type Account, type FamilyMember } from '../api'
import { BankIcon } from '../components/BankIcon'

type TxnType = 'expense' | 'income' | 'transfer'

export default function AddPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const editId = searchParams.get('id')
  const isEdit = !!editId

  const [type, setType] = useState<TxnType>('expense')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'))
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [expandedParent, setExpandedParent] = useState<number | null>(null)
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])
  const [accountId, setAccountId] = useState<number | null>(null)
  const [toAccountId, setToAccountId] = useState<number | null>(null)
  const [memberId, setMemberId] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [catTree, setCatTree] = useState<CategoryTree[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [members, setMembers] = useState<FamilyMember[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(isEdit)
  // 报销相关
  const [isReimbursable, setIsReimbursable] = useState(false)
  const [reimbursableAmount, setReimbursableAmount] = useState('')

  useEffect(() => {
    categoryApi.tree().then(r => setCatTree(r.data))
    // 只加载未归档的标签
    tagApi.list({ include_archived: false }).then(r => setTags(r.data))
    accountApi.list().then(r => setAccounts(r.data))
    memberApi.list().then(r => setMembers(r.data))
  }, [])

  // 编辑模式：加载交易并预填表单
  useEffect(() => {
    if (!editId) return
    transactionApi.get(Number(editId)).then(r => {
      const t = r.data
      setType(t.type)
      setAmount(String(t.amount))
      setDate(t.date)
      setCategoryId(t.category_id)
      setAccountId(t.account_id)
      setToAccountId(t.to_account_id)
      setMemberId(t.member_id)
      setNote(t.description || '')
      setSelectedTagIds(t.tags.map(tag => tag.id))
      setIsReimbursable(t.is_reimbursable)
      setReimbursableAmount(t.reimbursable_amount ? String(t.reimbursable_amount) : '')
      // 如果交易的分类是某个父分类的子分类，自动展开父级
      if (t.category_id) {
        for (const parent of catTree) {
          if (parent.children.some(c => c.id === t.category_id)) {
            setExpandedParent(parent.id)
            break
          }
        }
      }
      setLoading(false)
    }).catch(() => {
      alert('加载交易失败')
      navigate('/')
    })
    // 注意：catTree 在另一个 effect 里加载，分类展开逻辑见下
  }, [editId])

  // catTree 加载完成后，如果是编辑模式且 category_id 存在，补展开父分类
  useEffect(() => {
    if (!isEdit || !categoryId || catTree.length === 0) return
    for (const parent of catTree) {
      if (parent.children.some(c => c.id === categoryId)) {
        setExpandedParent(parent.id)
        return
      }
    }
  }, [catTree, categoryId, isEdit])

  const filteredTree = catTree.filter(c => c.type === (type === 'transfer' ? 'expense' : type))

  const handleTypeChange = (t: TxnType) => {
    setType(t)
    setCategoryId(null)
    setExpandedParent(null)
  }

  const handleCatClick = (node: CategoryTree) => {
    if (node.children.length > 0) {
      if (expandedParent === node.id) {
        setExpandedParent(null)
      } else {
        setExpandedParent(node.id)
        setCategoryId(node.id)
      }
    } else {
      setCategoryId(node.id)
      setExpandedParent(null)
    }
  }

  const toggleTag = (id: number) => {
    setSelectedTagIds(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    )
  }

  const handleSubmit = async () => {
    if (!amount || parseFloat(amount) <= 0) return
    setSubmitting(true)
    try {
      const amt = parseFloat(amount)
      // 仅支出才允许报销
      const reimEnabled = type === 'expense' && isReimbursable
      const reimAmt = reimEnabled
        ? (reimbursableAmount ? parseFloat(reimbursableAmount) : amt)
        : 0
      const payload = {
        amount: amt,
        type,
        description: note,   // 备注内容作为显示标题
        date,
        category_id: type !== 'transfer' ? categoryId : null,
        account_id: accountId,
        to_account_id: type === 'transfer' ? toAccountId : null,
        member_id: memberId,
        tag_ids: selectedTagIds,
        is_reimbursable: reimEnabled,
        reimbursable_amount: reimAmt,
      }
      if (isEdit && editId) {
        await transactionApi.update(Number(editId), payload)
      } else {
        await transactionApi.create({ ...payload, source: 'manual', reimbursement_status: reimEnabled ? 'pending' : 'none' })
      }
      navigate('/')
    } catch (e: unknown) {
      // 兼容 FastAPI 两种错误格式：
      //   1) HTTPException → detail: string
      //   2) Pydantic 校验失败 → detail: [{loc, msg, type}, ...]
      const err = e as {
        response?: { status?: number; data?: { detail?: string | Array<{ loc?: unknown[]; msg?: string }> } }
        message?: string
      }
      const detail = err.response?.data?.detail
      let msg = ''
      if (typeof detail === 'string') {
        msg = detail
      } else if (Array.isArray(detail)) {
        msg = detail.map(d => `${d.loc?.slice(-1)?.[0] ?? ''}: ${d.msg ?? ''}`).join('\n')
      } else {
        msg = err.message || '请检查网络连接'
      }
      console.error('保存交易失败:', e)
      alert(`保存失败 (${err.response?.status ?? '?'})：\n${msg}`)
    } finally {
      setSubmitting(false)
    }
  }

  // 按分类分组展示标签
  const tagsByCategory = tags.reduce<Record<number, { catName: string; catIcon: string; tags: Tag[] }>>(
    (acc, tag) => {
      const cid = tag.category_id
      if (!acc[cid]) {
        acc[cid] = {
          catName: tag.category?.name || '',
          catIcon: tag.category?.icon || '🏷️',
          tags: [],
        }
      }
      acc[cid].tags.push(tag)
      return acc
    },
    {}
  )

  if (loading) {
    return (
      <div className="form-page">
        <div className="page-header">
          <button className="back-btn" onClick={() => navigate('/')}>←</button>
          编辑账单
        </div>
        <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>加载中...</div>
      </div>
    )
  }

  return (
    <div className="form-page">
      <div className="page-header">
        <button className="back-btn" onClick={() => navigate('/')}>←</button>
        {isEdit ? '编辑账单' : '记一笔'}
      </div>

      <div className="type-toggle">
        <button className={type === 'expense' ? 'active' : ''} onClick={() => handleTypeChange('expense')}>支出</button>
        <button className={type === 'income' ? 'active' : ''} onClick={() => handleTypeChange('income')}>收入</button>
        <button className={type === 'transfer' ? 'active' : ''} onClick={() => handleTypeChange('transfer')}>转账</button>
      </div>

      <div className="form-group">
        <label>金额</label>
        <input
          type="number"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          onWheel={e => (e.target as HTMLInputElement).blur()}
          style={{ fontSize: 24, fontWeight: 600, textAlign: 'center' }}
        />
      </div>

      {/* 账户选择 */}
      {accounts.length > 0 && (() => {
        const renderAccountChips = (selectedId: number | null, onSelect: (id: number | null) => void) => {
          const unassigned = accounts.filter(a => a.member_id == null)
          const memberGroups = new Map<number, Account[]>()
          accounts.filter(a => a.member_id != null).forEach(a => {
            const arr = memberGroups.get(a.member_id!) || []
            arr.push(a)
            memberGroups.set(a.member_id!, arr)
          })
          return (
            <>
              {unassigned.length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>未指定</div>
                  <div className="member-chips" style={{ marginBottom: 6 }}>
                    {unassigned.map(a => (
                      <div key={a.id} className={`chip ${selectedId === a.id ? 'selected' : ''}`}
                        onClick={() => onSelect(selectedId === a.id ? null : a.id)}>
                        <BankIcon icon={a.icon} size={16} /> {a.name}
                      </div>
                    ))}
                  </div>
                </>
              )}
              {[...memberGroups.entries()].map(([mid, accs]) => {
                const m = members.find(mb => mb.id === mid)
                return (
                  <div key={mid}>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4, marginTop: 2 }}>
                      {m ? `${m.avatar} ${m.name}` : '未知'}
                    </div>
                    <div className="member-chips" style={{ marginBottom: 6 }}>
                      {accs.map(a => (
                        <div key={a.id} className={`chip ${selectedId === a.id ? 'selected' : ''}`}
                          onClick={() => onSelect(selectedId === a.id ? null : a.id)}>
                          <BankIcon icon={a.icon} size={16} /> {a.name}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </>
          )
        }

        return (
        <div className="form-group">
          {type === 'transfer' ? (
            <>
              <label>转出账户</label>
              {renderAccountChips(accountId, (id) => setAccountId(id))}
              <label style={{ marginTop: 8, display: 'block' }}>转入账户</label>
              {renderAccountChips(toAccountId, (id) => setToAccountId(id))}
            </>
          ) : (
            <>
              <label>{type === 'expense' ? '支出账户' : '收入账户'}</label>
              {renderAccountChips(accountId, (id) => setAccountId(id))}
            </>
          )}
        </div>
        )
      })()}

      {/* 家庭成员 */}
      {members.length > 0 && (
        <div className="form-group">
          <label>家庭成员（可选）</label>
          <div className="member-chips">
            <div className={`chip ${memberId === null ? 'selected' : ''}`}
              onClick={() => setMemberId(null)}>
              未指定
            </div>
            {members.map(m => (
              <div key={m.id} className={`chip ${memberId === m.id ? 'selected' : ''}`}
                onClick={() => setMemberId(m.id)}>
                {m.avatar} {m.name}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 分类（转账不需要） */}
      {type !== 'transfer' && (
        <div className="form-group">
          <label>分类</label>
          {(() => {
            // 按 5 个一行切片（与 .category-grid 的 5 列布局对齐）；遇到展开的父分类就在该行下方插入子分类
            const COLS = 5
            const rows: CategoryTree[][] = []
            for (let i = 0; i < filteredTree.length; i += COLS) {
              rows.push(filteredTree.slice(i, i + COLS))
            }
            return rows.map((row, rowIdx) => {
              const expandedInRow = expandedParent !== null
                ? row.find(c => c.id === expandedParent)
                : undefined
              return (
                <div key={rowIdx}>
                  <div className="category-grid" style={rowIdx > 0 ? { marginTop: 8 } : undefined}>
                    {row.map(cat => (
                      <div key={cat.id} className={`cat-item ${categoryId === cat.id ? 'selected' : ''}`}
                        onClick={() => handleCatClick(cat)} style={{ position: 'relative' }}>
                        <span className="cat-icon">{cat.icon}</span>
                        <span className="cat-name">{cat.name}</span>
                        {cat.children.length > 0 && (
                          <span style={{ position: 'absolute', top: 2, right: 3, fontSize: 9, color: '#9ca3af' }}>
                            {expandedParent === cat.id ? '▲' : '▼'}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  {expandedInRow && expandedInRow.children.length > 0 && (
                    <div style={{
                      marginTop: 6, padding: '10px 10px 8px',
                      background: '#f9fafb', borderRadius: 8, border: '1px solid #f3f4f6',
                    }}>
                      <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 6, paddingLeft: 2 }}>
                        {expandedInRow.icon} {expandedInRow.name} 的子分类
                      </div>
                      <div className="category-grid">
                        {expandedInRow.children.map(child => (
                          <div key={child.id} className={`cat-item ${categoryId === child.id ? 'selected' : ''}`}
                            onClick={() => { setCategoryId(child.id) }}>
                            <span className="cat-icon">{child.icon}</span>
                            <span className="cat-name">{child.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          })()}
        </div>
      )}

      {/* 标签（多选，选填） */}
      {tags.length > 0 && (
        <div className="form-group">
          <label>标签（可选，多选）</label>
          {Object.entries(tagsByCategory).map(([, group]) => (
            <div key={group.catName} style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>
                {group.catIcon} {group.catName}
              </div>
              <div className="member-chips">
                {group.tags.map(tag => (
                  <div key={tag.id} className={`chip ${selectedTagIds.includes(tag.id) ? 'selected' : ''}`}
                    onClick={() => toggleTag(tag.id)}>
                    {tag.icon} {tag.name}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 可报销开关（仅支出） */}
      {type === 'expense' && (
        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={isReimbursable}
              onChange={e => {
                setIsReimbursable(e.target.checked)
                if (!e.target.checked) setReimbursableAmount('')
              }}
              style={{ width: 18, height: 18 }}
            />
            <span>💼 可报销（该笔不计入支出统计）</span>
          </label>
          {isReimbursable && (
            <div style={{ marginTop: 10 }}>
              <label style={{ fontSize: 13, color: '#6b7280', display: 'block', marginBottom: 4 }}>
                预期报销金额
                <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 4 }}>
                  留空默认=支出金额
                </span>
              </label>
              <input
                type="number"
                inputMode="decimal"
                placeholder={amount || '0.00'}
                value={reimbursableAmount}
                onChange={e => setReimbursableAmount(e.target.value)}
                onWheel={e => (e.target as HTMLInputElement).blur()}
              />
            </div>
          )}
        </div>
      )}

      <div className="form-group">
        <label>日期</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} />
      </div>

      <div className="form-group">
        <label>备注（可选）</label>
        <input type="text" placeholder={type === 'transfer' ? '转账说明' : '买了什么？'}
          value={note} onChange={e => setNote(e.target.value)} />
      </div>

      <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
        {submitting ? '保存中...' : (isEdit ? '保存修改' : '保存')}
      </button>
    </div>
  )
}
