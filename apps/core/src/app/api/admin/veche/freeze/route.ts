import { NextRequest,NextResponse } from "next/server";
import { appBaseUrl,hasPrototypeAdminAccess } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";
import { recordFreezeWithDatabase } from "@/lib/veche-empty";
import { pool } from "@/lib/db";
export const runtime="nodejs";
export async function POST(request:NextRequest){
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(appBaseUrl()).origin)return new NextResponse('Forbidden',{status:403});
 const actor=await getCurrentParticipant();if(!actor)return new NextResponse('Unauthorized',{status:401});if(!hasPrototypeAdminAccess(actor.id))return new NextResponse('Forbidden',{status:403});
 const url=new URL('/admin/veche',appBaseUrl());
 try{
  const form=await request.formData(),action=form.get('action'),raw=String(form.get('expiresAt')??'');
  if(form.get('attest')!=='yes')throw Error('Confirmation required');
  if(action==='freeze'&&!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw))throw Error('Invalid expiry');
  await recordFreezeWithDatabase(pool,actor.id,String(form.get('source')??''),String(form.get('decision')??''),action,action==='freeze'?new Date(raw+':00+03:00'):null);
  url.searchParams.set('freeze','saved');
 }catch{url.searchParams.set('freeze','failed');}
 return NextResponse.redirect(url,303);
}
