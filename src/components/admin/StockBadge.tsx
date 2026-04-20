type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock' | 'unknown'

const STYLES: Record<StockStatus, { classes: string; label: string }> = {
  in_stock: { classes: 'bg-[#E8F0E8] text-[#3A6B3A]', label: 'IN STOCK' },
  low_stock: { classes: 'bg-[#FFF3E0] text-[#8B5E00]', label: 'LOW STOCK' },
  out_of_stock: { classes: 'bg-[#FDECEC] text-[#B83A3A]', label: 'OUT OF STOCK' },
  unknown: { classes: 'bg-[#F2F2F0] text-[#6B6B6B]', label: 'NOT CHECKED' },
}

export default function StockBadge({
  status,
  size = 'default',
}: {
  status: StockStatus | null | undefined
  size?: 'default' | 'sm'
}) {
  const key: StockStatus = status ?? 'unknown'
  const style = STYLES[key]
  const sizing =
    size === 'sm'
      ? 'text-[8px] tracking-[0.15em] px-1.5 py-0.5'
      : 'text-[9px] tracking-[0.20em] px-2.5 py-1'
  return (
    <span className={`inline-block rounded-[2px] ${sizing} ${style.classes}`}>
      {style.label}
    </span>
  )
}
