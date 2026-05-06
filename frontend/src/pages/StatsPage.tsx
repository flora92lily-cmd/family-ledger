import { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import {
  statsApi,
  type MonthlySummaryStats,
  type CategoryBreakdownItem,
  type MemberBreakdownItem,
  type TagBreakdownGroup,
  type MerchantItem,
  type StatCompareValue,
} from '../api'

const COLORS = [
  '#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#F44336',
  '#009688', '#FF5722', '#795548', '#607D8B', '#E91E63',
  '#3F51B5', '#00BCD4', '#8BC34A', '#FFC107',
]

type TopTab = 'monthly' | 'annual' | 'asset' | 'allocation'
type SubTab = 'category' | 'member' | 'tag' | 'merchant'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPct(pct: number | null | undefined): string {
  if (pct == null) return '—'
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`
}

function pctColor(pct: number | null | undefined, isExpense: boolean): string {
  if (pct == null) return '#bbb'
  const up = pct > 0
  return isExpense ? (up ? '#f44336' : '#4caf50') : (up ? '#4caf50' : '#f44336')
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PctBadge({ pct, label, isExpense }: { pct: number | null; label: string; isExpense: boolean }) {
  return (
    <span style={{ fontSize: 11, color: pctColor(pct, isExpense) }}>
      {label} {pct == null ? '—' : (pct > 0 ? '↑' : '↓') + Math.abs(pct).toFixed(1) + '%'}
    </span>
  )
}

function SummaryCard({ label, data, isExpense, accent }: {
  label: string; data?: StatCompareValue; isExpense?: boolean; accent: string
}) {
  return (
    <div style={{
      flex: 1, minWidth: 0, padding: '10px 12px', background: '#fff',
      borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: accent }}>
        ¥{(data?.current ?? 0).toFixed(0)}
      </div>
      <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 10, color: pctColor(data?.prev_month_pct, !!isExpense) }}>
          环比 {fmtPct(data?.prev_month_pct)}
        </span>
        <span style={{ fontSize: 10, color: pctColor(data?.prev_year_pct, !!isExpense) }}>
          同比 {fmtPct(data?.prev_year_pct)}
        </span>
      </div>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="empty-state" style={{ padding: '40px 0' }}>
      <div className="empty-icon">📊</div>
      <p>{text}</p>
    </div>
  )
}

function CategoryView({ data, viewType }: { data: CategoryBreakdownItem[]; viewType: string }) {
  const [expanded, setExpanded] = useState<number | null>(null)
  const isExpense = viewType === 'expense'

  if (data.length === 0) return <EmptyState text={`本月没有${isExpense ? '支出' : '收入'}数据`} />

  return (
    <div>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2} dataKey="total">
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip formatter={(v: number) => [`¥${v.toFixed(2)}`, '']} />
        </PieChart>
      </ResponsiveContainer>

      <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
        {data.map((cat, i) => (
          <div key={cat.id}>
            <div
              style={{
                display: 'flex', alignItems: 'center', padding: '10px 14px', gap: 8,
                cursor: cat.children.length > 0 ? 'pointer' : 'default',
                borderTop: i > 0 ? '1px solid #f5f5f5' : 'none',
              }}
              onClick={() => cat.children.length > 0 && setExpanded(expanded === cat.id ? null : cat.id)}
            >
              <span style={{ fontSize: 18, flexShrink: 0 }}>{cat.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 14, color: '#333' }}>{cat.name}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {cat.children.length > 0 && (
                      <span style={{ fontSize: 10, color: '#bbb' }}>{expanded === cat.id ? '▲' : '▼'}</span>
                    )}
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#333' }}>¥{cat.total.toFixed(2)}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <div style={{ flex: 1, height: 3, background: '#f0f0f0', borderRadius: 2 }}>
                    <div style={{ width: `${cat.percentage}%`, height: '100%', background: COLORS[i % COLORS.length], borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: 10, color: '#aaa', minWidth: 32, textAlign: 'right' }}>{cat.percentage.toFixed(1)}%</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <PctBadge pct={cat.prev_month_pct} label="环比" isExpense={isExpense} />
                  <PctBadge pct={cat.prev_year_pct} label="同比" isExpense={isExpense} />
                </div>
              </div>
            </div>

            {expanded === cat.id && cat.children.map(child => (
              <div key={child.id} style={{
                display: 'flex', alignItems: 'center', padding: '8px 14px 8px 42px', gap: 8,
                background: '#fafafa', borderTop: '1px solid #f0f0f0',
              }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>{child.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 13, color: '#555' }}>{child.name}</span>
                    <span style={{ fontSize: 13, color: '#555' }}>¥{child.total.toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ flex: 1, height: 2, background: '#eee', borderRadius: 1 }}>
                      <div style={{ width: `${child.percentage}%`, height: '100%', background: COLORS[i % COLORS.length], opacity: 0.55, borderRadius: 1 }} />
                    </div>
                    <span style={{ fontSize: 10, color: '#bbb', minWidth: 32, textAlign: 'right' }}>{child.percentage.toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function MemberView({ data, viewType }: { data: MemberBreakdownItem[]; viewType: string }) {
  const isExpense = viewType === 'expense'
  if (data.length === 0) return <EmptyState text="本月没有成员数据" />

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {data.map((m, i) => (
        <div key={m.member_id ?? 'null'} style={{
          display: 'flex', alignItems: 'center', padding: '12px 14px', gap: 10,
          borderTop: i > 0 ? '1px solid #f5f5f5' : 'none',
        }}>
          <span style={{ fontSize: 22, flexShrink: 0 }}>{m.member_avatar}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 14, color: '#333' }}>{m.member_name}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#333' }}>¥{m.total.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              <div style={{ flex: 1, height: 4, background: '#f0f0f0', borderRadius: 2 }}>
                <div style={{ width: `${m.percentage}%`, height: '100%', background: '#2196F3', borderRadius: 2 }} />
              </div>
              <span style={{ fontSize: 10, color: '#aaa', minWidth: 32, textAlign: 'right' }}>{m.percentage.toFixed(1)}%</span>
            </div>
            <PctBadge pct={m.prev_month_pct} label="环比" isExpense={isExpense} />
          </div>
        </div>
      ))}
    </div>
  )
}

function TagView({ data }: { data: TagBreakdownGroup[] }) {
  if (data.length === 0) return <EmptyState text="本月没有标签数据" />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {data.map(group => (
        <div key={group.tag_category_id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '8px 14px', background: '#f8f8f8', fontSize: 12, color: '#666', fontWeight: 600 }}>
            {group.tag_category_icon} {group.tag_category_name}
            <span style={{ float: 'right', fontWeight: 400 }}>¥{group.total.toFixed(2)}</span>
          </div>
          {group.tags.map((tag, i) => (
            <div key={tag.tag_id} style={{
              display: 'flex', alignItems: 'center', padding: '10px 14px', gap: 8,
              borderTop: '1px solid #f0f0f0',
            }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>{tag.tag_icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 14, color: '#333' }}>{tag.tag_name}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#333' }}>¥{tag.total.toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ flex: 1, height: 3, background: '#f0f0f0', borderRadius: 2 }}>
                    <div style={{ width: `${Math.min(tag.percentage, 100)}%`, height: '100%', background: COLORS[i % COLORS.length], borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: 10, color: '#aaa', minWidth: 32, textAlign: 'right' }}>{tag.percentage.toFixed(1)}%</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function MerchantView({ data }: { data: MerchantItem[] }) {
  if (data.length === 0) return <EmptyState text="本月没有商户数据" />

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {data.map((m, i) => (
        <div key={m.counterparty} style={{
          display: 'flex', alignItems: 'center', padding: '10px 14px', gap: 10,
          borderTop: i > 0 ? '1px solid #f5f5f5' : 'none',
        }}>
          <div style={{
            width: 26, height: 26, borderRadius: '50%', background: COLORS[i % COLORS.length],
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 12, fontWeight: 700, flexShrink: 0,
          }}>
            {i + 1}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 14, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.counterparty}
              </span>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#333', flexShrink: 0, marginLeft: 8 }}>
                ¥{m.total.toFixed(2)}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ flex: 1, height: 3, background: '#f0f0f0', borderRadius: 2 }}>
                <div style={{ width: `${m.percentage}%`, height: '100%', background: COLORS[i % COLORS.length], borderRadius: 2 }} />
              </div>
              <span style={{ fontSize: 10, color: '#aaa' }}>{m.count} 笔 · {m.percentage.toFixed(1)}%</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function StatsPage() {
  const now = dayjs()
  const [topTab, setTopTab] = useState<TopTab>('monthly')
  const [period, setPeriod] = useState({ year: now.year(), month: now.month() + 1 })
  const { year, month } = period
  const [viewType, setViewType] = useState<'expense' | 'income'>('expense')
  const [subTab, setSubTab] = useState<SubTab>('category')

  const [summary, setSummary] = useState<MonthlySummaryStats | null>(null)
  const [categories, setCategories] = useState<CategoryBreakdownItem[]>([])
  const [members, setMembers] = useState<MemberBreakdownItem[]>([])
  const [tags, setTags] = useState<TagBreakdownGroup[]>([])
  const [merchants, setMerchants] = useState<MerchantItem[]>([])
  const [loading, setLoading] = useState(false)

  const isCurrentMonth = year === now.year() && month === now.month() + 1

  const prevMonth = () => setPeriod(p =>
    p.month === 1 ? { year: p.year - 1, month: 12 } : { year: p.year, month: p.month - 1 }
  )
  const nextMonth = () => {
    if (isCurrentMonth) return
    setPeriod(p => p.month === 12 ? { year: p.year + 1, month: 1 } : { year: p.year, month: p.month + 1 })
  }

  useEffect(() => {
    if (topTab !== 'monthly') return
    statsApi.monthlySummary(year, month).then(r => setSummary(r.data)).catch(() => {})
  }, [year, month, topTab])

  useEffect(() => {
    if (topTab !== 'monthly') return
    setLoading(true)
    const load =
      subTab === 'category' ? statsApi.categoryBreakdown(year, month, viewType).then(r => setCategories(r.data)) :
      subTab === 'member'   ? statsApi.memberBreakdown(year, month, viewType).then(r => setMembers(r.data)) :
      subTab === 'tag'      ? statsApi.tagBreakdown(year, month, viewType).then(r => setTags(r.data)) :
      statsApi.topMerchants(year, month, viewType).then(r => setMerchants(r.data))
    load.finally(() => setLoading(false))
  }, [year, month, viewType, subTab, topTab])

  const TOP_TABS: { key: TopTab; label: string }[] = [
    { key: 'monthly', label: '月度' },
    { key: 'annual', label: '年度' },
    { key: 'asset', label: '资产' },
    { key: 'allocation', label: '配置' },
  ]
  const SUB_TABS: { key: SubTab; label: string }[] = [
    { key: 'category', label: '分类' },
    { key: 'member', label: '成员' },
    { key: 'tag', label: '标签' },
    { key: 'merchant', label: 'TOP 商户' },
  ]
  const PLACEHOLDER_LABELS: Partial<Record<TopTab, string>> = {
    annual: '年度报表', asset: '资产负债表', allocation: '配置分析',
  }

  return (
    <div className="page-content" style={{ padding: 0 }}>
      {/* Top-level tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #eee', background: '#fff', position: 'sticky', top: 0, zIndex: 10 }}>
        {TOP_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTopTab(key)}
            style={{
              flex: 1, padding: '12px 0', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 14, fontWeight: topTab === key ? 600 : 400,
              color: topTab === key ? '#4caf50' : '#666',
              borderBottom: topTab === key ? '2px solid #4caf50' : '2px solid transparent',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Monthly tab */}
      {topTab === 'monthly' && (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Month navigation */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
            <button onClick={prevMonth} style={{ fontSize: 22, background: 'none', border: 'none', cursor: 'pointer', color: '#333', padding: '4px 8px', lineHeight: 1 }}>‹</button>
            <span style={{ fontSize: 16, fontWeight: 600, color: '#333', minWidth: 96, textAlign: 'center' }}>
              {year}-{String(month).padStart(2, '0')}
            </span>
            <button onClick={nextMonth} style={{ fontSize: 22, background: 'none', border: 'none', cursor: isCurrentMonth ? 'default' : 'pointer', color: isCurrentMonth ? '#ccc' : '#333', padding: '4px 8px', lineHeight: 1 }}>›</button>
          </div>

          {/* Summary cards */}
          <div style={{ display: 'flex', gap: 8 }}>
            <SummaryCard label="总支出" data={summary?.expense} isExpense accent="#f44336" />
            <SummaryCard label="总收入" data={summary?.income} accent="#4caf50" />
            <SummaryCard label="结余" data={summary?.balance} accent="#2196F3" />
          </div>

          {/* Type toggle */}
          <div className="type-toggle">
            <button className={viewType === 'expense' ? 'active' : ''} onClick={() => setViewType('expense')}>支出</button>
            <button className={viewType === 'income' ? 'active' : ''} onClick={() => setViewType('income')}>收入</button>
          </div>

          {/* Sub-tabs */}
          <div style={{ display: 'flex', background: '#fff', borderBottom: '1px solid #eee', margin: '0 -16px', padding: '0 16px' }}>
            {SUB_TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setSubTab(key)}
                style={{
                  flex: 1, padding: '8px 0', border: 'none', background: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: subTab === key ? 600 : 400,
                  color: subTab === key ? '#333' : '#888',
                  borderBottom: subTab === key ? '2px solid #333' : '2px solid transparent',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Sub-tab content */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: 32, color: '#bbb', fontSize: 14 }}>加载中…</div>
          ) : (
            <>
              {subTab === 'category' && <CategoryView data={categories} viewType={viewType} />}
              {subTab === 'member'   && <MemberView data={members} viewType={viewType} />}
              {subTab === 'tag'      && <TagView data={tags} />}
              {subTab === 'merchant' && <MerchantView data={merchants} />}
            </>
          )}
        </div>
      )}

      {/* Placeholder tabs */}
      {topTab !== 'monthly' && (
        <div className="empty-state" style={{ paddingTop: 80 }}>
          <div className="empty-icon">🚧</div>
          <p>{PLACEHOLDER_LABELS[topTab]}即将上线</p>
        </div>
      )}
    </div>
  )
}
