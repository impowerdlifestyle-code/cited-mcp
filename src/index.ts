#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { formatReport, runCheck } from "./check.js";
import { ENGINE_IDS } from "./engines.js";

const server = new McpServer({ name: "cited-mcp", title: "Cited AI Visibility Check", version: "0.1.0" });

server.registerTool(
  "check_ai_visibility",
  {
    title: "Check AI visibility",
    description:
      "Ask AI engines (ChatGPT via the OpenAI API, Perplexity, Gemini) buyer questions with live web search on, and report whether a business is named, " +
      "its position in any list, whether its website is cited, which competitors are named instead, and the source domains each engine used. " +
      "Engines without an API key in the server env are skipped. Each question costs a few cents per engine, billed by the provider. " +
      "Pass 1 to 10 questions, or omit them and pass a category (for example \"family dentist\") plus a location to use 5 generic buyer questions.",
    inputSchema: {
      business_name: z.string().min(1).describe("The business to look for, e.g. \"Sunshine Dental LLC\""),
      website: z.string().optional().describe("The business website, e.g. sunshinedental.com. Used to detect citations of its pages."),
      location: z.string().optional().describe("City or area, e.g. \"Tampa, FL\". Used when questions are generated."),
      category: z.string().optional().describe("What the business is, e.g. \"family dentist\". Required when questions are omitted."),
      questions: z.array(z.string().min(3)).min(1).max(10).optional().describe("1 to 10 questions a buyer would ask an AI assistant."),
      engines: z.array(z.enum(ENGINE_IDS as [string, ...string[]])).optional().describe("Subset of engines to run. Default: every engine with a key."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (args) => {
    try {
      const out = await runCheck({ ...args, engines: args.engines as typeof ENGINE_IDS | undefined });
      return {
        content: [{ type: "text", text: formatReport(out) }],
        structuredContent: out as unknown as Record<string, unknown>,
      };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }] };
    }
  },
);

await server.connect(new StdioServerTransport());
