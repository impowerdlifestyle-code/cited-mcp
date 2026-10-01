import { describe, expect, it } from "vitest";
import { competitorsNamed, domainOf, listPosition, mentionsName, nameVariants, normalize, rankedEntries, sameSite } from "../src/detect.js";

describe("normalize and variants", () => {
  it("folds case, punctuation, ampersands and accents", () => {
    expect(normalize("Joe's Café & Bar, Inc.")).toBe("joes cafe and bar inc");
  });
  it("drops legal suffixes and a leading 'the'", () => {
    expect(nameVariants("The Smith Group, LLC")).toContain("smith group");
    expect(nameVariants("Acme Co.")).toContain("acme");
    expect(nameVariants("Sunshine Dental & Implants")).toContain("sunshine dental implants");
  });
});

describe("mentionsName", () => {
  it("matches across case, punctuation and suffixes", () => {
    expect(mentionsName("Try SUNSHINE DENTAL AND IMPLANTS today", "Sunshine Dental & Implants, LLC")).toBe(true);
    expect(mentionsName("**Joes Pizza** is great", "Joe's Pizza Inc")).toBe(true);
  });
  it("matches a camel-cased brand written without spaces", () => {
    expect(mentionsName("Book through YachtAwayNow.", "Yacht Away Now")).toBe(true);
  });
  it("respects word boundaries", () => {
    expect(mentionsName("Citedness matters", "Cited")).toBe(false);
    expect(mentionsName("Acmes are everywhere", "Acme")).toBe(false);
  });
  it("counts the website domain written in the text", () => {
    expect(mentionsName("See sunshinedental.com for hours", "Totally Different Name", "sunshinedental.com")).toBe(true);
  });
  it("does not match other businesses", () => {
    expect(mentionsName("Bayshore Smiles and Harbor Family Dentistry", "Sunshine Dental")).toBe(false);
  });
});

describe("domains", () => {
  it("strips www and handles bare hosts", () => {
    expect(domainOf("https://www.Example.com/a?b=1")).toBe("example.com");
    expect(domainOf("example.com")).toBe("example.com");
    expect(domainOf("not a url")).toBe("");
  });
  it("treats subdomains as the same site", () => {
    expect(sameSite("blog.example.com", "example.com")).toBe(true);
    expect(sameSite("notexample.com", "example.com")).toBe(false);
  });
});

describe("lists", () => {
  const text = "Intro\n\n1. **Alpha Co** - first\n2. **Beta LLC** - second\n3. Gamma Dental: third\n\nOutro";
  it("finds ranked entries and the position", () => {
    expect(rankedEntries(text)).toHaveLength(3);
    expect(listPosition(text, "Beta")).toBe(2);
    expect(listPosition(text, "Delta")).toBeNull();
  });
  it("extracts competitors, excluding the target and platforms", () => {
    const t = `${text}\n- **Yelp** has more\n### Delta Dentistry`;
    expect(competitorsNamed(t, "Beta, LLC")).toEqual(["Alpha Co", "Gamma Dental", "Delta Dentistry"]);
  });
});

describe("competitorsNamed ignores labels and rating fragments", () => {
  it("drops 'Best for' labels and rating counts but keeps real names", () => {
    const text = [
      "1. **Voreli AI** - St. Petersburg agency",
      "2. **Fishhook Marketing** - Tampa",
      "3. **Best for a strategy-first small-business setup**",
      "4. **0 Google rating**",
      "5. **GO Agency AI**",
    ].join("\n");
    expect(competitorsNamed(text, "Voreli AI", "voreli.ai")).toEqual(["Fishhook Marketing", "GO Agency AI"]);
  });
});
