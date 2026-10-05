import { randomBytes } from "node:crypto";
import type { ArchiveParticipant, previewDepartureArchive, summarizeDepartureArchive, departureReviewModel } from "./telegram-departure-archive";

export type DepartureReviewPageData = {
  model_version: typeof departureReviewModel; source_channel: string; archive_sha256: string;
  summary: ReturnType<typeof summarizeDepartureArchive>;
  rows: ReturnType<typeof previewDepartureArchive>; participants: ArchiveParticipant[];
  images: Record<string, string[]>;
};

export function renderDepartureReviewHtml(data: DepartureReviewPageData): string {
  const nonce = randomBytes(16).toString("hex");
  // The page needs current collision data, not stable IDs or retained profile history.
  const pageData = { ...data, participants: data.participants.map(p => ({ id: p.id, display_name: p.display_name,
    usernames: [...new Set([...p.usernames, ...(p.identity_evidence ?? []).filter(e => e.kind === "username" && ["external_identities.username", "telegram_roster_entries.username"].includes(e.source)).map(e => e.value)])],
    reconstructed_archived_usernames: p.reconstructed_archived_usernames ?? [] })) };
  const json = JSON.stringify(pageData).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>Архив убытия — проверка usernames</title>
<style nonce="${nonce}">
*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,sans-serif;color:#21392e;background:#eef2ee}header{background:#173b32;color:white;padding:24px}h1{margin:0;font-size:26px}.toolbar{position:sticky;top:0;background:white;padding:12px 24px;border-bottom:1px solid #c5d4ca;display:flex;gap:12px;align-items:center;flex-wrap:wrap;z-index:2}main{max-width:1250px;margin:24px auto;padding:0 20px}article{background:white;border:1px solid #c5d4ca;border-radius:12px;padding:20px;margin:20px 0;display:grid;grid-template-columns:minmax(250px,38%) 1fr;gap:24px}article.confirmed{border:2px solid #338a59}article.unresolved{border-style:dashed}.screens img{max-width:100%;max-height:720px;object-fit:contain;display:block;margin:0 auto 12px}h2{margin:0;font-size:21px}h3{font-size:16px;margin-bottom:6px}button,select,input{font:inherit;padding:8px 12px;border:1px solid #a9bdb0;border-radius:6px;background:#f5f8f6;color:#173b32}input{display:block;width:100%;background:white;margin:5px 0 12px}button{cursor:pointer;margin:4px 6px 4px 0}button.primary{background:#225b45;color:white}.proposal{border:1px solid #d9e1dc;border-radius:8px;padding:10px;margin:8px 0}.id{font:13px ui-monospace,monospace;overflow-wrap:anywhere}.decision{font-weight:600}.warning{color:#865419}pre{white-space:pre-wrap;word-break:break-word;font-size:13px;background:#f5f7f5;padding:12px}.upload input{display:none}#progress{margin-left:auto}@media(max-width:750px){article{grid-template-columns:1fr}.toolbar{position:static}#progress{margin-left:0}}
</style></head><body>
<header><h1>Архив убытия · подтверждение исторического @username</h1><p>Проверьте username на скриншоте. OCR — только подсказка. Отсутствие в текущем Core ожидаемо.</p><p>Подтверждённый username позволит создать минимального исторического Participant со статусом left. Повторы используют одного Participant, даты событий остаются отдельными. Telegram identity не создаётся.</p><p>Эта страница только скачивает reviewed mapping JSON. Никакие данные в Core не записываются.</p></header>
<div class="toolbar"><label>Показать <select id="filter"><option value="all">Все записи</option><option value="pending">Не проверены</option><option value="confirmed">Подтверждены</option><option value="unresolved">Неразрешённые</option><option value="existing_current_username_match">Совпадения с текущим Core</option><option value="unresolved_no_username">Без username</option></select></label><button id="download" class="primary">Скачать reviewed mapping JSON</button><label class="upload">Продолжить из JSON<input id="resume" type="file" accept=".json,application/json"></label><span id="progress"></span></div>
<main><p id="totals"></p><p class="warning">Числа в прогнозе включают неподтверждённые OCR-подсказки. При нескольких usernames в записи нужно выбрать username ушедшего участника; прогноз может уменьшиться после проверки.</p><p id="notice" role="status"></p><div id="entries"></div></main>
<script nonce="${nonce}" id="review-data" type="application/json">${json}</script>
<script nonce="${nonce}">
const data=JSON.parse(document.getElementById('review-data').textContent);
const key=value=>value.trim().replace(/^@/,'').toLowerCase();
const usable=value=>typeof value==='string'&&/^@[A-Za-z0-9_]{4,32}$/.test(value.trim())&&/[A-Za-z0-9]/.test(value);
const states=new Map(data.rows.map(r=>[r.source_message_id,{archived_username:r.username_options.length===1?r.username_options[0].archived_username:'',archived_display_name:'',participant_id:null,target:null,status:'pending'}]));
const byId=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};
const button=(text,handler,primary=false)=>{const b=el('button',text,primary?'primary':'');b.type='button';b.addEventListener('click',handler);return b};
function matches(value){return {current:data.participants.filter(p=>[...p.usernames,...(p.identity_evidence||[]).filter(e=>e.kind==='username'&&['external_identities.username','telegram_roster_entries.username'].includes(e.source)).map(e=>e.value)].some(u=>key(u)===key(value))),historical:data.participants.filter(p=>(p.reconstructed_archived_usernames||[]).some(u=>key(u)===key(value)))};}
function validTarget(state){if(!usable(state.archived_username))return false;const m=matches(state.archived_username);if(state.target==='existing_current')return m.current.some(p=>p.id===state.participant_id);if(state.target!=='historical')return false;if(m.historical.length>1)return false;if(m.historical.length===1)return state.participant_id===m.historical[0].id;return !m.current.length&&state.participant_id===null;}
function edit(id,field,value){const s=states.get(id);states.set(id,{...s,[field]:value.trim(),participant_id:null,target:null,status:'pending'});render();}
function confirm(id,target,participantId=null){const s={...states.get(id),target,participant_id:participantId};if(!validTarget(s))throw new Error('Username или совпадение требует проверки');states.set(id,{...s,status:'confirmed'});render();}
function unresolved(id){states.set(id,{...states.get(id),target:null,participant_id:null,status:'unresolved'});render();}
function render(){
 const confirmed=[...states.values()].filter(s=>s.status==='confirmed');
 byId('progress').textContent='Подтверждено '+confirmed.length+' · usernames '+new Set(confirmed.map(s=>key(s.archived_username))).size+' · всего '+data.rows.length;
 byId('totals').textContent='Прогноз: usernames '+data.summary.unique_usable_archived_usernames+' · username-кандидатов для новых Participants '+data.summary.historical_participants_would_be_created+' · максимум новых Participants '+data.summary.historical_participants_creation_upper_bound+' · повторяющихся групп '+data.summary.repeated_username_groups.length+' · совпадений Core '+data.summary.exact_current_core_username_collisions+' · записей без username '+data.summary.archive_entries_without_usable_username;
 byId('entries').replaceChildren();
 for(const row of data.rows){const s=states.get(row.source_message_id),m=matches(s.archived_username),filter=byId('filter').value;
  if(filter!=='all'&&filter!==s.status&&!(filter==='existing_current_username_match'&&m.current.length)&&!(filter==='unresolved_no_username'&&!usable(s.archived_username)))continue;
  const card=el('article',undefined,s.status);card.id='message-'+row.source_message_id;
  const screens=el('div',undefined,'screens');for(const src of data.images[row.source_message_id]||[]){const img=el('img');img.src=src;img.alt='Скриншот сообщения '+row.source_message_id;img.loading='lazy';screens.append(img);}if(!screens.children.length)screens.append(el('p','Нет изображения.'));
  const info=el('div');info.append(el('h2','Сообщение #'+row.source_message_id),el('p',row.archive_date+' · архивная дата'),el('h3','OCR имя / @username'),el('p',[...row.ocr_names,...row.ocr_usernames.map(u=>'@'+u)].join(' / ')||'Нет пригодного username'));
  for(const o of row.username_options)info.append(button('Выбрать подсказку '+o.archived_username,()=>edit(row.source_message_id,'archived_username',o.archived_username)));
  const label=el('label','Исторический @username (проверьте по изображению)'),input=el('input');input.value=s.archived_username;input.placeholder='@username';input.addEventListener('change',()=>edit(row.source_message_id,'archived_username',input.value));label.append(input);info.append(label);
  const nameLabel=el('label','Архивное display name — необязательно, только после проверки'),name=el('input');name.value=s.archived_display_name;name.maxLength=200;name.addEventListener('change',()=>edit(row.source_message_id,'archived_display_name',name.value));nameLabel.append(name);info.append(nameLabel);
  if(!usable(s.archived_username))info.append(el('p','Без пригодного @username запись остаётся неразрешённой.','warning'));
  else {
   const related=data.rows.filter(r=>r.username_options.some(o=>key(o.archived_username)===key(s.archived_username))).map(r=>r.source_message_id);
   info.append(el('p','Группа исторического Participant: @'+key(s.archived_username)+(related.length>1?' · сообщения '+related.join(', '):''),'id'));
   if(m.current.length){info.append(el('p','existing_current_username_match — создание дубликата заблокировано. Подтвердите конкретного текущего Participant или оставьте запись неразрешённой.','warning'));for(const p of m.current){const proposal=el('div',undefined,'proposal');proposal.append(el('strong',p.display_name),el('p',p.id,'id'),el('p','Основание: exact_current_core_username'),button('Подтвердить этого текущего Participant',()=>confirm(row.source_message_id,'existing_current',p.id)));info.append(proposal);}}
   if(m.historical.length>1)info.append(el('p','Несколько реконструированных Participants с этим username: требуется отдельное разрешение неоднозначности.','warning'));
   for(const p of m.historical){const proposal=el('div',undefined,'proposal');proposal.append(el('strong',p.display_name),el('p',p.id,'id'),el('p','Основание: reconstructed_archived_username'));if(m.historical.length===1)proposal.append(button('Подтвердить повторное использование исторического Participant',()=>confirm(row.source_message_id,'historical',p.id)));info.append(proposal);}
   if(!m.current.length&&!m.historical.length)info.append(el('p','После будущего применения: display_name = '+s.archived_username.slice(1)+', membership_status = left. Без external_identities.'),button('Подтвердить username для исторического Participant',()=>confirm(row.source_message_id,'historical'),true));
  }
  info.append(el('p',s.status==='confirmed'?'Подтверждено человеком: '+s.archived_username+' · '+s.target+(s.participant_id?' · '+s.participant_id:''):s.status==='unresolved'?'Оставлено неразрешённым':'Решение ещё не подтверждено','decision'),button('Отметить неразрешённым',()=>unresolved(row.source_message_id)));
  const details=el('details');details.append(el('summary','OCR / подпись / контекст'),el('pre',JSON.stringify(row.context,null,2)));info.append(details);card.append(screens,info);byId('entries').append(card);
 }
}
function buildReviewedMapping(){return {model_version:data.model_version,source_channel:data.source_channel,archive_sha256:data.archive_sha256,mappings:data.rows.map(row=>{const s=states.get(row.source_message_id);return {source_message_id:row.source_message_id,archived_username:usable(s.archived_username)?s.archived_username:null,...(s.archived_display_name?{archived_display_name:s.archived_display_name}:{}),participant_id:s.participant_id,target:s.target,event_type:'forum.left',confirmed:s.status==='confirmed',review_status:s.status};})};}
function restore(input){if(input.model_version!==data.model_version||input.source_channel!==data.source_channel||input.archive_sha256!==data.archive_sha256||!Array.isArray(input.mappings))throw new Error('Другой архив или устаревшая модель review');const restored=new Map([...states].map(([id])=>[id,{archived_username:'',archived_display_name:'',participant_id:null,target:null,status:'pending'}])),seen=new Set();for(const m of input.mappings){if(!restored.has(m.source_message_id)||seen.has(m.source_message_id)||typeof m.confirmed!=='boolean'||m.event_type!=='forum.left'||(m.archived_username!==null&&!usable(m.archived_username))||(m.archived_display_name!==undefined&&(typeof m.archived_display_name!=='string'||m.archived_display_name.length>200)))throw new Error('Недопустимый mapping');const s={archived_username:m.archived_username||'',archived_display_name:m.archived_display_name||'',participant_id:m.participant_id,target:m.target,status:m.confirmed?'confirmed':m.review_status==='unresolved'?'unresolved':'pending'};if(m.confirmed&&!validTarget(s))throw new Error('Подтверждённый mapping требует повторной проверки');if(!m.confirmed){s.participant_id=null;s.target=null;}seen.add(m.source_message_id);restored.set(m.source_message_id,s);}for(const [id,s] of restored)states.set(id,s);render();}
byId('download').addEventListener('click',()=>{const blob=new Blob([JSON.stringify(buildReviewedMapping(),null,2)+'\\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='reviewed-departures-usernames.json';document.body.append(a);a.click();a.remove();URL.revokeObjectURL(url);byId('notice').textContent='JSON скачан. Participants и события не создавались.';});
byId('resume').addEventListener('change',async event=>{try{const file=event.target.files[0];if(file){restore(JSON.parse(await file.text()));byId('notice').textContent='Решения восстановлены локально.';}}catch(error){byId('notice').textContent=error.message;}finally{event.target.value='';}});
byId('filter').addEventListener('change',render);render();
</script></body></html>`;
}
