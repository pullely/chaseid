import { CHASE_GOV_UK_URL, renderEmailTemplate } from "@notifications-worker/templates/index";
import { CHASE_TEMPLATE_KEYS, GOV_UK_VERIFY_URL } from "@saas/contracts/chase";

const DATA = {
  personName: "Adaeze Okonkwo",
  companyName: "HARBOURSIDE ACCOUNTING LIMITED",
  companyNumber: "00000001",
  nextStatementDue: "2026-10-05",
  daysUntilDue: 12,
  step: 1,
};

describe("the chase templates (CH2)", () => {
  it.each(CHASE_TEMPLATE_KEYS)("%s renders subject, html and text", (key) => {
    const rendered = renderEmailTemplate(key, DATA, { brandName: "Chaseid" });
    expect(rendered).not.toBeNull();
    expect(rendered!.subject).toContain("HARBOURSIDE ACCOUNTING LIMITED");
    expect(rendered!.text).toContain("Dear Adaeze Okonkwo,");
    expect(rendered!.text).toContain("2026-10-05 (in 12 days)");
    expect(rendered!.html).toContain("<!DOCTYPE html>");
    expect(rendered!.html).toContain("on behalf of your accountant");
  });

  it("the three steps say three different things", () => {
    const subjects = CHASE_TEMPLATE_KEYS.map((key) => renderEmailTemplate(key, DATA)!.subject);
    expect(new Set(subjects).size).toBe(3);
    expect(subjects[2]).toMatch(/^Urgent/);
  });

  it("escapes every substitution in the html part", () => {
    const hostile = {
      ...DATA,
      personName: '<script>alert("x")</script>',
      companyName: "Smith & Sons <b>Ltd</b>",
    };
    for (const key of CHASE_TEMPLATE_KEYS) {
      const { html, text } = renderEmailTemplate(key, hostile)!;
      expect(html).not.toContain("<script>");
      expect(html).not.toContain("<b>Ltd</b>");
      expect(html).toContain("&lt;script&gt;");
      expect(html).toContain("Smith &amp; Sons &lt;b&gt;Ltd&lt;/b&gt;");
      // The text part is plain text and carries the value verbatim.
      expect(text).toContain("Smith & Sons <b>Ltd</b>");
    }
  });

  it("links only to GOV.UK — no anchor, no token, no link back into the product", () => {
    expect(CHASE_GOV_UK_URL).toBe(GOV_UK_VERIFY_URL);
    for (const key of CHASE_TEMPLATE_KEYS) {
      const { html, text } = renderEmailTemplate(key, { ...DATA, token: "SECRET", code: "123456" })!;
      expect(html).not.toMatch(/<a\s/i);
      expect(html).not.toContain("SECRET");
      expect(text).not.toContain("123456");
      const urls = `${html} ${text}`.match(/https?:\/\/[^\s"<]+/g) ?? [];
      expect(urls.length).toBeGreaterThan(0);
      expect(urls.every((u) => u.startsWith("https://www.gov.uk/"))).toBe(true);
    }
  });

  it("reads an overdue filing and a missing name sensibly", () => {
    const { text } = renderEmailTemplate("chase.first_notice", {
      ...DATA,
      personName: null,
      companyName: "",
      daysUntilDue: -3,
    })!;
    expect(text).toContain("Hello,");
    expect(text).toContain("company 00000001");
    expect(text).toContain("(3 days ago)");
  });
});
