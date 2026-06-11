import { useEffect, useState, useCallback, memo } from 'react'
import dayjs from 'dayjs'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'
import { BankIcon } from '../components/BankIcon'
import { PeriodPickerSheet } from '../components/PeriodPickerSheet'
import {
  statsApi,
  accountApi,
  memberApi,
  transactionApi,
  type FamilyMember,
  type Account,
  type MonthlySummaryStats,
  type CategoryBreakdownItem,
  type TagBreakdownGroup,
  type MerchantItem,
  type StatCompareValue,
  type AnnualReport,
  type AllocationReport,
  type NetWorthPoint,
  type DailyReport,
  type DrillDownTransaction,
} from '../api'
import { useNavigate } from 'react-router-dom'

const COLORS = [
  '#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#F44336',
  '#009688', '#FF5722', '#795548', '#607D8B', '#E91E63',
  '#3F51B5', '#00BCD4', '#8BC34A', '#FFC107',
]

type TopTab = 'monthly' | 'annual' | 'asset' | 'allocation'
type SubTab = 'category' | 'daily' | 'tag' | 'merchant'

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

const RADIAN = Math.PI / 180
function renderPieLabel({ cx, cy, midAngle, outerRadius, percent, name }: any) {
  const radius = outerRadius + 28
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  const pct = (percent * 100).toFixed(1)
  return (
    <text x={x} y={y} fill="#666" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={11}>
      {name} {pct}%
    </text>
  )
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

const CategoryView = memo(function CategoryView({ data, viewType, onDrillDown }: { data: CategoryBreakdownItem[]; viewType: string; onDrillDown: (params: {category_id?: number; tag_id?: number; counterparty?: string; title: string}) => void }) {
  const [expanded, setExpanded] = useState<number | null>(null)
  const isExpense = viewType === 'expense'

  if (data.length === 0) return <EmptyState text={`本月没有${isExpense ? '支出' : '收入'}数据`} />

  return (
    <div>
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2} dataKey="total" nameKey="name"
            label={renderPieLabel} labelLine={{ stroke: '#ccc', strokeWidth: 1 }}>
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip formatter={(v: unknown) => [`¥${(v as number).toFixed(2)}`, '']} />
        </PieChart>
      </ResponsiveContainer>

      <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
        {data.map((cat, i) => (
          <div key={cat.id}>
            <div
              style={{
                display: 'flex', alignItems: 'center', padding: '10px 14px', gap: 8,
                cursor: 'pointer', borderTop: i > 0 ? '1px solid #f5f5f5' : 'none',
              }}
              onClick={() => cat.children.length > 0 ? setExpanded(expanded === cat.id ? null : cat.id) : onDrillDown({ category_id: cat.id, title: cat.name })}
            >
              <span style={{ fontSize: 18, flexShrink: 0 }}>{cat.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 14, color: '#333' }}>{cat.name}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {cat.children.length > 0 ? (
                      <span style={{ fontSize: 10, color: '#4caf50', background: '#f0fdf4', padding: '1px 6px', borderRadius: 8 }}>下钻</span>
                    ) : (
                      <span style={{ fontSize: 10, color: '#aaa' }}>→</span>
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
                background: '#fafafa', borderTop: '1px solid #f0f0f0', cursor: 'pointer',
              }} onClick={(e) => { e.stopPropagation(); onDrillDown({ category_id: child.id, title: child.name }) }}>
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
})

const TagView = memo(function TagView({ data, onDrillDown }: { data: TagBreakdownGroup[]; onDrillDown: (params: {category_id?: number; tag_id?: number; counterparty?: string; title: string}) => void }) {
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
              borderTop: '1px solid #f0f0f0', cursor: 'pointer',
            }} onClick={() => onDrillDown({ tag_id: tag.tag_id, title: tag.tag_name })}>
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
})

const MerchantView = memo(function MerchantView({ data, onDrillDown }: { data: MerchantItem[]; onDrillDown: (params: {category_id?: number; tag_id?: number; counterparty?: string; title: string}) => void }) {
  if (data.length === 0) return <EmptyState text="本月没有商户数据" />

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {data.map((m, i) => (
        <div key={m.counterparty} style={{
          display: 'flex', alignItems: 'center', padding: '10px 14px', gap: 10,
          borderTop: i > 0 ? '1px solid #f5f5f5' : 'none', cursor: 'pointer',
        }} onClick={() => onDrillDown({ counterparty: m.counterparty, title: m.counterparty })}>
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
})

const DailyView = memo(function DailyView({ data, loading, viewType, onDrillDay, month }: { data: DailyReport | null; loading: boolean; viewType: string; onDrillDay: (day: number) => void; month: number }) {
  if (loading) return <div style={{ textAlign: 'center', padding: 32, color: '#bbb', fontSize: 14 }}>加载中…</div>
  if (!data || data.days.length === 0) return <EmptyState text={`本月没有${viewType === 'expense' ? '支出' : '收入'}数据`} />

  return (
    <div>
      {/* Daily averages */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 1, padding: '8px 12px', background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: 10, color: '#888' }}>日均收入</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#4caf50' }}>¥{data.avg_daily_income.toFixed(2)}</div>
        </div>
        <div style={{ flex: 1, padding: '8px 12px', background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: 10, color: '#888' }}>日均支出</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#f44336' }}>¥{data.avg_daily_expense.toFixed(2)}</div>
        </div>
      </div>

      {/* Daily table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', padding: '8px 14px', background: '#fafafa', fontSize: 11, color: '#999', fontWeight: 600 }}>
          <span style={{ width: 54, flexShrink: 0 }}>日期</span>
          <span style={{ flex: 1, textAlign: 'right' }}>收入</span>
          <span style={{ flex: 1, textAlign: 'right' }}>支出</span>
          <span style={{ flex: 1, textAlign: 'right' }}>结余</span>
          <span style={{ width: 36, flexShrink: 0, textAlign: 'right' }}></span>
        </div>
        {data.days.map((d, i) => (
          <div key={d.day} style={{
            display: 'flex', padding: '7px 14px', fontSize: 13, color: '#333',
            borderTop: i > 0 ? '1px solid #f5f5f5' : 'none', cursor: 'pointer',
          }} onClick={() => onDrillDay(d.day)}>
            <span style={{ width: 54, flexShrink: 0, color: '#888' }}>{String(month).padStart(2, '0')}-{String(d.day).padStart(2, '0')}</span>
            <span style={{ flex: 1, textAlign: 'right', color: d.income > 0 ? '#4caf50' : '#ccc' }}>{d.income > 0 ? d.income.toFixed(2) : '—'}</span>
            <span style={{ flex: 1, textAlign: 'right', color: d.expense > 0 ? '#f44336' : '#ccc' }}>{d.expense > 0 ? d.expense.toFixed(2) : '—'}</span>
            <span style={{ flex: 1, textAlign: 'right', color: d.balance >= 0 ? '#333' : '#f44336' }}>{d.balance.toFixed(2)}</span>
            <span style={{ width: 36, flexShrink: 0, textAlign: 'right', fontSize: 10, color: '#7c3aed' }}>{d.transfer_count > 0 ? `${d.transfer_count}笔转账` : ''}</span>
          </div>
        ))}
      </div>
    </div>
  )
})

// ── Main page ─────────────────────────────────────────────────────────────────

export default function StatsPage() {
  const navigate = useNavigate()
  const now = dayjs()
  // 从编辑页返回时把 sessionStorage 快照作为初始 state，避免初次 fetch 与 restore fetch 竞态
  const [restored] = useState<Record<string, unknown> | null>(() => {
    const raw = sessionStorage.getItem('stats:returnState')
    if (!raw) return null
    sessionStorage.removeItem('stats:returnState')
    try { return JSON.parse(raw) } catch { return null }
  })
  const [topTab, setTopTab] = useState<TopTab>((restored?.topTab as TopTab) || 'monthly')
  const [period, setPeriod] = useState((restored?.period as { year: number; month: number }) || { year: now.year(), month: now.month() + 1 })
  const { year, month } = period
  const [annualYear, setAnnualYear] = useState((restored?.annualYear as number) || now.year())
  const [annualType, setAnnualType] = useState<'expense' | 'income'>((restored?.annualType as 'expense' | 'income') || 'expense')
  const [annualLegend, setAnnualLegend] = useState<Set<string>>(new Set(['expense']))
  const [viewType, setViewType] = useState<'expense' | 'income'>((restored?.viewType as 'expense' | 'income') || 'expense')
  const [subTab, setSubTab] = useState<SubTab>((restored?.subTab as SubTab) || 'category')
  const [memberId, setMemberId] = useState<number | null | undefined>(
    restored && 'memberId' in restored ? (restored.memberId as number | null | undefined) : undefined
  )  // undefined=all, null=-1=unassigned, number=specific

  const [members, setMembers] = useState<FamilyMember[]>([])
  const [summary, setSummary] = useState<MonthlySummaryStats | null>(null)
  const [categories, setCategories] = useState<CategoryBreakdownItem[]>([])
  const [tags, setTags] = useState<TagBreakdownGroup[]>([])
  const [merchants, setMerchants] = useState<MerchantItem[]>([])
  const [loading, setLoading] = useState(false)
  const [dailyData, setDailyData] = useState<DailyReport | null>(null)
  const [annualData, setAnnualData] = useState<AnnualReport | null>(null)
  const [annualLoading, setAnnualLoading] = useState(false)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [assetLoading, setAssetLoading] = useState(false)
  const [allocationData, setAllocationData] = useState<AllocationReport | null>(null)
  const [allocationLoading, setAllocationLoading] = useState(false)
  const [networthTrend, setNetworthTrend] = useState<NetWorthPoint[]>([])
  const [snapshotTaking, setSnapshotTaking] = useState(false)
  const [monthPickerOpen, setMonthPickerOpen] = useState(false)
  const [yearPickerOpen, setYearPickerOpen] = useState(false)

  // Drill-down state
  const [drillTitle, setDrillTitle] = useState('')
  const [drillTxns, setDrillTxns] = useState<DrillDownTransaction[]>([])
  const [drillLoading, setDrillLoading] = useState(false)
  const [selectedTxn, setSelectedTxn] = useState<DrillDownTransaction | null>(null)

  const handleDrillDown = useCallback((params: {category_id?: number; tag_id?: number; counterparty?: string; title: string; day?: number; drillYear?: number; drillMonth?: number | null; allTypes?: boolean; drillType?: string}) => {
    setDrillTitle(params.title)
    setDrillLoading(true)
    const m = params.drillMonth ?? month
    const y = params.drillYear ?? year
    const t = params.allTypes ? null : (params.drillType ?? viewType)
    statsApi.drillDown(y, m, t, {
      category_id: params.category_id,
      tag_id: params.tag_id,
      counterparty: params.counterparty,
      ...(memberId != null ? { member_id: memberId } : {}),
      day: params.day,
    }).then(r => setDrillTxns(r.data)).finally(() => setDrillLoading(false))
  }, [year, month, viewType, memberId])

  const handleDeleteTxn = async (id: number) => {
    await transactionApi.delete(id)
    setSelectedTxn(null)
    setDrillTxns(prev => prev.filter(t => t.id !== id))
  }

  const isCurrentMonth = year === now.year() && month === now.month() + 1

  const prevMonth = () => setPeriod(p =>
    p.month === 1 ? { year: p.year - 1, month: 12 } : { year: p.year, month: p.month - 1 }
  )
  const nextMonth = () => {
    if (isCurrentMonth) return
    setPeriod(p => p.month === 12 ? { year: p.year + 1, month: 1 } : { year: p.year, month: p.month + 1 })
  }

  // Fetch members
  useEffect(() => {
    memberApi.list().then(r => setMembers(r.data)).catch(() => {})
  }, [])

  // Fetch monthly summary
  useEffect(() => {
    if (topTab !== 'monthly') return
    statsApi.monthlySummary(year, month, memberId).then(r => setSummary(r.data)).catch(() => {})
  }, [year, month, topTab, memberId])

  // Fetch monthly breakdowns
  useEffect(() => {
    if (topTab !== 'monthly') return
    setLoading(true)
    const load =
      subTab === 'category' ? statsApi.categoryBreakdown(year, month, viewType, memberId).then(r => setCategories(r.data)) :
      subTab === 'daily'    ? statsApi.dailyReport(year, month, viewType, memberId).then(r => setDailyData(r.data)) :
      subTab === 'tag'      ? statsApi.tagBreakdown(year, month, viewType, memberId).then(r => setTags(r.data)) :
      statsApi.topMerchants(year, month, viewType, 10, memberId).then(r => setMerchants(r.data))
    load.finally(() => setLoading(false))
  }, [year, month, viewType, subTab, topTab, memberId])

  // Fetch annual
  useEffect(() => {
    if (topTab !== 'annual') return
    setAnnualLoading(true)
    statsApi.annual(annualYear, annualType, memberId).then(r => setAnnualData(r.data)).finally(() => setAnnualLoading(false))
  }, [annualYear, annualType, topTab, memberId])

  // Fetch asset accounts
  useEffect(() => {
    if (topTab !== 'asset') return
    setAssetLoading(true)
    accountApi.list().then(r => setAccounts(r.data)).finally(() => setAssetLoading(false))
  }, [topTab])

  // Fetch allocation
  useEffect(() => {
    if (topTab !== 'allocation') return
    setAllocationLoading(true)
    Promise.all([
      statsApi.allocation().then(r => setAllocationData(r.data)),
      statsApi.networthTrend().then(r => setNetworthTrend(r.data)),
    ]).finally(() => setAllocationLoading(false))
  }, [topTab])

  const TOP_TABS: { key: TopTab; label: string }[] = [
    { key: 'monthly', label: '月度' },
    { key: 'annual', label: '年度' },
    { key: 'asset', label: '资产' },
    { key: 'allocation', label: '配置' },
  ]
  const SUB_TABS: { key: SubTab; label: string }[] = [
    { key: 'category', label: '分类' },
    { key: 'daily', label: '日报' },
    { key: 'tag', label: '标签' },
    { key: 'merchant', label: 'TOP 商户' },
  ]
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

      {/* Global member filter chip bar */}
      <div style={{
        display: 'flex', gap: 6, padding: '8px 16px', overflowX: 'auto', whiteSpace: 'nowrap',
        background: '#fff', borderBottom: '1px solid #f5f5f5',
      }}>
        <div
          onClick={() => setMemberId(undefined)}
          style={{
            padding: '4px 12px', borderRadius: 16, fontSize: 12, cursor: 'pointer', flexShrink: 0,
            fontWeight: memberId === undefined ? 600 : 400,
            background: memberId === undefined ? '#4caf50' : '#f5f5f5',
            color: memberId === undefined ? '#fff' : '#666',
          }}
        >全部</div>
        {members.map(m => (
          <div
            key={m.id}
            onClick={() => setMemberId(memberId === m.id ? undefined : m.id)}
            style={{
              padding: '4px 12px', borderRadius: 16, fontSize: 12, cursor: 'pointer', flexShrink: 0,
              fontWeight: memberId === m.id ? 600 : 400,
              background: memberId === m.id ? '#2196F3' : '#f5f5f5',
              color: memberId === m.id ? '#fff' : '#666',
            }}
          >{m.avatar} {m.name}</div>
        ))}
        <div
          onClick={() => setMemberId(memberId === -1 ? undefined : -1)}
          style={{
            padding: '4px 12px', borderRadius: 16, fontSize: 12, cursor: 'pointer', flexShrink: 0,
            fontWeight: memberId === -1 ? 600 : 400,
            background: memberId === -1 ? '#666' : '#f5f5f5',
            color: memberId === -1 ? '#fff' : '#888',
          }}
        >未指定</div>
      </div>

      {/* Monthly tab */}
      {topTab === 'monthly' && (
        <div style={{ padding: '12px 16px 80px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Month navigation */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
            <button onClick={prevMonth} style={{ fontSize: 22, background: 'none', border: 'none', cursor: 'pointer', color: '#333', padding: '4px 8px', lineHeight: 1 }}>‹</button>
            <button
              onClick={() => setMonthPickerOpen(true)}
              style={{ fontSize: 16, fontWeight: 600, color: '#333', minWidth: 96, textAlign: 'center', background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '4px 8px' }}
            >
              <span>{year}-{String(month).padStart(2, '0')}</span>
              <span style={{ fontSize: 11, color: '#888' }}>▾</span>
            </button>
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
              {subTab === 'category' && <CategoryView data={categories} viewType={viewType} onDrillDown={handleDrillDown} />}
              {subTab === 'daily' && <DailyView data={dailyData} loading={loading} viewType={viewType} month={month} onDrillDay={(day) => handleDrillDown({ title: `${month}月${day}日`, day, allTypes: true })} />}
              {subTab === 'tag'      && <TagView data={tags} onDrillDown={handleDrillDown} />}
              {subTab === 'merchant' && <MerchantView data={merchants} onDrillDown={handleDrillDown} />}
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
            <button
              onClick={() => setYearPickerOpen(true)}
              style={{ fontSize: 16, fontWeight: 600, color: '#333', minWidth: 60, textAlign: 'center', background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '4px 8px' }}
            >
              <span>{annualYear}</span>
              <span style={{ fontSize: 11, color: '#888' }}>▾</span>
            </button>
            <button onClick={() => setAnnualYear(y => Math.min(y + 1, now.year()))} style={{ fontSize: 22, background: 'none', border: 'none', cursor: annualYear >= now.year() ? 'default' : 'pointer', color: annualYear >= now.year() ? '#ccc' : '#333', padding: '4px 8px', lineHeight: 1 }}>›</button>
          </div>

          {annualLoading ? (
            <div style={{ textAlign: 'center', padding: 32, color: '#bbb', fontSize: 14 }}>加载中…</div>
          ) : annualData && (
            <>
              {/* Annual summary cards */}
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

              {/* Legend toggle */}
              <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                {[
                  { key: 'expense', label: '支出', color: '#f44336' },
                  { key: 'income', label: '收入', color: '#4caf50' },
                  { key: 'balance', label: '结余', color: '#2196F3' },
                ].map(({ key, label, color }) => (
                  <button
                    key={key}
                    onClick={() => {
                      const next = new Set(annualLegend)
                      if (next.has(key)) next.delete(key); else next.add(key)
                      if (next.size === 0) next.add(key)
                      setAnnualLegend(next)
                    }}
                    style={{
                      padding: '4px 12px', borderRadius: 14, border: `1.5px solid ${color}`,
                      background: annualLegend.has(key) ? color : 'transparent',
                      color: annualLegend.has(key) ? '#fff' : color,
                      fontSize: 12, cursor: 'pointer', fontWeight: 600,
                    }}
                  >{label}</button>
                ))}
                <button
                  onClick={() => setAnnualLegend(new Set(['income', 'expense', 'balance']))}
                  style={{
                    padding: '4px 12px', borderRadius: 14, border: '1.5px solid #ccc',
                    background: '#fafafa', color: '#666', fontSize: 12, cursor: 'pointer',
                  }}
                >全部</button>
              </div>

              {/* 12-month trend chart — cleaner design */}
              <div className="card" style={{ padding: '14px 8px 4px 0' }}>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={annualData.trend} margin={{ top: 4, right: 12, left: 0, bottom: 0 }} barSize={14} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" vertical={false} />
                    <XAxis dataKey="month" tickFormatter={m => `${m}月`} tick={{ fontSize: 11, fill: '#999' }} axisLine={{ stroke: '#eee' }} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#aaa' }} axisLine={false} tickLine={false} tickFormatter={v => v >= 10000 ? `${(v/10000).toFixed(1)}万` : v >= 1000 ? `${(v/1000).toFixed(0)}k` : `${v}`} width={40} />
                    <Tooltip formatter={(v: unknown, name: unknown) => [`¥${(v as number).toFixed(0)}`, name === 'income' ? '收入' : name === 'expense' ? '支出' : '结余']} />
                    {annualLegend.has('income')   && <Bar dataKey="income"  fill="#4caf50" radius={[4, 4, 0, 0]} />}
                    {annualLegend.has('expense')  && <Bar dataKey="expense" fill="#f44336" radius={[4, 4, 0, 0]} />}
                    {annualLegend.has('balance')  && <Bar dataKey="balance" fill="#2196F3" radius={[4, 4, 0, 0]} />}
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Type toggle for category breakdown */}
              <div className="type-toggle">
                <button className={annualType === 'expense' ? 'active' : ''} onClick={() => setAnnualType('expense')}>支出</button>
                <button className={annualType === 'income' ? 'active' : ''} onClick={() => setAnnualType('income')}>收入</button>
              </div>

              {/* Category breakdown */}
              {annualData.categories.length === 0 ? (
                <EmptyState text={`${annualYear} 年没有${annualType === 'expense' ? '支出' : '收入'}数据`} />
              ) : (
                <>
                  {/* Donut chart */}
                  <div className="card" style={{ padding: '12px 0' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#555', padding: '0 14px 8px' }}>分类占比</div>
                    <ResponsiveContainer width="100%" height={260}>
                      <PieChart>
                        <Pie data={annualData.categories} cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2} dataKey="total" nameKey="name"
                          label={renderPieLabel} labelLine={{ stroke: '#ccc', strokeWidth: 1 }}>
                          {annualData.categories.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: unknown) => [`¥${(v as number).toFixed(0)}`, '']} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div style={{ fontSize: 13, fontWeight: 600, color: '#555', marginBottom: -4 }}>分类汇总</div>
                  <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    {annualData.categories.map((cat, i) => (
                      <div key={cat.id}>
                        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', gap: 8, borderTop: i > 0 ? '1px solid #f5f5f5' : 'none', cursor: 'pointer' }}
                          onClick={() => handleDrillDown({ category_id: cat.id, title: `${annualYear}年 ${cat.name}`, drillYear: annualYear, drillMonth: null as any, drillType: annualType })}>
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
                          <div key={child.id} style={{ display: 'flex', alignItems: 'center', padding: '7px 14px 7px 42px', gap: 8, background: '#fafafa', borderTop: '1px solid #f0f0f0', cursor: 'pointer' }}
                            onClick={(e) => { e.stopPropagation(); handleDrillDown({ category_id: child.id, title: `${annualYear}年 ${child.name}`, drillYear: annualYear, drillMonth: null as any, drillType: annualType }) }}>
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

                  {/* Monthly table */}
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#555', marginBottom: -4 }}>月报表</div>
                  <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', padding: '8px 14px', background: '#fafafa', fontSize: 11, color: '#999', fontWeight: 600 }}>
                      <span style={{ width: 32, flexShrink: 0 }}>月</span>
                      <span style={{ flex: 1, textAlign: 'right' }}>收入</span>
                      <span style={{ flex: 1, textAlign: 'right' }}>支出</span>
                      <span style={{ flex: 1, textAlign: 'right' }}>结余</span>
                    </div>
                    {annualData.trend.map((m, i) => (
                      <div key={m.month} style={{
                        display: 'flex', padding: '7px 14px', fontSize: 13, color: '#333',
                        borderTop: i > 0 ? '1px solid #f5f5f5' : 'none',
                      }}>
                        <span style={{ width: 32, flexShrink: 0, color: '#888' }}>{m.month}月</span>
                        <span style={{ flex: 1, textAlign: 'right', color: m.income > 0 ? '#4caf50' : '#ccc' }}>{m.income > 0 ? m.income.toFixed(0) : '—'}</span>
                        <span style={{ flex: 1, textAlign: 'right', color: m.expense > 0 ? '#f44336' : '#ccc' }}>{m.expense > 0 ? m.expense.toFixed(0) : '—'}</span>
                        <span style={{ flex: 1, textAlign: 'right', color: m.balance >= 0 ? '#333' : '#f44336' }}>{m.balance.toFixed(0)}</span>
                      </div>
                    ))}
                  </div>
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
            // Filter accounts by selected member
            let filtered = accounts
            if (memberId != null) {
              if (memberId === -1) {
                filtered = accounts.filter(a => a.member_id == null)
              } else {
                filtered = accounts.filter(a => a.member_id === memberId)
              }
            }
            // 资产类：资金/充值/投资理财/银行理财；信用卡固定算负债。
            // 债务账户按余额正负动态分：>0 代表别人欠我 → 资产；<0 代表我欠别人 → 负债（取 abs）。
            const ASSET_CATS = ['资金账户', '充值账户', '投资理财', '银行理财']
            const assets = [
              ...filtered.filter(a => ASSET_CATS.includes(a.category)),
              ...filtered.filter(a => a.category === '债务' && a.current_balance > 0),
            ]
            const liabs = [
              ...filtered.filter(a => a.category === '信用卡'),
              ...filtered.filter(a => a.category === '债务' && a.current_balance < 0),
            ]
            const totalAsset = assets.reduce((s, a) => s + Math.max(0, a.current_balance), 0)
            const totalLiab  = liabs.reduce((s, a) => s + Math.abs(Math.min(0, a.current_balance) || a.current_balance), 0)
            const netWorth   = totalAsset - totalLiab

            // 饼图：债务正余额并入资产构成，显示为"债务（应收）"
            const pieData = [
              ...ASSET_CATS.map(cat => ({
                name: cat,
                value: assets.filter(a => a.category === cat).reduce((s, a) => s + Math.max(0, a.current_balance), 0),
              })),
              {
                name: '债务（应收）',
                value: filtered
                  .filter(a => a.category === '债务' && a.current_balance > 0)
                  .reduce((s, a) => s + a.current_balance, 0),
              },
            ].filter(d => d.value > 0)

            const AccountRow = ({ acc, i }: { acc: Account; i: number }) => (
              <div key={acc.id} style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', gap: 10, borderTop: i > 0 ? '1px solid #f5f5f5' : 'none' }}>
                <span style={{ flexShrink: 0 }}><BankIcon icon={acc.icon} size={24} /></span>
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
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={68} paddingAngle={2} dataKey="value" nameKey="name"
                          label={renderPieLabel} labelLine={{ stroke: '#ccc', strokeWidth: 1 }}>
                          {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: unknown) => [`¥${(v as number).toFixed(2)}`, '']} />
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

      {/* Allocation tab */}
      {topTab === 'allocation' && (
        <div style={{ padding: '12px 16px 80px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {allocationLoading ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#aaa', fontSize: 14 }}>加载中…</div>
          ) : (
            <>
              {/* Net worth trend */}
              <div className="card" style={{ padding: '14px 16px' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 10 }}>净资产趋势</div>
                {networthTrend.length >= 2 ? (
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={networthTrend.map(p => ({ name: p.snapshot_date.slice(0, 7), 净资产: +(p.net_worth / 10000).toFixed(2) }))} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#aaa' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#aaa' }} axisLine={false} tickLine={false} unit="万" width={36} />
                      <Tooltip formatter={(v: unknown) => [`¥${((v as number) * 10000).toFixed(0)}`, '净资产']} labelStyle={{ fontSize: 12 }} />
                      <Bar dataKey="净资产" fill="#4CAF50" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ padding: '20px 0', textAlign: 'center', color: '#bbb', fontSize: 13 }}>
                    数据积累 2 个月后展示趋势曲线
                  </div>
                )}
                {/* Manual snapshot trigger */}
                <button
                  onClick={() => {
                    setSnapshotTaking(true)
                    statsApi.takeSnapshot()
                      .then(r => {
                        const d = r.data
                        alert(`快照已生成：${d.accounts} 个账户，${d.holdings} 个持仓`)
                        // refresh trend
                        statsApi.networthTrend().then(r2 => setNetworthTrend(r2.data))
                      })
                      .catch(() => alert('快照生成失败'))
                      .finally(() => setSnapshotTaking(false))
                  }}
                  disabled={snapshotTaking}
                  style={{
                    marginTop: 12, width: '100%', padding: '8px 0', border: '1px solid #e0e0e0',
                    borderRadius: 8, background: '#fafafa', color: '#666', fontSize: 13, cursor: 'pointer',
                  }}
                >
                  {snapshotTaking ? '生成中…' : '📷 立即生成快照'}
                </button>
              </div>

              {/* Allocation breakdown */}
              {allocationData && allocationData.total > 0 ? (
                <>
                  <div className="card" style={{ padding: '14px 16px' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 4 }}>资产配置现状</div>
                    <div style={{ fontSize: 11, color: '#aaa', marginBottom: 10 }}>
                      总持仓市值 ¥{allocationData.total.toFixed(2)}（仅统计投资持仓）
                    </div>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie
                          data={allocationData.items}
                          dataKey="total"
                          nameKey="label"
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          innerRadius={44}
                          paddingAngle={2}
                          label={renderPieLabel} labelLine={{ stroke: '#ccc', strokeWidth: 1 }}
                        >
                          {allocationData.items.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: unknown) => [`¥${(v as number).toFixed(2)}`, '']} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    {allocationData.items.map((item, i) => (
                      <div key={item.risk_class} style={{
                        display: 'flex', alignItems: 'center', padding: '12px 14px', gap: 10,
                        borderTop: i > 0 ? '1px solid #f5f5f5' : 'none',
                      }}>
                        <div style={{
                          width: 10, height: 10, borderRadius: '50%',
                          background: COLORS[i % COLORS.length], flexShrink: 0,
                        }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontSize: 14, color: '#333' }}>{item.label}</span>
                            <span style={{ fontSize: 14, fontWeight: 600, color: '#333' }}>¥{item.total.toFixed(2)}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ flex: 1, height: 3, background: '#f0f0f0', borderRadius: 2 }}>
                              <div style={{ width: `${item.percentage}%`, height: '100%', background: COLORS[i % COLORS.length], borderRadius: 2 }} />
                            </div>
                            <span style={{ fontSize: 11, color: '#aaa', minWidth: 36, textAlign: 'right' }}>{item.percentage.toFixed(1)}%</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                !allocationLoading && <EmptyState text="暂无持仓数据，请先在投资页添加持仓并设置风险等级" />
              )}
            </>
          )}
        </div>
      )}

      {/* ── Drill-down overlay (transaction list) ────────────────────────── */}
      {drillTxns.length > 0 && !selectedTxn && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}
          onClick={() => { setDrillTxns([]); setDrillTitle('') }}>
          <div style={{ width: '100%', maxHeight: '75vh', background: '#fff', borderRadius: '16px 16px 0 0', padding: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>{drillTitle}</span>
              <button onClick={() => { setDrillTxns([]); setDrillTitle('') }}
                style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#999' }}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {drillLoading ? (
                <div style={{ textAlign: 'center', padding: 32, color: '#bbb' }}>加载中…</div>
              ) : (
                drillTxns.map((t, i) => (
                  <div key={t.id} style={{
                    display: 'flex', alignItems: 'center', padding: '10px 0', gap: 8,
                    borderTop: i > 0 ? '1px solid #f5f5f5' : 'none', cursor: 'pointer',
                  }} onClick={() => setSelectedTxn(t)}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>{t.category_icon || '📦'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 13, color: '#333' }}>{t.description || t.category_name || t.counterparty || '未分类'}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: t.type === 'expense' ? '#f44336' : t.type === 'income' ? '#4caf50' : '#7c3aed' }}>
                          {t.type === 'expense' ? '-' : t.type === 'income' ? '+' : ''}¥{t.amount.toFixed(2)}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>
                        {t.date} {t.member_name ? `· ${t.member_avatar} ${t.member_name}` : ''} {t.account_name ? `· ${t.account_name}` : ''}
                      </div>
                    </div>
                    <span style={{ fontSize: 12, color: '#bbb' }}>›</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Transaction detail bottom sheet ──────────────────────────────── */}
      {selectedTxn && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 250, display: 'flex', alignItems: 'flex-end' }}
          onClick={() => setSelectedTxn(null)}>
          <div style={{ width: '100%', background: 'white', borderRadius: '20px 20px 0 0', padding: 20 }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>
                {selectedTxn.category_icon || '💰'} {selectedTxn.description || selectedTxn.category_name || selectedTxn.counterparty || '交易详情'}
              </span>
              <span style={{ fontSize: 20, fontWeight: 700, color: selectedTxn.type === 'expense' ? '#f44336' : selectedTxn.type === 'income' ? '#4caf50' : '#7c3aed' }}>
                {selectedTxn.type === 'expense' ? '-' : selectedTxn.type === 'income' ? '+' : ''}¥{selectedTxn.amount.toFixed(2)}
              </span>
            </div>
            <div style={{ fontSize: 14, color: '#6b7280', lineHeight: 2 }}>
              <div>日期：{selectedTxn.date}</div>
              {selectedTxn.type === 'transfer' ? (
                <>
                  <div>类型：转账</div>
                  <div>转出：{selectedTxn.account_name ? `${selectedTxn.account_icon} ${selectedTxn.account_name}` : '未设置'}</div>
                  <div>转入：{selectedTxn.to_account_name ? `${selectedTxn.to_account_icon} ${selectedTxn.to_account_name}` : '未设置'}</div>
                </>
              ) : (
                <>
                  <div>类型：{selectedTxn.type === 'expense' ? '支出' : '收入'}</div>
                  {selectedTxn.category_name && <div>分类：{selectedTxn.category_icon} {selectedTxn.category_name}</div>}
                  {selectedTxn.account_name && <div>账户：{selectedTxn.account_icon} {selectedTxn.account_name}</div>}
                </>
              )}
              <div>成员：{selectedTxn.member_name ? `${selectedTxn.member_avatar} ${selectedTxn.member_name}` : '未指定'}</div>
              {selectedTxn.counterparty && <div>对方：{selectedTxn.counterparty}</div>}
              <div>来源：{selectedTxn.source === 'manual' ? '手动记账' : selectedTxn.source}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={() => setSelectedTxn(null)}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #e5e7eb', background: '#f9fafb', fontSize: 15, cursor: 'pointer' }}>
                关闭
              </button>
              <button onClick={() => {
                  const id = selectedTxn.id
                  setSelectedTxn(null)
                  sessionStorage.setItem('stats:returnState', JSON.stringify({
                    topTab, period, annualYear, annualType, viewType, subTab, memberId,
                  }))
                  navigate(`/add?copy=${id}`)
                }}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #16a34a', background: '#f0fdf4', color: '#16a34a', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
                复制
              </button>
              <button onClick={() => {
                  const id = selectedTxn.id
                  setSelectedTxn(null)
                  sessionStorage.setItem('stats:returnState', JSON.stringify({
                    topTab, period, annualYear, annualType, viewType, subTab, memberId,
                  }))
                  navigate(`/add?id=${id}`)
                }}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #2563eb', background: '#eff6ff', color: '#2563eb', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
                编辑
              </button>
              <button onClick={() => handleDeleteTxn(selectedTxn.id)}
                style={{ flex: 1, padding: 12, borderRadius: 10, border: 'none', background: '#ef4444', color: 'white', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      <PeriodPickerSheet
        open={monthPickerOpen}
        onClose={() => setMonthPickerOpen(false)}
        mode="month"
        year={year}
        month={month}
        onChange={(y, m) => setPeriod({ year: y, month: m || 1 })}
      />
      <PeriodPickerSheet
        open={yearPickerOpen}
        onClose={() => setYearPickerOpen(false)}
        mode="year"
        year={annualYear}
        onChange={y => setAnnualYear(y)}
      />
    </div>
  )
}
