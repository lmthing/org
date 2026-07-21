/**
 * Deterministic duplicate-space check for the architect's CREATE path.
 *
 * `synthesize_and_run` fans out once per topic and derives each new space's slug
 * purely from that topic — so two differently-worded requests for the SAME entity
 * ("MetLife Silver pension" and "Pension — MetLife Silver", or "car insurance" and
 * "vehicle insurance" for one insurer) each mint a brand-new space and the runtime
 * (which keys a registration purely on its directory path) happily registers both.
 * This function is the deterministic choke point: derive a normalized token
 * signature for the intended topic and for every already-scaffolded space, and
 * REUSE an existing space when its signature is contained in the topic's (or vice
 * versa). The result feeds `01-design.md`, which then skips designing/registering a
 * second copy.
 *
 * The rule is deliberately CONSERVATIVE — a false merge silently loses a real
 * space, which is worse than a rare surviving duplicate. So it only merges when the
 * SMALLER significant-token set (>= 2 tokens) is a full subset of the larger: an
 * entity + a qualifier must both match, never a single shared word. Distinct
 * insurers (their names differ) and a pension-vs-health policy from the same
 * provider (the domain tokens differ) therefore stay separate.
 *
 * Pure: takes the topic and the already-listed spaces (from `listScaffoldedSpaces()`),
 * uses only JS builtins, and touches no host primitives — so it is unit-testable in
 * isolation and cannot drift the way a prose reasoning step does.
 *
 * @param topic  The user's request / intended topic for the new space.
 * @param spaces The existing scaffolded spaces (name + dir), from listScaffoldedSpaces().
 * @returns      { reused, slug, dir } — reused:true with the existing space's slug/dir
 *               when the topic already has a home; otherwise reused:false.
 */
export function matchExistingSpace(
  topic: string,
  spaces: { name: string; dir: string }[],
): { reused: boolean; slug: string; dir: string } {
  // Generic, domain-agnostic wrapper words that carry no distinguishing meaning —
  // dropping them lets "MetLife Silver advisor" and "Pension MetLife Silver" reduce
  // to the SAME entity tokens. Never list a brand / person / place / product name
  // here: those are exactly the tokens that must stay distinct. Singular + plural.
  const STOP = new Set<string>([
    'the', 'a', 'an', 'of', 'for', 'and', 'or', 'to', 'my', 'our', 'your', 'with',
    'on', 'in', 'about', 'info', 'details', 'general', 'new',
    'advisor', 'advisors', 'assistant', 'assistants', 'expert', 'experts',
    'specialist', 'specialists', 'helper', 'helpers', 'guide', 'guides',
    'agent', 'agents', 'space', 'spaces', 'bot', 'bots',
    'service', 'services', 'support', 'manage', 'manager', 'management',
    'tracker', 'trackers', 'account', 'accounts', 'provider', 'providers',
  ]);
  // Generic everyday synonyms collapsed to one canonical token, so wording variants
  // of the SAME everyday domain merge ("vehicle"/"auto"/"motor" -> "car"). English,
  // domain-level only — never a proper noun. Plurals canonicalize here too.
  const SYN: Record<string, string> = {
    vehicle: 'car', vehicles: 'car', auto: 'car', autos: 'car', automobile: 'car',
    automobiles: 'car', motor: 'car', cars: 'car',
    house: 'home', houses: 'home', property: 'home', properties: 'home', homes: 'home',
    doctor: 'health', doctors: 'health', gp: 'health', medical: 'health',
    physician: 'health', physicians: 'health', healthcare: 'health',
    phone: 'mobile', phones: 'mobile', cell: 'mobile', cellphone: 'mobile',
    cellphones: 'mobile', mobiles: 'mobile', handset: 'mobile',
    pensions: 'pension', retirement: 'pension',
    insurances: 'insurance', policies: 'policy',
  };
  const norm = (s: string): Set<string> => {
    const out = new Set<string>();
    for (const raw of String(s || '').toLowerCase().split(/[^a-z0-9]+/)) {
      if (!raw) continue;
      const t = SYN[raw] || raw;
      if (STOP.has(t)) continue;
      out.add(t);
    }
    return out;
  };

  const want = norm(topic);
  if (want.size < 2) return { reused: false, slug: '', dir: '' };

  for (const sp of spaces || []) {
    const have = norm(sp && sp.name);
    if (have.size < 2) continue; // never let a 0/1-token (generic) space absorb a topic
    const [small, big] = want.size <= have.size ? [want, have] : [have, want];
    if (small.size < 2) continue; // require an entity + a qualifier match, not one word
    let subset = true;
    for (const t of small) {
      if (!big.has(t)) {
        subset = false;
        break;
      }
    }
    if (subset) return { reused: true, slug: sp.name, dir: sp.dir };
  }
  return { reused: false, slug: '', dir: '' };
}
