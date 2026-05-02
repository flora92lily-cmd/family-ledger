import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  categoryApi,
  type Category, type CategoryTree,
} from '../api'

const COMMON_ICONS = ['📦', '🍜', '🚗', '🛒', '🏠', '🏥', '📚', '🎮', '📱', '👔', '🎁', '💰', '💵', '🏆', '📈', '🧧', '💎', '✈️', '🐾', '🍺', '⚽', '💄', '🔧', '🏷️']

const EMPTY_CAT_FORM = {
  name: '',
  icon: '📦',
  type: 'expense' as 'expense' | 'income',
  keywords: '',
  parent_id: null as number | null,
  sort_order: 0,
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, color: '#6b7280', marginBottom: 4 }
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px',
  border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 15, marginBottom: 14, outline: 'none',
}

export default function CategoryPage() {
  const navigate = useNavigate()

  const [catTree, setCatTree] = useState<CategoryTree[]>([])
  const [allCats, setAllCats] = useState<Category[]>([])
  const [catTab, setCatTab] = useState<'expense' | 'income'>('expense')
  const [showCatModal, setShowCatModal] = useState(false)
  const [editCatId, setEditCatId] = useState<number | null>(null)
  const [catForm, setCatForm] = useState({ ...EMPTY_CAT_FORM })

  const loadCategories = async () => {
    const [tree, flat] = await Promise.all([categoryApi.tree(), categoryApi.list()])
    setCatTree(tree.data)
    setAllCats(flat.data)
  }

  useEffect(() => {
    loadCategories()
  }, [])

  const filteredTree = catTree.filter(c => c.type === catTab)
  const parentOptions = allCats.filter(c => c.type === catForm.type && c.parent_id === null && c.id !== editCatId)

  const openAddCat = (type: 'expense' | 'income', parent_id: number | null = null) => {
    setEditCatId(null)
    setCatForm({ ...EMPTY_CAT_FORM, type, parent_id })
    setShowCatModal(true)
  }

  const openEditCat = (c: Category) => {
    setEditCatId(c.id)
    setCatForm({
      name: c.name,
      icon: c.icon,
      type: c.type as 'expense' | 'income',
      keywords: c.keywords,
      parent_id: c.parent_id,
      sort_order: c.sort_order,
    })
    setShowCatModal(true)
  }

  const saveCat = async () => {
    if (!catForm.name.trim()) return alert('请输入分类名称')
    if (editCatId !== null) {
      await categoryApi.update(editCatId, catForm)
    } else {
      await categoryApi.create(catForm)
    }
    setShowCatModal(false)
    loadCategories()
  }

  const deleteCat = async (c: Category) => {
    const label = c.parent_id ? `子分类「${c.name}」` : `分类「${c.name}」（下属子分类将移至一级）`
    if (!confirm(`确认删除${label}？`)) return
    await categoryApi.delete(c.id)
    loadCategories()
  }

  return (
    <div className="form-page">
      <div className="page-header">
        <button className="back-btn" onClick={() => navigate('/settings')}>←</button>
        分类管理
      </div>

      <div style={{ padding: '0 16px 16px' }}>
        {/* 支出/收入切换 + 添加按钮 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div className="type-toggle" style={{ flex: 1 }}>
            <button className={catTab === 'expense' ? 'active' : ''} onClick={() => setCatTab('expense')}>支出</button>
            <button className={catTab === 'income' ? 'active' : ''} onClick={() => setCatTab('income')}>收入</button>
          </div>
          <button
            onClick={() => openAddCat(catTab)}
            style={{
              background: 'var(--primary)', color: 'white', border: 'none',
              borderRadius: 8, fontSize: 14, fontWeight: 600,
              padding: '8px 16px', cursor: 'pointer', whiteSpace: 'nowrap',
            }}>
            + 新建
          </button>
        </div>

        {/* 分类树 */}
        {filteredTree.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 13, padding: '32px 0' }}>
            暂无分类，点击「+ 新建」添加
          </div>
        ) : (
          filteredTree.map(parent => (
            <div key={parent.id} className="card" style={{ marginBottom: 10, padding: '10px 14px' }}>
              {/* 父分类行 */}
              <div style={{ display: 'flex', alignItems: 'center', paddingBottom: 6, borderBottom: parent.children.length > 0 ? '1px solid #f3f4f6' : 'none' }}>
                <span style={{ fontSize: 20, marginRight: 8 }}>{parent.icon}</span>
                <span style={{ fontSize: 15, fontWeight: 600, flex: 1 }}>{parent.name}</span>
                <button onClick={() => openAddCat(catTab, parent.id)}
                  style={{ background: 'none', border: 'none', fontSize: 12, color: '#3b82f6', cursor: 'pointer', marginRight: 8 }}>
                  +子分类
                </button>
                <button onClick={() => openEditCat(parent)}
                  style={{ background: 'none', border: 'none', fontSize: 12, color: '#6b7280', cursor: 'pointer', marginRight: 6 }}>
                  编辑
                </button>
                <button onClick={() => deleteCat(parent)}
                  style={{ background: 'none', border: 'none', fontSize: 12, color: '#ef4444', cursor: 'pointer' }}>
                  删除
                </button>
              </div>

              {/* 子分类列表 */}
              {parent.children.map((child, idx) => (
                <div key={child.id} style={{
                  display: 'flex', alignItems: 'center', padding: '6px 0 6px 28px',
                  borderBottom: idx < parent.children.length - 1 ? '1px solid #f9fafb' : 'none',
                }}>
                  <span style={{ fontSize: 16, marginRight: 8 }}>{child.icon}</span>
                  <span style={{ fontSize: 13, flex: 1, color: '#374151' }}>{child.name}</span>
                  {child.keywords && (
                    <span style={{ fontSize: 11, color: '#9ca3af', marginRight: 8, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {child.keywords}
                    </span>
                  )}
                  <button onClick={() => openEditCat(child)}
                    style={{ background: 'none', border: 'none', fontSize: 12, color: '#6b7280', cursor: 'pointer', marginRight: 6 }}>
                    编辑
                  </button>
                  <button onClick={() => deleteCat(child)}
                    style={{ background: 'none', border: 'none', fontSize: 12, color: '#ef4444', cursor: 'pointer' }}>
                    删除
                  </button>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {/* 分类编辑弹窗 */}
      {showCatModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ width: '100%', background: 'white', borderRadius: '20px 20px 0 0', padding: 20, maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ fontWeight: 600, fontSize: 17, marginBottom: 16, textAlign: 'center' }}>
              {editCatId !== null ? '编辑分类' : '新建分类'}
            </div>

            {editCatId === null && catForm.parent_id === null && (
              <>
                <label style={labelStyle}>类型</label>
                <div className="type-toggle" style={{ marginBottom: 14 }}>
                  <button className={catForm.type === 'expense' ? 'active' : ''} onClick={() => setCatForm(f => ({ ...f, type: 'expense' }))}>支出</button>
                  <button className={catForm.type === 'income' ? 'active' : ''} onClick={() => setCatForm(f => ({ ...f, type: 'income' }))}>收入</button>
                </div>
              </>
            )}

            <label style={labelStyle}>所属一级分类（为空则为一级分类）</label>
            <select
              value={catForm.parent_id ?? ''}
              onChange={e => setCatForm(f => ({ ...f, parent_id: e.target.value ? parseInt(e.target.value) : null }))}
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, marginBottom: 14 }}>
              <option value="">无（一级分类）</option>
              {parentOptions.map(p => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
            </select>

            <label style={labelStyle}>名称 *</label>
            <input style={inputStyle} placeholder="分类名称"
              value={catForm.name} onChange={e => setCatForm(f => ({ ...f, name: e.target.value }))} />

            <label style={labelStyle}>图标</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {COMMON_ICONS.map(ico => (
                <button key={ico} onClick={() => setCatForm(f => ({ ...f, icon: ico }))}
                  style={{
                    width: 36, height: 36, fontSize: 20, cursor: 'pointer', borderRadius: 8,
                    border: catForm.icon === ico ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                    background: catForm.icon === ico ? '#eff6ff' : 'white',
                  }}>
                  {ico}
                </button>
              ))}
            </div>

            <label style={labelStyle}>关键词（逗号分隔，用于智能分类）</label>
            <input style={inputStyle} placeholder="如：咖啡,下午茶,奶茶"
              value={catForm.keywords} onChange={e => setCatForm(f => ({ ...f, keywords: e.target.value }))} />

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button onClick={() => setShowCatModal(false)}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #e5e7eb', background: '#f9fafb', fontSize: 15, cursor: 'pointer' }}>
                取消
              </button>
              <button onClick={saveCat}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: 'none', background: '#3b82f6', color: 'white', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
