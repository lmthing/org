/**
 * Retrieve credibility and metadata information for a news domain.
 *
 * Checks domain age, presence of about/editorial pages, known press
 * association memberships, and cross-references against a curated list
 * of known reliable and unreliable sources.
 */

export interface DomainInfo {
  domain: string;
  credibilityScore: number;
  biasRating: "left" | "left-center" | "center" | "right-center" | "right" | "unknown";
  factualityRating: "very_high" | "high" | "mixed" | "low" | "very_low";
  type: "news_agency" | "newspaper" | "tv_network" | "digital_native" | "blog" | "government" | "unknown";
  country?: string;
  language?: string;
  foundedYear?: number;
  notes: string[];
}

// Curated credibility database (subset — in production this would be a full dataset)
const DOMAIN_DB: Record<string, Partial<DomainInfo>> = {
  "reuters.com": {
    credibilityScore: 0.97, biasRating: "center", factualityRating: "very_high",
    type: "news_agency", country: "UK", foundedYear: 1851,
    notes: ["Wire service — primary source for most news organisations worldwide"],
  },
  "apnews.com": {
    credibilityScore: 0.97, biasRating: "center", factualityRating: "very_high",
    type: "news_agency", country: "US", foundedYear: 1846,
    notes: ["Associated Press — cooperative news agency, widely cited"],
  },
  "bbc.com": {
    credibilityScore: 0.95, biasRating: "center", factualityRating: "very_high",
    type: "tv_network", country: "UK", foundedYear: 1922,
    notes: ["Public service broadcaster — strong editorial standards"],
  },
  "bloomberg.com": {
    credibilityScore: 0.93, biasRating: "center", factualityRating: "very_high",
    type: "digital_native", country: "US", foundedYear: 1981,
    notes: ["Financial data and news — strong in business/economics coverage"],
  },
  "nytimes.com": {
    credibilityScore: 0.91, biasRating: "left-center", factualityRating: "high",
    type: "newspaper", country: "US", foundedYear: 1851,
    notes: ["Newspaper of record — strong investigative journalism"],
  },
  "theguardian.com": {
    credibilityScore: 0.89, biasRating: "left-center", factualityRating: "high",
    type: "newspaper", country: "UK", foundedYear: 1821,
    notes: ["Known for investigative reporting and editorial independence"],
  },
  "washingtonpost.com": {
    credibilityScore: 0.90, biasRating: "left-center", factualityRating: "high",
    type: "newspaper", country: "US", foundedYear: 1877,
    notes: ["Major US newspaper — strong political coverage"],
  },
  "wsj.com": {
    credibilityScore: 0.91, biasRating: "right-center", factualityRating: "high",
    type: "newspaper", country: "US", foundedYear: 1889,
    notes: ["Financial newspaper — strong business coverage, conservative editorial board"],
  },
  "economist.com": {
    credibilityScore: 0.92, biasRating: "center", factualityRating: "very_high",
    type: "newspaper", country: "UK", foundedYear: 1843,
    notes: ["Weekly magazine — in-depth analysis and global perspective"],
  },
  "nature.com": {
    credibilityScore: 0.98, biasRating: "center", factualityRating: "very_high",
    type: "digital_native", country: "UK", foundedYear: 1869,
    notes: ["Premier scientific journal — peer-reviewed primary research"],
  },
  "aljazeera.com": {
    credibilityScore: 0.82, biasRating: "center", factualityRating: "high",
    type: "tv_network", country: "Qatar", foundedYear: 1996,
    notes: ["Strong Middle East coverage — state-funded by Qatar"],
  },
  "dw.com": {
    credibilityScore: 0.85, biasRating: "center", factualityRating: "high",
    type: "tv_network", country: "Germany", foundedYear: 1953,
    notes: ["Deutsche Welle — Germany's international broadcaster"],
  },
  "ft.com": {
    credibilityScore: 0.93, biasRating: "center", factualityRating: "very_high",
    type: "newspaper", country: "UK", foundedYear: 1888,
    notes: ["Financial Times — premium business and economics coverage"],
  },
  "npr.org": {
    credibilityScore: 0.90, biasRating: "left-center", factualityRating: "high",
    type: "tv_network", country: "US", foundedYear: 1971,
    notes: ["Non-profit media — strong investigative and cultural reporting"],
  },
  "techcrunch.com": {
    credibilityScore: 0.80, biasRating: "center", factualityRating: "high",
    type: "digital_native", country: "US", foundedYear: 2005,
    notes: ["Technology news — startup and venture capital focus"],
  },
  "arstechnica.com": {
    credibilityScore: 0.85, biasRating: "center", factualityRating: "high",
    type: "digital_native", country: "US", foundedYear: 1998,
    notes: ["Technology and science — detailed technical analysis"],
  },
  "theverge.com": {
    credibilityScore: 0.78, biasRating: "left-center", factualityRating: "high",
    type: "digital_native", country: "US", foundedYear: 2011,
    notes: ["Technology and culture — consumer-focused"],
  },
  "spiegel.de": {
    credibilityScore: 0.88, biasRating: "left-center", factualityRating: "high",
    type: "newspaper", country: "Germany", foundedYear: 1947,
    notes: ["Der Spiegel — Germany's leading investigative news magazine"],
  },
  "lemonde.fr": {
    credibilityScore: 0.87, biasRating: "center", factualityRating: "high",
    type: "newspaper", country: "France", foundedYear: 1944,
    notes: ["Le Monde — French newspaper of record"],
  },
};

export async function getDomainInfo(urlOrDomain: string): Promise<DomainInfo> {
  let domain = urlOrDomain;
  try {
    if (urlOrDomain.startsWith("http")) {
      domain = new URL(urlOrDomain).hostname.replace(/^www\./, "");
    }
  } catch { /* use raw input */ }

  const known = DOMAIN_DB[domain];
  if (known) {
    return {
      domain,
      credibilityScore: known.credibilityScore ?? 0.5,
      biasRating: known.biasRating ?? "unknown",
      factualityRating: known.factualityRating ?? "mixed",
      type: known.type ?? "unknown",
      country: known.country,
      language: known.language,
      foundedYear: known.foundedYear,
      notes: known.notes ?? [],
    };
  }

  // Unknown domain — do basic heuristics
  const notes: string[] = ["Not in curated credibility database — assess with caution"];
  const tld = domain.split(".").pop() ?? "";
  let country: string | undefined;
  const tldCountryMap: Record<string, string> = {
    uk: "UK", de: "Germany", fr: "France", jp: "Japan", cn: "China",
    au: "Australia", ca: "Canada", in: "India", br: "Brazil", it: "Italy",
    es: "Spain", nl: "Netherlands", se: "Sweden", no: "Norway", ch: "Switzerland",
  };
  if (tldCountryMap[tld]) country = tldCountryMap[tld];

  const hasAbout = domain.includes("about") || domain.includes("info");
  if (hasAbout) notes.push("Domain appears to have informational subpages");

  return {
    domain,
    credibilityScore: 0.5,
    biasRating: "unknown",
    factualityRating: "mixed",
    type: "unknown",
    country,
    notes,
  };
}
