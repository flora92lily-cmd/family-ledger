import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import {
  transactionApi, categoryApi, tagApi, memberApi,
  type Transaction, type CategoryTree, type Tag, type FamilyMember,
} from '../api'
import { TransactionCard } from '../components/TransactionCard'
import { TxnDetailSheet } from '../components/TxnDetailSheet'

type Filters = {
  q: string
  start_date: string
  end_date: string
  min_amount: string
  max_amount: string
  member_id: number | null  // null=全部, 0=未指定, >0=成员
  category_id: number | null
  tag_ids: number[]
}

const EMPTY: Filters = {
  q: '', start_date: '', end_date: '',
  min_amount: '', max_amount: '',
  member_id: null, category_id: null, tag_ids: [],
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 12px',
  border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, outline: 'none',
}

export default function SearchPage() {
  const navigate = useNavigate()
  const [filters, setFilters] = useState<Filters>(EMPTY)
  const [results, setResults] = useState<Transaction[]>([])
  const [searched, setSearched] = useState(false)  // 是否触发过搜索（控制提示语）
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Transaction | null>(null)

  const [catTree, setCatTree] = useState<CategoryTree[]>([])
  const [catSheetOpen, setCatSheetOpen] = useState(false)
  const [catTab, setCatTab] = useState<'expense' | 'income'>('expense')
  const [expandedParent, setExpandedParent] = useState<number | null>(null)

  const [allTags, setAllTags] = useState<Tag[]>([])
  const [members, setMembers] = useState<FamilyMember[]>([])

  // 加载下拉数据
  useEffect(() => {
    Promise.all([categoryApi.tree(), tagApi.list({ include_archived: false }), memberApi.list()])
      .then(([c, t, m]) => {
        setCatTree(c.data)
        setAllTags(t.data)
        setMembers(m.data)
      })
  }, [])

  // 从编辑页返回时恢复 filter（仅恢复一次）
  useEffect(() => {
    const raw = sessionStorage.getItem('search:returnState')
    if (!raw) return
    sessionStorage.removeItem('search:returnState')
    try {
      setFilters(JSON.parse(raw))
    } catch { /* ignore */ }
  }, [])

  // 判断是否所有 filter 都是空（无搜索条件）
  const isEmpty = useMemo(() => (
    !filters.q.trim() &&
    !filters.start_date && !filters.end_date &&
    !filters.min_amount && !filters.max_amount &&
    filters.member_id == null &&
    filters.category_id == null &&
    filters.tag_ids.length === 0
  ), [filters])

  // debounce 触发搜索
  useEffect(() => {
    if (isEmpty) {
      setResults([])
      setSearched(false)
      return
    }
    const handle = setTimeout(async () => {
      setLoading(true)
      const params: Record<string, unknown> = {}
      if (filters.q.trim()) params.q = filters.q.trim()
      if (filters.start_date) params.start_date = filters.start_date
      if (filters.end_date) params.end_date = filters.end_date
      if (filters.min_amount) params.min_amount = parseFloat(filters.min_amount)
      if (filters.max_amount) params.max_amount = parseFloat(filters.max_amount)
      if (filters.member_id != null) params.member_id = filters.member_id
      if (filters.category_id != null) params.category_id = filters.category_id
      if (filters.tag_ids.length > 0) params.tag_ids = filters.tag_ids
      try {
        const r = await transactionApi.list(params)
        setResults(r.data)
        setSearched(true)
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(handle)
  }, [filters, isEmpty])

  const handleDelete = async (txn: Transaction) => {
    if (!confirm('确认删除这条记录？')) return
    await transactionApi.delete(txn.id)
    setSelected(null)
    setResults(prev => prev.filter(t => t.id !== txn.id))
  }

  const handleEdit = (txn: Transaction) => {
    setSelected(null)
    sessionStorage.setItem('search:returnState', JSON.stringify(filters))
    navigate(`/add?id=${txn.id}`)
  }

  // 选中的分类显示文本
  const selectedCategoryLabel = useMemo(() => {
    if (filters.category_id == null) return '不限'
    for (const parent of catTree) {
      if (parent.id === filters.category_id) return `${parent.icon} ${parent.name}（含子类）`
      const child = parent.children.find(c => c.id === filters.category_id)
      if (child) return `${child.icon} ${child.name}`
    }
    return '不限'
  }, [filters.category_id, catTree])

  // 标签按分类分组
  const tagsByCategory = useMemo(() => {
    const groups: Record<number, { name: string; icon: string; tags: Tag[] }> = {}
    allTags.forEach(t => {
      const cat = t.category
      if (!cat) return
      if (!groups[cat.id]) groups[cat.id] = { name: cat.name, icon: cat.icon, tags: [] }
      groups[cat.id].tags.push(t)
    })
    return Object.values(groups)
  }, [allTags])

  // 按日期分组结果
  const grouped = useMemo(() => {
    return results.reduce<Record<string, Transaction[]>>((acc, txn) => {
      const d = txn.date
      if (!acc[d]) acc[d] = []
      acc[d].push(txn)
      return acc
    }, {})
  }, [results])

  const dayName = (d: string) => ['周日','周一','周二','周三','周四','周五','周六'][dayjs(d).day()]

  const filteredCatTree = catTree.filter(c => c.type === catTab)

  return (
    <div className="form-page">
      <div className="page-header">
        <button className="back-btn" onClick={() => navigate('/')}>←</button>
        搜索账单
      </div>

      <div style={{ padding: '12px 16px' }}>
        {/* 关键词 */}
        <label style={labelStyle}>关键词（备注 / 交易对方）</label>
        <input
          style={{ ...inputStyle, marginBottom: 12 }}
          placeholder="如：星巴克、地铁、工资"
          value={filters.q}
          onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
        />

        {/* 日期范围 */}
        <label style={labelStyle}>日期范围</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            style={inputStyle}
            type="date"
            value={filters.start_date}
            onChange={e => setFilters(f => ({ ...f, start_date: e.target.value }))}
          />
          <input
            style={inputStyle}
            type="date"
            value={filters.end_date}
            onChange={e => setFilters(f => ({ ...f, end_date: e.target.value }))}
          />
        </div>

        {/* 金额范围 */}
        <label style={labelStyle}>金额范围</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
          <input
            style={inputStyle}
            type="number"
            placeholder="最低"
            value={filters.min_amount}
            onChange={e => setFilters(f => ({ ...f, min_amount: e.target.value }))}
          />
          <span style={{ color: '#9ca3af' }}>—</span>
          <input
            style={inputStyle}
            type="number"
            placeholder="最高"
            value={filters.max_amount}
            onChange={e => setFilters(f => ({ ...f, max_amount: e.target.value }))}
          />
        </div>

        {/* 家庭成员 */}
        <label style={labelStyle}>家庭成员</label>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          <FilterChip
            active={filters.member_id == null}
            onClick={() => setFilters(f => ({ ...f, member_id: null }))}
          >全部</FilterChip>
          {members.map(m => (
            <FilterChip
              key={m.id}
              active={filters.member_id === m.id}
              onClick={() => setFilters(f => ({ ...f, member_id: m.id }))}
            >{m.avatar} {m.name}</FilterChip>
          ))}
          <FilterChip
            active={filters.member_id === 0}
            onClick={() => setFilters(f => ({ ...f, member_id: 0 }))}
          >未指定</FilterChip>
        </div>

        {/* 分类 */}
        <label style={labelStyle}>分类</label>
        <button
          onClick={() => setCatSheetOpen(true)}
          style={{
            ...inputStyle, marginBottom: 12, background: 'white', textAlign: 'left',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
          }}
        >
          <span style={{ color: filters.category_id == null ? '#9ca3af' : '#111827' }}>
            {selectedCategoryLabel}
          </span>
          <span style={{ color: '#9ca3af', fontSize: 12 }}>
            {filters.category_id != null && (
              <span
                onClick={(e) => { e.stopPropagation(); setFilters(f => ({ ...f, category_id: null })) }}
                style={{ marginRight: 8, color: '#ef4444', cursor: 'pointer' }}
              >清除</span>
            )}
            ▾
          </span>
        </button>

        {/* 标签 */}
        {tagsByCategory.length > 0 && (
          <>
            <label style={labelStyle}>标签（多选，任一命中）</label>
            <div style={{ marginBottom: 12 }}>
              {tagsByCategory.map(group => (
                <div key={group.name} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>
                    {group.icon} {group.name}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {group.tags.map(t => {
                      const checked = filters.tag_ids.includes(t.id)
                      return (
                        <FilterChip
                          key={t.id}
                          active={checked}
                          onClick={() => setFilters(f => ({
                            ...f,
                            tag_ids: checked ? f.tag_ids.filter(id => id !== t.id) : [...f.tag_ids, t.id],
                          }))}
                        >{t.icon} {t.name}</FilterChip>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* 重置按钮 */}
        <button
          onClick={() => setFilters(EMPTY)}
          disabled={isEmpty}
          style={{
            width: '100%', padding: 10, borderRadius: 8, fontSize: 14, cursor: isEmpty ? 'default' : 'pointer',
            border: '1px solid #e5e7eb',
            background: isEmpty ? '#f9fafb' : 'white',
            color: isEmpty ? '#d1d5db' : '#374151',
            marginBottom: 16,
          }}
        >重置筛选</button>

        {/* 结果区 */}
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
          {isEmpty ? (
            <div style={{ textAlign: 'center', padding: '40px 16px', color: '#9ca3af', fontSize: 14 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>🔍</div>
              <div>输入或选择条件后开始搜索</div>
            </div>
          ) : loading && results.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px', color: '#9ca3af', fontSize: 13 }}>搜索中…</div>
          ) : results.length === 0 && searched ? (
            <div style={{ textAlign: 'center', padding: '40px 16px', color: '#9ca3af', fontSize: 14 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>📭</div>
              <div>无匹配账单</div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
                共 {results.length} 条结果{results.length >= 500 && '（已截断至 500 条）'}
              </div>
              <div className="txn-list" style={{ paddingTop: 0 }}>
                {Object.entries(grouped).map(([date, txns]) => (
                  <div key={date} className="txn-date-group">
                    <div className="date-header">
                      {dayjs(date).format('YYYY年MM月DD日')} {dayName(date)}
                    </div>
                    {txns.map(txn => (
                      <TransactionCard key={txn.id} txn={txn} onClick={setSelected} />
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 分类选择 sheet */}
      {catSheetOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}
          onClick={() => setCatSheetOpen(false)}
        >
          <div
            style={{ width: '100%', background: 'white', borderRadius: '20px 20px 0 0', padding: 20, maxHeight: '75vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>选择分类</span>
              <button
                onClick={() => { setFilters(f => ({ ...f, category_id: null })); setCatSheetOpen(false) }}
                style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 13, cursor: 'pointer' }}
              >清除选择</button>
            </div>

            {/* 类型 tab */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {(['expense', 'income'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setCatTab(t)}
                  style={{
                    flex: 1, padding: '8px 0', borderRadius: 20, fontSize: 14, cursor: 'pointer',
                    border: catTab === t ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                    background: catTab === t ? '#eff6ff' : 'white',
                    color: catTab === t ? '#3b82f6' : '#374151',
                    fontWeight: catTab === t ? 600 : 400,
                  }}
                >
                  {t === 'expense' ? '📤 支出' : '📥 收入'}
                </button>
              ))}
            </div>

            <div>
              {filteredCatTree.map(parent => (
                <div key={parent.id} style={{ marginBottom: 4 }}>
                  <button
                    onClick={() => setExpandedParent(expandedParent === parent.id ? null : parent.id)}
                    style={{
                      width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 14, cursor: 'pointer',
                      border: '1px solid #e5e7eb', background: '#f9fafb', textAlign: 'left',
                      display: 'flex', justifyContent: 'space-between',
                    }}
                  >
                    <span>{parent.icon} {parent.name}</span>
                    <span style={{ color: '#9ca3af' }}>{expandedParent === parent.id ? '▲' : '▼'}</span>
                  </button>
                  {expandedParent === parent.id && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '6px 0 6px 8px' }}>
                      <button
                        onClick={() => { setFilters(f => ({ ...f, category_id: parent.id })); setCatSheetOpen(false) }}
                        style={{
                          padding: '6px 14px', borderRadius: 16, fontSize: 12, cursor: 'pointer',
                          border: filters.category_id === parent.id ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                          background: filters.category_id === parent.id ? '#eff6ff' : 'white',
                          color: filters.category_id === parent.id ? '#3b82f6' : '#374151',
                          fontWeight: filters.category_id === parent.id ? 600 : 400,
                        }}
                      >
                        {parent.icon} {parent.name}（含全部子类）
                      </button>
                      {parent.children.map(child => (
                        <button
                          key={child.id}
                          onClick={() => { setFilters(f => ({ ...f, category_id: child.id })); setCatSheetOpen(false) }}
                          style={{
                            padding: '6px 14px', borderRadius: 16, fontSize: 12, cursor: 'pointer',
                            border: filters.category_id === child.id ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                            background: filters.category_id === child.id ? '#eff6ff' : 'white',
                            color: filters.category_id === child.id ? '#3b82f6' : '#374151',
                            fontWeight: filters.category_id === child.id ? 600 : 400,
                          }}
                        >
                          {child.icon} {child.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {filteredCatTree.length === 0 && (
                <div style={{ fontSize: 13, color: '#9ca3af', padding: '12px 0', textAlign: 'center' }}>
                  暂无该类型分类
                </div>
              )}
            </div>

            <button
              onClick={() => setCatSheetOpen(false)}
              style={{
                width: '100%', padding: 10, marginTop: 12, borderRadius: 8, fontSize: 14, cursor: 'pointer',
                border: '1px solid #e5e7eb', background: '#f9fafb', color: '#374151',
              }}
            >关闭</button>
          </div>
        </div>
      )}

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

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 12px', borderRadius: 16, fontSize: 12, cursor: 'pointer',
        border: active ? '2px solid #3b82f6' : '1px solid #e5e7eb',
        background: active ? '#eff6ff' : 'white',
        color: active ? '#3b82f6' : '#374151',
        fontWeight: active ? 600 : 400,
      }}
    >{children}</button>
  )
}
