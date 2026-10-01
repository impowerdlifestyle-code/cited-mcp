import { describe, expect, it } from "vitest";
import { providerMessage } from "../src/engines.js";

describe("providerMessage", () => {
  it("pulls the message out of an OpenAI style error", () => {
    expect(providerMessage('{"error":{"message":"You have no credits remaining.","type":"insufficient_quota"}}')).toBe("You have no credits remaining.");
  });
  it("handles a string error and plain text", () => {
    expect(providerMessage('{"error":"bad key"}')).toBe("bad key");
    expect(providerMessage("Service\n  Unavailable")).toBe("Service Unavailable");
  });
});
