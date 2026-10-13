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
beforeEach(()=>{vi.clearAllMocks();mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes("FROM award_batches")?[batch]:[]}));mocks.audience.mockResolvedValue({cities:[],interests:[],audience:[person],unknownDates:[]});});
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
 it("hides removed candidates, allows ordinary addition, and collapses personal text editors", async()=>{
  const candidate={id:"candidate",participant_id:"person",display_name:"Анна",source:"filter",status:"excluded",reason:"Saved reason",personal_address:"Saved address"};
  mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes("FROM award_batches")?[batch]:[candidate]}));
  let fields=props(await page({search:"1",joinedFrom:"2023-10-13"}));
  expect((fields.find(p=>p.action==="add_selected")?.rows as Array<{disabled:boolean}>)[0].disabled).toBe(false);
  expect(fields.some(p=>p.action==="remove_selected")).toBe(false);
  expect(fields.some(p=>p.defaultValue==="Saved address")).toBe(false);
  mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes("FROM award_batches")?[batch]:[{...candidate,status:"included"}]}));
  fields=props(await page());
  expect(fields.some(p=>p.action==="remove_selected")).toBe(true);
  const rows=fields.find(p=>p.action==="remove_selected")?.rows as Array<{details:ReactNode}>;
  const editor=props(rows[0].details);
  expect(editor.some(p=>p.defaultValue==="Saved address")).toBe(true);
  expect(editor.some(p=>p.name==="status"&&p.type==="hidden"&&p.value==="included")).toBe(true);
  expect(editor.some(p=>p.open===true)).toBe(false);
 });
 it("keeps unknown-date manual review separate from the selectable range matches",async()=>{
  mocks.audience.mockResolvedValue({cities:[],interests:[],audience:[person],unknownDates:[{id:"unknown",displayName:"Без даты",joinedOn:null}]});
  const fields=props(await page({search:"1",joinedFrom:"2023-10-13"}));
  expect(fields.some(p=>p.className==="muted" && p.children=== "Эти участники не являются совпадениями с диапазоном дат. После проверки используйте ручное добавление.")).toBe(true);
  expect((fields.find(p=>p.action==="add_selected")?.rows as Array<{id:string}>).map(p=>p.id)).toEqual(["person"]);
 });
 it("does not execute invalid ranges and never shows draft mutations on finalized batch",async()=>{
  expect(props(await page({search:"1",joinedFrom:"2024-04-14",joinedTo:"2024-04-13"})).some(p=>p.action==="add_selected")).toBe(false);
  expect(mocks.audience).toHaveBeenCalledTimes(1);
  mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes("FROM award_batches")?[{...batch,status:"finalized"}]:[]}));
  const fields=props(await page({search:"1"}));
  expect(fields.some(p=>p.value==="clear"||p.action==="add_selected"||p.action==="remove_selected"||p.method==="get")).toBe(false);
 });

 it("names what blocks the release and offers one reason for the whole batch",async()=>{
  const blank={id:"c1",participant_id:"person",display_name:"Анна",source:"filter",status:"included",reason:"",personal_address:""};
  mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes("FROM award_batches")?[batch]:[blank]}));
  let fields=props(await page());
  expect(fields.some(p=>p.name==="action"&&p.value==="fill_reason")).toBe(true);
  expect(fields.some(p=>p.children==="Нельзя завершить выпуск: не заполнено основание награждения. Таких участников в черновике: 1.")).toBe(true);
  expect(fields.some(p=>p.type==="submit"&&p.disabled===true)).toBe(true);
  const conflicted={...blank,reason:"Участник Первой волны",instance_id:"instance"};
  mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes("FROM award_batches")?[batch]:[conflicted]}));
  fields=props(await page());
  expect(fields.some(p=>typeof p.children==="string"&&String(p.children).includes("награда уже есть"))).toBe(true);
  expect(fields.some(p=>p.name==="action"&&p.value==="fill_reason")).toBe(false);
  const ready={...blank,reason:"Участник Первой волны"};
  mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes("FROM award_batches")?[batch]:[ready]}));
  fields=props(await page());
  expect(fields.some(p=>p.type==="submit"&&p.disabled===true)).toBe(false);
  expect(fields.some(p=>typeof p.children==="string"&&String(p.children).startsWith("Нельзя завершить выпуск"))).toBe(false);
 });
});
