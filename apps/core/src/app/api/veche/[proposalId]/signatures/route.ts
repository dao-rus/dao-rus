import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";
import { setSignature } from "@/lib/veche-signatures";
import { validPollId } from "@/lib/veche-polls";
import { afterSignatureCallChanged } from "@/lib/veche-announcement";
export const runtime="nodejs";
export async function POST(request:NextRequest,{params}:{params:Promise<{proposalId:string}>}){
 const origin=request.headers.get("origin");
 if(origin&&origin!==new URL(appBaseUrl()).origin)return new NextResponse("Forbidden",{status:403});
 const participant=await getCurrentParticipant();if(!participant)return new NextResponse("Unauthorized",{status:401});
 const {proposalId}=await params;if(!validPollId(proposalId))return new NextResponse("Not found",{status:404});
 const url=new URL(`/veche/${proposalId}`,appBaseUrl());
 try{
   const form=await request.formData();const support=form.get("support");
   if(support!=="on"&&support!=="off")throw new Error("Invalid support");
   await setSignature(proposalId,participant.id,support==="on");
   await afterSignatureCallChanged(proposalId);
   url.searchParams.set("signature","saved");
 }catch{url.searchParams.set("signature","failed");}
 return NextResponse.redirect(url,303);
}
