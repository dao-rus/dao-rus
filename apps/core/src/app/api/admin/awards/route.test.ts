import { beforeEach,describe,expect,it,vi } from "vitest";
import { NextRequest } from "next/server";
const mocks=vi.hoisted(()=>({current:vi.fn(),capability:vi.fn(),establish:vi.fn(),images:vi.fn()}));
vi.mock("@/lib/session",()=>({getCurrentParticipant:mocks.current}));
vi.mock("@/lib/award-access",()=>({hasAwardCapability:mocks.capability}));
vi.mock("@/lib/awards",async()=>({...await import("../../../../lib/awards"),establishAward:mocks.establish}));
vi.mock("@/lib/award-images",()=>({prepareAwardImages:mocks.images}));
vi.mock("@/lib/award-http",async()=>import("../../../../lib/award-http"));
import {POST} from "./route";
const id="10000000-0000-4000-8000-000000000001";
const request=()=>new NextRequest("http://localhost:3000/api/admin/awards",{method:"POST",headers:{origin:"http://localhost:3000"},body:new URLSearchParams({actorId:"attacker"})});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("APP_BASE_URL","http://localhost:3000");mocks.current.mockResolvedValue({id});mocks.capability.mockReturnValue(false);});
describe("award institution authorization",()=>{
  it("session alone and technical administrator do not confer award authority",async()=>{
    vi.stubEnv("ADMIN_PARTICIPANT_IDS",id);
    expect((await POST(request())).status).toBe(403);
    expect(mocks.establish).not.toHaveBeenCalled();expect(mocks.images).not.toHaveBeenCalled();
  });
  it("requires session before parsing upload",async()=>{mocks.current.mockResolvedValue(null);expect((await POST(request())).status).toBe(401);expect(mocks.capability).not.toHaveBeenCalled();});
  it("uses configured capability and session actor for an uploaded award",async()=>{
    mocks.capability.mockReturnValue(true);mocks.images.mockResolvedValue({original:Buffer.from([1]),thumbnail:Buffer.from([2])});mocks.establish.mockResolvedValue({id});
    const form=new FormData();form.set("image",new File(["image"],"award.png"));form.set("actorId","attacker");form.set("name","Test");
    const response=await POST(new NextRequest("http://localhost:3000/api/admin/awards",{method:"POST",headers:{origin:"http://localhost:3000"},body:form}));
    expect(response.status).toBe(303);expect(mocks.capability).toHaveBeenCalledWith(id,"award.establish");expect(mocks.establish.mock.calls[0][0]).toBe(id);
  });
});
