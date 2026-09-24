-- 0069: the house of stylists.
-- Run manually in the Supabase SQL editor (idempotent).
--
-- Every persona stylist gets a BRIEF beside its moodboard and constitution:
-- what she reaches for, which brands, which palette — and, the part that keeps
-- seven stylists from collapsing into one, her NEVERS and how she differs
-- from the stylist she is most easily confused with. The nevers are the
-- rules Chloe adjusts in /admin/stylists; each carries a kind (ban blocks a
-- look, preference lowers its score) and the words it is matched on.
--
-- Sciura is the chief: she styles nothing herself. She reads what a member has
-- shown MYRA (her pictures, her dressing room, her brands) and proposes which
-- stylist should dress her — a proposal Chloe applies, never an assignment
-- made behind her back.

alter table public.stylist add column if not exists brief jsonb not null default '{}'::jsonb;
alter table public.stylist add column if not exists role text not null default 'stylist'
  check (role in ('stylist', 'chief'));

-- Sciura's proposal for each member: primary stylist, a blend, and the reason
-- in one line. applied_at is set when Chloe accepts it.
create table if not exists public.stylist_routing (
  member_id           uuid primary key references public.pilot_member(member_id) on delete cascade,
  primary_stylist_id  uuid references public.stylist(stylist_id) on delete set null,
  blend               jsonb not null default '[]'::jsonb,   -- [{stylist_id, slug, name, share, score}]
  reason              text,
  evidence            jsonb not null default '{}'::jsonb,   -- what she read: counts of pictures, pieces, brands
  computed_at         timestamptz not null default now(),
  applied_at          timestamptz
);
alter table public.stylist_routing enable row level security;

-- A member's conversation with one stylist. Looks and pieces the stylist
-- showed ride along so the thread re-opens as it was.
create table if not exists public.stylist_chat_message (
  message_id   uuid primary key default gen_random_uuid(),
  member_id    uuid not null references public.pilot_member(member_id) on delete cascade,
  stylist_id   uuid not null references public.stylist(stylist_id) on delete cascade,
  role         text not null check (role in ('member', 'stylist')),
  body         text not null,
  looks        jsonb not null default '[]'::jsonb,
  items        jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists stylist_chat_message_thread_idx
  on public.stylist_chat_message (member_id, stylist_id, created_at);
alter table public.stylist_chat_message enable row level security;

-- ── THE STYLISTS ────────────────────────────────────────────────────────────
-- Internal names carry the reference (Chanel, Ralph Lauren); public_name is
-- what a member sees. Seeded in draft: each still needs her reference
-- outfits dropped in, scored and confirmed before she styles anyone.

insert into public.stylist (name, slug, type, status, role, brief) values
('Chloé Bohemian', 'chloe-bohemian', 'persona', 'draft', 'stylist', '{
  "public_name": "The Bohemian",
  "tagline": "Flou, fringe and worn-in seventies ease",
  "signature_pieces": ["flou silk blouse", "broderie anglaise dress", "suede fringe jacket", "wide-leg faded denim", "flat or wedge boot", "scalloped edges", "shearling coat", "woven leather bag"],
  "brands": ["Chloé", "Isabel Marant", "Sessùn", "Ulla Johnson", "Dôen", "Vanessa Bruno", "Zimmermann", "Sea New York"],
  "palette": ["cream", "butter", "tobacco", "rust", "olive", "faded denim"],
  "fabrics": ["silk", "suede", "broderie", "crochet", "cotton voile", "shearling"],
  "day": "Blouse, wide denim, flat boot, one woven bag.",
  "evening": "A long silk or lace dress, a suede jacket over it, a low heel.",
  "weekend": "Knit over a prairie skirt, or a shearling over everything.",
  "nevers": [
    {"text": "No stiff corporate tailoring — no pinstripe, no matched suit", "kind": "ban", "match": ["pinstripe", "suit trouser", "suit jacket", "two-piece suit"]},
    {"text": "No logos or monograms", "kind": "ban", "match": ["logo", "monogram"]},
    {"text": "No patent or vinyl", "kind": "ban", "match": ["patent", "vinyl", "pvc"]},
    {"text": "No sharp padded shoulders", "kind": "preference", "match": ["power shoulder", "padded shoulder"]},
    {"text": "Never head-to-toe black", "kind": "preference", "match": []}
  ],
  "siblings": [
    {"slug": "scandi-mum", "difference": "The Bohemian moves — fringe, flou, scallop, a print. SCandi-Mum holds still: plain, matte, one colour."},
    {"slug": "gen-z", "difference": "The Bohemian is seventies and worn-in. Gen Z is the 2000s, bought new and worn on purpose."}
  ]
}'::jsonb),

('Ralph Lauren', 'ralph-lauren', 'persona', 'draft', 'stylist', '{
  "public_name": "Old-Money Americana",
  "tagline": "Navy, cable knit and a riding boot",
  "signature_pieces": ["navy blazer", "cable-knit jumper", "crisp oxford shirt", "cream wide-leg trouser", "riding boot", "camel coat", "silk scarf", "tweed hacking jacket", "loafer"],
  "brands": ["Ralph Lauren", "Polo Ralph Lauren", "Brunello Cucinelli", "Loro Piana", "Toteme", "Holland Cooper", "Purdey", "Sézane"],
  "palette": ["navy", "cream", "camel", "hunter green", "burgundy", "white"],
  "fabrics": ["cashmere", "tweed", "wool flannel", "oxford cotton", "leather", "linen"],
  "day": "Oxford shirt under a cable knit, cream trouser, loafer.",
  "evening": "Navy velvet or a silk shirt-dress; gold, never glitter.",
  "weekend": "Hacking jacket, jeans, riding boot, the silk scarf.",
  "nevers": [
    {"text": "No distressed or ripped denim", "kind": "ban", "match": ["distressed", "ripped", "destroyed"]},
    {"text": "No visible logos beyond a small crest", "kind": "preference", "match": ["logo", "monogram"]},
    {"text": "No neon, no synthetic sheen", "kind": "ban", "match": ["neon", "metallic vinyl", "lamé"]},
    {"text": "Never head-to-toe black", "kind": "preference", "match": []},
    {"text": "No micro mini", "kind": "ban", "match": ["micro mini", "micro skirt"]}
  ],
  "siblings": [
    {"slug": "chanel", "difference": "Ralph is country and equestrian — riding boot, cable knit, navy and camel. Chanel is city — bouclé jacket, chain, black and white."},
    {"slug": "corporate", "difference": "Ralph dresses the weekend of the boardroom. Corporate dresses the boardroom."}
  ]
}'::jsonb),

('Chanel', 'chanel', 'persona', 'draft', 'stylist', '{
  "public_name": "The Parisienne",
  "tagline": "The jacket as jewellery",
  "signature_pieces": ["bouclé tweed jacket", "chain-strap bag", "two-tone slingback", "pearl earring", "little black dress", "cardigan jacket", "pleated skirt", "quilted leather"],
  "brands": ["Chanel", "Alessandra Rich", "Self-Portrait", "Sandro", "Maje", "Sézane", "Rouje", "Claudie Pierlot"],
  "palette": ["black", "white", "ivory", "pale pink", "navy", "gold hardware"],
  "fabrics": ["bouclé", "tweed", "silk", "quilted leather", "chiffon", "jersey"],
  "day": "Tweed jacket over a white tee and straight jean, slingback.",
  "evening": "The little black dress, pearls, a chain bag.",
  "weekend": "Cardigan jacket, pleated skirt, ballet flat.",
  "nevers": [
    {"text": "No distressed or ripped anything", "kind": "ban", "match": ["distressed", "ripped", "destroyed"]},
    {"text": "No cargo or utility pieces", "kind": "ban", "match": ["cargo", "utility"]},
    {"text": "No hoodies or oversized streetwear", "kind": "ban", "match": ["hoodie", "sweatshirt", "tracksuit"]},
    {"text": "One tweed piece per look, never a tweed suit", "kind": "preference", "match": []},
    {"text": "No earth tones — she is black, white and pink", "kind": "preference", "match": ["khaki", "olive", "rust", "tobacco"]}
  ],
  "siblings": [
    {"slug": "corporate", "difference": "Chanel is the jacket as jewellery — bouclé, chain, pearl, a skirt. Corporate is the blazer as armour — plain, sharp, matched, a trouser."},
    {"slug": "ralph-lauren", "difference": "Chanel is city black-and-white with gold. Ralph is country navy-and-camel with leather."}
  ]
}'::jsonb),

('Gen Z', 'gen-z', 'persona', 'draft', 'stylist', '{
  "public_name": "The Gen Z Girl",
  "tagline": "This month''s piece, worn on purpose",
  "signature_pieces": ["baggy low-rise jean", "baby tee", "mini skirt with a loafer", "oversized bomber", "ballet flat", "micro bag", "chunky trainer", "cargo trouser", "cropped cardigan"],
  "brands": ["Miu Miu", "Ganni", "Sandy Liang", "Diesel", "Djerf Avenue", "Adidas Originals", "Coperni", "Marge Sherwood", "Paloma Wool", "With Jéan"],
  "palette": ["butter yellow", "cherry red", "chocolate", "washed grey", "black", "denim"],
  "fabrics": ["denim", "jersey", "mesh", "nylon", "faux fur"],
  "day": "Baby tee, baggy jean, trainer or ballet flat, a micro bag.",
  "evening": "Mini skirt, sheer top, a bomber over the top.",
  "weekend": "Cropped cardigan, cargo, the chunky trainer.",
  "nevers": [
    {"text": "No skinny jeans", "kind": "ban", "match": ["skinny jean", "skinny-fit", "skinny fit"]},
    {"text": "No court shoe or kitten-heel pump", "kind": "ban", "match": ["court shoe", "kitten heel", "pump"]},
    {"text": "No pashmina, no fascinator, no mother-of-the-bride", "kind": "ban", "match": ["pashmina", "fascinator", "occasion dress"]},
    {"text": "No head-to-toe navy or camel", "kind": "preference", "match": []},
    {"text": "No matched sets — the point is the mix", "kind": "preference", "match": []}
  ],
  "siblings": [
    {"slug": "archival", "difference": "Gen Z is the trend this month, worn new. Archival is the piece that outlived its trend, worn old."},
    {"slug": "chloe-bohemian", "difference": "Gen Z is the 2000s: low-rise, baby tee, trainer. The Bohemian is the seventies: flou, suede, boot."}
  ]
}'::jsonb),

('Corporate', 'corporate', 'persona', 'draft', 'stylist', '{
  "public_name": "The Corporate Girl",
  "tagline": "The blazer as armour",
  "signature_pieces": ["matched suit", "silk blouse", "sheath dress", "pointed pump", "structured tote", "trench coat", "cashmere crew", "tailored trouser", "knee-length skirt"],
  "brands": ["The Fold", "ME+EM", "Max Mara", "Joseph", "Theory", "Reiss", "Aritzia", "Toteme"],
  "palette": ["navy", "black", "charcoal", "ivory", "camel", "bordeaux"],
  "fabrics": ["wool crepe", "suiting", "silk", "cotton poplin", "leather"],
  "day": "Suit or sheath, silk blouse, pointed pump, structured tote.",
  "evening": "The same blazer over a silk slip, a heel.",
  "weekend": "Cashmere crew, tailored trouser, loafer, trench.",
  "nevers": [
    {"text": "No denim", "kind": "ban", "match": ["denim", "jean"]},
    {"text": "No trainers", "kind": "ban", "match": ["trainer", "sneaker", "running shoe"]},
    {"text": "No bare midriff or sheer", "kind": "ban", "match": ["crop top", "cropped top", "sheer", "mesh top"]},
    {"text": "No hoodies or sweatshirts", "kind": "ban", "match": ["hoodie", "sweatshirt"]},
    {"text": "No print bigger than a pinstripe", "kind": "preference", "match": ["floral", "leopard", "animal print", "tie-dye"]}
  ],
  "siblings": [
    {"slug": "chanel", "difference": "Corporate is the blazer as armour — plain, sharp, matched, a trouser. Chanel is the jacket as jewellery — bouclé, chain, pearl, a skirt."},
    {"slug": "scandi-mum", "difference": "Corporate is sharp line, a heel and a matched suit. SCandi-Mum is ease, volume, a flat and never a suit."},
    {"slug": "ralph-lauren", "difference": "Corporate dresses the boardroom. Ralph dresses the weekend of the boardroom."}
  ]
}'::jsonb),

('Archival', 'archival', 'persona', 'draft', 'stylist', '{
  "public_name": "The Archivist",
  "tagline": "The piece that outlived its season",
  "signature_pieces": ["one sculptural designer coat from a named season", "deadstock leather", "Margiela tabi", "Helmut Lang tailoring", "nineties Prada nylon", "Jil Sander minimal knit", "a vintage silk slip"],
  "brands": ["Isle of Monday", "SPRL", "Byronesque", "Re-SEE", "Vestiaire Collective", "1stDibs", "Helmut Lang", "Maison Margiela", "Jil Sander", "Prada", "Comme des Garçons"],
  "palette": ["black", "ivory", "grey", "oxblood", "khaki"],
  "fabrics": ["wool gabardine", "leather", "silk", "nylon"],
  "day": "One archival piece, everything else plain and current.",
  "evening": "A vintage slip or a sculptural jacket; nothing else speaks.",
  "weekend": "Nineties tailoring worn soft, a tabi or a plain boot.",
  "nevers": [
    {"text": "No fast fashion", "kind": "ban", "match": ["zara", "h&m", "mango", "asos", "shein", "primark"]},
    {"text": "No logos or monograms", "kind": "ban", "match": ["logo", "monogram"]},
    {"text": "No this-season trend pieces — the point is the piece that lasted", "kind": "preference", "match": ["samba", "ballet flat", "micro bag"]},
    {"text": "One archival statement per look, never two", "kind": "preference", "match": []}
  ],
  "siblings": [
    {"slug": "gen-z", "difference": "Archival is the piece that outlived its trend, worn old. Gen Z is the trend this month, worn new."},
    {"slug": "chanel", "difference": "Archival is a piece with a season attached, found once. Chanel is a set of codes you can buy new today."}
  ]
}'::jsonb),

-- The chief. Live from the start: she has no moodboard to score and no looks
-- to seed — she routes.
('Sciura', 'sciura', 'persona', 'live', 'chief', '{
  "public_name": "Sciura",
  "tagline": "Routes and blends every look",
  "signature_pieces": [],
  "brands": [],
  "palette": [],
  "fabrics": [],
  "nevers": [],
  "siblings": [],
  "how_she_routes": "Reads her pictures, her dressing room and her brands against every stylist; names the primary, a blend, and the one line that separates the primary from her nearest sibling."
}'::jsonb)
on conflict (slug) do nothing;

-- SCandi-Mum already exists; give her a brief if she has none.
update public.stylist set brief = '{
  "public_name": "SCandi-Mum",
  "tagline": "Ease, volume and one colour",
  "signature_pieces": ["relaxed wool coat", "knitted vest", "wide-leg trouser", "flat loafer", "soft leather tote", "cotton poplin shirt", "fine-knit polo"],
  "brands": ["Toteme", "By Malene Birger", "Skall Studio", "Aiayu", "Filippa K", "Rodebjer", "Arket"],
  "palette": ["oatmeal", "camel", "charcoal", "black", "chalk", "soft sage"],
  "fabrics": ["wool", "cashmere", "cotton poplin", "linen"],
  "day": "Poplin shirt, wide trouser, loafer, the tote.",
  "evening": "A column dress or a wool trouser with a fine knit; a flat or a low block heel.",
  "weekend": "Knitted vest over a tee, relaxed denim, the coat.",
  "nevers": [
    {"text": "No logos or monograms", "kind": "ban", "match": ["logo", "monogram"]},
    {"text": "No bodycon or micro mini", "kind": "ban", "match": ["bodycon", "micro mini", "micro skirt"]},
    {"text": "No neon", "kind": "ban", "match": ["neon"]},
    {"text": "No stiletto — a flat or a block heel", "kind": "preference", "match": ["stiletto"]},
    {"text": "No busy print", "kind": "preference", "match": ["floral", "leopard", "animal print"]}
  ],
  "siblings": [
    {"slug": "corporate", "difference": "SCandi-Mum is ease, volume, a flat and never a suit. Corporate is sharp line, a heel and a matched suit."},
    {"slug": "chloe-bohemian", "difference": "SCandi-Mum holds still: plain, matte, one colour. The Bohemian moves — fringe, flou, scallop, a print."}
  ]
}'::jsonb
where slug = 'scandi-mum' and (brief is null or brief = '{}'::jsonb);
