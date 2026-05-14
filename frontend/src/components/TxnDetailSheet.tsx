import { useEffect, useState } from 'react'
import { reimbursementApi, type Transaction, type ReimbursementRecord } from '../api'
import { BankIcon } from '../components/BankIcon'
import { txnIcon, txnTitle, txnAmountStr, txnAmountColor } from '../utils/txnRender'

interface Props {
  txn: Transaction
  onClose: () => void
  onEdit: (txn: Transaction) => void
  onDelete: (txn: Transaction) => void
}

export function TxnDetailSheet({ txn, onClose, onEdit, onDelete }: Props) {
  const [linkedRecord, setLinkedRecord] = useState<ReimbursementRecord | null>(null)

  useEffect(() => {
    if (txn.reimbursement_status !== 'done') {
      setLinkedRecord(null)
      return
    }
    let cancelled = false
    reimbursementApi.list().then(r => {
      if (cancelled) return
      const rec = r.data.find(rec => rec.items.some(it => it.transaction_id === txn.id))
      setLinkedRecord(rec || null)
    })
    return () => { cancelled = true }
  }, [txn])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}
      onClick={onClose}>
      <div style={{ width: '100%', background: 'white', borderRadius: '20px 20px 0 0', padding: 20 }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 18, fontWeight: 600 }}>
            {txnIcon(txn)} {txnTitle(txn)}
          </span>
          <span style={{ fontSize: 20, fontWeight: 700, color: txnAmountColor(txn) }}>
            {txnAmountStr(txn)}
          </span>
        </div>

        <div style={{ fontSize: 14, color: '#6b7280', lineHeight: 2 }}>
          <div>日期：{txn.date}</div>
          {txn.type === 'transfer' ? (
            <>
              <div>类型：转账</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>转出：{txn.account ? <><BankIcon icon={txn.account.icon} size={16} /> {txn.account.name}</> : '未设置'}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>转入：{txn.to_account ? <><BankIcon icon={txn.to_account.icon} size={16} /> {txn.to_account.name}</> : '未设置'}</div>
            </>
          ) : (
            <>
              <div>类型：{txn.type === 'expense' ? '支出' : '收入'}</div>
              {txn.category && <div>分类：{txn.category.icon} {txn.category.name}</div>}
              {txn.account && <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>账户：<BankIcon icon={txn.account.icon} size={16} /> {txn.account.name}</div>}
            </>
          )}
          <div>成员：{txn.member ? `${txn.member.avatar} ${txn.member.name}` : '未指定'}</div>
          {txn.tags.length > 0 && (
            <div>标签：{txn.tags.map(t => `${t.icon} ${t.name}`).join('、')}</div>
          )}
          {txn.counterparty && <div>对方：{txn.counterparty}</div>}
          {txn.description && <div>备注：{txn.description}</div>}
          <div>来源：{txn.source === 'manual' ? '手动记账' : txn.source}</div>

          {txn.is_reimbursable && (
            <div style={{
              marginTop: 12, padding: 10, borderRadius: 8,
              background: txn.reimbursement_status === 'done' ? '#f0fdf4' : '#fffbeb',
              border: `1px solid ${txn.reimbursement_status === 'done' ? '#bbf7d0' : '#fde68a'}`,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: txn.reimbursement_status === 'done' ? '#15803d' : '#b45309', marginBottom: 4 }}>
                💼 {txn.reimbursement_status === 'done' ? '已报销' : '待报销'}
              </div>
              <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.8 }}>
                <div>预期报销金额：¥{txn.reimbursable_amount.toFixed(2)}</div>
                {linkedRecord && (
                  <>
                    <div>报销日期：{linkedRecord.date}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>到账账户：{linkedRecord.to_account ? <><BankIcon icon={linkedRecord.to_account.icon} size={16} /> {linkedRecord.to_account.name}</> : '未设置'}</div>
                    <div>实际到账金额：¥{linkedRecord.total_amount.toFixed(2)}</div>
                    {linkedRecord.note && <div>报销备注：{linkedRecord.note}</div>}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onClose}
            style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #e5e7eb', background: '#f9fafb', fontSize: 15, cursor: 'pointer' }}>
            关闭
          </button>
          <button onClick={() => onEdit(txn)}
            style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #2563eb', background: '#eff6ff', color: '#2563eb', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
            编辑
          </button>
          <button onClick={() => onDelete(txn)}
            style={{ flex: 1, padding: 12, borderRadius: 10, border: 'none', background: '#ef4444', color: 'white', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
            删除
          </button>
        </div>
      </div>
    </div>
  )
}
