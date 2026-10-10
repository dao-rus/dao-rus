import {wizardValues,invalidWizardStep,wizardDeadline,wizardHref,readCallAvailability} from "@/lib/veche-presentation";
import {pool} from "@/lib/db";
import { createPaidCall } from "@/lib/veche-finance";
import { afterPollCalled } from "@/lib/veche-announcement";
import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";
import { createSignatureCall } from "@/lib/veche-signatures";
import { afterSignatureCallChanged } from "@/lib/veche-announcement";
import type { PollConfig } from "@/lib/veche-polls";
export const runtime="nodejs";
export async function POST(request:NextRequest){
 const origin=request.headers.get("origin");
 if(origin&&origin!==new URL(appBaseUrl()).origin)return new NextResponse("Forbidden",{status:403});
 const participant=await getCurrentParticipant();
 if(!participant)return new NextResponse("Unauthorized",{status:401});
 let url=new URL("/veche",appBaseUrl());
 try{
   const form=await request.formData();
   let wizard:ReturnType<typeof wizardValues>|null=null;
   if(form.get('wizard')==='yes'){
    wizard=wizardValues(Object.fromEntries([...form.entries()].map(([k,v])=>[k,String(v)])));
    const available=await readCallAvailability(pool,participant.id);
    const invalid=invalidWizardStep(wizard,5,available.quotes.map(q=>q.circle));
    if(invalid)return NextResponse.redirect(new URL(wizardHref(wizard,invalid,{error:'1'}),appBaseUrl()),303);
    url=new URL(wizardHref(wizard,6,{error:'create'}),appBaseUrl());
   }
   const deadline=wizard?wizardDeadline(wizard):form.get("timing")==="permanent"?null:new Date(String(form.get("deadline"))+"+03:00");
   const paid=form.get("path")==="paid";
   const proposal=await (paid?createPaidCall:createSignatureCall)(participant.id,form.get("title"),form.get("body"),{circle:form.get("circle") as PollConfig["circle"],mode:form.get("mode") as PollConfig["mode"],deadline,authorVisibility:form.get("authorVisibility")==="anonymous"?"anonymous":"public"});
   if(paid)await afterPollCalled(proposal.id);else await afterSignatureCallChanged(proposal.id);
   url=new URL(`/veche/${proposal.id}`,appBaseUrl());
 }catch{if(url.pathname!=="/veche/new")url.searchParams.set("call","failed");}
 return NextResponse.redirect(url,303);
}
