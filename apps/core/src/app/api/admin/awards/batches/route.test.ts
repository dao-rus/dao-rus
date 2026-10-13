import { NextRequest } from "next/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({actor:vi.fn(),capability:vi.fn(),query:vi.fn(),add:vi.fn(),exclude:vi.fn(),finalize:vi.fn()}));
vi.mock("@/lib/session",()=>({getCurrentParticipant:mocks.actor}));
vi.mock("@/lib/award-access",()=>({hasAwardCapability:mocks.capability}));
vi.mock("@/lib/db",()=>({pool:{query:mocks.query}}));
vi.mock("@/lib/awards",async()=>import("../../../../../lib/awards"));
vi.mock("@/lib/award-batches",async()=>({...await import("../../../../../lib/award-batches"),addSelectedAwardCandidates:mocks.add,excludeAwardCandidates:mocks.exclude,finalizeAwardBatch:mocks.finalize}));
vi.mock("@/lib/award-http",async()=>import("../../../../../lib/award-http"));
vi.mock("@/lib/interface-texts",()=>({readInterfaceTexts:vi.fn()}));
import { POST } from "./route";
const actor="10000000-0000-4000-8000-000000000001",batch="20000000-0000-4000-8000-000000000002",award="30000000-0000-4000-8000-000000000003";
const request=(action:string,extras:Record<string,string>={})=>new NextRequest("http://localhost:3000/api/admin/awards/batches",{method:"POST",headers:{origin:"http://localhost:3000"},body:new URLSearchParams({action,batchId:batch,...extras})});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("APP_BASE_URL","http://localhost:3000");mocks.actor.mockResolvedValue({id:actor});mocks.capability.mockReturnValue(true);mocks.query.mockResolvedValue({rowCount:1,rows:[{award_id:award}]});});
afterEach(()=>vi.unstubAllEnvs());
describe("draft selection POST",()=>{
 it("requires confirmation before clear and bulk exclusion",async()=>{
  await POST(request("clear")); await POST(request("remove_selected",{candidateIds:actor}));
  expect(mocks.exclude).not.toHaveBeenCalled(); expect(mocks.finalize).not.toHaveBeenCalled();
  const response=await POST(request("clear",{confirm:"on"}));
  expect(mocks.exclude).toHaveBeenCalledWith(actor,batch,null);
  expect(response.headers.get("location")).toBe(`http://localhost:3000/admin/awards/${award}/batches/${batch}?award_update=saved`);
 });
 it("forwards selected people and filters with the session actor",async()=>{
  const response = await POST(request("add_selected",{participantIds:actor,joinedFrom:"2023-10-13",joinedTo:"2024-04-13",actorId:"attacker"}));
  const redirect = new URL(response.headers.get("location")!);
  expect(redirect.searchParams.get("joinedFrom")).toBe("2023-10-13");
  expect(redirect.searchParams.get("joinedTo")).toBe("2024-04-13");
  expect(redirect.searchParams.get("search")).toBe("1");
  expect(mocks.add).toHaveBeenCalledWith(actor,batch,[actor],expect.objectContaining({joinedFrom:"2023-10-13",joinedTo:"2024-04-13"}));
  expect(mocks.finalize).not.toHaveBeenCalled();
  await POST(request("remove_selected",{candidateIds:actor,confirm:"on"}));
  expect(mocks.exclude).toHaveBeenCalledWith(actor,batch,[actor]);
 });
 it("denies guests, technical admins without Founder capability and cross-origin writes",async()=>{
  mocks.actor.mockResolvedValue(null); expect((await POST(request("clear",{confirm:"on"}))).status).toBe(401);
  mocks.actor.mockResolvedValue({id:actor});mocks.capability.mockReturnValue(false);expect((await POST(request("clear",{confirm:"on"}))).status).toBe(403);
  const req=request("clear",{confirm:"on"});req.headers.set("origin","https://evil.example");expect((await POST(req)).status).toBe(403);
  expect(mocks.exclude).not.toHaveBeenCalled();
 });
});
