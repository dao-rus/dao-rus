import {spawnSync} from "node:child_process";
import {expect,it} from "vitest";
it('Reception CLI loads with production tsx invocation and safely rejects missing configuration/arguments',()=>{
 const env={...process.env,TELEGRAM_RECEPTION_BOT_TOKEN:'',TELEGRAM_RECEPTION_WEBHOOK_SECRET:'',TELEGRAM_FORUM_CHAT_ID:'',TELEGRAM_RECEPTION_TOPIC_ID:''};
 for(const [script,message] of [['reception-diagnostics.ts','Reception token is not configured'],['reception-recovery.ts','Usage: reception-recovery.ts']] as const){
  const result=spawnSync(process.execPath,['--import','tsx','scripts/'+script],{cwd:process.cwd(),env,encoding:'utf8',timeout:15000,windowsHide:true});
  expect(result.status).toBe(1);expect(result.stderr).toContain(message);expect(result.stderr).not.toContain('Transform failed');
 }
});
