import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
})

// === Tag Types ===
export interface TagCategory {
  id: number
  name: string
  icon: string
  sort_order: number
  created_at: string
}

export interface Tag {
  id: number
  name: string
  icon: string
  category_id: number
  is_archived: boolean
  sort_order: number
  created_at: string
  category?: TagCategory
}

export interface TagBrief {
  id: number
  name: string
  icon: string
  category_id: number
  is_archived: boolean
}

// === Family Member ===
export interface FamilyMember {
  id: number
  name: string
  avatar: string
  sort_order: number
  created_at: string
}

export interface FamilyMemberBrief {
  id: number
  name: string
  avatar: string
}

// === Category ===
export interface Category {
  id: number
  name: string
  icon: string
  type: 'expense' | 'income'
  keywords: string
  parent_id: number | null
  sort_order: number
  created_at: string
}

export interface CategoryTree extends Category {
  children: CategoryTree[]
}

export interface AccountBrief {
  id: number
  name: string
  icon: string
  category: string
}

// === Transaction ===
export type ReimbursementStatus = 'none' | 'pending' | 'done'

export interface Transaction {
  id: number
  amount: number
  type: 'expense' | 'income' | 'transfer'
  description: string
  counterparty: string
  date: string
  source: string
  category_id: number | null
  account_id: number | null
  to_account_id: number | null
  member_id: number | null
  is_reimbursable: boolean
  reimbursable_amount: number
  reimbursement_status: ReimbursementStatus
  external_id: string
  created_at: string
  category: Category | null
  account: AccountBrief | null
  to_account: AccountBrief | null
  member: FamilyMemberBrief | null
  tags: TagBrief[]
}

// === Reimbursement Record ===
export interface ReimbursementItem {
  transaction_id: number
  amount: number
  date: string | null
  description: string | null
  category_name: string | null
  category_icon: string | null
  amount_paid: number | null
}

export interface ReimbursementRecord {
  id: number
  date: string
  to_account_id: number | null
  total_amount: number
  note: string
  source: string
  external_id: string
  created_at: string
  to_account: AccountBrief | null
  items: ReimbursementItem[]
}

export interface ReimbursementCreateInput {
  date: string
  to_account_id: number
  total_amount: number
  note?: string
  transaction_ids: number[]
}

export interface MonthlySummary {
  month: string
  total_income: number
  total_expense: number
  balance: number
}

export interface CategorySummary {
  category_name: string
  category_icon: string
  total: number
  percentage: number
}

export interface MemberSummary {
  member_id: number | null
  member_name: string
  member_avatar: string
  total: number
  percentage: number
}

export type AssetType = 'fund' | 'stock' | 'wealth'

export interface Holding {
  id: number
  name: string
  code: string
  asset_type: AssetType
  shares: number
  cost_price: number
  current_price: number
  current_value: number
  cost_total: number
  gain: number
  gain_rate: number
  account_id: number | null
  member_id: number | null
  note: string
  price_updated_at: string | null
  created_at: string
  member: FamilyMemberBrief | null
  tags: TagBrief[]
}

export interface HoldingSummary {
  total_value: number
  total_cost: number
  total_gain: number
  gain_rate: number
  count: number
}

// === Account ===
export type AccountCategory = '资金账户' | '信用卡' | '充值账户' | '债务' | '投资理财' | '银行理财'

export interface Account {
  id: number
  name: string
  icon: string
  category: AccountCategory
  balance: number
  current_balance: number
  member_id: number | null
  note: string
  sort_order: number
  created_at: string
  member: FamilyMemberBrief | null
  tags: TagBrief[]
}

// === Parsed Import Transaction ===
export interface FundCandidate {
  code: string
  name: string
}

export interface ParsedTransaction {
  index: number
  amount: number
  type: 'expense' | 'income' | 'transfer'
  date: string
  description: string
  counterparty: string
  category_id: number | null
  category_name: string | null
  account_id: number | null
  to_account_id: number | null
  member_id: number | null
  payment_method: string
  raw: string
  is_duplicate: boolean
  tag_ids: number[]
  tag_names: string[]
  // 报销字段（钱迹导入时可能填充）
  is_reimbursable: boolean
  reimbursable_amount: number
  reimbursement_status: ReimbursementStatus
  external_id: string
  default_unchecked: boolean
  // 投资交易识别（detector + 后端预匹配/反查的结果）
  detected_action: '' | 'buy' | 'sell'
  detected_asset_type: '' | 'fund' | 'stock'
  detected_name: string
  detected_code: string
  target_holding_id: number | null
  target_holding_name: string | null
  fund_search_candidates: FundCandidate[]
}

// === Parsed Import Reimbursement（钱迹类型=报销记录） ===
export interface ParsedReimbursement {
  index: number
  amount: number
  date: string
  payment_method: string
  note: string
  external_id: string
  linked_external_id: string
  raw: string
  is_duplicate: boolean
  to_account_id: number | null
}

// === 导入账户映射（payment_method ↔ account_id 记忆） ===
export interface AccountMappingItem {
  raw_name: string
  account_id: number | null
}

// === API calls ===

export const tagApi = {
  // TagCategory
  listCategories: () => api.get<TagCategory[]>('/api/tags/categories'),
  createCategory: (data: { name: string; icon: string; sort_order?: number }) =>
    api.post<TagCategory>('/api/tags/categories', data),
  updateCategory: (id: number, data: { name: string; icon: string; sort_order?: number }) =>
    api.put<TagCategory>(`/api/tags/categories/${id}`, data),
  deleteCategory: (id: number) => api.delete(`/api/tags/categories/${id}`),

  // Tag
  list: (params?: { category_id?: number; include_archived?: boolean }) =>
    api.get<Tag[]>('/api/tags/', { params }),
  create: (data: { name: string; icon: string; category_id: number; sort_order?: number }) =>
    api.post<Tag>('/api/tags/', data),
  update: (id: number, data: { name: string; icon: string; sort_order?: number }) =>
    api.put<Tag>(`/api/tags/${id}`, data),
  archive: (id: number) => api.post<Tag>(`/api/tags/${id}/archive`),
  unarchive: (id: number) => api.post<Tag>(`/api/tags/${id}/unarchive`),
  move: (id: number, category_id: number) =>
    api.post<Tag>(`/api/tags/${id}/move`, { category_id }),
  delete: (id: number) => api.delete(`/api/tags/${id}`),
}

export const categoryApi = {
  list: (type?: string) => api.get<Category[]>('/api/categories/', { params: type ? { type } : {} }),
  tree: (type?: string) => api.get<CategoryTree[]>('/api/categories/tree', { params: type ? { type } : {} }),
  create: (data: { name: string; icon: string; type: string; keywords: string; parent_id?: number | null; sort_order?: number }) =>
    api.post<Category>('/api/categories/', data),
  update: (id: number, data: { name: string; icon: string; type: string; keywords: string; parent_id?: number | null; sort_order?: number }) =>
    api.put<Category>(`/api/categories/${id}`, data),
  delete: (id: number) => api.delete(`/api/categories/${id}`),
  reseed: () => api.post<{ ok: boolean; count: number }>('/api/categories/reseed'),
}

export const importApi = {
  parse: (source: string, file: File, opts?: { start_date?: string; end_date?: string }) => {
    const fd = new FormData()
    fd.append('source', source)
    fd.append('file', file)
    if (opts?.start_date) fd.append('start_date', opts.start_date)
    if (opts?.end_date) fd.append('end_date', opts.end_date)
    return api.post<{
      count: number
      dup_count: number
      reim_count: number
      reim_dup_count: number
      filtered_out?: number
      transactions: ParsedTransaction[]
      reimbursements: ParsedReimbursement[]
      account_mappings: AccountMappingItem[]
      message?: string
    }>(
      '/api/imports/parse',
      fd,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    )
  },
  save: (
    source: string,
    transactions: Array<Record<string, unknown>>,
    reimbursements: Array<Record<string, unknown>> = [],
    account_mappings: AccountMappingItem[] = [],
  ) =>
    api.post<{
      saved: number
      reim_saved: number
      reim_linked: number
      mappings_saved: number
      holdings_created: number
      holdings_updated: number
      holdings_warnings: string[]
    }>(
      '/api/imports/save',
      { source, transactions, reimbursements, account_mappings }
    ),
}

export const transactionApi = {
  list: (params?: Record<string, unknown>) =>
    api.get<Transaction[]>('/api/transactions/', { params }),
  get: (id: number) => api.get<Transaction>(`/api/transactions/${id}`),
  create: (data: Record<string, unknown>) => api.post<Transaction>('/api/transactions/', data),
  update: (id: number, data: Record<string, unknown>) =>
    api.patch<Transaction>(`/api/transactions/${id}`, data),
  delete: (id: number) => api.delete(`/api/transactions/${id}`),
  monthlySummary: (year: number, tag_id?: number, member_id?: number) =>
    api.get<MonthlySummary[]>('/api/transactions/summary/monthly', {
      params: {
        year,
        ...(tag_id ? { tag_id } : {}),
        ...(member_id !== undefined ? { member_id } : {}),
      },
    }),
  categorySummary: (year: number, month: number, type?: string, tag_id?: number, member_id?: number) =>
    api.get<CategorySummary[]>('/api/transactions/summary/category', {
      params: {
        year,
        month,
        type: type || 'expense',
        ...(tag_id ? { tag_id } : {}),
        ...(member_id !== undefined ? { member_id } : {}),
      },
    }),
  memberSummary: (year: number, month: number, type?: string) =>
    api.get<MemberSummary[]>('/api/transactions/summary/member', {
      params: { year, month, type: type || 'expense' },
    }),
}

export interface FamilyMemberInput {
  name: string
  avatar: string
  sort_order?: number
}

export const memberApi = {
  list: () => api.get<FamilyMember[]>('/api/members/'),
  create: (data: FamilyMemberInput) => api.post<FamilyMember>('/api/members/', data),
  update: (id: number, data: FamilyMemberInput) => api.put<FamilyMember>(`/api/members/${id}`, data),
  delete: (id: number) => api.delete(`/api/members/${id}`),
}

export const reimbursementApi = {
  listPending: () => api.get<Transaction[]>('/api/reimbursements/pending'),
  list: () => api.get<ReimbursementRecord[]>('/api/reimbursements/'),
  get: (id: number) => api.get<ReimbursementRecord>(`/api/reimbursements/${id}`),
  create: (data: ReimbursementCreateInput) =>
    api.post<ReimbursementRecord>('/api/reimbursements/', data),
  delete: (id: number) =>
    api.delete<{ ok: boolean; reverted_transactions: number }>(`/api/reimbursements/${id}`),
}

export interface RedeemInput {
  to_account_id: number
  date: string
  received_amount: number
  shares_reduced: number
  record_pnl: boolean
  pnl_category_id?: number | null
  note?: string
}

export interface RedeemResult {
  ok: boolean
  cost_basis: number
  pnl: number
  transfer_amount: number
  pnl_txn_id: number | null
  remaining_shares: number
}

export const holdingApi = {
  list: () => api.get<Holding[]>('/api/holdings/'),
  summary: () => api.get<HoldingSummary>('/api/holdings/summary'),
  create: (data: Record<string, unknown>) => api.post<Holding>('/api/holdings/', data),
  update: (id: number, data: Record<string, unknown>) => api.put<Holding>(`/api/holdings/${id}`, data),
  delete: (id: number) => api.delete(`/api/holdings/${id}`),
  refresh: (id: number) => api.post<Holding>(`/api/holdings/${id}/refresh`),
  refreshAll: () => api.post<{ updated: number; failed: Array<{ name: string; error: string }> }>('/api/holdings/refresh-all'),
  redeem: (id: number, data: RedeemInput) => api.post<RedeemResult>(`/api/holdings/${id}/redeem`, data),
}

export interface AccountInput {
  name: string
  icon: string
  category: AccountCategory
  balance: number
  member_id?: number | null
  note: string
  sort_order: number
  tag_ids?: number[]
}

export const accountApi = {
  list: (params?: { member_id?: number }) =>
    api.get<Account[]>('/api/accounts/', { params }),
  create: (data: AccountInput) => api.post<Account>('/api/accounts/', data),
  update: (id: number, data: AccountInput) => api.put<Account>(`/api/accounts/${id}`, data),
  delete: (id: number) => api.delete(`/api/accounts/${id}`),
}

// === Recurring Rule ===
export type RecurrenceType = 'weekly' | 'monthly'
export type EndType = 'never' | 'date' | 'count'
export type TxnType = 'expense' | 'income' | 'transfer'

export interface RecurringRule {
  id: number
  recurrence_type: RecurrenceType
  recurrence_day: number
  start_date: string
  end_type: EndType
  end_date: string | null
  max_count: number | null
  executed_count: number
  type: TxnType
  category_id: number | null
  account_id: number | null
  to_account_id: number | null
  amount: number
  member_id: number | null
  description: string
  tag_ids: number[]
  is_active: boolean
  created_at: string
  updated_at: string
  category: Category | null
  account: AccountBrief | null
  to_account: AccountBrief | null
  member: FamilyMemberBrief | null
}

export interface RecurringExecution {
  id: number
  rule_id: number
  transaction_id: number | null
  target_date: string
  executed_at: string
}

// === Stats Types ===
export interface StatCompareValue {
  current: number
  prev_month: number
  prev_month_pct: number | null
  prev_year: number
  prev_year_pct: number | null
}

export interface MonthlySummaryStats {
  income: StatCompareValue
  expense: StatCompareValue
  balance: StatCompareValue
}

export interface CategoryChild {
  id: number
  name: string
  icon: string
  total: number
  percentage: number
}

export interface CategoryBreakdownItem {
  id: number
  name: string
  icon: string
  total: number
  percentage: number
  prev_month_pct: number | null
  prev_year_pct: number | null
  children: CategoryChild[]
}

export interface MemberBreakdownItem {
  member_id: number | null
  member_name: string
  member_avatar: string
  total: number
  percentage: number
  prev_month_pct: number | null
}

export interface TagStatItem {
  tag_id: number
  tag_name: string
  tag_icon: string
  total: number
  percentage: number
}

export interface TagBreakdownGroup {
  tag_category_id: number
  tag_category_name: string
  tag_category_icon: string
  total: number
  tags: TagStatItem[]
}

export interface MerchantItem {
  counterparty: string
  total: number
  count: number
  percentage: number
}

export interface MonthlyTrend {
  month: number
  income: number
  expense: number
  balance: number
}

export interface AnnualCategoryItem {
  id: number
  name: string
  icon: string
  total: number
  percentage: number
  children: CategoryChild[]
}

export interface AnnualMemberItem {
  member_id: number | null
  member_name: string
  member_avatar: string
  total: number
  percentage: number
}

export interface AnnualReport {
  year: number
  trend: MonthlyTrend[]
  categories: AnnualCategoryItem[]
  members: AnnualMemberItem[]
}

export interface AllocationItem {
  risk_class: string
  label: string
  total: number
  percentage: number
}

export interface AllocationReport {
  total: number
  items: AllocationItem[]
}

export interface NetWorthPoint {
  snapshot_date: string
  total_assets: number
  total_liabilities: number
  net_worth: number
}

export interface DailyItem {
  day: number
  income: number
  expense: number
  balance: number
  transfer_count: number
}

export interface DailyReport {
  year: number
  month: number
  days: DailyItem[]
  avg_daily_income: number
  avg_daily_expense: number
}

export interface DrillDownTransaction {
  id: number
  amount: number
  type: string
  description: string
  counterparty: string
  date: string
  source: string
  category_id: number | null
  category_name: string | null
  category_icon: string | null
  account_id: number | null
  account_name: string | null
  account_icon: string | null
  to_account_id: number | null
  to_account_name: string | null
  to_account_icon: string | null
  member_id: number | null
  member_name: string | null
  member_avatar: string | null
}

export const statsApi = {
  monthlySummary: (year: number, month: number, member_id?: number | null) =>
    api.get<MonthlySummaryStats>('/api/stats/monthly-summary', { params: { year, month, ...(member_id != null ? { member_id } : {}) } }),
  categoryBreakdown: (year: number, month: number, type: string, member_id?: number | null) =>
    api.get<CategoryBreakdownItem[]>('/api/stats/category-breakdown', { params: { year, month, type, ...(member_id != null ? { member_id } : {}) } }),
  memberBreakdown: (year: number, month: number, type: string) =>
    api.get<MemberBreakdownItem[]>('/api/stats/member-breakdown', { params: { year, month, type } }),
  tagBreakdown: (year: number, month: number, type: string, member_id?: number | null) =>
    api.get<TagBreakdownGroup[]>('/api/stats/tag-breakdown', { params: { year, month, type, ...(member_id != null ? { member_id } : {}) } }),
  topMerchants: (year: number, month: number, type: string, limit = 10, member_id?: number | null) =>
    api.get<MerchantItem[]>('/api/stats/top-merchants', { params: { year, month, type, limit, ...(member_id != null ? { member_id } : {}) } }),
  annual: (year: number, type: string, member_id?: number | null) =>
    api.get<AnnualReport>('/api/stats/annual', { params: { year, type, ...(member_id != null ? { member_id } : {}) } }),
  dailyReport: (year: number, month: number, type: string, member_id?: number | null) =>
    api.get<DailyReport>('/api/stats/daily-report', { params: { year, month, type, ...(member_id != null ? { member_id } : {}) } }),
  drillDown: (year: number, month: number | null, type: string | null, params: { category_id?: number; tag_id?: number; counterparty?: string; member_id?: number | null; day?: number }) =>
    api.get<DrillDownTransaction[]>('/api/stats/drill-down', {
      params: {
        year,
        ...(month != null ? { month } : {}),
        ...(type != null ? { type } : {}),
        ...(params.category_id != null ? { category_id: params.category_id } : {}),
        ...(params.tag_id != null ? { tag_id: params.tag_id } : {}),
        ...(params.counterparty != null ? { counterparty: params.counterparty } : {}),
        ...(params.member_id != null ? { member_id: params.member_id } : {}),
        ...(params.day != null ? { day: params.day } : {}),
      },
    }),
  allocation: () =>
    api.get<AllocationReport>('/api/stats/allocation'),
  networthTrend: () =>
    api.get<NetWorthPoint[]>('/api/stats/networth-trend'),
  takeSnapshot: () =>
    api.post<{ message: string; accounts: number; holdings: number }>('/api/stats/snapshots/take'),
}

export const recurringRuleApi = {
  list: () => api.get<RecurringRule[]>('/api/recurring-rules/'),
  get: (id: number) => api.get<RecurringRule>(`/api/recurring-rules/${id}`),
  create: (data: Record<string, unknown>) =>
    api.post<RecurringRule>('/api/recurring-rules/', data),
  update: (id: number, data: Record<string, unknown>) =>
    api.patch<RecurringRule>(`/api/recurring-rules/${id}`, data),
  delete: (id: number) => api.delete(`/api/recurring-rules/${id}`),
  executions: (id: number) =>
    api.get<RecurringExecution[]>(`/api/recurring-rules/${id}/executions`),
}

export default api
