import { NextRequest,NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";
import { validPollId } from "@/lib/veche-polls";
import { setEmptyMark } from "@/lib/veche-empty";
export const runtime="nodejs";
export async function POST(request:NextRequest,{params}:{params:Promise<{proposalId:string}>}){
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(appBaseUrl()).origin)return new NextResponse('Forbidden',{status:403});
 const actor=await getCurrentParticipant();if(!actor)return new NextResponse('Unauthorized',{status:401});
 const {proposalId}=await params;if(!validPollId(proposalId))return new NextResponse('Not found',{status:404});
 const url=new URL(`/veche/${proposalId}`,appBaseUrl());
 try{const form=await request.formData(),mark=form.get('mark');if(mark!=='on'&&mark!=='off')throw Error('Invalid mark');await setEmptyMark(proposalId,actor.id,mark==='on');url.searchParams.set('outcome','saved');}catch{url.searchParams.set('outcome','failed');}
 return NextResponse.redirect(url,303);
}
