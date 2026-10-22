import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ current: vi.fn(), mark: vi.fn() }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.current }));
vi.mock("@/lib/config", () => ({ appBaseUrl: () => "https://core.example" }));
vi.mock("@/lib/code-comment-reads", () => ({ markCodeCommentsRead: mocks.mark }));
import { POST } from "./route";
const id = "10000000-0000-4000-8000-000000000001";
function request(origin: string, body: unknown) {
  return new NextRequest("http://internal/api/code/reads", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
}
describe("Code comment reads endpoint", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.current.mockResolvedValue({ id }); });
  it("uses the authenticated participant and only supplied IDs", async () => {
    expect((await POST(request("https://core.example", [id]))).status).toBe(204);
    expect(mocks.mark).toHaveBeenCalledWith(id, [id]);
  });
  it("rejects foreign origins, malformed IDs and guests", async () => {
    expect((await POST(request("https://evil.example", [id]))).status).toBe(403);
    expect((await POST(request("https://core.example", ["bad"]))).status).toBe(400);
    mocks.current.mockResolvedValue(null);
    expect((await POST(request("https://core.example", [id]))).status).toBe(401);
    expect(mocks.mark).not.toHaveBeenCalled();
  });
});
