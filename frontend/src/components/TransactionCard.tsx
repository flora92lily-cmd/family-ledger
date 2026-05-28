import type { Transaction } from '../api'
import {
  txnIcon, txnTitle, txnSubMeta, txnAccountEl, txnAmountStr, txnAmountColor,
} from '../utils/txnRender'

interface Props {
  txn: Transaction
  onClick?: (txn: Transaction) => void
}

export function TransactionCard({ txn, onClick }: Props) {
  const subMeta = txnSubMeta(txn)
  const accountEl = txnAccountEl(txn)
  return (
    <div className="txn-item" onClick={() => onClick?.(txn)}>
      <div className="icon">{txnIcon(txn)}</div>
      <div className="info">
        <div className="desc" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>{txnTitle(txn)}</span>
          {txn.is_reimbursable && txn.reimbursement_status === 'pending' && (
            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, background: '#fef3c7', color: '#b45309', fontWeight: 500 }}>
              待报销
            </span>
          )}
          {txn.is_reimbursable && txn.reimbursement_status === 'done' && (
            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, background: '#dcfce7', color: '#15803d', fontWeight: 500 }}>
              已报销
            </span>
          )}
        </div>
        {subMeta && <div className="meta">{subMeta}</div>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 0 }}>
        <div className="amount" style={{ color: txnAmountColor(txn) }}>
          {txnAmountStr(txn)}
        </div>
        {accountEl && (
          <div className="meta" style={{ marginTop: 2, fontSize: 11, color: '#9ca3af', maxWidth: 160, overflow: 'hidden', whiteSpace: 'nowrap' }}>
            {accountEl}
          </div>
        )}
      </div>
    </div>
  )
}
