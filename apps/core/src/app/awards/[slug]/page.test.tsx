import { describe,expect,it,vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const mocks=vi.hoisted(()=>({publicAward:vi.fn()}));
vi.mock("@/lib/award-views",()=>({getPublicAward:mocks.publicAward}));
vi.mock("@/lib/interface-texts",async()=>{const m=await import("../../../lib/interface-texts");return {readInterfaceTexts:async()=>({values:Object.fromEntries(m.interfaceTextFields.map(f=>[f.key,f.defaultValue]))})};});
vi.mock("@/components/award-content",async()=>import("../../../components/award-content"));
vi.mock("next/navigation",()=>({notFound:()=>{throw new Error("NOT_FOUND")}}));
import Page from "./page";
describe("anonymous award page",()=>{
  it("renders public information and opted-in names without any recipient notes, refusal history or session",async()=>{
    mocks.publicAward.mockResolvedValue({award:{id:"award",name:"First wave",slug:"wave",imageUrl:"/test.png",establishedOn:"2026-10-07",description:"Public description",criterion:"Public criterion",publicAddress:"Public greeting",kind:"historical",historicalCutoffAt:null,reason:"PRIVATE_REASON",personalAddress:"PRIVATE_ADDRESS",rejectedAt:new Date()},recipients:[{id:"person",name:"Public recipient",reason:"PRIVATE_REASON",personalAddress:"PRIVATE_ADDRESS"}]});
    const html=renderToStaticMarkup(await Page({params:Promise.resolve({slug:"wave"})}));
    expect(html).toContain("ДАО Русь");expect(html).toContain("Public greeting");expect(html).toContain("Public recipient");expect(html).not.toContain("PRIVATE");expect(html).not.toContain("rejectedAt");
  });
});
