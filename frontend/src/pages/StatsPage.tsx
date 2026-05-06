import { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from 'recharts'
import {
  statsApi,
  accountApi,
  type Account,
  type MonthlySummaryStats,
  type CategoryBreakdownItem,
  type MemberBreakdownItem,
  type TagBreakdownGroup,
  type MerchantItem,
  type StatCompareValue,
  type AnnualReport,
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
  const [annualYear, setAnnualYear] = useState(now.year())
  const [annualType, setAnnualType] = useState<'expense' | 'income'>('expense')
  const [viewType, setViewType] = useState<'expense' | 'income'>('expense')
  const [subTab, setSubTab] = useState<SubTab>('category')

  const [summary, setSummary] = useState<MonthlySummaryStats | null>(null)
  const [categories, setCategories] = useState<CategoryBreakdownItem[]>([])
  const [members, setMembers] = useState<MemberBreakdownItem[]>([])
  const [tags, setTags] = useState<TagBreakdownGroup[]>([])
  const [merchants, setMerchants] = useState<MerchantItem[]>([])
  const [loading, setLoading] = useState(false)
  const [annualData, setAnnualData] = useState<AnnualReport | null>(null)
  const [annualLoading, setAnnualLoading] = useState(false)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [assetLoading, setAssetLoading] = useState(false)

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

  useEffect(() => {
    if (topTab !== 'annual') return
    setAnnualLoading(true)
    statsApi.annual(annualYear, annualType).then(r => setAnnualData(r.data)).finally(() => setAnnualLoading(false))
  }, [annualYear, annualType, topTab])

  useEffect(() => {
    if (topTab !== 'asset') return
    setAssetLoading(true)
    accountApi.list().then(r => setAccounts(r.data)).finally(() => setAssetLoading(false))
  }, [topTab])

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
    asset: '资产负债表', allocation: '配置分析',
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
        <div style={{ padding: '12px 16px 80px', display: 'flex', flexDirection: 'column', gap: 12 }}>
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

      {/* Annual tab */}
      {topTab === 'annual' && (
        <div style={{ padding: '12px 16px 80px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Year navigation */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
            <button onClick={() => setAnnualYear(y => y - 1)} style={{ fontSize: 22, background: 'none', border: 'none', cursor: 'pointer', color: '#333', padding: '4px 8px', lineHeight: 1 }}>‹</button>
            <span style={{ fontSize: 16, fontWeight: 600, color: '#333', minWidth: 60, textAlign: 'center' }}>{annualYear}</span>
            <button onClick={() => setAnnualYear(y => Math.min(y + 1, now.year()))} style={{ fontSize: 22, background: 'none', border: 'none', cursor: annualYear >= now.year() ? 'default' : 'pointer', color: annualYear >= now.year() ? '#ccc' : '#333', padding: '4px 8px', lineHeight: 1 }}>›</button>
          </div>

          {annualLoading ? (
            <div style={{ textAlign: 'center', padding: 32, color: '#bbb', fontSize: 14 }}>加载中…</div>
          ) : annualData && (
            <>
              {/* 12-month bar chart */}
              <div className="card" style={{ padding: '12px 0' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#555', padding: '0 14px 8px' }}>全年收支趋势</div>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={annualData.trend} margin={{ top: 4, right: 12, left: -16, bottom: 0 }} barSize={8} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tickFormatter={m => `${m}月`} tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : `${v}`} />
                    <Tooltip formatter={(v: number, name: string) => [`¥${v.toFixed(0)}`, name === 'income' ? '收入' : name === 'expense' ? '支出' : '结余']} />
                    <Legend formatter={k => k === 'income' ? '收入' : k === 'expense' ? '支出' : '结余'} wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="income" fill="#4caf50" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="expense" fill="#f44336" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Year total summary */}
              {(() => {
                const totalInc = annualData.trend.reduce((s, m) => s + m.income, 0)
                const totalExp = annualData.trend.reduce((s, m) => s + m.expense, 0)
                return (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1, padding: '10px 12px', background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
                      <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>全年收入</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#4caf50' }}>¥{totalInc.toFixed(0)}</div>
                    </div>
                    <div style={{ flex: 1, padding: '10px 12px', background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
                      <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>全年支出</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#f44336' }}>¥{totalExp.toFixed(0)}</div>
                    </div>
                    <div style={{ flex: 1, padding: '10px 12px', background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
                      <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>全年结余</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#2196F3' }}>¥{(totalInc - totalExp).toFixed(0)}</div>
                    </div>
                  </div>
                )
              })()}

              {/* Type toggle for category/member breakdown */}
              <div className="type-toggle">
                <button className={annualType === 'expense' ? 'active' : ''} onClick={() => setAnnualType('expense')}>支出</button>
                <button className={annualType === 'income' ? 'active' : ''} onClick={() => setAnnualType('income')}>收入</button>
              </div>

              {/* Category breakdown */}
              {annualData.categories.length === 0 ? (
                <EmptyState text={`${annualYear} 年没有${annualType === 'expense' ? '支出' : '收入'}数据`} />
              ) : (
                <>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#555', marginBottom: -4 }}>分类汇总</div>
                  <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    {annualData.categories.map((cat, i) => (
                      <div key={cat.id}>
                        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', gap: 8, borderTop: i > 0 ? '1px solid #f5f5f5' : 'none' }}>
                          <span style={{ fontSize: 18, flexShrink: 0 }}>{cat.icon}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span style={{ fontSize: 14, color: '#333' }}>{cat.name}</span>
                              <span style={{ fontSize: 14, fontWeight: 600, color: '#333' }}>¥{cat.total.toFixed(0)}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ flex: 1, height: 3, background: '#f0f0f0', borderRadius: 2 }}>
                                <div style={{ width: `${cat.percentage}%`, height: '100%', background: COLORS[i % COLORS.length], borderRadius: 2 }} />
                              </div>
                              <span style={{ fontSize: 10, color: '#aaa', minWidth: 32, textAlign: 'right' }}>{cat.percentage.toFixed(1)}%</span>
                            </div>
                          </div>
                        </div>
                        {cat.children.map(child => (
                          <div key={child.id} style={{ display: 'flex', alignItems: 'center', padding: '7px 14px 7px 42px', gap: 8, background: '#fafafa', borderTop: '1px solid #f0f0f0' }}>
                            <span style={{ fontSize: 15, flexShrink: 0 }}>{child.icon}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                                <span style={{ fontSize: 13, color: '#555' }}>{child.name}</span>
                                <span style={{ fontSize: 13, color: '#555' }}>¥{child.total.toFixed(0)}</span>
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

                  {/* Member breakdown */}
                  {annualData.members.length > 0 && (
                    <>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#555', marginBottom: -4 }}>成员汇总</div>
                      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        {annualData.members.map((m, i) => (
                          <div key={m.member_id ?? 'null'} style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', gap: 10, borderTop: i > 0 ? '1px solid #f5f5f5' : 'none' }}>
                            <span style={{ fontSize: 20, flexShrink: 0 }}>{m.member_avatar}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                                <span style={{ fontSize: 14, color: '#333' }}>{m.member_name}</span>
                                <span style={{ fontSize: 14, fontWeight: 600, color: '#333' }}>¥{m.total.toFixed(0)}</span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{ flex: 1, height: 3, background: '#f0f0f0', borderRadius: 2 }}>
                                  <div style={{ width: `${m.percentage}%`, height: '100%', background: '#2196F3', borderRadius: 2 }} />
                                </div>
                                <span style={{ fontSize: 10, color: '#aaa', minWidth: 32, textAlign: 'right' }}>{m.percentage.toFixed(1)}%</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Asset/liability tab */}
      {topTab === 'asset' && (
        <div style={{ padding: '12px 16px 80px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {assetLoading ? (
            <div style={{ textAlign: 'center', padding: 32, color: '#bbb', fontSize: 14 }}>加载中…</div>
          ) : (() => {
            const ASSET_CATS = ['资金账户', '充值账户', '投资理财']
            const LIAB_CATS  = ['信用卡', '债务']
            const assets  = accounts.filter(a => ASSET_CATS.includes(a.category))
            const liabs   = accounts.filter(a => LIAB_CATS.includes(a.category))
            const totalAsset = assets.reduce((s, a) => s + Math.max(0, a.current_balance), 0)
            const totalLiab  = liabs.reduce((s, a) => s + Math.max(0, a.current_balance), 0)
            const netWorth   = totalAsset - totalLiab

            const pieData = ASSET_CATS.map(cat => ({
              name: cat,
              value: assets.filter(a => a.category === cat).reduce((s, a) => s + Math.max(0, a.current_balance), 0),
            })).filter(d => d.value > 0)

            const AccountRow = ({ acc, i }: { acc: Account; i: number }) => (
              <div key={acc.id} style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', gap: 10, borderTop: i > 0 ? '1px solid #f5f5f5' : 'none' }}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>{acc.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 14, color: '#333' }}>{acc.name}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#333' }}>¥{acc.current_balance.toFixed(2)}</span>
                  </div>
                  {acc.member && <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{acc.member.avatar} {acc.member.name}</div>}
                </div>
              </div>
            )

            return (
              <>
                {/* Net worth summary */}
                <div style={{ background: 'linear-gradient(135deg, #1976d2, #42a5f5)', borderRadius: 16, padding: '16px', color: '#fff' }}>
                  <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 4 }}>净资产</div>
                  <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>¥{netWorth.toFixed(2)}</div>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <div>
                      <div style={{ fontSize: 11, opacity: 0.8 }}>总资产</div>
                      <div style={{ fontSize: 16, fontWeight: 600 }}>¥{totalAsset.toFixed(2)}</div>
                    </div>
                    <div style={{ width: 1, background: 'rgba(255,255,255,0.3)' }} />
                    <div>
                      <div style={{ fontSize: 11, opacity: 0.8 }}>总负债</div>
                      <div style={{ fontSize: 16, fontWeight: 600 }}>¥{totalLiab.toFixed(2)}</div>
                    </div>
                  </div>
                </div>

                {/* Asset composition pie */}
                {pieData.length > 0 && (
                  <div className="card" style={{ padding: '12px 0' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#555', padding: '0 14px 8px' }}>资产构成</div>
                    <ResponsiveContainer width="100%" height={160}>
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={68} paddingAngle={2} dataKey="value" nameKey="name">
                          {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => [`¥${v.toFixed(2)}`, '']} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Asset accounts */}
                {assets.length > 0 && (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#4caf50', marginBottom: -4 }}>资产账户</div>
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                      {assets.map((a, i) => <AccountRow key={a.id} acc={a} i={i} />)}
                    </div>
                  </>
                )}

                {/* Liability accounts */}
                {liabs.length > 0 && (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#f44336', marginBottom: -4 }}>负债账户</div>
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                      {liabs.map((a, i) => <AccountRow key={a.id} acc={a} i={i} />)}
                    </div>
                  </>
                )}

                {accounts.length === 0 && <EmptyState text="请先在设置中添加账户" />}
              </>
            )
          })()}
        </div>
      )}

      {/* Allocation placeholder */}
      {topTab === 'allocation' && (
        <div className="empty-state" style={{ paddingTop: 80 }}>
          <div className="empty-icon">🚧</div>
          <p>配置分析即将上线</p>
        </div>
      )}
    </div>
  )
}
