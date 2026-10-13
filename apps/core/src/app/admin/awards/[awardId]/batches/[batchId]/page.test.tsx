import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { interfaceTextFields } from "../../../../../../lib/interface-texts";
const mocks=vi.hoisted(()=>({admin:vi.fn(),query:vi.fn(),audience:vi.fn()}));
vi.mock("@/lib/award-admin",()=>({requireAwardAdmin:mocks.admin,awardRouteId:(v:string)=>v}));
vi.mock("@/lib/db",()=>({pool:{query:mocks.query}}));
vi.mock("@/lib/interface-texts",()=>({readInterfaceTexts:async()=>({values:Object.fromEntries(interfaceTextFields.map(f=>[f.key,f.defaultValue]))})}));
vi.mock("@/lib/participant-audience",()=>({selectParticipantAudienceWithDatabase:mocks.audience,audienceConditions:[]}));
vi.mock("@/lib/award-batches",async()=>import("../../../../../../lib/award-batches"));
vi.mock("@/components/award-candidate-selection",()=>({AwardCandidateSelection:()=>null}));
vi.mock("@/components/admin-crumbs",()=>({AdminCrumbs:()=>null}));
vi.mock("@/components/award-content",()=>({AwardNotice:()=>null}));
vi.mock("@/components/award-link",()=>({AwardLink:()=>null}));
vi.mock("@/components/user-text",()=>({UserText:()=>null}));
vi.mock("@/components/local-date-time",()=>({LocalDateTime:()=>null}));
vi.mock("next/navigation",()=>({notFound:()=>{throw new Error("notFound");}}));
import Page from "./page";
function props(node:ReactNode):Record<string,unknown>[] {if(Array.isArray(node))return node.flatMap(props);if(!isValidElement(node))return [];const p=node.props as Record<string,unknown>;return[p,...props(p.children as ReactNode)];}
const batch={id:"batch",award_id:"award",name:"Награда",kind:"regular",status:"draft",created_at:new Date(),audience_rule:{}};
const person={id:"person",displayName:"Анна",joinedOn:"2023-10-13",joinedSource:"telegram_export",joinedApproximate:false};
beforeEach(()=>{vi.clearAllMocks();mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes("FROM award_batches")?[batch]:[]}));mocks.audience.mockResolvedValue({cities:[],interests:[],audience:[person]});});
const page=(query={})=>Page({params:Promise.resolve({awardId:"award",batchId:"batch"}),searchParams:Promise.resolve(query)});
describe("award draft candidate search",()=>{
 it("has read-only GET search and retains manual addition before search",async()=>{
  const fields=props(await page());
  expect(fields.some(p=>p.method==="get")).toBe(true);
  expect(fields.some(p=>p.name==="joinedFrom"&&p.type==="date")).toBe(true);
  expect(fields.some(p=>p.name==="joinedTo"&&p.type==="date")).toBe(true);
  expect(fields.some(p=>p.name==="action"&&p.value==="add")).toBe(true);
  expect(fields.some(p=>p.action==="add_selected")).toBe(false);
  for(const [sql] of mocks.query.mock.calls)expect(sql).toMatch(/^SELECT/);
 });
 it("shows checked selection component only after validated search with source/date",async()=>{
  const fields=props(await page({search:"1",joinedFrom:"2023-10-13",joinedTo:"2024-04-13"}));
  const selection=fields.find(p=>p.action==="add_selected");
  expect(selection?.rows).toEqual([{id:"person",name:"Анна",joinedOn:"2023-10-13",source:"Telegram: сообщение о вступлении",status:"Не добавлен",disabled:false}]);
  expect(selection?.filters).toContainEqual({name:"joinedFrom",value:"2023-10-13"});
  expect(mocks.audience).toHaveBeenLastCalledWith(expect.anything(),expect.objectContaining({joinedTo:"2024-04-13"}),"awards");
 });
 it("does not execute invalid ranges and never shows draft mutations on finalized batch",async()=>{
  expect(props(await page({search:"1",joinedFrom:"2024-04-14",joinedTo:"2024-04-13"})).some(p=>p.action==="add_selected")).toBe(false);
  expect(mocks.audience).toHaveBeenCalledTimes(1);
  mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes("FROM award_batches")?[{...batch,status:"finalized"}]:[]}));
  const fields=props(await page({search:"1"}));
  expect(fields.some(p=>p.value==="clear"||p.action==="add_selected"||p.action==="exclude_selected"||p.method==="get")).toBe(false);
 });
});
