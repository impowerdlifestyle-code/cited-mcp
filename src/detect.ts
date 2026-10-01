const LEGAL_SUFFIXES = new Set([
  "llc", "l l c", "inc", "incorporated", "co", "corp", "corporation", "company", "ltd", "limited",
  "pllc", "pc", "pa", "lp", "llp", "plc", "gmbh",
]);

const NOT_COMPETITORS = /^(cited|chatgpt|openai|perplexity|google|google gemini|gemini|claude|anthropic|copilot|microsoft copilot|bing|google maps|google business profile|google ai overviews?|google ai mode|google reviews|reddit|yelp|g2|clutch|designrush|upwork|angi|angie's list|thumbtack|tripadvisor|facebook|instagram|nextdoor|bbb|better business bureau|houzz|homeadvisor|zocdoc|healthgrades|wikipedia|youtube|linkedin)$/i;

export function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’ʼ`']/g, "")
    .replace(/&|\+/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function stripLegal(normalized: string): string {
  let words = normalized.split(" ");
  while (words.length > 1) {
    const last2 = words.slice(-2).join(" ");
    if (words.length > 2 && LEGAL_SUFFIXES.has(last2)) words = words.slice(0, -2);
    else if (LEGAL_SUFFIXES.has(words[words.length - 1])) words = words.slice(0, -1);
    else break;
  }
  if (words.length > 1 && words[0] === "the") words = words.slice(1);
  return words.join(" ");
}

export function nameVariants(businessName: string): string[] {
  const full = normalize(businessName);
  const core = stripLegal(full);
  const variants = new Set([full, core]);
  if (core.includes(" and ")) variants.add(core.replace(/ and /g, " "));
  return [...variants].filter(Boolean);
}

export function mentionsName(text: string, businessName: string, websiteDomain?: string): boolean {
  const hay = ` ${normalize(text)} `;
  const collapsedHay = hay.replace(/ /g, "");
  for (const v of nameVariants(businessName)) {
    if (hay.includes(` ${v} `)) return true;
    const collapsed = v.replace(/ /g, "");
    if (v.includes(" ") && collapsed.length >= 8 && collapsedHay.includes(collapsed)) return true;
  }
  if (websiteDomain) {
    const d = websiteDomain.toLowerCase();
    if (text.toLowerCase().includes(d)) return true;
  }
  return false;
}

export function domainOf(url: string): string {
  let raw = url.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return "";
  }
}

export function sameSite(domain: string, target: string): boolean {
  return domain === target || domain.endsWith(`.${target}`);
}

export function uniqueDomains(urls: string[]): string[] {
  return [...new Set(urls.map(domainOf).filter(Boolean))];
}

export function rankedEntries(text: string): string[] {
  const entries: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^ ?(?:#{1,4}\s*)?\d+[.)]\s+(.+)/) ?? line.match(/^ ?[-*•]\s+(.+)/);
    if (m) entries.push(m[1].trim());
  }
  return entries;
}

export function listPosition(text: string, businessName: string, websiteDomain?: string): number | null {
  const entries = rankedEntries(text);
  const i = entries.findIndex((e) => mentionsName(e, businessName, websiteDomain));
  return i === -1 ? null : i + 1;
}

function cleanName(raw: string): string {
  return raw
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#]/g, "")
    .replace(/\[\d+\]/g, "")
    .replace(/^\s*\d+[.)]\s*/, "")
    .trim()
    .replace(/[.,:;]+$/, "");
}

function leadingName(entry: string): string {
  const bold = entry.match(/\*\*([^*]+)\*\*/);
  if (bold && entry.trim().startsWith("**")) return cleanName(bold[1]);
  const link = entry.match(/^\[([^\]]+)\]\(/);
  if (link) return cleanName(link[1]);
  const head = entry.split(/\s[-\u2013\u2014]\s|:\s|\s\(/)[0];
  return cleanName(head);
}

function looksLikeName(s: string): boolean {
  const words = s.split(/\s+/);
  if (!s || words.length > 7 || s.length > 60) return false;
  if (!/^[A-Z0-9]/.test(s)) return false;
  if (/^(note|tip|tips|why|how|what|summary|pros|cons|cost|price|pricing|location|address|phone|hours|rating|reviews?|website|services|specialt(y|ies)|best for|highlights?|key features?)$/i.test(s)) return false;
  // Labels like "Best for a strategy-first setup" or "Good if you need X" describe a pick, they are not a business.
  if (/^(best|good|great|ideal|top|also)\s+(for|if|when|pick|choice)\b/i.test(s)) return false;
  // Rating fragments like "0 Google rating" or "4.8 stars (120 reviews)".
  if (/\d/.test(s) && /\b(ratings?|reviews?|stars?)\b/i.test(s)) return false;
  return true;
}

export function competitorsNamed(text: string, businessName: string, websiteDomain?: string): string[] {
  const candidates: string[] = [];
  for (const e of rankedEntries(text)) candidates.push(leadingName(e));
  for (const m of text.matchAll(/^#{2,4}\s+(?:\d+[.)]\s*)?(.+)$/gm)) candidates.push(cleanName(m[1]));
  for (const m of text.matchAll(/\*\*([^*\n]{2,60})\*\*/g)) candidates.push(cleanName(m[1]));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    const key = normalize(c);
    if (!key || seen.has(key) || !looksLikeName(c)) continue;
    seen.add(key);
    if (NOT_COMPETITORS.test(c.trim())) continue;
    if (mentionsName(c, businessName, websiteDomain)) continue;
    out.push(c);
  }
  return out;
}
