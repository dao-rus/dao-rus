import {pool} from "../src/lib/db";
import {telegramReceptionConfig} from "../src/lib/config";
import {recoverReceptionDelivery,type RecoveryRow} from "../src/lib/reception-recovery";

async function main(){

const args=process.argv.slice(2),apply=args.includes('--apply'),confirmedNotDelivered=args.includes('--confirmed-not-delivered');
const updateId=args[args.indexOf('--update')+1];
if(!args.includes('--update')||!/^\d+$/.test(updateId??''))throw new Error('Usage: reception-recovery.ts --update <ID> [--apply] [--confirmed-not-delivered]');
try {
 const r=await pool.query('SELECT *,updated_at::text AS recovery_version FROM reception_relay_updates WHERE update_id=$1',[updateId]);
 const row=r.rows[0] as RecoveryRow|undefined;if(!row)throw new Error('Relay entry not found');
 console.log(JSON.stringify({updateId,direction:row.direction,status:row.status,errorCode:row.error_code,updatedAt:row.updated_at,apply}));
 if(apply){
  let senderLabel:string|undefined;
  if(row.direction==='private_to_forum'&&!row.forum_heading_message_id){
   const {token}=telegramReceptionConfig();
   const response=await fetch(`https://api.telegram.org/bot${token}/getChat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:row.private_chat_id}),signal:AbortSignal.timeout(5000)});
   const body=await response.json();if(body.ok!==true||body.result?.type!=='private'||String(body.result.id)!==String(row.private_chat_id))throw new Error('Cannot verify original sender; no delivery attempted');
   senderLabel=[body.result.first_name,body.result.last_name].filter(x=>typeof x==='string').join(' ');
   if(typeof body.result.username==='string')senderLabel+=` (@${body.result.username})`;
  }
  console.log(JSON.stringify({updateId,result:await recoverReceptionDelivery(row,pool,{confirmedNotDelivered,senderLabel})}));
 }
}catch(error){console.error(error instanceof Error?error.message:'Recovery failed');process.exitCode=1;}
finally {await pool.end();}
}
main().catch(error=>{const message=error instanceof Error?error.message:"";console.error(message.startsWith("Usage:")||message==="Reception token is not configured"?message:"Reception CLI failed; check configuration and database connectivity");process.exitCode=1;});
