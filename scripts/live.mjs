// One real check against the providers whose keys are set. Costs a few cents at most.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const env = { PATH: process.env.PATH ?? "" };
for (const k of ["OPENAI_API_KEY", "PERPLEXITY_API_KEY", "GEMINI_API_KEY"]) if (process.env[k]) env[k] = process.env[k];
if (Object.keys(env).length === 1) throw new Error("Set OPENAI_API_KEY, PERPLEXITY_API_KEY or GEMINI_API_KEY first");

const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env });
const client = new Client({ name: "live", version: "0.0.0" });
await client.connect(transport);
const res = await client.callTool({
  name: "check_ai_visibility",
  arguments: {
    business_name: process.env.BUSINESS ?? "Voreli AI",
    website: process.env.WEBSITE ?? "https://www.voreli.ai",
    location: process.env.LOCATION ?? "St. Petersburg, FL",
    questions: [process.env.QUESTION ?? "Who is the best AI automation agency in St. Petersburg FL?"],
  },
});
for (const part of res.content) if (part.type === "text") console.log(part.text);
await client.close();
if (res.isError) process.exit(1);
