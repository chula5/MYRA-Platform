// The feed's own gender words, and the only rule the scan reads them with.
//
// A plain module with no imports, on purpose: brand-watch.ts pulls in the
// Supabase client and cannot be loaded by the jiti scripts, and a bench that
// measures a copy of this rule would be measuring a rule nobody runs.
//
// Read on structured fields only — product type, tags, title, handle — never
// body copy, where a women's piece can mention menswear in passing.

export const WOMEN_RE = /\b(women|womens|women's|woman|femme|femmes|ladies|damen|donna|mujer|w(?:ss|aw|fw)\d{2})\b/i
export const MEN_RE = /\b(men|mens|men's|man|menswear|homme|hommes|herren|uomo|hombre|m(?:ss|aw|fw)\d{2})\b/i

// Children's ranges. Boden names them only in the handle (girls-…, boys-…,
// baby-…) and queued 190 kids pieces whose titles never said so. Plural
// girls/boys only, so "boy-fit" and "girlfriend" stay; "baby" stops short of
// the colours (baby blue, baby pink) and the babydoll dress. No "junior":
// Linnea Lund's Junior Cardigan is a women's piece.
export const KIDS_RE = /\b(kids?|girls|boys|babies|baby(?![\s-]*(?:blue|pink|doll|alpaca|cashmere|cord|soft))|toddlers?|infants?|newborns?|child|children|childrens|children's|enfants?)\b/i
