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
    more: ['Vanessa Bruno', 'Agnès b.', 'Tara Jarmon', 'Gerard Darel', 'Antik Batik', 'Loulou de Saison', 'Alfie Paris', 'Capulette Paris', 'La Veste', 'Mes Demoiselles', 'Maison Magdalena', 'Rae Feather', 'Louise Misha', 'J’amemme'],
  },
  {
    key: 'quiet_luxury',
    name: 'Quiet luxury',
    blurb: 'Clean lines, beautiful fabric, no logos',
    brands: ['The Row', 'Khaite', 'Totême', 'Phoebe Philo', 'Lemaire', 'Jil Sander', 'Róhe', 'Fforme', 'St. Agni', 'Max Mara', 'Gabriela Hearst', 'Tibi'],
    more: ['Horton New York', 'Iris von Arnim', 'Soft Goat', '6397', 'Nili Lotan', 'Kallmeyer', 'Malknstudio', 'NiiHAi', 'Diotima', 'Heirlome', 'Colleen Allen', 'CO Core', 'Bevza', 'Liffner', 'Métier', 'Attega', 'Almada Label', 'Cmmn Swdn', 'The Label Edition', 'Scarlet & Sam'],
  },
  {
    key: 'tailoring',
    name: 'Polished everyday',
    blurb: 'What you actually wear Monday to Friday',
    brands: ['ME+EM', 'Wyse', 'Whistles', 'Joseph', 'Jigsaw', 'Toast', 'Aligne', 'Baukjen', 'Mint Velvet', 'Massimo Dutti', 'Vince', 'Veronica Beard'],
    more: ['Max&Co', 'Twinset', 'Adolfo Domínguez', 'Leem', 'Serena Bute', 'Tory Burch', 'Brora', 'Kindred of Ireland', 'Lisa Yang', 'palmer//harding', 'Giuliva Heritage', 'Fortela', 'DA LUNA London'],
  },
  {
    key: 'romantic',
    name: 'Romance & occasion',
    blurb: 'Florals, volume, somewhere to be',
    brands: ['Zimmermann', 'Erdem', 'Emilia Wickstead', 'Self-Portrait', 'Ulla Johnson', 'Roland Mouret', 'Oscar de la Renta', 'Markarian', 'Taller Marmo', 'Victoria Beckham', 'Sea New York', 'Simone Rocha'],
    more: ['Alexandra Grecco', 'Camilla and Marc', 'Caroline Constas', 'Cinq à Sept', 'CAMI NYC', 'Silvia Tcherassi', 'Maygel Coronel', 'Maria de la Orden', 'Leo Lin', 'Wiederhoeft', 'Conner Ives', 'Andreeva', 'Ashlyn', 'Dé Rococo', 'Jude', 'Julietta', 'Mélisse', 'Rejina Pyo'],
  },
  {
    key: 'contemporary',
    name: 'Colour & print',
    blurb: 'Not afraid of a pattern',
    brands: ['Rixo', 'La DoubleJ', 'Farm Rio', 'Alémais', 'Etro', 'Sister Jane', 'Damson Madder', 'Essentiel Antwerp', 'Bimba y Lola', 'Christopher John Rogers', 'Ganni', 'Stine Goya'],
    more: ['Anna Sui', 'Siedrés', 'Sensi Studio', 'ViX Paula Hermanny', 'Ciao Lucia', 'Gimaguas', 'Paloma Wool', 'Haikure', 'Bernadette Antwerp', 'Naya Rea', 'Sita Nevado', 'Elle Sasson', 'Aflalo', 'With Jéan'],
  },
  {
    key: 'designer',
    name: 'The houses',
    blurb: 'The names on the bags',
    brands: ['Chanel', 'Dior', 'Saint Laurent', 'Chloé', 'Bottega Veneta', 'Loewe', 'Prada', 'Miu Miu', 'Celine', 'Alaïa', 'Lanvin', 'Ferragamo'],
    more: ['Stella McCartney', 'Missoni', 'Brunello Cucinelli', 'Altuzarra', 'Yves Salomon', 'Diesel', 'Bode', 'Ami'],
  },
  {
    key: 'directional',
    name: 'The directional',
    blurb: 'Artful, architectural, a little strange',
    brands: ['Dries Van Noten', 'Marni', 'JW Anderson', 'Proenza Schouler', 'Issey Miyake', 'Roksanda', 'Christopher Esber', 'A.W.A.K.E. Mode', 'Comme des Garçons', 'Toga', 'Rachel Comey', 'Jacques Wei'],
    more: ['Acne Studios', 'Shushu/Tong', 'Pleats Please Issey Miyake', 'Forte Forte', 'Dunst', 'Darkpark', 'Georgia Hardinge', 'Insomnia Studio', 'No Emotions', 'Nocturne', 'Halfboy', 'Destree', 'Elleme', 'Déhanche', 'Hunting Season', 'Macabla', 'Pointe Milou', 'Rise & Fall'],
  },
  {
    key: 'scandi',
    name: 'Scandi',
    blurb: 'Pared back, easy, a bit of edge',
    brands: ['By Malene Birger', 'Skall Studio', 'Baum und Pferdgarten', 'Munthe', 'Rabens Saloner', 'Stella Nova', 'House of Dagmar', 'Mos Mosh', 'TOVE', 'OpéraSPORT', 'Rhúne', 'Djerf Avenue'],
    more: ['Our Legacy', 'Tivioli', 'Anonymous Copenhagen', 'Caro Editions', 'Freja', 'MKDT Studio', 'Stand Studio', 'Holzweiler'],
  },
  {
    key: 'denim',
    name: 'Denim & ease',
    blurb: 'LA, good jeans, a white tee',
    brands: ['Agolde', 'Frame', 'Reformation', 'Anine Bing', 'Dôen', 'Free People', 'Varley', 'R13', 'Simon Miller', 'Mother', 'Citizens of Humanity', 'Éterne'],
    more: ['SIR.', 'Estella', 'Apparis', 'L’Académie', 'DISSH', 'Posse', 'Acler', 'VRG GRL'],
  },
  {
    key: 'night',
    name: 'Night out',
    blurb: 'Dinner, a party, the dress',
    brands: ['The Attico', '16Arlington', 'Magda Butrym', 'Rat & Boa', 'De La Vali', 'Simkhai', 'Staud', 'Cult Gaia', 'Nanushka', 'Rotate', 'Bec + Bridge', 'Aje'],
    more: ['Roberto Festa', 'Redondo Brand', 'Sirthelabel', 'MOI&SASS', 'Rumored', 'Saint Art', 'Seam', 'Sloan', 'Studio83', 'Tressé', 'Utzon', 'Zahati', 'The Veil', 'Jovonna London', 'Florrie London', 'Vivere London'],
  },
  {
    key: 'finish',
    name: 'Bags, shoes & jewels',
    blurb: 'The finishing touches',
    brands: ['Polène', 'DeMellier', 'Strathberry', 'Mansur Gavriel', 'Anya Hindmarch', 'Aeyde', 'Manolo Blahnik', 'Aquazzura', 'Roger Vivier', 'Amina Muaddi', 'Le Monde Béryl', 'Completedworks'],
    more: ['Herbert Levine', 'Giaborghini', 'Mon Collier BCN', 'Baudesson', 'Emme Parsons', 'Loeffler Randall', 'Carel', 'Jonak', 'Bobbies', 'Furla', 'JW Pei', 'Chylak', 'A.Emery', 'Chan Luu', 'éliou', 'JUJU VERA', 'Rachel Trevor-Morgan', 'Jane Taylor London', 'Jess Collett Milliner', 'Awon Golding Millinery', 'Alexandra Harper Millinery'],
  },
  {
    key: 'preloved',
    name: 'Second-hand & vintage',
    blurb: 'Pre-loved, found, one of a kind',
    brands: ['Vestiaire Collective', 'The RealReal', 'Hardly Ever Worn It', 'Sign of the Times', 'Cudoni', 'Reluxe', 'Vivien’s Vintage', 'Elsie’s Archive', 'The Seller', 'Rewind Vintage'],
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
