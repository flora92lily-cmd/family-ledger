import type { Transaction } from '../api'
import { BankIcon } from '../components/BankIcon'

export const txnIcon = (txn: Transaction) =>
  txn.type === 'transfer' ? '🔄' : txn.category?.icon || '💰'

export const txnTitle = (txn: Transaction) => {
  if (txn.type === 'transfer') return txn.description || '转账'
  return txn.category?.name || '未分类'
}

export const txnSubMeta = (txn: Transaction) => {
  const parts: string[] = []
  if (txn.description) parts.push(txn.description)
  if (txn.member) parts.push(`${txn.member.avatar}${txn.member.name}`)
  return parts.join(' · ')
}

export const txnAccountEl = (txn: Transaction) => {
  if (txn.type === 'transfer') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
        {txn.account ? <><BankIcon icon={txn.account.icon} size={14} />{txn.account.name}</> : '?'}
        <span style={{ margin: '0 2px' }}>→</span>
        {txn.to_account ? <><BankIcon icon={txn.to_account.icon} size={14} />{txn.to_account.name}</> : '?'}
      </span>
    )
  }
  return txn.account
    ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><BankIcon icon={txn.account.icon} size={14} />{txn.account.name}</span>
    : null
}

export const txnAmountStr = (txn: Transaction) => {
  const v = `¥${txn.amount.toFixed(2)}`
  if (txn.type === 'transfer') return v
  return (txn.type === 'expense' ? '-' : '+') + v
}

export const txnAmountColor = (txn: Transaction) => {
  if (txn.type === 'transfer') return '#6366f1'
  return txn.type === 'expense' ? '#ef4444' : '#22c55e'
}
