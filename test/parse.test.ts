import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeAnswer, defaultQuestions, formatReport, runCheck } from "../src/check.js";
import { parseGemini, parseOpenAI, parsePerplexity } from "../src/engines.js";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

describe("OpenAI Responses parsing", () => {
  const a = parseOpenAI(fixture("openai"));
  it("joins output text and collects citation URLs", () => {
    expect(a.text).toContain("Bayshore Smiles");
    expect(a.urls).toContain("https://sunshinedental.com/services");
    expect(a.model).toBe("gpt-5.4-mini-2026-03-17");
  });
  it("estimates cost from tokens plus search calls", () => {
    expect(a.estimatedCostUsd).toBeCloseTo((8000 * 0.75 + 400 * 4.5) / 1e6 + 0.01, 6);
  });
  it("detects the business, its position and its cited site", () => {
    const r = analyzeAnswer("q", "openai", a, "Sunshine Dental & Implants", "sunshinedental.com");
    expect(r.named).toBe(true);
    expect(r.position).toBe(2);
    expect(r.list_length).toBe(3);
    expect(r.website_cited).toBe(true);
    expect(r.competitors).toEqual(["Bayshore Smiles", "Harbor Family Dentistry"]);
    expect(r.source_domains).toEqual(["bayshoresmiles.com", "yelp.com", "sunshinedental.com"]);
  });
});

describe("Perplexity parsing", () => {
  const a = parsePerplexity(fixture("perplexity"));
  it("uses citations and the reported cost", () => {
    expect(a.urls[0]).toContain("yelp.com");
    expect(a.estimatedCostUsd).toBe(0.0051);
  });
  it("reports a miss with competitors", () => {
    const r = analyzeAnswer("q", "perplexity", a, "Sunshine Dental", "sunshinedental.com");
    expect(r.named).toBe(false);
    expect(r.position).toBeNull();
    expect(r.website_cited).toBe(false);
    expect(r.competitors).toEqual(["Harbor Family Dentistry", "Bayshore Smiles", "Westshore Dental Group"]);
    expect(r.source_domains).toEqual(["yelp.com", "bayshoresmiles.com", "healthgrades.com"]);
  });
});

describe("Gemini parsing", () => {
  const a = parseGemini(fixture("gemini"), "gemini-2.5-flash-lite");
  it("recovers domains from grounding chunk titles", () => {
    expect(a.urls).toEqual(["https://sunshinedental.com", "https://yelp.com"]);
  });
  it("matches 'and' against '&'", () => {
    const r = analyzeAnswer("q", "gemini", a, "Sunshine Dental & Implants LLC", "https://www.sunshinedental.com/");
    expect(r.named).toBe(true);
    expect(r.position).toBe(2);
    expect(r.website_cited).toBe(false);
  });
});

describe("runCheck without keys", () => {
  it("generates questions and skips every engine with a clear note", async () => {
    const out = await runCheck({ business_name: "Sunshine Dental", category: "dentist", location: "Tampa, FL" }, {});
    expect(out.questions).toEqual(defaultQuestions("dentist", "Tampa, FL"));
    expect(out.questions).toHaveLength(5);
    expect(out.engines_run).toEqual([]);
    expect(out.engines_skipped.map((s) => s.reason)).toContain("OPENAI_API_KEY is not set");
    const text = formatReport(out);
    expect(text).toContain("Track this weekly with Cited: https://cited.voreli.ai");
    expect(text).not.toMatch(/\u2014/);
  });
  it("requires questions or a category", async () => {
    await expect(runCheck({ business_name: "X" }, {})).rejects.toThrow(/category/);
  });
});
