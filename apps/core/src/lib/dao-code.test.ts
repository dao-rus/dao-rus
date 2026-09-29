import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DAO_CODE_CLAUSES } from "./dao-code";

describe("DAO code canonical projection", () => {
  it("keeps the runtime clauses synchronized with the canonical governance document", () => {
    const documentPath = fileURLToPath(
      new URL("../../../../docs/governance/code.md", import.meta.url),
    );
    const document = readFileSync(documentPath, "utf8");

    for (const clause of DAO_CODE_CLAUSES) {
      expect(document).toContain(`## ${clause.id}`);
      expect(document).toContain(`**${clause.text}**`);
    }
  });
});
