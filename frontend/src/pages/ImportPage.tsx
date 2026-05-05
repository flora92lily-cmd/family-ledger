import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  importApi,
  categoryApi,
  tagApi,
  accountApi,
  memberApi,
  holdingApi,
  type ParsedTransaction,
  type ParsedReimbursement,
  type CategoryTree,
  type Tag,
  type Account,
  type FamilyMember,
  type AccountMappingItem,
  type Holding,
  type FundCandidate,
} from '../api'

// 支付方式关键词 → 账户名关键词映射
const PAYMENT_ACCOUNT_HINTS: Array<{ keywords: string[]; accountKeywords: string[] }> = [
  { keywords: ['招商银行', '招行'], accountKeywords: ['招行', '招商'] },
  { keywords: ['余额宝', '支付宝', '余额'], accountKeywords: ['支付宝', '余额'] },
  { keywords: ['花呗'], accountKeywords: ['花呗'] },
  { keywords: ['微信', '零钱'], accountKeywords: ['微信', '零钱'] },
  { keywords: ['工商银行', '工行'], accountKeywords: ['工行', '工商'] },
  { keywords: ['建设银行', '建行'], accountKeywords: ['建行', '建设'] },
  { keywords: ['农业银行', '农行'], accountKeywords: ['农行', '农业'] },
  { keywords: ['中国银行', '中行'], accountKeywords: ['中行', '中国银行'] },
]

// 模糊匹配指定关键词到账户
function matchAccountByKeywords(keywords: string[], accounts: Account[]): number | null {
  const matched = accounts.find(a => keywords.some(kw => a.name.includes(kw)))
  return matched?.id ?? null
}

const SOURCE_FALLBACK: Record<string, string[]> = {
  alipay: ['支付宝'],
  wechat: ['微信'],
  bank_pdf: ['招行', '招商'],
  jd: ['京东'],
}

function autoMatchAccount(paymentMethod: string, accounts: Account[]): number | null {
  if (!paymentMethod) return null
  for (const hint of PAYMENT_ACCOUNT_HINTS) {
    if (hint.keywords.some(kw => paymentMethod.includes(kw))) {
      const matched = accounts.find(a =>
        hint.accountKeywords.some(ak => a.name.includes(ak))
      )
      if (matched) return matched.id
    }
  }
  return null
}

const SOURCES = [
  { value: 'alipay', label: '支付宝', icon: '🅰️', desc: '从支付宝导出的 CSV 账单' },
  { value: 'wechat', label: '微信支付', icon: '💚', desc: '从微信支付导出的 CSV 账单' },
  { value: 'bank_pdf', label: '银行账单', icon: '🏦', desc: '招商银行流水 PDF' },
  { value: 'qianji', label: '钱迹', icon: '📒', desc: '钱迹 App 导出的 CSV 账本' },
  { value: 'jd', label: '京东', icon: '🛒', desc: '京东交易流水 CSV' },
  { value: 'generic', label: '通用 CSV', icon: '📋', desc: '其他记账软件导出的 CSV/Excel' },
]


export default function ImportPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<'select' | 'mapping' | 'preview'>('select')
  const [source, setSource] = useState<string>('')
  const [parsing, setParsing] = useState(false)
  // 钱迹专属：日期范围过滤（一次性导出全部历史时，限制只导入指定区间）
  const [qianjiStartDate, setQianjiStartDate] = useState<string>('')
  const [qianjiEndDate, setQianjiEndDate] = useState<string>('')
  const [filteredOutCount, setFilteredOutCount] = useState(0)
  const [transactions, setTransactions] = useState<ParsedTransaction[]>([])
  const [selectedIdx, setSelectedIdx] = useState<Set<number>>(new Set())
  const [reimbursements, setReimbursements] = useState<ParsedReimbursement[]>([])
  const [selectedReimIdx, setSelectedReimIdx] = useState<Set<number>>(new Set())
  const [catTree, setCatTree] = useState<CategoryTree[]>([])
  const [tags, setTags] = useState<Tag[]>([])          // 未归档标签
  const [accounts, setAccounts] = useState<Account[]>([])
  const [holdings, setHoldings] = useState<Holding[]>([])
  // 当前导入会话中前端临时建仓：detected_name → { code, name, account_id }（save 时随交易传给后端建库）
  const [pendingNewHoldings, setPendingNewHoldings] = useState<Map<string, { code: string; name: string; account_id: number | null }>>(new Map())
  const [members, setMembers] = useState<FamilyMember[]>([])
  const [batchMemberId, setBatchMemberId] = useState<number | null>(null)
  const [_parseMessage, setParseMessage] = useState('')
  const [dupCount, setDupCount] = useState(0)
  const [reimDupCount, setReimDupCount] = useState(0)
  const [saving, setSaving] = useState(false)

  // 批量标签：虚拟叠加到所有勾选账单，不写入各行 state，保存时才合并
  const [batchTagIds, setBatchTagIds] = useState<number[]>([])

  // 原始账户映射：(payment_method 字符串 → account_id 或 null)。
  // 解析后由后端 account_mappings 初始化，未命中映射的项用 autoMatchAccount 启发式补；
  // 用户在 mapping step 改一项时同步所有该 payment_method 的交易；保存时整表 upsert。
  const [accountMappings, setAccountMappings] = useState<Map<string, number | null>>(new Map())

  // 后端返回时已经在 payment_method_mappings 表里记忆过的 raw_name 集合（用于在 mapping 页显示"已记忆"徽标）
  const [rememberedRawNames, setRememberedRawNames] = useState<Set<string>>(new Set())

  // 钱迹专属：标签列按家庭成员匹配（命中成员名 → 填 member_id，否则继续作为标签）
  const [qianjiTagAsMember, setQianjiTagAsMember] = useState(() => {
    try { return localStorage.getItem('qianji_tag_as_member') === '1' } catch { return false }
  })
  // 保存 parse 时的原始 tag_names + member_id 快照，按 index 索引；toggle 切换时基于此重算
  const originalParsedRef = useRef<Map<number, { tag_names: string[]; member_id: number | null }>>(new Map())

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    categoryApi.tree().then(r => setCatTree(r.data))
    tagApi.list({ include_archived: false }).then(r => setTags(r.data))
    accountApi.list().then(r => setAccounts(r.data))
    memberApi.list().then(r => setMembers(r.data))
    holdingApi.list().then(r => setHoldings(r.data))
  }, [])

  useEffect(() => {
    try { localStorage.setItem('qianji_tag_as_member', qianjiTagAsMember ? '1' : '0') } catch { /* ignore */ }
  }, [qianjiTagAsMember])

  // 根据 toggle + 原始快照重算 transactions：开启时把命中成员名的 tag_names 转移到 member_id
  const applyMemberMapping = (
    enable: boolean,
    txns: ParsedTransaction[],
    memberList: FamilyMember[],
    origMap: Map<number, { tag_names: string[]; member_id: number | null }>
  ): ParsedTransaction[] => {
    return txns.map(t => {
      const orig = origMap.get(t.index)
      if (!orig) return t
      if (!enable) {
        return { ...t, tag_names: [...orig.tag_names], member_id: orig.member_id }
      }
      const remaining: string[] = []
      let matchedMember: number | null = orig.member_id
      for (const name of orig.tag_names) {
        const m = memberList.find(mm => mm.name === name)
        if (m && matchedMember == null) {
          matchedMember = m.id
        } else {
          remaining.push(name)
        }
      }
      return { ...t, tag_names: remaining, member_id: matchedMember }
    })
  }

  const handleToggleTagAsMember = (next: boolean) => {
    setQianjiTagAsMember(next)
    setTransactions(prev => applyMemberMapping(next, prev, members, originalParsedRef.current))
  }

  const handleSourceClick = (src: string) => {
    setSource(src)
    // 钱迹需要先选日期范围（可选），点开后展示日期选择器，不直接弹文件选择
    if (src === 'qianji') return
    fileInputRef.current?.click()
  }

  const handleQianjiPickFile = () => {
    if (qianjiStartDate && qianjiEndDate && qianjiStartDate > qianjiEndDate) {
      alert('开始日期不能晚于结束日期')
      return
    }
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !source) return

    setParsing(true)
    setParseMessage('')
    try {
      const parseOpts = source === 'qianji'
        ? {
            start_date: qianjiStartDate || undefined,
            end_date: qianjiEndDate || undefined,
          }
        : undefined
      const [parseRes, acctRes, holdRes] = await Promise.all([
        importApi.parse(source, file, parseOpts),
        accountApi.list(),
        holdingApi.list(),
      ])
      const loadedAccounts = acctRes.data
      const loadedHoldings = holdRes.data
      setAccounts(loadedAccounts)
      setHoldings(loadedHoldings)

      const txns = parseRes.data.transactions
      const reims = parseRes.data.reimbursements || []
      setDupCount(parseRes.data.dup_count || 0)
      setReimDupCount(parseRes.data.reim_dup_count || 0)
      setFilteredOutCount(parseRes.data.filtered_out || 0)

      const fallbackHints = SOURCE_FALLBACK[source] || []
      const fallbackAccount = loadedAccounts.find(a =>
        fallbackHints.some(kw => a.name.includes(kw)) && a.category === '资金账户'
      )

      // 初始化原始账户映射：后端返回的 account_id 优先；为 null 的用启发式兜底
      const initMap = new Map<string, number | null>()
      const remembered = new Set<string>()
      const backendMappings = parseRes.data.account_mappings || []
      for (const m of backendMappings) {
        if (m.account_id != null) {
          initMap.set(m.raw_name, m.account_id)
          remembered.add(m.raw_name)  // 后端有记录 = "已记忆"
        } else {
          // 历史无映射：用启发式 + 来源兜底（空 raw_name 走 fallbackAccount，模拟整本账单）
          let guess: number | null = null
          if (m.raw_name) {
            guess = autoMatchAccount(m.raw_name, loadedAccounts) ?? fallbackAccount?.id ?? null
          } else {
            guess = fallbackAccount?.id ?? null
          }
          initMap.set(m.raw_name, guess)
        }
      }
      setAccountMappings(initMap)
      setRememberedRawNames(remembered)

      const enriched = txns.map(t => {
        // 投资 transfer：from = 资金账户（payment_method 映射）；to = target_holding 的绑定账户
        if (t.type === 'transfer' && t.detected_action) {
          const fromMap = initMap.get(t.payment_method || '')
          const fundAccount = fromMap
            ?? autoMatchAccount(t.payment_method, loadedAccounts)
            ?? fallbackAccount?.id
            ?? null
          const targetH = t.target_holding_id ? loadedHoldings.find(h => h.id === t.target_holding_id) : null
          const investAccount = targetH?.account_id ?? null
          if (t.detected_action === 'buy') {
            return {
              ...t,
              account_id: t.account_id ?? fundAccount,
              to_account_id: t.to_account_id ?? investAccount,
            }
          }
          // sell
          return {
            ...t,
            account_id: t.account_id ?? investAccount,
            to_account_id: t.to_account_id ?? fundAccount,
          }
        }
        if (t.type === 'transfer') {
          // 9.6 零钱通转账：根据 description 含"存入/转入"或"转出"判断方向
          const zqtId = matchAccountByKeywords(['零钱通'], loadedAccounts)
          const otherId = autoMatchAccount(t.payment_method, loadedAccounts)
            ?? fallbackAccount?.id
            ?? null
          const isInflow = /存入|转入/.test(t.description)
          return {
            ...t,
            account_id: t.account_id ?? (isInflow ? otherId : zqtId),
            to_account_id: t.to_account_id ?? (isInflow ? zqtId : otherId),
          }
        }
        // 非转账：account_id 优先级 = 后端预填（来自映射记忆） > 前端启发式映射 > 兜底
        const fromMap = initMap.get(t.payment_method || '')
        return {
          ...t,
          account_id: t.account_id
            ?? (fromMap !== undefined ? fromMap : null)
            ?? autoMatchAccount(t.payment_method, loadedAccounts)
            ?? fallbackAccount?.id
            ?? null,
        }
      })
      // 报销记录自动匹配到账账户（后端已尝试过，这里再兜底一次）
      const enrichedReim = reims.map(r => ({
        ...r,
        to_account_id: r.to_account_id
          ?? autoMatchAccount(r.payment_method, loadedAccounts)
          ?? null,
      }))
      // 保存原始 parsed 快照，供成员/标签 toggle 切换时回溯
      const origMap = new Map<number, { tag_names: string[]; member_id: number | null }>()
      enriched.forEach(t => origMap.set(t.index, { tag_names: [...t.tag_names], member_id: t.member_id }))
      originalParsedRef.current = origMap

      // 钱迹 + 开关开启：解析后立即把命中成员名的 tag_names 转换为 member_id
      const finalTxns = source === 'qianji'
        ? applyMemberMapping(qianjiTagAsMember, enriched, members, origMap)
        : enriched

      setTransactions(finalTxns)
      setReimbursements(enrichedReim)
      setSelectedIdx(new Set(
        finalTxns.filter(t => !t.is_duplicate && !t.default_unchecked).map(t => t.index)
      ))
      setSelectedReimIdx(new Set(enrichedReim.filter(r => !r.is_duplicate).map(r => r.index)))
      setParseMessage(parseRes.data.message || '')
      setBatchTagIds([])
      if (enriched.length > 0 || enrichedReim.length > 0) {
        // 流程分支：有任何 raw_name 未在记忆表里 → 进 mapping 让用户先选；否则直接 preview
        const hasUnremembered = backendMappings.some(m => !remembered.has(m.raw_name))
        if (hasUnremembered) {
          setStep('mapping')
        } else {
          setStep('preview')
        }
      } else {
        alert(parseRes.data.message || '未能解析出任何交易记录')
      }
    } catch (err) {
      const error = err as { response?: { data?: { detail?: string } }; message?: string }
      alert('解析失败：' + (error.response?.data?.detail || error.message))
    } finally {
      setParsing(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const toggleSelect = (idx: number) => {
    const next = new Set(selectedIdx)
    if (next.has(idx)) next.delete(idx)
    else next.add(idx)
    setSelectedIdx(next)
  }

  const toggleAll = () => {
    if (selectedIdx.size === transactions.length) {
      setSelectedIdx(new Set())
    } else {
      setSelectedIdx(new Set(transactions.map(t => t.index)))
    }
  }

  const updateTxn = (idx: number, patch: Partial<ParsedTransaction>) => {
    setTransactions(prev => prev.map(t => (t.index === idx ? { ...t, ...patch } : t)))
  }

  // 切换单条账单的手动标签（不含批量标签，批量由 batchTagIds 管理）
  const toggleTxnTag = (txnIndex: number, tagId: number) => {
    // 批量标签不允许在单条里再次操作
    if (batchTagIds.includes(tagId)) return
    const txn = transactions.find(t => t.index === txnIndex)
    if (!txn) return
    const newTagIds = txn.tag_ids.includes(tagId)
      ? txn.tag_ids.filter(id => id !== tagId)
      : [...txn.tag_ids, tagId]
    updateTxn(txnIndex, { tag_ids: newTagIds })
  }

  // 移除单条账单上的钱迹原始标签名（字符串）
  const removeTxnTagName = (txnIndex: number, name: string) => {
    const txn = transactions.find(t => t.index === txnIndex)
    if (!txn) return
    updateTxn(txnIndex, { tag_names: txn.tag_names.filter(n => n !== name) })
  }

  // 切换批量标签（选中即实时显示在下方所有账单）
  const toggleBatchTag = (tagId: number) => {
    setBatchTagIds(prev =>
      prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]
    )
  }

  // 改某个 payment_method 的目标账户：写 map state + 同步所有该 raw_name 的非转账交易
  const updateMapping = (rawName: string, accountId: number | null) => {
    setAccountMappings(prev => {
      const next = new Map(prev)
      next.set(rawName, accountId)
      return next
    })
    setTransactions(prev => prev.map(t => {
      if (t.type === 'transfer') return t
      if ((t.payment_method || '') === rawName) {
        return { ...t, account_id: accountId }
      }
      return t
    }))
  }

  const toggleReimSelect = (idx: number) => {
    const next = new Set(selectedReimIdx)
    if (next.has(idx)) next.delete(idx)
    else next.add(idx)
    setSelectedReimIdx(next)
  }

  const updateReim = (idx: number, patch: Partial<ParsedReimbursement>) => {
    setReimbursements(prev => prev.map(r => (r.index === idx ? { ...r, ...patch } : r)))
  }

  const handleSave = async () => {
    const toSave = transactions
      .filter(t => selectedIdx.has(t.index))
      .map(t => {
        // 投资交易：附带 detected_* 和当场建仓信息
        const investExtras: Record<string, unknown> = {}
        if (t.detected_action) {
          investExtras.detected_action = t.detected_action
          investExtras.detected_asset_type = t.detected_asset_type
          investExtras.target_holding_id = t.target_holding_id ?? null
          // 如果用户在预览页选了 eastmoney 候选但没建本地 holding，pendingNewHoldings 会有
          const pending = t.detected_name ? pendingNewHoldings.get(t.detected_name) : null
          if (!t.target_holding_id && pending) {
            investExtras.new_holding_code = pending.code
            investExtras.new_holding_name = pending.name
            investExtras.new_holding_account_id = pending.account_id
          }
        }
        return {
          amount: t.amount,
          type: t.type,
          date: t.date,
          description: t.description,
          counterparty: t.counterparty,
          category_id: t.category_id,
          account_id: t.account_id ?? null,
          to_account_id: t.to_account_id ?? null,
          // 优先级：单条 > 批量 > null
          member_id: t.member_id ?? batchMemberId ?? null,
          // 合并批量标签 + 单条标签（去重）
          tag_ids: [...new Set([...batchTagIds, ...t.tag_ids])],
          // 钱迹原始标签名交给后端在 save 时建库
          tag_names: t.tag_names,
          // 报销字段（钱迹 parse 时自动填充，用户也可在预览页修改）
          is_reimbursable: t.is_reimbursable,
          reimbursable_amount: t.reimbursable_amount,
          reimbursement_status: t.reimbursement_status,
          external_id: t.external_id,
          ...investExtras,
        }
      })

    const reimToSave = reimbursements
      .filter(r => selectedReimIdx.has(r.index))
      .map(r => ({
        amount: r.amount,
        date: r.date,
        note: r.note,
        to_account_id: r.to_account_id ?? null,
        external_id: r.external_id,
        linked_external_id: r.linked_external_id,
      }))

    if (toSave.length === 0 && reimToSave.length === 0) {
      alert('请至少选择一条交易或报销记录')
      return
    }

    // 检查有没有投资交易未关联持仓（保存后份额不会更新）
    const unresolvedInvest = transactions.filter(t =>
      selectedIdx.has(t.index) &&
      t.detected_action &&
      !t.target_holding_id &&
      !(t.detected_name && pendingNewHoldings.has(t.detected_name))
    )
    if (unresolvedInvest.length > 0) {
      const names = unresolvedInvest.map(t => t.detected_name || '未知').join('、')
      const ok = confirm(
        `以下 ${unresolvedInvest.length} 笔投资交易未关联持仓，保存后不会自动更新份额：\n${names}\n\n继续保存（仅记转账），还是返回去选择持仓？\n\n点"确定"继续，点"取消"返回。`
      )
      if (!ok) return
    }

    setSaving(true)
    try {
      const mappingsToSave: AccountMappingItem[] = Array.from(accountMappings.entries()).map(
        ([raw_name, account_id]) => ({ raw_name, account_id })
      )
      const res = await importApi.save(source, toSave, reimToSave, mappingsToSave)
      const parts = [`交易 ${res.data.saved} 条`]
      if (res.data.reim_saved) parts.push(`报销记录 ${res.data.reim_saved} 条`)
      if (res.data.reim_linked) parts.push(`已关联原账单 ${res.data.reim_linked} 条`)
      if (res.data.holdings_created) parts.push(`新建持仓 ${res.data.holdings_created} 个`)
      if (res.data.holdings_updated) parts.push(`持仓份额已更新 ${res.data.holdings_updated} 条`)
      let msg = '成功导入：' + parts.join('，')
      if (res.data.holdings_warnings?.length) {
        msg += '\n\n⚠ 投资份额提示：\n' + res.data.holdings_warnings.join('\n')
      }
      alert(msg)
      navigate('/')
    } catch (err) {
      const error = err as { message?: string }
      alert('保存失败：' + error.message)
    } finally {
      setSaving(false)
    }
  }

  const totalSelected = transactions.filter(t => selectedIdx.has(t.index))
  const totalExpense = totalSelected.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const totalIncome = totalSelected.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)

  const tagMap = Object.fromEntries(tags.map(t => [t.id, t]))

  if (step === 'select') {
    return (
      <div className="page-content">
        <div className="page-header">
          <button className="back-btn" onClick={() => navigate('/settings')}>←</button>
          导入账单
        </div>

        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 16 }}>
            选择账单来源，上传文件后将自动解析并智能分类
          </div>

          {SOURCES.map(s => {
            const isQianjiExpanded = s.value === 'qianji' && source === 'qianji'
            return (
              <div key={s.value}
                style={{ marginBottom: 12 }}>
                <div onClick={() => handleSourceClick(s.value)}
                  style={{ background: 'white', borderRadius: isQianjiExpanded ? '12px 12px 0 0' : 12, padding: 16, display: 'flex', alignItems: 'center', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', borderBottom: isQianjiExpanded ? '1px solid #e5e7eb' : undefined }}>
                  <div style={{ fontSize: 32, marginRight: 12 }}>{s.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{s.label}</div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{s.desc}</div>
                  </div>
                  <div style={{ color: '#9ca3af' }}>{isQianjiExpanded ? '▾' : '›'}</div>
                </div>

                {isQianjiExpanded && (
                  <div style={{ background: 'white', borderRadius: '0 0 12px 12px', padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                    <div style={{ fontSize: 13, color: '#374151', fontWeight: 500, marginBottom: 8 }}>
                      📅 选择导入日期范围（可选）
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
                      钱迹一次性导出全部历史，可在此限定本次只导入指定区间。留空则全部导入（仍会自动去重）。
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                      <input type="date" value={qianjiStartDate}
                        onChange={e => setQianjiStartDate(e.target.value)}
                        style={{ flex: 1, padding: '6px 8px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6 }} />
                      <span style={{ color: '#9ca3af' }}>至</span>
                      <input type="date" value={qianjiEndDate}
                        onChange={e => setQianjiEndDate(e.target.value)}
                        style={{ flex: 1, padding: '6px 8px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6 }} />
                    </div>
                    {(qianjiStartDate || qianjiEndDate) && (
                      <div style={{ marginBottom: 10 }}>
                        <button onClick={() => { setQianjiStartDate(''); setQianjiEndDate('') }}
                          style={{ background: 'none', border: 'none', fontSize: 12, color: '#6b7280', cursor: 'pointer', padding: 0 }}>
                          清空日期
                        </button>
                      </div>
                    )}
                    <button onClick={handleQianjiPickFile}
                      style={{ width: '100%', padding: '10px', fontSize: 14, fontWeight: 500, background: '#3b82f6', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                      选择文件
                    </button>
                  </div>
                )}
              </div>
            )
          })}

          {parsing && <div style={{ textAlign: 'center', padding: 16, color: '#6b7280' }}>正在解析文件...</div>}

          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.pdf,.txt"
            style={{ display: 'none' }} onChange={handleFileChange} />
        </div>
      </div>
    )
  }

  // ─── 账户映射 step：先让用户把账单里出现的支付方式映射到 APP 账户，再进 preview ───
  if (step === 'mapping') {
    const pmCounts = new Map<string, number>()
    for (const t of transactions) {
      if (t.type === 'transfer') continue
      const key = t.payment_method || ''
      pmCounts.set(key, (pmCounts.get(key) || 0) + 1)
    }
    const sortedPms = Array.from(pmCounts.entries()).sort((a, b) => b[1] - a[1])
    const unmappedCount = sortedPms.filter(([rn]) => !accountMappings.get(rn)).length

    return (
      <div className="page-content">
        <div className="page-header">
          <button className="back-btn" onClick={() => setStep('select')}>←</button>
          账户映射
        </div>
        <div style={{ padding: '0 16px' }}>
          <div style={{ margin: '8px 0', padding: '10px 14px', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 10, fontSize: 13, color: '#5b21b6' }}>
            📥 把账单里出现的支付方式映射到 APP 账户。下次导入相同来源的账单会自动按这次的映射预填，不用再选。
          </div>

          {sortedPms.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af' }}>
              本次账单没有可映射的支付方式（仅含转账行）
            </div>
          ) : sortedPms.map(([rawName, count]) => {
            const mapped = accountMappings.get(rawName) ?? null
            const isEmpty = rawName === ''
            const isRemembered = rememberedRawNames.has(rawName)
            return (
              <div key={rawName || '__empty__'} className="card" style={{ margin: '8px 0', padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {isEmpty
                      ? <span style={{ color: '#6b7280' }}>📄 整本账单（未标注支付方式）</span>
                      : <span>{rawName}</span>}
                  </div>
                  <span style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 10,
                    background: isRemembered ? '#dcfce7' : '#fef3c7',
                    color: isRemembered ? '#15803d' : '#b45309',
                    whiteSpace: 'nowrap', marginLeft: 8,
                  }}>
                    {isRemembered ? '已记忆' : '新'}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8 }}>
                  共 {count} 条交易
                </div>
                <select
                  value={mapped ?? ''}
                  onChange={e => updateMapping(rawName, e.target.value ? parseInt(e.target.value) : null)}
                  style={{
                    width: '100%', padding: '6px 10px', fontSize: 13,
                    border: mapped ? '1px solid #a78bfa' : '1px dashed #d1d5db',
                    borderRadius: 6,
                    background: mapped ? '#f5f3ff' : '#f9fafb',
                    color: mapped ? '#6d28d9' : '#9ca3af',
                  }}>
                  <option value="">未关联（这部分交易不会自动选账户）</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
                </select>
              </div>
            )
          })}

          {sortedPms.length > 0 && (
            <>
              <button className="btn-primary" onClick={() => setStep('preview')} style={{ marginTop: 16 }}>
                {unmappedCount > 0 ? `下一步:预览交易(${unmappedCount} 个未关联)` : '下一步:预览交易'}
              </button>
              {unmappedCount > 0 && (
                <div style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center', marginTop: 8 }}>
                  未关联的支付方式不会被记忆,对应交易在预览页可单独选择账户
                </div>
              )}
            </>
          )}
          {sortedPms.length === 0 && (
            <button className="btn-primary" onClick={() => setStep('preview')} style={{ marginTop: 16 }}>
              下一步:预览交易
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <button className="back-btn" onClick={() => setStep('mapping')}>←</button>
        预览导入 ({selectedIdx.size}/{transactions.length}
        {reimbursements.length > 0 ? ` + 报销${selectedReimIdx.size}/${reimbursements.length}` : ''})
      </div>

      <div style={{ padding: '0 16px' }}>
        {filteredOutCount > 0 && (
          <div style={{ margin: '8px 0', padding: '10px 14px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, fontSize: 13, color: '#1e40af' }}>
            📅 已按日期范围过滤掉 <strong>{filteredOutCount}</strong> 条不在区间内的记录
            {(qianjiStartDate || qianjiEndDate) && (
              <span style={{ color: '#3b82f6', marginLeft: 4 }}>
                （{qianjiStartDate || '不限'} 至 {qianjiEndDate || '不限'}）
              </span>
            )}
          </div>
        )}

        {dupCount > 0 && (
          <div style={{ margin: '8px 0', padding: '10px 14px', background: '#fefce8', border: '1px solid #fde68a', borderRadius: 10, fontSize: 13, color: '#92400e' }}>
            ⚠️ 检测到 <strong>{dupCount}</strong> 条疑似重复（金额相同、日期相近），已默认取消勾选，可手动勾回
          </div>
        )}

        {reimDupCount > 0 && (
          <div style={{ margin: '8px 0', padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, fontSize: 13, color: '#991b1b' }}>
            ⚠️ 检测到 <strong>{reimDupCount}</strong> 条报销记录已存在（external_id 重复），已默认取消勾选
          </div>
        )}

        {/* 已应用映射提示条：点击"修改"回到独立映射 step */}
        {accountMappings.size > 0 && (() => {
          const total = accountMappings.size
          const mapped = Array.from(accountMappings.values()).filter(v => v != null).length
          return (
            <div style={{
              margin: '8px 0',
              padding: '10px 14px',
              background: '#f5f3ff',
              border: '1px solid #ddd6fe',
              borderRadius: 10,
              fontSize: 13,
              color: '#5b21b6',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span>📥 已为 <strong>{mapped}/{total}</strong> 个支付方式关联了 APP 账户</span>
              <button onClick={() => setStep('mapping')}
                style={{ background: 'none', border: '1px solid #c4b5fd', color: '#6d28d9', borderRadius: 6, padding: '3px 10px', fontSize: 12, cursor: 'pointer' }}>
                修改映射
              </button>
            </div>
          )
        })()}

        <div className="card" style={{ margin: '8px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>支出 / 收入</div>
              <div style={{ fontSize: 14, marginTop: 2 }}>
                <span style={{ color: '#ef4444' }}>-¥{totalExpense.toFixed(2)}</span>
                <span style={{ margin: '0 6px', color: '#9ca3af' }}>/</span>
                <span style={{ color: '#22c55e' }}>+¥{totalIncome.toFixed(2)}</span>
              </div>
            </div>
            <button onClick={toggleAll}
              style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 12px', fontSize: 13, cursor: 'pointer' }}>
              {selectedIdx.size === transactions.length ? '取消全选' : '全选'}
            </button>
          </div>

          {/* 钱迹标签 → 家庭成员开关 */}
          {source === 'qianji' && members.length > 0 && (
            <div style={{ marginBottom: 10, padding: '8px 10px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={qianjiTagAsMember}
                  onChange={e => handleToggleTagAsMember(e.target.checked)}
                  style={{ width: 16, height: 16 }} />
                <span style={{ fontWeight: 500 }}>钱迹标签按家庭成员匹配</span>
              </label>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4, paddingLeft: 24 }}>
                {qianjiTagAsMember
                  ? '✓ 命中成员名（如「老公」）→ 自动填到家庭成员；其余继续作为标签'
                  : '所有标签保持为标签；切换会基于原始解析结果重算（已手动改的会被覆盖）'}
              </div>
            </div>
          )}

          {/* 批量家庭成员：未单独指定的账单沿用此值 */}
          {members.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>
                批量家庭成员
                {batchMemberId !== null
                  ? <span style={{ fontSize: 11, color: '#3b82f6', marginLeft: 6 }}>
                      未单独指定的账单将归属此成员
                    </span>
                  : <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 6 }}>
                      可选：批量设置归属成员，单条可单独覆盖
                    </span>
                }
              </div>
              <div className="member-chips">
                <div className={`chip ${batchMemberId === null ? 'selected' : ''}`}
                  onClick={() => setBatchMemberId(null)}>
                  未指定
                </div>
                {members.map(m => (
                  <div key={m.id} className={`chip ${batchMemberId === m.id ? 'selected' : ''}`}
                    onClick={() => setBatchMemberId(m.id)}>
                    {m.avatar} {m.name}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 批量标签：选中即实时显示在下方账单，无需点"应用" */}
          {tags.length > 0 && (
            <div>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>
                批量标签
                {batchTagIds.length > 0
                  ? <span style={{ fontSize: 11, color: '#3b82f6', marginLeft: 6 }}>
                      已选 {batchTagIds.length} 个，将显示在下方所有账单上
                    </span>
                  : <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 6 }}>
                      选择后实时显示到所有账单，单条可另行追加
                    </span>
                }
              </div>
              <div className="member-chips">
                {tags.map(tag => (
                  <div key={tag.id} className={`chip ${batchTagIds.includes(tag.id) ? 'selected' : ''}`}
                    onClick={() => toggleBatchTag(tag.id)}>
                    {tag.icon} {tag.name}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {transactions.map(t => {
          // 这条账单实际显示的全部标签：批量 + 单条手动
          const effectiveBatchIds = batchTagIds
          const perRowIds = t.tag_ids.filter(id => !batchTagIds.includes(id))
          const hasAnyTag = effectiveBatchIds.length > 0 || perRowIds.length > 0 || t.tag_names.length > 0

          return (
            <div key={t.index} className="card"
              style={{ margin: '8px 0', padding: 12, opacity: selectedIdx.has(t.index) ? 1 : 0.5, background: t.is_duplicate ? '#fefce8' : 'white', border: t.is_duplicate ? '1px solid #fde68a' : undefined }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <input type="checkbox" checked={selectedIdx.has(t.index)}
                  onChange={() => toggleSelect(t.index)}
                  style={{ marginTop: 4, width: 18, height: 18, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.description || t.counterparty || '未命名交易'}
                      {t.is_duplicate && <span style={{ marginLeft: 6, fontSize: 11, color: '#92400e', background: '#fde68a', borderRadius: 4, padding: '1px 5px' }}>疑似重复</span>}
                      {!t.is_duplicate && t.default_unchecked && <span style={{ marginLeft: 6, fontSize: 11, color: '#6b7280', background: '#e5e7eb', borderRadius: 4, padding: '1px 5px' }}>需确认</span>}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: t.type === 'expense' ? '#ef4444' : t.type === 'transfer' ? '#6366f1' : '#22c55e', marginLeft: 8, whiteSpace: 'nowrap' }}>
                      {t.type === 'expense' ? '-' : t.type === 'income' ? '+' : ''}¥{t.amount.toFixed(2)}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
                    {t.date}
                    {t.counterparty && t.counterparty !== t.description && ` · ${t.counterparty}`}
                    {t.payment_method && <span style={{ color: '#a78bfa' }}> · {t.payment_method}</span>}
                  </div>

                  {t.type !== 'transfer' && (
                    <select value={t.category_id || ''}
                      onChange={e => {
                        const cid = e.target.value ? parseInt(e.target.value) : null
                        let name: string | null = null
                        for (const parent of catTree) {
                          if (parent.id === cid) { name = parent.name; break }
                          const child = parent.children.find(ch => ch.id === cid)
                          if (child) { name = child.name; break }
                        }
                        updateTxn(t.index, { category_id: cid, category_name: name })
                      }}
                      style={{ width: '100%', padding: '4px 6px', fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 6, background: '#f9fafb' }}>
                      <option value="">未分类</option>
                      {catTree
                        .filter(c => c.type === t.type)
                        .map(parent => parent.children.length > 0 ? (
                          <optgroup key={parent.id} label={`${parent.icon} ${parent.name}`}>
                            <option value={parent.id}>{parent.icon} {parent.name}（整体）</option>
                            {parent.children.map(child => (
                              <option key={child.id} value={child.id}>　{child.icon} {child.name}</option>
                            ))}
                          </optgroup>
                        ) : (
                          <option key={parent.id} value={parent.id}>{parent.icon} {parent.name}</option>
                        ))}
                    </select>
                  )}

                  {accounts.length > 0 && t.type !== 'transfer' && (
                    <select
                      value={t.account_id ?? ''}
                      onChange={e => updateTxn(t.index, { account_id: e.target.value ? parseInt(e.target.value) : null })}
                      style={{ width: '100%', marginTop: 4, padding: '4px 6px', fontSize: 12, border: t.account_id ? '1px solid #a78bfa' : '1px dashed #d1d5db', borderRadius: 6, background: t.account_id ? '#f5f3ff' : '#f9fafb', color: t.account_id ? '#6d28d9' : '#9ca3af' }}>
                      <option value="">账户未关联（点击选择）</option>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
                    </select>
                  )}

                  {members.length > 0 && (() => {
                    const effectiveMid = t.member_id ?? batchMemberId
                    const isFromBatch = t.member_id == null && batchMemberId != null
                    return (
                      <select
                        value={t.member_id ?? ''}
                        onChange={e => updateTxn(t.index, { member_id: e.target.value ? parseInt(e.target.value) : null })}
                        style={{ width: '100%', marginTop: 4, padding: '4px 6px', fontSize: 12, border: effectiveMid ? '1px solid #f59e0b' : '1px dashed #d1d5db', borderRadius: 6, background: effectiveMid ? '#fffbeb' : '#f9fafb', color: effectiveMid ? '#b45309' : '#9ca3af' }}>
                        <option value="">{isFromBatch ? `（沿用批量：${members.find(m => m.id === batchMemberId)?.name || ''}）` : '家庭成员未指定'}</option>
                        {members.map(m => <option key={m.id} value={m.id}>{m.avatar} {m.name}</option>)}
                      </select>
                    )
                  })()}

                  {/* 投资交易识别：橙色徽标 + holding 选择器 + 改回支出按钮 */}
                  {t.type === 'transfer' && t.detected_action && (() => {
                    const isBuy = t.detected_action === 'buy'
                    const investAccounts = accounts.filter(a => a.category === '投资理财')
                    const fundStockHoldings = holdings.filter(h => h.asset_type === 'fund' || h.asset_type === 'stock')
                    const matchedHolding = t.target_holding_id ? holdings.find(h => h.id === t.target_holding_id) : null
                    const pendingForName = t.detected_name ? pendingNewHoldings.get(t.detected_name) : null
                    return (
                      <div style={{ marginTop: 6, padding: '6px 8px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#9a3412', marginBottom: 4 }}>
                          <span>{isBuy ? '📈' : '📉'}</span>
                          <span style={{ fontWeight: 600 }}>{isBuy ? '投资买入' : '投资赎回'}</span>
                          {t.detected_name && <span style={{ color: '#7c2d12' }}>· {t.detected_name}</span>}
                          <button
                            onClick={() => updateTxn(t.index, {
                              type: 'expense',
                              detected_action: '',
                              target_holding_id: null,
                              to_account_id: null,
                            })}
                            style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 6px', background: 'white', border: '1px solid #fed7aa', borderRadius: 4, color: '#9a3412', cursor: 'pointer' }}>
                            改回普通支出
                          </button>
                        </div>
                        {/* holding 选择器 */}
                        {matchedHolding ? (
                          <select
                            value={t.target_holding_id ?? ''}
                            onChange={e => {
                              const hid = e.target.value ? parseInt(e.target.value) : null
                              const h = hid ? holdings.find(x => x.id === hid) : null
                              const investAcct = h?.account_id ?? null
                              updateTxn(t.index, {
                                target_holding_id: hid,
                                ...(isBuy ? { to_account_id: investAcct } : { account_id: investAcct }),
                              })
                            }}
                            style={{ width: '100%', padding: '4px 6px', fontSize: 12, border: '1px solid #34d399', borderRadius: 6, background: '#ecfdf5', color: '#065f46' }}>
                            {fundStockHoldings.map(h => (
                              <option key={h.id} value={h.id}>✓ {h.name} {h.code && `(${h.code})`}</option>
                            ))}
                          </select>
                        ) : pendingForName ? (
                          <div style={{ fontSize: 12, color: '#065f46', padding: '4px 6px', background: '#ecfdf5', border: '1px solid #34d399', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span>✓ 将新建：{pendingForName.name} ({pendingForName.code})</span>
                            <select
                              value={pendingForName.account_id ?? ''}
                              onChange={e => {
                                const accId = e.target.value ? parseInt(e.target.value) : null
                                if (!t.detected_name) return
                                setPendingNewHoldings(prev => {
                                  const next = new Map(prev)
                                  next.set(t.detected_name, { ...pendingForName, account_id: accId })
                                  return next
                                })
                                if (isBuy) updateTxn(t.index, { to_account_id: accId })
                                else updateTxn(t.index, { account_id: accId })
                              }}
                              style={{ flex: 1, padding: '2px 4px', fontSize: 11, border: '1px solid #d1fae5', borderRadius: 4, background: 'white' }}>
                              <option value="">绑定到投资账户</option>
                              {investAccounts.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
                            </select>
                            <button
                              onClick={() => {
                                if (!t.detected_name) return
                                setPendingNewHoldings(prev => {
                                  const next = new Map(prev)
                                  next.delete(t.detected_name)
                                  return next
                                })
                              }}
                              style={{ fontSize: 10, padding: '1px 4px', background: 'white', border: '1px solid #fca5a5', borderRadius: 4, color: '#b91c1c', cursor: 'pointer' }}>
                              撤销
                            </button>
                          </div>
                        ) : t.fund_search_candidates && t.fund_search_candidates.length > 0 ? (
                          <select
                            defaultValue=""
                            onChange={e => {
                              if (!e.target.value || !t.detected_name) return
                              const cand = t.fund_search_candidates.find((c: FundCandidate) => c.code === e.target.value)
                              if (!cand) return
                              setPendingNewHoldings(prev => {
                                const next = new Map(prev)
                                next.set(t.detected_name, { code: cand.code, name: cand.name, account_id: investAccounts[0]?.id ?? null })
                                return next
                              })
                              const defaultInvestAcct = investAccounts[0]?.id ?? null
                              if (isBuy) updateTxn(t.index, { to_account_id: defaultInvestAcct })
                              else updateTxn(t.index, { account_id: defaultInvestAcct })
                            }}
                            style={{ width: '100%', padding: '4px 6px', fontSize: 12, border: '1px solid #f59e0b', borderRadius: 6, background: '#fffbeb', color: '#92400e' }}>
                            <option value="">⚠ 请确认基金（共 {t.fund_search_candidates.length} 个候选）</option>
                            {t.fund_search_candidates.map((c: FundCandidate) => (
                              <option key={c.code} value={c.code}>{c.code} - {c.name}</option>
                            ))}
                          </select>
                        ) : fundStockHoldings.length > 0 ? (
                          <select
                            value={t.target_holding_id ?? ''}
                            onChange={e => {
                              const hid = e.target.value ? parseInt(e.target.value) : null
                              const h = hid ? holdings.find(x => x.id === hid) : null
                              const investAcct = h?.account_id ?? null
                              updateTxn(t.index, {
                                target_holding_id: hid,
                                ...(isBuy ? { to_account_id: investAcct } : { account_id: investAcct }),
                              })
                            }}
                            style={{ width: '100%', padding: '4px 6px', fontSize: 12, border: '1px dashed #f87171', borderRadius: 6, background: '#fef2f2', color: '#991b1b' }}>
                            <option value="">无法识别，请手动选择持仓</option>
                            {fundStockHoldings.map(h => (
                              <option key={h.id} value={h.id}>{h.name} {h.code && `(${h.code})`}</option>
                            ))}
                          </select>
                        ) : (
                          <div style={{ fontSize: 11, color: '#991b1b', padding: '4px 6px', background: '#fef2f2', borderRadius: 4 }}>
                            未找到候选，且本地无持仓，请先到投资页建仓后再导入
                          </div>
                        )}
                      </div>
                    )
                  })()}

                  {accounts.length > 0 && t.type === 'transfer' && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
                      <select
                        value={t.account_id ?? ''}
                        onChange={e => updateTxn(t.index, { account_id: e.target.value ? parseInt(e.target.value) : null })}
                        style={{ flex: 1, padding: '4px 6px', fontSize: 12, border: t.account_id ? '1px solid #6366f1' : '1px dashed #d1d5db', borderRadius: 6, background: t.account_id ? '#eef2ff' : '#f9fafb', color: t.account_id ? '#4338ca' : '#9ca3af' }}>
                        <option value="">{t.detected_action === 'buy' ? '资金账户' : '转出账户'}</option>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
                      </select>
                      <span style={{ color: '#6366f1', fontSize: 14 }}>→</span>
                      <select
                        value={t.to_account_id ?? ''}
                        onChange={e => updateTxn(t.index, { to_account_id: e.target.value ? parseInt(e.target.value) : null })}
                        style={{ flex: 1, padding: '4px 6px', fontSize: 12, border: t.to_account_id ? '1px solid #6366f1' : '1px dashed #d1d5db', borderRadius: 6, background: t.to_account_id ? '#eef2ff' : '#f9fafb', color: t.to_account_id ? '#4338ca' : '#9ca3af' }}>
                        <option value="">{t.detected_action === 'sell' ? '资金账户' : '转入账户'}</option>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
                      </select>
                    </div>
                  )}

                  {/* 标签展示区 */}
                  {hasAnyTag && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                      {/* 批量标签（灰色，不可单独移除） */}
                      {effectiveBatchIds.map(tid => {
                        const tag = tagMap[tid]
                        return tag ? (
                          <span key={`batch-${tid}`}
                            style={{ fontSize: 11, background: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: 4, padding: '1px 7px', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                            {tag.icon} {tag.name}
                            <span style={{ fontSize: 9, color: '#9ca3af', marginLeft: 1 }}>批</span>
                          </span>
                        ) : null
                      })}
                      {/* 单条手动标签（蓝色，可点 × 移除） */}
                      {perRowIds.map(tid => {
                        const tag = tagMap[tid]
                        return tag ? (
                          <span key={tid}
                            onClick={() => toggleTxnTag(t.index, tid)}
                            style={{ fontSize: 11, background: '#dbeafe', color: '#1d4ed8', borderRadius: 4, padding: '1px 7px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                            {tag.icon} {tag.name} ×
                          </span>
                        ) : null
                      })}
                      {/* 钱迹原始标签名（绿色，可点 × 移除） */}
                      {t.tag_names.map((name, i) => (
                        <span key={`name-${i}`}
                          onClick={() => removeTxnTagName(t.index, name)}
                          style={{ fontSize: 11, background: '#dcfce7', color: '#166534', borderRadius: 4, padding: '1px 7px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          🏷️ {name} ×
                        </span>
                      ))}
                    </div>
                  )}

                  {/* 可报销开关（仅支出） */}
                  {t.type === 'expense' && (
                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: '#6b7280' }}>
                        <input type="checkbox"
                          checked={t.is_reimbursable}
                          onChange={e => updateTxn(t.index, {
                            is_reimbursable: e.target.checked,
                            reimbursable_amount: e.target.checked ? (t.reimbursable_amount || t.amount) : 0,
                            reimbursement_status: e.target.checked ? (t.reimbursement_status === 'done' ? 'done' : 'pending') : 'none',
                          })}
                          style={{ width: 14, height: 14 }} />
                        💼 可报销
                      </label>
                      {t.is_reimbursable && (
                        <>
                          <span style={{ color: '#9ca3af' }}>·</span>
                          <input type="number" inputMode="decimal"
                            value={t.reimbursable_amount || ''}
                            placeholder={t.amount.toFixed(2)}
                            onChange={e => updateTxn(t.index, { reimbursable_amount: parseFloat(e.target.value) || 0 })}
                            style={{ width: 80, padding: '2px 6px', fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 4 }} />
                          <span style={{
                            fontSize: 10, padding: '1px 6px', borderRadius: 10,
                            background: t.reimbursement_status === 'done' ? '#dcfce7' : '#fef3c7',
                            color: t.reimbursement_status === 'done' ? '#15803d' : '#b45309',
                          }}>
                            {t.reimbursement_status === 'done' ? '已报销' : '待报销'}
                          </span>
                        </>
                      )}
                    </div>
                  )}

                  {/* 单条标签选择器（展开/收起） */}
                  {tags.length > 0 && (
                    <details style={{ fontSize: 12, marginTop: 4 }}>
                      <summary style={{ color: '#6b7280', cursor: 'pointer', userSelect: 'none' }}>
                        {perRowIds.length > 0 ? '修改单条标签' : '+ 单条追加标签'}
                      </summary>
                      <div className="member-chips" style={{ marginTop: 4 }}>
                        {tags.map(tag => {
                          const isBatch = batchTagIds.includes(tag.id)
                          const isSelected = t.tag_ids.includes(tag.id)
                          return (
                            <div key={tag.id}
                              className={`chip ${isSelected || isBatch ? 'selected' : ''}`}
                              style={{
                                fontSize: 12,
                                padding: '3px 8px',
                                opacity: isBatch ? 0.45 : 1,
                                cursor: isBatch ? 'not-allowed' : 'pointer',
                              }}
                              title={isBatch ? '已通过批量标签添加' : undefined}
                              onClick={() => toggleTxnTag(t.index, tag.id)}>
                              {tag.icon} {tag.name}
                              {isBatch && <span style={{ fontSize: 9, marginLeft: 2, color: '#9ca3af' }}>批</span>}
                            </div>
                          )
                        })}
                      </div>
                    </details>
                  )}
                </div>
              </div>
            </div>
          )
        })}

        {/* 报销记录（钱迹 类型=报销记录） */}
        {reimbursements.length > 0 && (
          <>
            <div style={{ margin: '16px 0 8px', fontSize: 14, fontWeight: 600, color: '#374151', display: 'flex', alignItems: 'center', gap: 6 }}>
              💰 报销到账记录（{selectedReimIdx.size}/{reimbursements.length}）
              <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>
                到账款项将增加所选账户余额，并把关联原账单置为「已报销」
              </span>
            </div>
            {reimbursements.map(r => (
              <div key={r.index} className="card"
                style={{ margin: '8px 0', padding: 12, opacity: selectedReimIdx.has(r.index) ? 1 : 0.5, background: r.is_duplicate ? '#fef2f2' : '#f0fdf4', border: r.is_duplicate ? '1px solid #fecaca' : '1px solid #bbf7d0' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <input type="checkbox" checked={selectedReimIdx.has(r.index)}
                    onChange={() => toggleReimSelect(r.index)}
                    style={{ marginTop: 4, width: 18, height: 18, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>
                        💼 报销到账
                        {r.is_duplicate && <span style={{ marginLeft: 6, fontSize: 11, color: '#991b1b', background: '#fecaca', borderRadius: 4, padding: '1px 5px' }}>已存在</span>}
                        {r.linked_external_id && <span style={{ marginLeft: 6, fontSize: 11, color: '#15803d', background: '#dcfce7', borderRadius: 4, padding: '1px 5px' }}>可关联原账单</span>}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#15803d', whiteSpace: 'nowrap' }}>
                        +¥{r.amount.toFixed(2)}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
                      {r.date}
                      {r.payment_method && <span style={{ color: '#a78bfa' }}> · {r.payment_method}</span>}
                      {r.note && ` · ${r.note}`}
                    </div>
                    {accounts.length > 0 && (
                      <select
                        value={r.to_account_id ?? ''}
                        onChange={e => updateReim(r.index, { to_account_id: e.target.value ? parseInt(e.target.value) : null })}
                        style={{ width: '100%', padding: '4px 6px', fontSize: 12, border: r.to_account_id ? '1px solid #10b981' : '1px dashed #d1d5db', borderRadius: 6, background: r.to_account_id ? '#ecfdf5' : '#f9fafb', color: r.to_account_id ? '#047857' : '#9ca3af' }}>
                        <option value="">到账账户未关联（点击选择）</option>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
                      </select>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </>
        )}

        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? '导入中...' : `确认导入 ${selectedIdx.size + selectedReimIdx.size} 条`}
        </button>
      </div>
    </div>
  )
}
