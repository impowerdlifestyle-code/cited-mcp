import { competitorsNamed, domainOf, listPosition, mentionsName, rankedEntries, sameSite, uniqueDomains } from "./detect.js";
import { ENGINES, ENGINE_IDS, type EngineAnswer, type EngineId } from "./engines.js";

export const FOOTER = "Track this weekly with Cited: https://cited.voreli.ai";

export interface CheckInput {
  business_name: string;
  website?: string;
  location?: string;
  category?: string;
  questions?: string[];
  engines?: EngineId[];
}

export interface QuestionResult {
  question: string;
  engine: EngineId;
  model: string;
  named: boolean;
  position: number | null;
  list_length: number;
  website_cited: boolean;
  competitors: string[];
  source_domains: string[];
  answer_excerpt: string;
  estimated_cost_usd: number;
  error?: string;
}

export interface CheckOutput {
  business_name: string;
  website_domain: string | null;
  questions: string[];
  engines_run: EngineId[];
  engines_skipped: { engine: EngineId; reason: string }[];
  results: QuestionResult[];
  summary: { engine: EngineId; named_in: number; asked: number; website_cited_in: number; errors: number }[];
  estimated_total_cost_usd: number;
  note: string;
}

export function defaultQuestions(category: string, location?: string): string[] {
  const where = location ? ` in ${location}` : "";
  const near = location ? ` near ${location}` : "";
  return [
    `What is the best ${category}${where}?`,
    `Can you recommend a good ${category}${where}?`,
    `Who are the top-rated ${category} options${near}?`,
    `I need a ${category}${where}. Which one should I contact?`,
    `Which ${category}${where} do people recommend most?`,
  ];
}

export function analyzeAnswer(
  question: string,
  engine: EngineId,
  answer: EngineAnswer,
  businessName: string,
  websiteDomain: string | null,
): QuestionResult {
  const domains = uniqueDomains(answer.urls);
  const site = websiteDomain ?? undefined;
  const named = mentionsName(answer.text, businessName, site);
  const lines = answer.text.split("\n").filter((l) => /^ ?(?:#{1,4}\s*)?\d+[.)]\s+|^ ?[-*•]\s+/.test(l));
  return {
    question,
    engine,
    model: answer.model,
    named,
    position: listPosition(answer.text, businessName, site),
    list_length: rankedEntries(answer.text).length,
    website_cited: websiteDomain ? domains.some((d) => sameSite(d, websiteDomain)) : false,
    competitors: competitorsNamed(answer.text, businessName, site).slice(0, 15),
    source_domains: domains.slice(0, 10),
    answer_excerpt: answer.text.length > 700 ? `${answer.text.slice(0, 700)}...` : answer.text,
    estimated_cost_usd: round(answer.estimatedCostUsd),
  };
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function runCheck(input: CheckInput, env: NodeJS.ProcessEnv = process.env): Promise<CheckOutput> {
  let questions = (input.questions ?? []).map((q) => q.trim()).filter(Boolean);
  if (!questions.length) {
    if (!input.category) throw new Error("Pass either questions (1 to 10) or a category such as \"dentist\" so questions can be generated.");
    questions = defaultQuestions(input.category, input.location);
  }
  questions = questions.slice(0, 10);
  const websiteDomain = input.website ? domainOf(input.website) || null : null;

  const requested = input.engines?.length ? input.engines : ENGINE_IDS;
  const enginesRun: EngineId[] = [];
  const skipped: CheckOutput["engines_skipped"] = [];
  for (const id of requested) {
    if (env[ENGINES[id].envKey]) enginesRun.push(id);
    else skipped.push({ engine: id, reason: `${ENGINES[id].envKey} is not set` });
  }

  const jobs = questions.flatMap((q) => enginesRun.map((e) => ({ q, e })));
  const results = await pool(jobs, 4, async ({ q, e }): Promise<QuestionResult> => {
    const def = ENGINES[e];
    const model = env[def.modelEnv] || def.defaultModel;
    try {
      const answer = await def.ask(q, env[def.envKey]!, model);
      return analyzeAnswer(q, e, answer, input.business_name, websiteDomain);
    } catch (err) {
      return {
        question: q, engine: e, model, named: false, position: null, list_length: 0, website_cited: false,
        competitors: [], source_domains: [], answer_excerpt: "", estimated_cost_usd: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  const summary = enginesRun.map((e) => {
    const rs = results.filter((r) => r.engine === e && !r.error);
    return {
      engine: e,
      errors: results.filter((r) => r.engine === e && r.error).length,
      named_in: rs.filter((r) => r.named).length,
      asked: rs.length,
      website_cited_in: rs.filter((r) => r.website_cited).length,
    };
  });

  return {
    business_name: input.business_name,
    website_domain: websiteDomain,
    questions,
    engines_run: enginesRun,
    engines_skipped: skipped,
    results,
    summary,
    estimated_total_cost_usd: round(results.reduce((s, r) => s + r.estimated_cost_usd, 0)),
    note: "AI answers change from run to run, so treat one check as a snapshot, not a score. Costs are estimates from token usage at list prices; you pay your provider directly.",
  };
}

export function formatReport(o: CheckOutput): string {
  const lines: string[] = [];
  lines.push(`# AI visibility check: ${o.business_name}${o.website_domain ? ` (${o.website_domain})` : ""}`);
  lines.push("");
  if (!o.engines_run.length) {
    lines.push("No engines ran. Set at least one of OPENAI_API_KEY, PERPLEXITY_API_KEY or GEMINI_API_KEY in this server's env config.");
  }
  for (const s of o.summary) {
    const failed = s.errors ? `, ${s.errors} failed (see below)` : "";
    lines.push(
      s.asked
        ? `- ${ENGINES[s.engine].label}: named in ${s.named_in} of ${s.asked} answers, website cited in ${s.website_cited_in}${failed}`
        : `- ${ENGINES[s.engine].label}: every request failed (see below)`,
    );
  }
  for (const s of o.engines_skipped) lines.push(`- ${ENGINES[s.engine].label}: skipped (${s.reason})`);
  lines.push("");
  for (const q of o.engines_run.length ? o.questions : []) {
    lines.push(`## "${q}"`);
    for (const r of o.results.filter((x) => x.question === q)) {
      const label = ENGINES[r.engine].label;
      if (r.error) {
        lines.push(`- ${label}: error, ${r.error}`);
        continue;
      }
      const pos = r.position ? `, #${r.position} of ${r.list_length} listed` : "";
      const site = o.website_domain ? (r.website_cited ? ", website cited" : ", website not cited") : "";
      lines.push(`- ${label}: ${r.named ? "NAMED" : "not named"}${pos}${site}`);
      if (r.competitors.length) lines.push(`  - Named instead: ${r.competitors.slice(0, 8).join(", ")}`);
      if (r.source_domains.length) lines.push(`  - Sources: ${r.source_domains.slice(0, 6).join(", ")}`);
    }
    lines.push("");
  }
  lines.push(`Estimated provider cost: $${o.estimated_total_cost_usd.toFixed(4)}. ${o.note}`);
  lines.push("");
  lines.push(FOOTER);
  return lines.join("\n");
}
