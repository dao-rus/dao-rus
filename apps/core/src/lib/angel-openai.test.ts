import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { AngelValidationError } from "./angel";
import { ANGEL_MODEL, AngelProviderError, OpenAIAngelProvider } from "./angel-openai";

const types = [{ key: "skill", title: "Умею" }];
const compose = { operation: "compose_signal", typeKey: "skill", label: "SQL", description: null };
const search = { operation: "search_exchange", typeKeys: ["skill"], terms: ["SQL"] };
function completed(result: unknown) {
  return { status: "completed", error: null, incomplete_details: null,
    output: [{ type: "message", status: "completed", content: [{ type: "output_text", text: JSON.stringify(result) }] }],
    output_text: JSON.stringify(result) };
}
function setup(response: unknown) {
  const create = vi.fn().mockResolvedValue(response);
  return { create, provider: new OpenAIAngelProvider({ responses: { create } } as unknown as OpenAI) };
}

describe("OpenAI Angel adapter without network calls", () => {
  it.each(["compose", "search"] as const)("accepts a completed strict %s interpretation", async (operation) => {
    const result = operation === "compose" ? compose : search;
    const { create, provider } = setup(completed({ result }));
    await expect(provider[operation]({ text: "Ищу SQL-разработчика", types })).resolves.toEqual(result);
    const [request, options] = create.mock.calls[0];
    expect(request).toMatchObject({ model: ANGEL_MODEL, reasoning: { effort: "low" }, text: { format: { type: "json_schema", strict: true } } });
    expect(request.model).toBe("gpt-5.6-terra");
    expect(request.tools).toBeUndefined(); expect(request).not.toHaveProperty("previous_response_id");
    expect(request.input).toEqual([{ role: "developer", content: expect.stringContaining(JSON.stringify(types)) }, { role: "user", content: "Ищу SQL-разработчика" }]);
    expect(request.input[0].content).toContain("out_of_scope");
    expect(request.text.format.schema).toMatchObject({ type: "object", additionalProperties: false, required: ["result"], properties: { result: { anyOf: expect.any(Array) } } });
    expect(request.text.format.schema).not.toHaveProperty("anyOf");
    expect(options).toEqual({ timeout: 12000, maxRetries: 0 });
  });
  it.each(["compose", "search"] as const)("normalizes completed model denial for %s", async (operation) => {
    const { provider } = setup(completed({ result: { operation: "out_of_scope" } }));
    await expect(provider[operation]({ text: "Как погода?", types })).resolves.toEqual({ operation: "out_of_scope" });
  });
  it.each([
    { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
    { status: "incomplete", incomplete_details: { reason: "content_filter" } },
    { status: "failed", error: { code: "server_error" } },
    { status: "in_progress" }, { status: "cancelled" }, { status: undefined },
    { status: "completed", error: { code: "server_error" } },
    { status: "completed", incomplete_details: { reason: "content_filter" } },
  ])("never parses even valid text from a noncompleted/failed response: %s", async (override) => {
    const { provider } = setup({ ...completed({ result: compose }), ...override });
    await expect(provider.compose({ text: "Умею SQL", types })).rejects.toMatchObject({ kind: "unavailable" });
  });
  it("checks refusal content even if output_text also contains valid JSON", async () => {
    const { provider } = setup({ ...completed({ result: compose }), output: [{ type: "message", status: "completed", content: [{ type: "refusal", refusal: "No" }] }] });
    await expect(provider.compose({ text: "Умею SQL", types })).rejects.toMatchObject({ kind: "refusal" });
  });
  it.each([
    { ...completed({ result: compose }), output_text: "{" },
    { ...completed({ result: compose }), output_text: "" },
    { ...completed({ result: compose }), output: [{ type: "function_call", name: "write" }] },
    { ...completed({ result: compose }), output: [{ type: "message", status: "incomplete", content: [] }] },
  ])("rejects malformed/empty structured text and unexpected output actions", async (response) => {
    await expect(setup(response).provider.compose({ text: "Умею SQL", types })).rejects.toMatchObject({ kind: "invalid_response" });
  });
  it.each([
    compose, { result: compose, action: "write" }, { result: compose, operation: "out_of_scope" },
    { result: { ...compose, extra: true } }, { result: { ...compose, operation: "delete_signal" } },
    { result: { ...compose, typeKey: null } }, { result: { ...compose, typeKey: 3 } },
    { result: { ...compose, typeKey: "bad key" } }, { result: { ...compose, typeKey: "disabled" } },
    { result: { ...compose, label: {} } }, { result: { ...compose, description: 5 } },
    { result: { operation: "out_of_scope", action: "write" } },
    { result: search }, null,
  ])("fails closed without dropping envelope or result fields", async (envelope) => {
    await expect(setup(completed(envelope)).provider.compose({ text: "Умею SQL", types })).rejects.toBeInstanceOf(AngelValidationError);
  });
  it("checks malformed search keys at the adapter boundary", async () => {
    await expect(setup(completed({ result: { ...search, typeKeys: [null] } })).provider.search({ text: "Ищу SQL", types })).rejects.toBeInstanceOf(AngelValidationError);
  });
  it("maps SDK timeout and network errors without retaining provider details", async () => {
    const { create, provider } = setup(null);
    create.mockRejectedValue(new OpenAI.APIConnectionTimeoutError());
    await expect(provider.compose({ text: "Умею SQL", types })).rejects.toMatchObject({ kind: "timeout", message: "Angel provider failed" });
    create.mockRejectedValue(new Error("secret provider detail"));
    await expect(provider.search({ text: "Ищу SQL", types })).rejects.toEqual(new AngelProviderError("unavailable"));
  });
});
