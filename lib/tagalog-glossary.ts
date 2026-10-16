/**
 * Filipino/Tagalog -> English glossary for academic/course vocabulary.
 *
 * The problem this fixes: PSU's titles catalog is almost entirely in
 * English, but a good share of its own subjects are named and described in
 * Filipino (GE Filipino courses, Araling Panlipunan, Filipino-major
 * courses, etc.). Postgres full-text search and the embedding model
 * (all-MiniLM-L6-v2, English-only) both compare WORDS -- a course titled
 * "Pagbasa at Pagsulat Tungo sa Pananaliksik" shares literally zero words
 * with an English book titled "College Reading and Writing for Research",
 * however obviously relevant it is to a person, so both the lexical and
 * semantic signal come back with nothing (or near-nothing) to work with.
 * Filtering Filipino stopwords (see STOPWORDS in lib/matcher.ts) only
 * removes noise; it can't manufacture the missing English vocabulary a
 * match needs.
 *
 * This is deliberately a plain word-level glossary, not real machine
 * translation -- no translation API is wired into this app (would need an
 * API key configured, plus per-run network calls), so this is the
 * zero-infrastructure option: a hand-maintained list of common
 * Philippine-higher-ed academic vocabulary, applied by unigrams() in
 * lib/matcher.ts as a translate-if-known/keep-otherwise rewrite. It won't
 * cover everything -- for any course this misses, set an explicit English
 * override via the Match tab's "Priority Keywords" panel
 * (subjects.match_keyword), which always takes precedence over this.
 *
 * Keys are lowercase, unaccented (Filipino rarely uses diacritics in
 * ordinary academic writing). Extend this list as more gaps turn up --
 * it's plain data, no logic to touch.
 */
export const TAGALOG_GLOSSARY: Record<string, string> = {
  // --- Reading, writing, language, communication ---
  pagbasa: "reading",
  pagsulat: "writing",
  pagsasalita: "speaking",
  pakikinig: "listening",
  pananalita: "speech",
  pagpapahayag: "expression",
  komunikasyon: "communication",
  wika: "language",
  wikang: "language",
  panitikan: "literature",
  literatura: "literature",
  tula: "poetry",
  nobela: "novel",
  maikling: "short",
  kwento: "story",
  kuwento: "story",
  dula: "play",
  dulaan: "drama",
  retorika: "rhetoric",
  gramatika: "grammar",
  balarila: "grammar",
  bokabularyo: "vocabulary",
  talasalitaan: "vocabulary",
  pananaliksik: "research",
  pagsasaliksik: "research",
  // "pag-aaral" (study) and "mag-aaral" (student) both tokenize as
  // "pag"/"mag" + "aaral" -- the regex that splits text into words (see
  // unigrams() in lib/matcher.ts) doesn't keep hyphens, so a compound key
  // like "pag-aaral" could never actually match a real token. "pag"/"mag"
  // are bare grammatical prefixes once split off, so they're stopworded
  // instead (see STOPWORDS); only the content fragment is translated here.
  aaral: "study",
  aral: "lesson",
  araling: "studies",
  aralin: "lesson",
  kasanayan: "skills",
  kaalaman: "knowledge",
  kakayahan: "competence",
  kontekstwalisadong: "contextualized",
  kontekstwalisado: "contextualized",

  // --- Social studies / history / government ---
  kasaysayan: "history",
  heograpiya: "geography",
  lipunan: "society",
  panlipunan: "social",
  pamahalaan: "government",
  pamumuno: "leadership",
  pulitika: "politics",
  pampolitika: "political",
  pambansa: "national",
  bansa: "country",
  daigdig: "world",
  pandaigdig: "global",
  pandaigdigang: "global",
  internasyonal: "international",
  epekto: "effect",
  konstitusyon: "constitution",
  saligang: "fundamental",
  batas: "law",
  karapatan: "rights",
  tao: "human",
  pagkamamamayan: "citizenship",
  mamamayan: "citizen",
  kultura: "culture",
  kulturang: "cultural",
  kalinangan: "culture",
  etika: "ethics",
  etnikong: "ethnic",
  moral: "moral",
  relihiyon: "religion",
  kristiyanismo: "christianity",
  islam: "islam",
  kapayapaan: "peace",
  kaayusan: "order",
  hustisya: "justice",
  kriminolohiya: "criminology",
  kriminal: "criminal",
  krimen: "crime",

  // --- Education / teaching ---
  edukasyon: "education",
  guro: "teacher",
  pagtuturo: "teaching",
  pagkatuto: "learning",
  kurikulum: "curriculum",
  pagtatasa: "assessment",
  pagsusulit: "test",
  estudyante: "student",
  klasrum: "classroom",
  silid: "room",

  // --- Science / math / technology ---
  agham: "science",
  pisikal: "physical",
  kapaligiran: "environment",
  kalikasan: "nature",
  kalusugan: "health",
  kalikasang: "environmental",
  matematika: "mathematics",
  aritmetika: "arithmetic",
  istatistika: "statistics",
  estadistika: "statistics",
  teknolohiya: "technology",
  kompyuter: "computer",
  elektronika: "electronics",
  inhinyeriya: "engineering",
  pagmamanupaktura: "manufacturing",
  pagsasaka: "farming",
  agrikultura: "agriculture",
  pangingisda: "fishing",
  kagamitan: "equipment",

  // --- Business / economics ---
  negosyo: "business",
  kalakalan: "trade",
  komersiyo: "commerce",
  pamamahala: "management",
  pangangasiwa: "administration",
  ekonomiya: "economy",
  ekonomiks: "economics",
  pananalapi: "finance",
  pagbabangko: "banking",
  akawnting: "accounting",
  benta: "sales",
  pamilihan: "market",
  merkado: "market",
  industriya: "industry",
  paggawa: "labor",
  manggagawa: "worker",
  kabuhayan: "livelihood",
  turismo: "tourism",
  pagkain: "food",
  pagluluto: "cooking",

  // --- Health / nursing ---
  nars: "nurse",
  alaga: "care",
  aalaga: "care",
  medisina: "medicine",
  ospital: "hospital",
  pasyente: "patient",
  sakit: "illness",
  kapansanan: "disability",

  // --- Psychology / philosophy ---
  sikolohiya: "psychology",
  pilosopiya: "philosophy",
  iisip: "thinking",
  isip: "mind",
  pangangatwiran: "reasoning",
  pagpapahalaga: "values",
  pagpapaunlad: "development",
  unlad: "development",
  personal: "personal",
  pansarili: "self",

  // --- Arts ---
  sining: "art",
  masining: "artistic",
  musika: "music",
  sayaw: "dance",
  pagpipinta: "painting",
  larawan: "image",
  paglalaro: "theater",
  pelikula: "film",

  // --- Generic qualifiers / connectors often in course titles ---
  // "Iba't ibang" (various/different) splits as "iba" + "t" + "ibang" --
  // "t" (1 char) never survives the tokenizer's 2+ character minimum.
  iba: "other",
  ibang: "different",
  disiplina: "discipline",
  multidisiplina: "multidisciplinary",
  pangkalahatang: "general",
  pangunahing: "basic",
  batayang: "basic",
  mataas: "advanced",
  panimula: "introduction",
  introduksyon: "introduction",
  kontemporaryo: "contemporary",
  makabago: "modern",
  tradisyonal: "traditional",
  kaugnay: "related",
  kurso: "course",
  kursong: "course",
  asignatura: "subject",
  // "Pang-araw-araw" (everyday/daily) splits as "pang" + "araw" + "araw" --
  // "pang" is a bare prefix (stopworded below); "araw" (day) alone already
  // conveys most of the useful signal.
  araw: "day",
  bawat: "every",
  buhay: "life",
};
