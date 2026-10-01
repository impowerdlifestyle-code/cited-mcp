import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const env = { PATH: process.env.PATH ?? "" };
const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env });
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));
if (!tools.some((t) => t.name === "check_ai_visibility")) throw new Error("check_ai_visibility missing");

const res = await client.callTool({
  name: "check_ai_visibility",
  arguments: { business_name: "Example Dental", category: "dentist", location: "Tampa, FL" },
});
const text = res.content[0].text;
console.log(text);
if (!text.includes("skipped") || !text.includes("cited.voreli.ai")) throw new Error("unexpected no-key output");

await client.close();
console.log("smoke ok");
