// Visible RULES ONLY marker: the selected stylist had too few confirmed
// inspiration images (or no usable envelope) when the batch snapshot froze, so
// generation and review ran on rules and brief only — never borrowed imagery.

export default function RulesOnlyBadge() {
  return (
    <span
      className="inline-block border border-[#C4A882] text-[#9A7B45] text-[16px] tracking-[0.18em] px-2 py-[2px]"
      aria-label="Rules only — this stylist has no frozen inspiration envelope"
    >
      RULES ONLY
    </span>
  )
}
