import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(), createCommunityPost: vi.fn(), deleteCommunityPost: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/config", () => ({ appBaseUrl: () => "https://core.example.org" }));
vi.mock("@/lib/communities", () => ({
  communityFromParams: (params: { interest?: string }) => params.interest
    ? { type: "interest", interest: params.interest } : null,
  communityHref: (community: { interest: string }) => `/participants?interest=${encodeURIComponent(community.interest)}`,
  CommunityMembershipError: class CommunityMembershipError extends Error {},
  CommunityPostValidationError: class CommunityPostValidationError extends Error {},
  createCommunityPost: mocks.createCommunityPost,
  deleteCommunityPost: mocks.deleteCommunityPost,
}));

import { POST } from "./route";

function request(fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  return new NextRequest("https://core.example.org/api/community/posts", {
    method: "POST", body,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
}

describe("community posts route", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.getCurrentParticipant.mockResolvedValue({ id: "owner" }); });

  it("uses the signed-in author for creation", async () => {
    const response = await POST(request({ community: "/participants?interest=история", body: "Текст" }));
    expect(response.status).toBe(303);
    expect(mocks.createCommunityPost).toHaveBeenCalledWith({ type: "interest", interest: "история" }, "owner", "Текст");
  });

  it("passes deletion through the owner-scoped operation", async () => {
    await POST(request({ community: "/participants?interest=история", action: "delete", post_id: "post" }));
    expect(mocks.deleteCommunityPost).toHaveBeenCalledWith({ type: "interest", interest: "история" }, "owner", "post");
  });

  it("does not write when unauthenticated or given a noncommunity return path", async () => {
    mocks.getCurrentParticipant.mockResolvedValueOnce(null);
    expect((await POST(request({ community: "/participants?interest=история", body: "Текст" }))).status).toBe(303);
    expect((await POST(request({ community: "https://other.example/", body: "Текст" }))).status).toBe(303);
    expect(mocks.createCommunityPost).not.toHaveBeenCalled();
  });
});
