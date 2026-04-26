import { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import { transactionApi, memberApi, type CategorySummary, type MonthlySummary, type MemberSummary, type FamilyMember } from '../api'

export default function StatsPage() {
  const now = dayjs()
  const [year] = useState(now.year())
  const [month] = useState(now.month() + 1)
  const [categoryData, setCategoryData] = useState<CategorySummary[]>([])
  const [monthlySummary, setMonthlySummary] = useState<MonthlySummary[]>([])
  const [memberData, setMemberData] = useState<MemberSummary[]>([])
  const [viewType, setViewType] = useState<'expense' | 'income'>('expense')
  const [members, setMembers] = useState<FamilyMember[]>([])
  // null = 全部；0 = 未指定（NULL）；>0 = 指定成员
  const [filterMemberId, setFilterMemberId] = useState<number | null>(null)
  const [groupByMember, setGroupByMember] = useState(false)

  useEffect(() => {
    memberApi.list().then(r => setMembers(r.data))
  }, [])

  useEffect(() => {
    transactionApi.categorySummary(year, month, viewType, undefined, filterMemberId ?? undefined)
      .then(r => setCategoryData(r.data))
  }, [year, month, viewType, filterMemberId])

  useEffect(() => {
    transactionApi.monthlySummary(year, undefined, filterMemberId ?? undefined)
      .then(r => setMonthlySummary(r.data))
  }, [year, filterMemberId])

  useEffect(() => {
    if (groupByMember) {
      transactionApi.memberSummary(year, month, viewType).then(r => setMemberData(r.data))
    }
  }, [groupByMember, year, month, viewType])

  const total = categoryData.reduce((s, c) => s + c.total, 0)
  const memberTotal = memberData.reduce((s, m) => s + m.total, 0)

  return (
    <div className="page-content">
      <div className="page-header">统计</div>

      <div className="card">
        <div className="type-toggle" style={{ marginBottom: 12 }}>
          <button className={viewType === 'expense' ? 'active' : ''} onClick={() => setViewType('expense')}>
            支出
          </button>
          <button className={viewType === 'income' ? 'active' : ''} onClick={() => setViewType('income')}>
            收入
          </button>
        </div>

        {/* 成员筛选 */}
        {members.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>成员筛选</div>
            <div className="member-chips">
              <div className={`chip ${filterMemberId === null ? 'selected' : ''}`}
                onClick={() => setFilterMemberId(null)}>
                全部
              </div>
              <div className={`chip ${filterMemberId === 0 ? 'selected' : ''}`}
                onClick={() => setFilterMemberId(0)}>
                未指定
              </div>
              {members.map(m => (
                <div key={m.id} className={`chip ${filterMemberId === m.id ? 'selected' : ''}`}
                  onClick={() => setFilterMemberId(m.id)}>
                  {m.avatar} {m.name}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 按成员分组开关 */}
        {members.length > 0 && (
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#6b7280' }}>
              <input type="checkbox" checked={groupByMember}
                onChange={e => setGroupByMember(e.target.checked)}
                style={{ width: 16, height: 16 }} />
              按成员分组查看
            </label>
          </div>
        )}

        <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 4 }}>
          {year}年{month}月{viewType === 'expense' ? '总支出' : '总收入'}
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 16 }}>
          ¥{total.toFixed(2)}
        </div>

        {categoryData.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📊</div>
            <div>暂无数据</div>
          </div>
        ) : (
          categoryData.map(cat => (
            <div key={cat.category_name} className="stat-bar">
              <div className="stat-label">
                <span>{cat.category_icon}</span>
                <span>{cat.category_name}</span>
              </div>
              <div className="stat-track">
                <div className="stat-fill" style={{ width: `${cat.percentage}%` }} />
              </div>
              <div className="stat-value">¥{cat.total.toFixed(2)}</div>
            </div>
          ))
        )}
      </div>

      {/* 按成员分组 */}
      {groupByMember && members.length > 0 && (
        <div className="card">
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
            {year}年{month}月{viewType === 'expense' ? '支出' : '收入'} · 按成员分组
          </div>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
            合计：¥{memberTotal.toFixed(2)}
          </div>
          {memberData.length === 0 ? (
            <div className="empty-state">
              <div>暂无数据</div>
            </div>
          ) : (
            memberData.map(m => (
              <div key={m.member_id ?? 'null'} className="stat-bar">
                <div className="stat-label">
                  <span>{m.member_avatar}</span>
                  <span>{m.member_name}</span>
                </div>
                <div className="stat-track">
                  <div className="stat-fill" style={{ width: `${m.percentage}%` }} />
                </div>
                <div className="stat-value">¥{m.total.toFixed(2)}</div>
              </div>
            ))
          )}
        </div>
      )}

      <div className="card">
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{year}年月度趋势</div>
        {monthlySummary.length === 0 ? (
          <div className="empty-state">
            <div>暂无数据</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ textAlign: 'left', padding: '8px 4px', fontWeight: 500 }}>月份</th>
                  <th style={{ textAlign: 'right', padding: '8px 4px', fontWeight: 500, color: '#22c55e' }}>收入</th>
                  <th style={{ textAlign: 'right', padding: '8px 4px', fontWeight: 500, color: '#ef4444' }}>支出</th>
                  <th style={{ textAlign: 'right', padding: '8px 4px', fontWeight: 500 }}>结余</th>
                </tr>
              </thead>
              <tbody>
                {monthlySummary.map(m => (
                  <tr key={m.month} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '8px 4px' }}>{m.month}</td>
                    <td style={{ padding: '8px 4px', textAlign: 'right', color: '#22c55e' }}>
                      {m.total_income.toFixed(2)}
                    </td>
                    <td style={{ padding: '8px 4px', textAlign: 'right', color: '#ef4444' }}>
                      {m.total_expense.toFixed(2)}
                    </td>
                    <td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 500 }}>
                      {m.balance.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
