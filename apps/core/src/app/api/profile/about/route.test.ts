import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(()=>({ participant:vi.fn(), interest:vi.fn(), signal:vi.fn(), bio:vi.fn(), remove:vi.fn(), archive:vi.fn(), addResource:vi.fn(), removeResource:vi.fn() }));
vi.mock("@/lib/session",()=>({getCurrentParticipant:mocks.participant}));
vi.mock("@/lib/config",()=>({appBaseUrl:()=>"http://localhost:3000"}));
vi.mock("@/lib/profile-about",()=>({addProfileInterest:mocks.interest,addProfileSignal:mocks.signal,updateProfileBio:mocks.bio,
  removeProfileInterest:mocks.remove,addProfileResource:mocks.addResource,removeProfileResource:mocks.removeResource,
  archiveProfileSignal:mocks.archive,ProfileAboutValidationError:class extends Error{}}));
import { POST } from "./route";
function request(action:string) { return new NextRequest("http://localhost:3000/api/profile/about",{method:"POST",body:new URLSearchParams({action,label:"Interest",kind:"have",body:"Offer",visibility:"members"})}); }
beforeEach(()=>{vi.resetAllMocks();mocks.participant.mockResolvedValue({id:"owner"});});
it.each(["add_interest","add_signal"])("redirects %s with the newly awarded ledger ID",async action=>{
  mocks.interest.mockResolvedValue({id:"interest-reward",amount:"0.1"});
  mocks.signal.mockResolvedValue({id:"have-reward",amount:"0.2"});
  const response = await POST(request(action));
  expect(response.headers.get("location")).toBe(`http://localhost:3000/profile?about_update=updated&onboarding_reward=${action==="add_interest"?"interest-reward":"have-reward"}`);
});
it("returns no reward confirmation for a repeated action",async()=>{
  expect((await POST(request("add_interest"))).headers.get("location")).toBe("http://localhost:3000/profile?about_update=updated");
});
it("does not write or expose quests to a guest",async()=>{
  mocks.participant.mockResolvedValue(null);
  expect((await POST(request("add_signal"))).headers.get("location")).toBe("http://localhost:3000/");
  expect(mocks.signal).not.toHaveBeenCalled();
});
it("preserves the legacy editor's kind, body and visibility contract",async()=>{
  await POST(request("add_signal"));
  expect(mocks.signal).toHaveBeenCalledWith("owner","have","Offer","members");
});
it("adds and removes resources only for the authenticated participant", async () => {
  const add = new NextRequest("http://localhost:3000/api/profile/about", { method:"POST", body:new URLSearchParams({action:"add_resource",url:"https://example.org/me"}) });
  const remove = new NextRequest("http://localhost:3000/api/profile/about", { method:"POST", body:new URLSearchParams({action:"remove_resource",resource_id:"10000000-0000-4000-8000-000000000001"}) });
  expect((await POST(add)).status).toBe(303);
  expect(mocks.addResource).toHaveBeenCalledWith("owner", "https://example.org/me");
  expect((await POST(remove)).status).toBe(303);
  expect(mocks.removeResource).toHaveBeenCalledWith("owner", "10000000-0000-4000-8000-000000000001");
});
it("does not add or remove a resource for a guest", async () => {
  mocks.participant.mockResolvedValue(null);
  const request = new NextRequest("http://localhost:3000/api/profile/about", { method:"POST", body:new URLSearchParams({action:"add_resource",url:"https://example.org"}) });
  await POST(request);
  expect(mocks.addResource).not.toHaveBeenCalled();
});
