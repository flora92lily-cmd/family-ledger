// 银行/平台 Logo 图标组件
// 如果 icon 是已知 logo key，渲染 PNG 图片；否则渲染 emoji 文本

const LOGO_DEFS: Record<string, string> = {
  cmb:    '招',    // 招商银行
  icbc:   '工',    // 工商银行
  ccb:    '建',    // 建设银行
  citic:  '信',    // 中信银行
  galaxy: '银',    // 银河证券
  alipay: '支',    // 支付宝
  wechat: '微',    // 微信
  xueqiu: '球',    // 雪球
}

export const LOGO_ICONS = ['cmb', 'icbc', 'ccb', 'citic', 'galaxy', 'alipay', 'wechat', 'xueqiu']

export function isLogoKey(icon: string): boolean {
  return icon in LOGO_DEFS
}

/** 返回 icon 的纯文本表示（logo key → 对应中文，emoji → 自身），用于 <option> 等不能放 <img> 的地方 */
export function getIconText(icon: string): string {
  return LOGO_DEFS[icon] || icon
}

export function BankIcon({ icon, size = 24 }: { icon: string; size?: number }) {
  if (icon in LOGO_DEFS) {
    return (
      <img
        src={`/logos/${icon}.png`}
        alt={LOGO_DEFS[icon]}
        width={size}
        height={size}
        style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, borderRadius: 4, objectFit: 'contain' }}
      />
    )
  }
  return <span style={{ fontSize: size * 0.83, lineHeight: `${size}px` }}>{icon}</span>
}
