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
