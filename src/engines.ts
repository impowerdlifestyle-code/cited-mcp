export type EngineId = "openai" | "perplexity" | "gemini";

export interface EngineAnswer {
  text: string;
  urls: string[];
  model: string;
  estimatedCostUsd: number;
}

interface EngineDef {
  label: string;
  envKey: string;
  modelEnv: string;
  defaultModel: string;
  ask(question: string, apiKey: string, model: string): Promise<EngineAnswer>;
}

const TIMEOUT_MS = 120_000;

async function postJson(url: string, body: unknown, headers: Record<string, string>): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${providerMessage(raw)}`);
  return JSON.parse(raw);
}

const MARKDOWN_LINK_URL = /\((https?:\/\/[^\s)]+)\)/g;

function linkUrls(text: string): string[] {
  return [...text.matchAll(MARKDOWN_LINK_URL)].map((m) => m[1]);
}

// USD per 1M tokens, and per search call. Published list prices checked 2026-10-01; used only for the estimate.
const OPENAI_PRICES: Record<string, { input: number; output: number }> = {
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, output: 1.25 },
  "gpt-5-mini": { input: 0.25, output: 2 },
};
const OPENAI_SEARCH_CALL = 0.01;

export function parseOpenAI(d: any): EngineAnswer {
  const messages = (d.output ?? []).filter((o: any) => o.type === "message");
  const parts = messages.flatMap((m: any) => m.content ?? []).filter((c: any) => c.type === "output_text");
  const text = parts.map((p: any) => p.text ?? "").join("\n").trim();
  const urls = parts.flatMap((p: any) => (p.annotations ?? []).filter((a: any) => a.url).map((a: any) => a.url as string));
  const searches = (d.output ?? []).filter((o: any) => o.type === "web_search_call").length;
  const model = String(d.model ?? "");
  const price = Object.entries(OPENAI_PRICES).find(([k]) => model.startsWith(k))?.[1];
  const usage = d.usage ?? {};
  const tokens = price ? ((usage.input_tokens ?? 0) * price.input + (usage.output_tokens ?? 0) * price.output) / 1e6 : 0;
  return { text, urls: [...urls, ...linkUrls(text)], model, estimatedCostUsd: tokens + searches * OPENAI_SEARCH_CALL };
}

const PERPLEXITY_PRICES: Record<string, { input: number; output: number; request: number }> = {
  sonar: { input: 1, output: 1, request: 0.005 },
  "sonar-pro": { input: 3, output: 15, request: 0.006 },
};

export function parsePerplexity(d: any): EngineAnswer {
  const text = String(d.choices?.[0]?.message?.content ?? "").trim();
  const urls: string[] = [
    ...(d.citations ?? []),
    ...(d.search_results ?? []).map((r: any) => r.url).filter(Boolean),
  ];
  const model = String(d.model ?? "");
  const usage = d.usage ?? {};
  let cost = Number(usage.cost?.total_cost);
  if (!Number.isFinite(cost)) {
    const p = PERPLEXITY_PRICES[model];
    cost = p ? ((usage.prompt_tokens ?? 0) * p.input + (usage.completion_tokens ?? 0) * p.output) / 1e6 + p.request : 0;
  }
  return { text, urls: [...urls, ...linkUrls(text)], model, estimatedCostUsd: cost };
}

const GEMINI_PRICES: Record<string, { input: number; output: number }> = {
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
};

// Gemini grounding URIs are vertexaisearch redirect links; the chunk title carries the real domain.
export function parseGemini(d: any, model: string): EngineAnswer {
  const cand = d.candidates?.[0] ?? {};
  const text = (cand.content?.parts ?? []).map((p: any) => p.text ?? "").join("").trim();
  const chunks = cand.groundingMetadata?.groundingChunks ?? [];
  const urls: string[] = chunks
    .map((c: any) => {
      const uri: string = c.web?.uri ?? "";
      const title: string = c.web?.title ?? "";
      if (uri && !uri.includes("vertexaisearch.cloud.google.com")) return uri;
      return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(title) ? `https://${title}` : "";
    })
    .filter(Boolean);
  const u = d.usageMetadata ?? {};
  const name = String(d.modelVersion ?? model);
  const price = Object.entries(GEMINI_PRICES).find(([k]) => name.startsWith(k))?.[1];
  const cost = price
    ? ((u.promptTokenCount ?? 0) * price.input + ((u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0)) * price.output) / 1e6
    : 0;
  return { text, urls: [...urls, ...linkUrls(text)], model: name, estimatedCostUsd: cost };
}

export const ENGINES: Record<EngineId, EngineDef> = {
  openai: {
    label: "ChatGPT (OpenAI API)",
    envKey: "OPENAI_API_KEY",
    modelEnv: "OPENAI_MODEL",
    defaultModel: "gpt-5.4-mini",
    async ask(question, apiKey, model) {
      const d = await postJson(
        "https://api.openai.com/v1/responses",
        { model, input: question, tools: [{ type: "web_search" }], reasoning: { effort: "low" } },
        { Authorization: `Bearer ${apiKey}` },
      );
      return parseOpenAI(d);
    },
  },
  perplexity: {
    label: "Perplexity",
    envKey: "PERPLEXITY_API_KEY",
    modelEnv: "PERPLEXITY_MODEL",
    defaultModel: "sonar",
    async ask(question, apiKey, model) {
      const d = await postJson(
        "https://api.perplexity.ai/chat/completions",
        { model, messages: [{ role: "user", content: question }] },
        { Authorization: `Bearer ${apiKey}` },
      );
      return parsePerplexity(d);
    },
  },
  gemini: {
    label: "Gemini",
    envKey: "GEMINI_API_KEY",
    modelEnv: "GEMINI_MODEL",
    defaultModel: "gemini-2.5-flash-lite",
    async ask(question, apiKey, model) {
      const d = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { contents: [{ role: "user", parts: [{ text: question }] }], tools: [{ google_search: {} }] },
        { "x-goog-api-key": apiKey },
      );
      return parseGemini(d, model);
    },
  },
};

export const ENGINE_IDS = Object.keys(ENGINES) as EngineId[];

// Providers wrap errors as {"error":{"message":...}} or {"error":"..."}; fall back to the raw body.
export function providerMessage(raw: string): string {
  try {
    const body = JSON.parse(raw) as { error?: { message?: string } | string; message?: string };
    const msg = typeof body.error === "string" ? body.error : body.error?.message ?? body.message;
    if (msg) return msg;
  } catch {}
  return raw.replace(/\s+/g, " ").slice(0, 300);
}
