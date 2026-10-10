import {telegramReceptionConfig} from "./config";
import {deterministicReceptionFailure,receptionRelayBot,type ReceptionRelayBot,type ReceptionRelayDatabase} from "./telegram-reception-relay";

export type RecoveryRow={update_id:string;direction:string;forum_chat_id:string;private_chat_id:string;
  private_message_id:string|null;forum_message_id:string|null;forum_heading_message_id:string|null;
  status:string;error_code:string|null;updated_at:Date;recovery_version:string};

// Operator selects a single row. A CAS claims it; neither webhook duplicates nor another operator can resend it.
// Pending/ambiguous outcomes need human verification that Telegram did not deliver, not just an elapsed timeout.
export async function recoverReceptionDelivery(row:RecoveryRow,db:ReceptionRelayDatabase,
  options:{confirmedNotDelivered?:boolean;senderLabel?:string},bot?:ReceptionRelayBot):Promise<string>{
  const config=telegramReceptionConfig();
  if(!config.token||!config.forumChatId||!config.topicId||config.forumChatId!==String(row.forum_chat_id))throw new Error("Recovery target differs from current Reception configuration");
  const topic=Number(config.topicId);if(!Number.isSafeInteger(topic)||topic<1)throw new Error("Invalid Reception topic");
  if(!['private_to_forum','forum_to_private'].includes(row.direction))throw new Error("Invalid recovery direction");
  if(row.status==='sent'||row.status==='unsupported')return 'not_recoverable';
  if(!['pending','failed'].includes(row.status))throw new Error("Invalid recovery state");
  const age=Date.now()-new Date(row.updated_at).getTime();
  if(!Number.isFinite(age)||age<15_000)throw new Error("Delivery may still be active; wait at least 15 seconds");
  if((row.status==='pending'||!deterministicReceptionFailure(row.error_code))&&!options.confirmedNotDelivered)
    throw new Error("Ambiguous delivery: confirm absence in Telegram before recovery");
  const retryAfter=Number(/_retry_after_(\d+)$/.exec(row.error_code??'')?.[1]??0);
  if(age<retryAfter*1000)throw new Error("Telegram retry_after has not elapsed");
  const source=row.direction==='private_to_forum'?row.private_message_id:row.forum_message_id;
  if(!source||!/^\d+$/.test(source)||!Number.isSafeInteger(Number(source)))throw new Error("Missing valid source message ID; sender must resend");
  const name=options.senderLabel?.trim().replace(/\s+/gu,' ');
  if(row.direction==='private_to_forum'&&!row.forum_heading_message_id&&(!name||name.length>400))throw new Error("Verified sender label is required for private message recovery");
  if(!row.recovery_version)throw new Error('Missing exact PostgreSQL recovery version');
  const claim=await db.query(`UPDATE reception_relay_updates SET status='pending',error_code='recovery_in_progress',updated_at=now()
    WHERE update_id=$1 AND status=$2 AND error_code IS NOT DISTINCT FROM $3 AND updated_at=$4::timestamptz RETURNING update_id`,
    [row.update_id,row.status,row.error_code,row.recovery_version]);
  if(!claim.rowCount)return 'already_claimed';
  const relay=bot??receptionRelayBot(config.token);let heading=row.forum_heading_message_id;
  const fail=async(code:string)=>{await db.query(`UPDATE reception_relay_updates SET status='failed',error_code=$2,updated_at=now()
    WHERE update_id=$1 AND status='pending' AND error_code='recovery_in_progress'`,[row.update_id,code]);
    console.error(JSON.stringify({event:'reception_recovery_failed',updateId:row.update_id,errorCode:code}));return 'failed';};
  if(row.direction==='private_to_forum'&&!heading){
    const result=await relay.sendAttribution({chatId:config.forumChatId,text:`От: ${name}`, ...(topic===1?{}:{topicId:topic})});
    if(result.status==='failed')return fail('attribution_'+result.errorCode);
    heading=String(result.messageId);
    await db.query(`UPDATE reception_relay_updates SET forum_heading_message_id=$2,updated_at=now()
      WHERE update_id=$1 AND status='pending' AND error_code='recovery_in_progress'`,[row.update_id,heading]);
  }
  const result=await relay.copyMessage({chatId:row.direction==='private_to_forum'?config.forumChatId:String(row.private_chat_id),
    fromChatId:row.direction==='private_to_forum'?String(row.private_chat_id):config.forumChatId,messageId:Number(source),
    ...(row.direction==='private_to_forum'&&topic!==1?{topicId:topic}:{})});
  if(result.status==='failed')return fail(result.errorCode);
  const saved=await db.query(`UPDATE reception_relay_updates SET status='sent',error_code=NULL,
    private_message_id=COALESCE(private_message_id,$2::bigint),forum_message_id=COALESCE(forum_message_id,$3::bigint),
    updated_at=now() WHERE update_id=$1 AND status='pending' AND error_code='recovery_in_progress'`,
    [row.update_id,row.direction==='forum_to_private'?result.messageId:null,row.direction==='private_to_forum'?result.messageId:null]);
  if(saved.rowCount!==1)throw new Error('Telegram accepted delivery but mapping changed; verify Telegram before any recovery');
  return 'sent';
}
