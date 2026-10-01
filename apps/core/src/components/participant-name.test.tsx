import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ParticipantName } from "./participant-name";

describe("participant name indices", () => {
  it("links the profile and renders two distinct single-number SUP indices with accessible explanations", () => {
    const html = renderToStaticMarkup(
      <ParticipantName participantId="10000000-0000-4000-8000-000000000001"
        verificationPoints={2} positiveCount={7}>Алиса</ParticipantName>,
    );
    expect(html).toContain('href="/profile/10000000-0000-4000-8000-000000000001"');
    expect(html).toMatch(/Алиса<\/a>/);
    expect(html).toMatch(/<sup>2<\/sup>/);
    expect(html).toMatch(/<sup>7<\/sup>/);
    expect(html).toContain("Вес верификации");
    expect(html).toContain("положительных сигналов");
    expect(html).toContain("aria-expanded");
  });
});
