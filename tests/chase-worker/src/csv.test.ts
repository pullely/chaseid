import { parseImportCsv } from "@chase-worker/csv";
import { normaliseCompanyNumber } from "@chase-worker/provider/types";

describe("normaliseCompanyNumber", () => {
  it("pads a numeric number the spreadsheet stripped the zeros off", () => {
    expect(normaliseCompanyNumber("1234567")).toBe("01234567");
    expect(normaliseCompanyNumber("1")).toBe("00000001");
  });

  it("keeps a prefixed number and pads the numeric tail", () => {
    expect(normaliseCompanyNumber("SC3")).toBe("SC000003");
    expect(normaliseCompanyNumber("sc000003")).toBe("SC000003");
  });

  it("rejects what is not a company number at all", () => {
    expect(normaliseCompanyNumber("")).toBeNull();
    expect(normaliseCompanyNumber("Acme Ltd")).toBeNull();
    expect(normaliseCompanyNumber("012345678901")).toBeNull();
  });
});

describe("parseImportCsv", () => {
  it("reads the documented header", () => {
    const parsed = parseImportCsv(
      "company_number,person_name,person_email\n01234567,\"OKONKWO, Adaeze\",ada@harbourside.co.uk\n",
    );
    expect(parsed.rejected).toBe(0);
    expect(parsed.rows).toEqual([
      { companyNumber: "01234567", contactName: "OKONKWO, Adaeze", contactEmail: "ada@harbourside.co.uk" },
    ]);
  });

  it("matches columns by name, not position — practices hand you their own layout", () => {
    const parsed = parseImportCsv(
      "Client Name,Person Email,Company Number,Person Name\nHarbourside,ada@x.co.uk,1234567,Adaeze\n",
    );
    expect(parsed.rows[0]).toEqual({
      companyNumber: "01234567",
      contactName: "Harbourside",
      contactEmail: "ada@x.co.uk",
    });
  });

  it("accepts a header-less paste of company numbers", () => {
    const parsed = parseImportCsv("01234567\nSC000003\n");
    expect(parsed.rows.map((row) => row.companyNumber)).toEqual(["01234567", "SC000003"]);
    expect(parsed.rows[0]!.contactEmail).toBeNull();
  });

  it("drops rows with no usable company number and counts them", () => {
    const parsed = parseImportCsv("company_number,person_email\n01234567,a@b.co\nnot a number,c@d.co\n");
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rejected).toBe(1);
  });

  it("discards an address that is not one rather than trying to chase it", () => {
    const parsed = parseImportCsv("company_number,person_name,person_email\n01234567,Adaeze,ada(at)x\n");
    expect(parsed.rows[0]!.contactEmail).toBeNull();
    expect(parsed.rows[0]!.contactName).toBe("Adaeze");
  });

  it("handles an empty file without throwing", () => {
    expect(parseImportCsv("")).toEqual({ rows: [], rejected: 0 });
  });
});
