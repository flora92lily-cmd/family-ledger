import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  accountApi, tagApi, memberApi,
  type Account, type AccountCategory,
  type Tag, type TagCategory, type FamilyMember,
} from '../api'
import { BankIcon, LOGO_ICONS } from '../components/BankIcon'

const TAG_ICONS = ['🏷️', '👩', '👨', '👧', '👦', '👴', '👵', '✈️', '🏖️', '🎉', '💼', '🏠', '🎓', '🎮', '🌟', '❤️', '🔖', '📌', '🎯', '🗂️']
const ACCOUNT_EMOJI_ICONS = ['🏦', '💳', '💰', '📱', '🏧', '🎫', '🚌', '🍽️', '💵', '💼', '🧧', '🏠', '🚗']
const MEMBER_ICONS = ['👤', '👨', '👩', '👧', '👦', '👴', '👵', '🧒', '👶', '🏠', '👨‍👩‍👧', '👨‍👩‍👦', '👫', '👬', '👭', '🐶', '🐱']

const ACCOUNT_CATEGORIES: AccountCategory[] = ['资金账户', '信用卡', '充值账户', '债务', '投资理财', '银行理财']
const ACCOUNT_CATEGORY_ICONS: Record<AccountCategory, string> = {
  '资金账户': '🏦',
  '信用卡': '💳',
  '充值账户': '🎫',
  '债务': '📋',
  '投资理财': '📈',
  '银行理财': '🏛️',
}

const EMPTY_ACCOUNT_FORM = { name: '', icon: '🏦', category: '资金账户' as AccountCategory, balance: 0, member_id: null as number | null, note: '', sort_order: 0, tag_ids: [] as number[] }
const EMPTY_MEMBER_FORM = { name: '', avatar: '👤', sort_order: 0 }

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, color: '#6b7280', marginBottom: 4 }
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px',
  border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 15, marginBottom: 14, outline: 'none',
}

export default function SettingsPage() {
  const navigate = useNavigate()

  // ─── 账户 ──────────────────────────────────────────────────────
  const [accounts, setAccounts] = useState<Account[]>([])
  const [showAccountModal, setShowAccountModal] = useState(false)
  const [editAccountId, setEditAccountId] = useState<number | null>(null)
  const [accountForm, setAccountForm] = useState({ ...EMPTY_ACCOUNT_FORM })

  // ─── 家庭成员 ──────────────────────────────────────────────────
  const [members, setMembers] = useState<FamilyMember[]>([])
  const [showMemberModal, setShowMemberModal] = useState(false)
  const [editMemberId, setEditMemberId] = useState<number | null>(null)
  const [memberForm, setMemberForm] = useState({ ...EMPTY_MEMBER_FORM })

  // ─── 标签 ──────────────────────────────────────────────────────
  const [tagCategories, setTagCategories] = useState<TagCategory[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])          // 未归档
  const [archivedTags, setArchivedTags] = useState<Tag[]>([]) // 已归档
  const [showArchivedSection, setShowArchivedSection] = useState(false)

  // 标签分类弹窗
  const [showTagCatModal, setShowTagCatModal] = useState(false)
  const [editTagCatId, setEditTagCatId] = useState<number | null>(null)
  const [tagCatForm, setTagCatForm] = useState({ name: '', icon: '🏷️' })

  // 标签弹窗
  const [showTagModal, setShowTagModal] = useState(false)
  const [editTagId, setEditTagId] = useState<number | null>(null)
  const [tagForm, setTagForm] = useState({ name: '', icon: '🏷️', category_id: 0 })

  // 标签移动弹窗
  const [showMoveModal, setShowMoveModal] = useState(false)
  const [movingTagId, setMovingTagId] = useState<number | null>(null)
  const [moveToCatId, setMoveToCatId] = useState<number>(0)

  // ─── Load ───────────────────────────────────────────────────────
  const loadAccounts = async () => {
    const r = await accountApi.list()
    setAccounts(r.data)
  }

  const loadMembers = async () => {
    const r = await memberApi.list()
    setMembers(r.data)
  }

  const loadTags = async () => {
    const [cats, active, all] = await Promise.all([
      tagApi.listCategories(),
      tagApi.list({ include_archived: false }),
      tagApi.list({ include_archived: true }),
    ])
    setTagCategories(cats.data)
    setAllTags(active.data)
    setArchivedTags(all.data.filter(t => t.is_archived))
  }

  useEffect(() => {
    loadAccounts()
    loadTags()
    loadMembers()
  }, [])

  // ─── 账户操作 ─────────────────────────────────────────────────
  const openAddAccount = () => {
    setEditAccountId(null)
    setAccountForm({ ...EMPTY_ACCOUNT_FORM })
    setShowAccountModal(true)
  }

  const openEditAccount = (a: Account) => {
    setEditAccountId(a.id)
    setAccountForm({
      name: a.name, icon: a.icon, category: a.category,
      // 信用卡表单填写的是“欠款”，界面中始终用正数方便输入；
      // 保存时由后端统一转换为负余额。
      balance: a.category === '信用卡' ? Math.abs(a.balance) : a.balance,
      member_id: a.member_id, note: a.note, sort_order: a.sort_order,
      tag_ids: a.tags.map(t => t.id),
    })
    setShowAccountModal(true)
  }

  const saveAccount = async () => {
    if (!accountForm.name.trim()) return alert('请输入账户名称')
    if (editAccountId !== null) {
      await accountApi.update(editAccountId, accountForm)
    } else {
      await accountApi.create(accountForm)
    }
    setShowAccountModal(false)
    loadAccounts()
  }

  const deleteAccount = async (a: Account) => {
    if (!confirm(`确认删除账户「${a.name}」？`)) return
    await accountApi.delete(a.id)
    loadAccounts()
  }

  const toggleAccountTag = (id: number) => {
    setAccountForm(f => ({
      ...f,
      tag_ids: f.tag_ids.includes(id) ? f.tag_ids.filter(t => t !== id) : [...f.tag_ids, id],
    }))
  }

  // ─── 家庭成员操作 ─────────────────────────────────────────────
  const openAddMember = () => {
    setEditMemberId(null)
    setMemberForm({ ...EMPTY_MEMBER_FORM, sort_order: members.length })
    setShowMemberModal(true)
  }

  const openEditMember = (m: FamilyMember) => {
    setEditMemberId(m.id)
    setMemberForm({ name: m.name, avatar: m.avatar, sort_order: m.sort_order })
    setShowMemberModal(true)
  }

  const saveMember = async () => {
    if (!memberForm.name.trim()) return alert('请输入成员名称')
    try {
      if (editMemberId !== null) {
        await memberApi.update(editMemberId, memberForm)
      } else {
        await memberApi.create(memberForm)
      }
      setShowMemberModal(false)
      loadMembers()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      alert(err.response?.data?.detail || '保存失败')
    }
  }

  const deleteMember = async (m: FamilyMember) => {
    if (!confirm(`确认删除家庭成员「${m.name}」？`)) return
    try {
      await memberApi.delete(m.id)
      loadMembers()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      alert(err.response?.data?.detail || '删除失败')
    }
  }

  // ─── 标签分类操作 ─────────────────────────────────────────────
  const openAddTagCat = () => {
    setEditTagCatId(null)
    setTagCatForm({ name: '', icon: '🏷️' })
    setShowTagCatModal(true)
  }

  const openEditTagCat = (c: TagCategory) => {
    setEditTagCatId(c.id)
    setTagCatForm({ name: c.name, icon: c.icon })
    setShowTagCatModal(true)
  }

  const saveTagCat = async () => {
    if (!tagCatForm.name.trim()) return alert('请输入分类名称')
    if (editTagCatId !== null) {
      await tagApi.updateCategory(editTagCatId, tagCatForm)
    } else {
      await tagApi.createCategory(tagCatForm)
    }
    setShowTagCatModal(false)
    loadTags()
  }

  const deleteTagCat = async (c: TagCategory) => {
    if (!confirm(`确认删除标签分类「${c.name}」？下属标签将一并删除。`)) return
    await tagApi.deleteCategory(c.id)
    loadTags()
  }

  // ─── 标签操作 ─────────────────────────────────────────────────
  const openAddTag = (catId: number) => {
    setEditTagId(null)
    setTagForm({ name: '', icon: '🏷️', category_id: catId })
    setShowTagModal(true)
  }

  const openEditTag = (t: Tag) => {
    setEditTagId(t.id)
    setTagForm({ name: t.name, icon: t.icon, category_id: t.category_id })
    setShowTagModal(true)
  }

  const saveTag = async () => {
    if (!tagForm.name.trim()) return alert('请输入标签名称')
    try {
      if (editTagId !== null) {
        await tagApi.update(editTagId, { name: tagForm.name, icon: tagForm.icon })
      } else {
        await tagApi.create(tagForm)
      }
      setShowTagModal(false)
      loadTags()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      alert(err.response?.data?.detail || '保存失败')
    }
  }

  const archiveTag = async (t: Tag) => {
    await tagApi.archive(t.id)
    loadTags()
  }

  const unarchiveTag = async (t: Tag) => {
    await tagApi.unarchive(t.id)
    loadTags()
  }

  const deleteTag = async (t: Tag) => {
    if (!confirm(`确认删除标签「${t.name}」？已打上此标签的账单将移除该标签，但账单不会被删除。`)) return
    await tagApi.delete(t.id)
    loadTags()
  }

  const openMoveTag = (t: Tag) => {
    setMovingTagId(t.id)
    setMoveToCatId(t.category_id)
    setShowMoveModal(true)
  }

  const moveTag = async () => {
    if (!movingTagId) return
    await tagApi.move(movingTagId, moveToCatId)
    setShowMoveModal(false)
    loadTags()
  }

  // ─── 派生数据 ──────────────────────────────────────────────────
  // 未归档标签按分类分组
  const activeTagsByCategory = tagCategories.map(cat => ({
    ...cat,
    tags: allTags.filter(t => t.category_id === cat.id),
  }))

  return (
    <div className="page-content">
      <div className="page-header">设置</div>

      {/* 导入账单 */}
      <div className="card" onClick={() => navigate('/import')}
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
        <div style={{ fontSize: 28, marginRight: 12 }}>📥</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>导入账单</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>支付宝 · 微信 · 招行 PDF · 钱迹</div>
        </div>
        <div style={{ color: '#9ca3af', fontSize: 20 }}>›</div>
      </div>

      {/* 报销管理 */}
      <div className="card" onClick={() => navigate('/reimbursements')}
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
        <div style={{ fontSize: 28, marginRight: 12 }}>💼</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>报销管理</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>处理待报销账单 · 查看报销记录</div>
        </div>
        <div style={{ color: '#9ca3af', fontSize: 20 }}>›</div>
      </div>

      {/* 分类管理 */}
      <div className="card" onClick={() => navigate('/categories')}
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
        <div style={{ fontSize: 28, marginRight: 12 }}>🗂️</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>分类管理</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>支出 · 收入分类及关键词设置</div>
        </div>
        <div style={{ color: '#9ca3af', fontSize: 20 }}>›</div>
      </div>

      {/* 周期记账 */}
      <div className="card" onClick={() => navigate('/recurring')}
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
        <div style={{ fontSize: 28, marginRight: 12 }}>🔁</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>周期记账</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>定时自动记账 · 工资 · 房租 · 公积金</div>
        </div>
        <div style={{ color: '#9ca3af', fontSize: 20 }}>›</div>
      </div>

      {/* 家庭成员管理 */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>家庭成员管理</div>
            <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>账单 / 账户 / 投资归属于谁</div>
          </div>
          <button onClick={openAddMember}
            style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--primary)' }}>+</button>
        </div>

        {members.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 13, padding: '12px 0' }}>
            还没有家庭成员，点击 + 添加（如：我、老公、家庭）
          </div>
        ) : (
          members.map(m => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f9fafb' }}>
              <span style={{ fontSize: 22, marginRight: 10 }}>{m.avatar}</span>
              <span style={{ fontSize: 14, flex: 1 }}>{m.name}</span>
              <button onClick={() => openEditMember(m)}
                style={{ background: 'none', border: 'none', fontSize: 13, color: '#6b7280', cursor: 'pointer', marginRight: 6 }}>编辑</button>
              <button onClick={() => deleteMember(m)}
                style={{ background: 'none', border: 'none', fontSize: 13, color: '#ef4444', cursor: 'pointer' }}>删除</button>
            </div>
          ))
        )}
      </div>

      {/* 账户管理 */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>账户管理</div>
          <button onClick={openAddAccount}
            style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--primary)' }}>+</button>
        </div>

        {ACCOUNT_CATEGORIES.map(cat => {
          const catAccounts = accounts.filter(a => a.category === cat)
          if (catAccounts.length === 0) return null

          // 按家庭成员分组
          const unassigned = catAccounts.filter(a => a.member_id == null)
          const memberGroups = new Map<number, Account[]>()
          catAccounts.filter(a => a.member_id != null).forEach(a => {
            const arr = memberGroups.get(a.member_id!) || []
            arr.push(a)
            memberGroups.set(a.member_id!, arr)
          })

          const renderAccountRow = (a: Account) => (
            <div key={a.id}
              onClick={() => navigate(`/account/${a.id}`)}
              style={{ display: 'flex', alignItems: 'center', padding: '6px 0 6px 16px', borderBottom: '1px solid #f9fafb', cursor: 'pointer' }}>
              <span style={{ marginRight: 8 }}><BankIcon icon={a.icon} size={24} /></span>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 14 }}>{a.name}</span>
                {a.tags.length > 0 && (
                  <div style={{ marginTop: 2 }}>
                    {a.tags.map(t => (
                      <span key={t.id} style={{ fontSize: 11, background: '#f0f9ff', color: '#0369a1', borderRadius: 4, padding: '1px 5px', marginRight: 4 }}>
                        {t.icon} {t.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <span style={{ fontSize: 13, color: a.current_balance < 0 ? '#ef4444' : '#10b981', marginRight: 10 }}>
                {`${a.current_balance < 0 ? '-' : ''}¥${Math.abs(a.current_balance).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`}
              </span>
              <button onClick={(e) => { e.stopPropagation(); openEditAccount(a) }}
                style={{ background: 'none', border: 'none', fontSize: 13, color: '#6b7280', cursor: 'pointer', marginRight: 6 }}>编辑</button>
              <button onClick={(e) => { e.stopPropagation(); deleteAccount(a) }}
                style={{ background: 'none', border: 'none', fontSize: 13, color: '#ef4444', cursor: 'pointer' }}>删除</button>
            </div>
          )

          return (
            <div key={cat} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: '#9ca3af', fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span>{ACCOUNT_CATEGORY_ICONS[cat]}</span>{cat}
              </div>
              {/* 未指定成员 */}
              {unassigned.length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: '#b0b7c3', marginBottom: 2, paddingLeft: 4 }}>未指定</div>
                  {unassigned.map(renderAccountRow)}
                </>
              )}
              {/* 按成员分组 */}
              {[...memberGroups.entries()].map(([mid, accs]) => {
                const m = members.find(mb => mb.id === mid)
                return (
                  <div key={mid}>
                    <div style={{ fontSize: 11, color: '#b0b7c3', marginBottom: 2, paddingLeft: 4 }}>
                      {m ? `${m.avatar} ${m.name}` : '未知成员'}
                    </div>
                    {accs.map(renderAccountRow)}
                  </div>
                )
              })}
            </div>
          )
        })}

        {accounts.length === 0 && (
          <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 13, padding: '12px 0' }}>
            还没有账户，点击 + 添加
          </div>
        )}
      </div>

      {/* 标签管理 */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>标签管理</div>
          <button onClick={openAddTagCat}
            style={{ background: 'none', border: '1px solid #bfdbfe', fontSize: 13, color: 'var(--primary)', cursor: 'pointer', borderRadius: 6, padding: '3px 10px' }}>
            + 新建分组
          </button>
        </div>

        {activeTagsByCategory.map(cat => (
          <div key={cat.id} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 16, marginRight: 6 }}>{cat.icon}</span>
              <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{cat.name}</span>
              <button onClick={() => openAddTag(cat.id)}
                style={{ background: 'none', border: 'none', fontSize: 12, color: '#3b82f6', cursor: 'pointer', marginRight: 8 }}>
                +标签
              </button>
              <button onClick={() => openEditTagCat(cat)}
                style={{ background: 'none', border: 'none', fontSize: 12, color: '#6b7280', cursor: 'pointer', marginRight: 6 }}>编辑</button>
              <button onClick={() => deleteTagCat(cat)}
                style={{ background: 'none', border: 'none', fontSize: 12, color: '#ef4444', cursor: 'pointer' }}>删除</button>
            </div>

            {cat.tags.length === 0 ? (
              <div style={{ fontSize: 12, color: '#d1d5db', paddingLeft: 22, marginBottom: 4 }}>暂无标签</div>
            ) : (
              cat.tags.map(tag => (
                <div key={tag.id} style={{ display: 'flex', alignItems: 'center', padding: '5px 0 5px 22px', borderBottom: '1px solid #f9fafb' }}>
                  <span style={{ fontSize: 16, marginRight: 6 }}>{tag.icon}</span>
                  <span style={{ fontSize: 13, flex: 1 }}>{tag.name}</span>
                  <button onClick={() => openEditTag(tag)}
                    style={{ background: 'none', border: 'none', fontSize: 12, color: '#6b7280', cursor: 'pointer', marginRight: 4 }}>编辑</button>
                  <button onClick={() => openMoveTag(tag)}
                    style={{ background: 'none', border: 'none', fontSize: 12, color: '#6b7280', cursor: 'pointer', marginRight: 4 }}>移动</button>
                  <button onClick={() => archiveTag(tag)}
                    style={{ background: 'none', border: 'none', fontSize: 12, color: '#f59e0b', cursor: 'pointer', marginRight: 4 }}>归档</button>
                  <button onClick={() => deleteTag(tag)}
                    style={{ background: 'none', border: 'none', fontSize: 12, color: '#ef4444', cursor: 'pointer' }}>删除</button>
                </div>
              ))
            )}
          </div>
        ))}

        {/* 已归档标签 */}
        {archivedTags.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <button onClick={() => setShowArchivedSection(!showArchivedSection)}
              style={{ background: 'none', border: 'none', fontSize: 13, color: '#9ca3af', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: '4px 0' }}>
              {showArchivedSection ? '▼' : '▶'} 已归档标签（{archivedTags.length}）
            </button>
            {showArchivedSection && archivedTags.map(tag => (
              <div key={tag.id} style={{ display: 'flex', alignItems: 'center', padding: '5px 0 5px 16px', opacity: 0.6 }}>
                <span style={{ fontSize: 16, marginRight: 6 }}>{tag.icon}</span>
                <span style={{ fontSize: 13, flex: 1, color: '#9ca3af' }}>{tag.name}</span>
                <button onClick={() => unarchiveTag(tag)}
                  style={{ background: 'none', border: 'none', fontSize: 12, color: '#10b981', cursor: 'pointer', marginRight: 4 }}>取消归档</button>
                <button onClick={() => deleteTag(tag)}
                  style={{ background: 'none', border: 'none', fontSize: 12, color: '#ef4444', cursor: 'pointer' }}>删除</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── 账户编辑弹窗 ─── */}
      {showAccountModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ width: '100%', background: 'white', borderRadius: '20px 20px 0 0', padding: 20, maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ fontWeight: 600, fontSize: 17, marginBottom: 16, textAlign: 'center' }}>
              {editAccountId !== null ? '编辑账户' : '新建账户'}
            </div>

            <label style={labelStyle}>账户大类</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              {ACCOUNT_CATEGORIES.map(cat => (
                <button key={cat} onClick={() => setAccountForm(f => ({ ...f, category: cat }))}
                  style={{ padding: '6px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer', border: accountForm.category === cat ? '2px solid #3b82f6' : '1px solid #e5e7eb', background: accountForm.category === cat ? '#eff6ff' : 'white', color: accountForm.category === cat ? '#3b82f6' : '#374151', fontWeight: accountForm.category === cat ? 600 : 400 }}>
                  {ACCOUNT_CATEGORY_ICONS[cat]} {cat}
                </button>
              ))}
            </div>

            <label style={labelStyle}>账户名称 *</label>
            <input style={inputStyle} placeholder="如：招行储蓄卡、支付宝余额"
              value={accountForm.name} onChange={e => setAccountForm(f => ({ ...f, name: e.target.value }))} />

            <label style={labelStyle}>图标</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {/* 银行/平台 Logo */}
              {LOGO_ICONS.map(key => (
                <button key={key} onClick={() => setAccountForm(f => ({ ...f, icon: key }))}
                  style={{ width: 36, height: 36, cursor: 'pointer', borderRadius: 8, border: accountForm.icon === key ? '2px solid #3b82f6' : '1px solid #e5e7eb', background: accountForm.icon === key ? '#eff6ff' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                  <BankIcon icon={key} size={22} />
                </button>
              ))}
              {/* 通用 emoji */}
              {ACCOUNT_EMOJI_ICONS.map(ico => (
                <button key={ico} onClick={() => setAccountForm(f => ({ ...f, icon: ico }))}
                  style={{ width: 36, height: 36, fontSize: 20, cursor: 'pointer', borderRadius: 8, border: accountForm.icon === ico ? '2px solid #3b82f6' : '1px solid #e5e7eb', background: accountForm.icon === ico ? '#eff6ff' : 'white' }}>{ico}</button>
              ))}
            </div>

            <label style={labelStyle}>
              {accountForm.category === '信用卡' ? '初始欠款（元）' : accountForm.category === '债务' ? '初始债务（元）' : '初始余额（元）'}
              <span style={{ color: '#9ca3af', fontSize: 11, marginLeft: 4 }}>记账后自动联动</span>
            </label>
            <input style={inputStyle} type="number" placeholder="0.00"
              value={accountForm.balance}
              onChange={e => setAccountForm(f => ({ ...f, balance: parseFloat(e.target.value) || 0 }))} />

            {/* 归属成员 */}
            {members.length > 0 && (
              <>
                <label style={labelStyle}>归属成员（可选）</label>
                <div className="member-chips" style={{ marginBottom: 14 }}>
                  <div className={`chip ${accountForm.member_id === null ? 'selected' : ''}`}
                    onClick={() => setAccountForm(f => ({ ...f, member_id: null }))}>
                    未指定
                  </div>
                  {members.map(m => (
                    <div key={m.id} className={`chip ${accountForm.member_id === m.id ? 'selected' : ''}`}
                      onClick={() => setAccountForm(f => ({ ...f, member_id: m.id }))}>
                      {m.avatar} {m.name}
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* 账户标签 */}
            {allTags.length > 0 && (
              <>
                <label style={labelStyle}>标签（可选）</label>
                <div className="member-chips" style={{ marginBottom: 14 }}>
                  {allTags.map(tag => (
                    <div key={tag.id} className={`chip ${accountForm.tag_ids.includes(tag.id) ? 'selected' : ''}`}
                      onClick={() => toggleAccountTag(tag.id)}>
                      {tag.icon} {tag.name}
                    </div>
                  ))}
                </div>
              </>
            )}

            <label style={labelStyle}>备注</label>
            <input style={inputStyle} placeholder="可选"
              value={accountForm.note} onChange={e => setAccountForm(f => ({ ...f, note: e.target.value }))} />

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button onClick={() => setShowAccountModal(false)}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #e5e7eb', background: '#f9fafb', fontSize: 15, cursor: 'pointer' }}>取消</button>
              <button onClick={saveAccount}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: 'none', background: '#3b82f6', color: 'white', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>保存</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 标签分类编辑弹窗 ─── */}
      {showTagCatModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ width: '100%', background: 'white', borderRadius: '20px 20px 0 0', padding: 20 }}>
            <div style={{ fontWeight: 600, fontSize: 17, marginBottom: 16, textAlign: 'center' }}>
              {editTagCatId !== null ? '编辑标签分组' : '新建标签分组'}
            </div>

            <label style={labelStyle}>分组名称 *</label>
            <input style={inputStyle} placeholder="如：家庭成员、旅行、项目"
              value={tagCatForm.name} onChange={e => setTagCatForm(f => ({ ...f, name: e.target.value }))} />

            <label style={labelStyle}>图标</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {TAG_ICONS.map(ico => (
                <button key={ico} onClick={() => setTagCatForm(f => ({ ...f, icon: ico }))}
                  style={{ width: 36, height: 36, fontSize: 20, cursor: 'pointer', borderRadius: 8, border: tagCatForm.icon === ico ? '2px solid #3b82f6' : '1px solid #e5e7eb', background: tagCatForm.icon === ico ? '#eff6ff' : 'white' }}>{ico}</button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowTagCatModal(false)}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #e5e7eb', background: '#f9fafb', fontSize: 15, cursor: 'pointer' }}>取消</button>
              <button onClick={saveTagCat}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: 'none', background: '#3b82f6', color: 'white', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>保存</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 标签编辑弹窗 ─── */}
      {showTagModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ width: '100%', background: 'white', borderRadius: '20px 20px 0 0', padding: 20 }}>
            <div style={{ fontWeight: 600, fontSize: 17, marginBottom: 16, textAlign: 'center' }}>
              {editTagId !== null ? '编辑标签' : '新建标签'}
            </div>

            <label style={labelStyle}>标签名称 *（全局唯一）</label>
            <input style={inputStyle} placeholder="如：我、老公、2026云南"
              value={tagForm.name} onChange={e => setTagForm(f => ({ ...f, name: e.target.value }))} />

            <label style={labelStyle}>图标</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {TAG_ICONS.map(ico => (
                <button key={ico} onClick={() => setTagForm(f => ({ ...f, icon: ico }))}
                  style={{ width: 36, height: 36, fontSize: 20, cursor: 'pointer', borderRadius: 8, border: tagForm.icon === ico ? '2px solid #3b82f6' : '1px solid #e5e7eb', background: tagForm.icon === ico ? '#eff6ff' : 'white' }}>{ico}</button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowTagModal(false)}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #e5e7eb', background: '#f9fafb', fontSize: 15, cursor: 'pointer' }}>取消</button>
              <button onClick={saveTag}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: 'none', background: '#3b82f6', color: 'white', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>保存</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 家庭成员编辑弹窗 ─── */}
      {showMemberModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ width: '100%', background: 'white', borderRadius: '20px 20px 0 0', padding: 20, maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ fontWeight: 600, fontSize: 17, marginBottom: 16, textAlign: 'center' }}>
              {editMemberId !== null ? '编辑成员' : '新建成员'}
            </div>

            <label style={labelStyle}>成员名称 *（全局唯一）</label>
            <input style={inputStyle} placeholder="如：我、老公、家庭"
              value={memberForm.name} onChange={e => setMemberForm(f => ({ ...f, name: e.target.value }))} />

            <label style={labelStyle}>头像</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {MEMBER_ICONS.map(ico => (
                <button key={ico} onClick={() => setMemberForm(f => ({ ...f, avatar: ico }))}
                  style={{ width: 40, height: 40, fontSize: 22, cursor: 'pointer', borderRadius: 8, border: memberForm.avatar === ico ? '2px solid #3b82f6' : '1px solid #e5e7eb', background: memberForm.avatar === ico ? '#eff6ff' : 'white' }}>{ico}</button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button onClick={() => setShowMemberModal(false)}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #e5e7eb', background: '#f9fafb', fontSize: 15, cursor: 'pointer' }}>取消</button>
              <button onClick={saveMember}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: 'none', background: '#3b82f6', color: 'white', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>保存</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 移动标签弹窗 ─── */}
      {showMoveModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ width: '100%', background: 'white', borderRadius: '20px 20px 0 0', padding: 20 }}>
            <div style={{ fontWeight: 600, fontSize: 17, marginBottom: 16, textAlign: 'center' }}>移动到其他分组</div>

            <label style={labelStyle}>目标分组</label>
            <select
              value={moveToCatId}
              onChange={e => setMoveToCatId(parseInt(e.target.value))}
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, marginBottom: 20 }}>
              {tagCategories.map(c => (
                <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
              ))}
            </select>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowMoveModal(false)}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #e5e7eb', background: '#f9fafb', fontSize: 15, cursor: 'pointer' }}>取消</button>
              <button onClick={moveTag}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: 'none', background: '#3b82f6', color: 'white', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>确认移动</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
