import {telegramReceptionConfig} from "../src/lib/config";
import {receptionErrorCode} from "../src/lib/telegram-reception-relay";
const c=telegramReceptionConfig();
console.log(JSON.stringify({configured:{token:Boolean(c.token),webhookSecret:Boolean(c.webhookSecret),forum:Boolean(c.forumChatId),topic:c.topicId},username:c.botUsername}));
async function call(method:string,params:object={}){
 try {const response=await fetch(`https://api.telegram.org/bot${c.token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(params),signal:AbortSignal.timeout(5000)});
 const body=await response.json();if(body.ok!==true){console.log(JSON.stringify({method,errorCode:receptionErrorCode(body)}));return null;}return body.result;
 }catch{console.log(JSON.stringify({method,errorCode:'network_or_timeout',action:'Check production HTTPS egress to api.telegram.org:443'}));return null;}
}
if(!c.token)throw new Error('Reception token is not configured');
const me=await call('getMe');if(me)console.log(JSON.stringify({getMe:{id:me.id,username:me.username,canJoinGroups:me.can_join_groups,canReadAllGroupMessages:me.can_read_all_group_messages}}));
const redact=(value:string)=>[c.token,c.webhookSecret].filter((secret):secret is string=>Boolean(secret)).reduce<string>((text,secret)=>text.replaceAll(secret,'[redacted]'),value);
const webhook=await call('getWebhookInfo');if(webhook){const url=new URL(webhook.url||'https://unset.invalid');console.log(JSON.stringify({getWebhookInfo:{url:webhook.url?redact(url.origin+url.pathname):'',allowedUpdates:webhook.allowed_updates,pendingUpdateCount:webhook.pending_update_count,lastErrorDate:webhook.last_error_date,lastErrorMessage:typeof webhook.last_error_message==='string'?redact(webhook.last_error_message):undefined,maxConnections:webhook.max_connections}}));}
if(me&&c.forumChatId){const rights=await call('getChatMember',{chat_id:c.forumChatId,user_id:me.id});if(rights)console.log(JSON.stringify({forumRights:{status:rights.status,canSendMessages:rights.can_send_messages,canSendOtherMessages:rights.can_send_other_messages,canManageTopics:rights.can_manage_topics,isMember:rights.is_member}}));}
