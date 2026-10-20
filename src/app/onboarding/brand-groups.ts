// Curated brand groups: the onboarding picker, the YOU page picker, and the
// controlled brand-group taxonomy (profile-context, taste-profile, sign-up
// preferences all key off `key`). KEYS ARE STORED DATA — never rename one.
//
// Chloe's brief (2026-10-17): asking someone to think of brands on the spot is
// hard, so the picker must let her RECOGNISE them instead. Each group leads
// with the names most people know (`brands`, shown at once, LOVE ALL applies
// to these) and keeps the nicher labels MYRA stocks behind "+ more" (`more`).
// Both lists are taste signal; a brand MYRA does not stock is still offered
// and becomes a request her stylist sees. Add a new brand Chloe starts
// watching to the `more` of the group it belongs in.
//
// Re-sorted 2026-10-20 against what each label actually sells: a brand sits in
// ONE group, by its vibe. "Bags, shoes & jewels" became Bags (still `finish`),
// Shoes, Jewellery and Hats; "Denim & ease" became Denim (still `denim`),
// California cool and Australian; "Night out" is After dark (still `night`).

export interface BrandGroup {
  key: string
  name: string
  blurb: string
  /** The recognisable ones, shown first. */
  brands: string[]
  /** The nicher labels MYRA stocks, behind "+ more". */
  more?: string[]
}

export const BRAND_GROUPS: BrandGroup[] = [
  {
    key: 'parisian',
    name: 'Parisian',
    blurb: 'Effortless, a little undone',
    brands: ['Sézane', 'Isabel Marant', 'Sandro', 'Maje', 'Claudie Pierlot', 'ba&sh', 'A.P.C', 'Soeur', 'Rouje', 'Sessùn', 'Ami Paris', 'Jacquemus'],
    more: ['Vanessa Bruno', 'Agnès b.', 'Tara Jarmon', 'Gerard Darel', 'Antik Batik', 'Loulou de Saison', 'Alfie Paris', 'La Veste', 'Mes Demoiselles', 'Maison Magdalena', 'Louise Misha', 'J’amemme', 'Posse'],
  },
  {
    // Shown as The minimalists since 2026-10-20 (Chloe: "quiet luxury is very cringe"); the key stays.
    key: 'quiet_luxury',
    name: 'The minimalists',
    blurb: 'Clean lines, beautiful fabric, no logos',
    brands: ['The Row', 'Khaite', 'Totême', 'Phoebe Philo', 'Lemaire', 'Jil Sander', 'Róhe', 'Fforme', 'St. Agni', 'Max Mara', 'Gabriela Hearst', 'Brunello Cucinelli', 'Victoria Beckham'],
    more: ['Tibi', 'Altuzarra', 'Nili Lotan', 'Horton New York', 'Maria McManus', 'Linnea Lund', 'Conor O’Brien Studio', 'ARMA', 'N.A Studio', 'Iris von Arnim', 'Soft Goat', '6397', 'Kallmeyer', 'Malknstudio', 'NiiHAi', 'Heirlome', 'Colleen Allen', 'CO Core', 'Bevza', 'Almada Label', 'Cmmn Swdn', 'The Label Edition', 'Aflalo', 'Kulakovsky', 'Tae Park'],
  },
  {
    key: 'tailoring',
    name: 'Polished everyday',
    blurb: 'What you actually wear Monday to Friday',
    brands: ['ME+EM', 'Wyse', 'Whistles', 'Joseph', 'Jigsaw', 'Toast', 'Aligne', 'Baukjen', 'Mint Velvet', 'Massimo Dutti', 'Vince', 'Veronica Beard'],
    more: ['Max&Co', 'Twinset', 'Adolfo Domínguez', 'Leem', 'Serena Bute', 'Tory Burch', 'Brora', 'Rae Feather', 'Kindred of Ireland', 'Lisa Yang', 'palmer//harding', 'Giuliva Heritage', 'DA LUNA London', 'Front Row Shop', 'Attega', 'Vivere London', 'Jovonna London'],
  },
  {
    key: 'romantic',
    name: 'Romance & occasion',
    blurb: 'Florals, volume, somewhere to be',
    brands: ['Zimmermann', 'Erdem', 'Emilia Wickstead', 'Self-Portrait', 'Ulla Johnson', 'Roland Mouret', 'Oscar de la Renta', 'Markarian', 'Taller Marmo', 'Sea New York', 'Simone Rocha'],
    more: ['Alexandra Grecco', 'Carla Zampatti', 'HAI', 'Love Stories', 'Caroline Constas', 'Cinq à Sept', 'CAMI NYC', 'Silvia Tcherassi', 'Maygel Coronel', 'Maria de la Orden', 'Leo Lin', 'Wiederhoeft', 'Conner Ives', 'Andreeva', 'Ashlyn', 'Dé Rococo', 'Rejina Pyo'],
  },
  {
    key: 'contemporary',
    name: 'Colour & print',
    blurb: 'Not afraid of a pattern',
    brands: ['Rixo', 'La DoubleJ', 'Farm Rio', 'Alémais', 'Etro', 'Sister Jane', 'Damson Madder', 'Essentiel Antwerp', 'Bimba y Lola', 'Christopher John Rogers', 'Ganni', 'Stine Goya'],
    more: ['AMLUL', 'Anna Sui', 'Siedrés', 'ViX Paula Hermanny', 'Ciao Lucia', 'Gimaguas', 'Paloma Wool', 'Bernadette Antwerp', 'Naya Rea', 'Elle Sasson', 'With Jéan'],
  },
  {
    key: 'designer',
    name: 'The houses',
    blurb: 'The great fashion houses',
    brands: ['Chanel', 'Dior', 'Saint Laurent', 'Chloé', 'Bottega Veneta', 'Loewe', 'Prada', 'Miu Miu', 'Celine', 'Alaïa', 'Lanvin', 'Ferragamo'],
    more: ['Hermès', 'Gucci', 'Valentino', 'Fendi', 'Givenchy', 'Stella McCartney', 'Missoni', 'Yves Salomon'],
  },
  {
    key: 'directional',
    name: 'The directional',
    blurb: 'Artful, architectural, a little strange',
    brands: ['Dries Van Noten', 'Marni', 'JW Anderson', 'Proenza Schouler', 'Issey Miyake', 'Roksanda', 'Christopher Esber', 'A.W.A.K.E. Mode', 'Comme des Garçons', 'Toga', 'Rachel Comey', 'Jacques Wei'],
    more: ['Bode', 'Nanushka', 'Diotima', 'EENK', 'Shushu/Tong', 'Forte Forte', 'Dunst', 'Darkpark', 'Georgia Hardinge', 'Insomnia Studio', 'No Emotions', 'Nocturne', 'Halfboy', 'Destree', 'Macabla', 'Pointe Milou', 'Rise & Fall'],
  },
  {
    key: 'scandi',
    name: 'Scandi',
    blurb: 'Pared back, easy, a bit of edge',
    brands: ['Acne Studios', 'By Malene Birger', 'Skall Studio', 'Baum und Pferdgarten', 'Munthe', 'Rabens Saloner', 'Stella Nova', 'House of Dagmar', 'Mos Mosh', 'TOVE', 'Rhúne', 'Djerf Avenue'],
    more: ['OpéraSPORT', 'Our Legacy', 'Tivioli', 'Caro Editions', 'MKDT Studio', 'Stand Studio', 'Holzweiler', 'Utzon'],
  },
  {
    key: 'denim',
    name: 'Denim',
    blurb: 'Good jeans first',
    brands: ['Agolde', 'Frame', 'Mother', 'Citizens of Humanity', 'Re/Done', 'Levi’s', 'R13', 'Paige', 'Diesel'],
    more: ['Haikure', 'Tressé', 'Fortela'],
  },
  {
    key: 'california',
    name: 'California cool',
    blurb: 'Sun-faded, easy, a little boho',
    brands: ['Reformation', 'Dôen', 'Anine Bing', 'Free People', 'Éterne', 'Simon Miller', 'Varley', 'Staud', 'Cult Gaia', 'L’Académie'],
    more: ['Apparis'],
  },
  {
    key: 'australian',
    name: 'Australian',
    blurb: 'Sun, linen, beach to dinner',
    brands: ['DISSH', 'SIR.', 'Bec + Bridge', 'Aje', 'Acler', 'Camilla and Marc', 'Scanlan Theodore', 'Faithfull the Brand', 'Spell', 'Matteau'],
    more: ['VRG GRL'],
  },
  {
    key: 'night',
    name: 'After dark',
    blurb: 'Slinky, sequinned, a bit of attitude',
    brands: ['The Attico', '16Arlington', 'Magda Butrym', 'Rat & Boa', 'De La Vali', 'Simkhai', 'Rotate', 'David Koma', 'Nensi Dojaka', 'Mônot'],
    more: ['Seam', 'Studio83', 'Scarlet & Sam', 'Redondo Brand', 'Rumored', 'Saint Art', 'Sloan', 'The Veil'],
  },
  {
    key: 'finish',
    name: 'Bags',
    blurb: 'The one you carry every day',
    brands: ['Polène', 'DeMellier', 'Strathberry', 'Mansur Gavriel', 'Anya Hindmarch', 'Métier', 'Liffner', 'Chylak', 'Elleme', 'Hunting Season', 'Freja', 'MOI&SASS'],
    more: ['Advene', 'Mélisse', 'Sarah’s Bag', 'Sensi Studio', 'Furla', 'JW Pei', 'Déhanche'],
  },
  {
    key: 'shoes',
    name: 'Shoes',
    blurb: 'Flats to heels',
    brands: ['Manolo Blahnik', 'Aquazzura', 'Roger Vivier', 'Amina Muaddi', 'Aeyde', 'Le Monde Béryl', 'Loeffler Randall', 'Emme Parsons', 'Anonymous Copenhagen', 'A.Emery', 'Jude', 'Florrie London'],
    more: ['Herbert Levine', 'Giaborghini', 'Edward Meller', 'Nomasei', 'Carel', 'Jonak', 'Bobbies', 'Capulette Paris', 'Roberto Festa'],
  },
  {
    key: 'jewellery',
    name: 'Jewellery',
    blurb: 'The finishing touch',
    brands: ['Completedworks', 'Alighieri', 'Sophie Buhai', 'Laura Lombardi', 'Missoma', 'Chan Luu', 'Julietta', 'Nina Runsdorf', 'éliou', 'JUJU VERA'],
    more: ['Deux Amis', 'Sita Nevado', 'Mon Collier BCN', 'Baudesson'],
  },
  {
    key: 'hats',
    name: 'Hats',
    blurb: 'For the races and the weddings',
    brands: ['Rachel Trevor-Morgan', 'Jane Taylor London', 'Jess Collett Milliner', 'Awon Golding Millinery', 'Alexandra Harper Millinery', 'Zahati'],
  },
  {
    key: 'preloved',
    name: 'Second-hand & vintage',
    blurb: 'Pre-loved, found, one of a kind',
    brands: ['Vestiaire Collective', 'The RealReal', 'Hardly Ever Worn It', 'Sign of the Times', 'Cudoni', 'Reluxe', 'Vivien’s Vintage', 'Elsie’s Archive', 'The Seller', 'Rewind Vintage'],
    more: ['Les Archives', 'Comptoir Vintage', 'Estella'],
  },
  {
    key: 'rental',
    name: 'Rental',
    blurb: 'Borrow it for the weekend',
    brands: ['By Rotation', 'Hurr', 'Rites', 'Rotaro', 'My Wardrobe HQ', 'Cocoon', 'Loan the Look', 'Front Row'],
  },
]

// Age ranges — shown at onboarding (step 2) and used to tag outfits in admin.
export const AGE_RANGES = ['25-30', '30-40', '40-50', '50-60', '60-70', '70+'] as const
export type AgeRange = (typeof AGE_RANGES)[number]
