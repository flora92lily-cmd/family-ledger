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
export type AccountCategory = '资金账户' | '信用卡' | '充值账户' | '债务' | '投资理财'

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
      message?: string
    }>(
      '/api/imports/parse',
      fd,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    )
  },
  save: (source: string, transactions: Array<Record<string, unknown>>, reimbursements: Array<Record<string, unknown>> = []) =>
    api.post<{ saved: number; reim_saved: number; reim_linked: number }>(
      '/api/imports/save',
      { source, transactions, reimbursements }
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

export const holdingApi = {
  list: () => api.get<Holding[]>('/api/holdings/'),
  summary: () => api.get<HoldingSummary>('/api/holdings/summary'),
  create: (data: Record<string, unknown>) => api.post<Holding>('/api/holdings/', data),
  update: (id: number, data: Record<string, unknown>) => api.put<Holding>(`/api/holdings/${id}`, data),
  delete: (id: number) => api.delete(`/api/holdings/${id}`),
  refresh: (id: number) => api.post<Holding>(`/api/holdings/${id}/refresh`),
  refreshAll: () => api.post<{ updated: number; failed: Array<{ name: string; error: string }> }>('/api/holdings/refresh-all'),
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

export default api
