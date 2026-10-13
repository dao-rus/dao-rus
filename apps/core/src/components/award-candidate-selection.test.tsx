import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { AwardCandidateSelection } from "./award-candidate-selection";
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
const rows=[{id:"a",participantId:"participant-a",name:"Анна",joinedOn:"2023-10-13",source:"Telegram",status:"Не добавлен"},{id:"b",participantId:"participant-b",name:"Борис",joinedOn:null,source:"Неизвестно",status:"Включён",disabled:true}];
const labels={name:"Участник",date:"Дата",source:"Источник",status:"Статус",unknown:"Дата неизвестна",selectAll:"Все",deselect:"Снять",selected:"Выбрано",submit:"Добавить",confirm:"Подтверждаю",empty:"Нет"};
async function render(action:"add_selected"|"remove_selected",check:(view:ReactTestRenderer)=>Promise<void>) {
 const env=globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?:boolean};const old=env.IS_REACT_ACT_ENVIRONMENT;env.IS_REACT_ACT_ENVIRONMENT=true;
 let view!:ReactTestRenderer;
 try {await act(async()=>{view=create(<AwardCandidateSelection batchId="batch" action={action} rows={rows} filters={[{name:"joinedFrom",value:"2023-10-13"}]} labels={labels}/>);});await check(view);}
 finally {if(view)await act(async()=>view.unmount());env.IS_REACT_ACT_ENVIRONMENT=old;}
}
describe("candidate checkbox selection",()=>{
 it("selects only available rows, counts choices and resets without submitting",async()=>render("add_selected",async view=>{
  const submit=()=>view.root.findAllByType("button").find(b=>b.props.type==="submit")!;
  expect(submit().props.disabled).toBe(true);
  await act(async()=>view.root.findAllByType("button").find(b=>b.children[0]==="Все")!.props.onClick());
  const checks=view.root.findAllByType("input").filter(i=>i.props.type==="checkbox");
  expect(checks.map(c=>c.props.checked)).toEqual([true,false]);expect(submit().props.disabled).toBe(false);
  expect(view.root.findByType("output").children.join("")).toBe("Выбрано: 1");
  expect(view.root.findByProps({name:"joinedFrom"}).props.value).toBe("2023-10-13");
  expect(view.root.findAllByType("a").map(link=>link.props.href)).toEqual(["/profile/participant-a","/profile/participant-b"]);
  await act(async()=>view.root.findAllByType("button").find(b=>b.children[0]==="Снять")!.props.onClick());
  expect(submit().props.disabled).toBe(true);
  await act(async()=>checks[0].props.onChange({target:{checked:true}}));expect(submit().props.disabled).toBe(false);
 }));
 it("requires explicit confirmation for removal and uses native labelled controls",async()=>render("remove_selected",async view=>{
  expect(view.root.findByProps({name:"confirm"}).props.required).toBe(true);
  expect(view.root.findByProps({name:"candidateIds",value:"a"}).parent?.type).toBe("label");
  expect(view.root.findByType("form").props.method).toBe("post");
  expect(view.root.findByProps({name:"candidateIds",value:"a"}).props.form).toBe(view.root.findByType("form").props.id);
 }));
});
