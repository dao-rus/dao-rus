import {describe,it,expect} from 'vitest';
import {wizardValues,invalidWizardStep,wizardDeadline,wizardHref} from './veche-presentation';
describe('Veche GET steps',()=>{
 const complete={title:'Question',body:'Body',circle:'dao',mode:'secret',duration:'7',deadline:'',authorVisibility:'public'};
 it('defaults to secret, seven days and public name; preserves values in back/edit links',()=>{
  expect(wizardValues({})).toMatchObject({mode:'secret',duration:'7',authorVisibility:'public'});
  const url=new URL(wizardHref({...complete,title:'Question & <one>'},3),'https://example.test');expect(url.searchParams.get('title')).toBe('Question & <one>');expect(url.searchParams.get('step')).toBe('3');
 });
 it('returns missing or invalid values to their own step',()=>{
  for(const [field,value,step] of [['title','',1],['body',' ',1],['circle','city',2],['mode','unknown',3],['duration','0',4],['authorVisibility','unknown',5]] as const)expect(invalidWizardStep({...complete,[field]:value},5,['dao'])).toBe(step);
  expect(invalidWizardStep(complete,5,['dao'])).toBeNull();
 });
 it('requires a future custom date and computes only supported deadlines',()=>{
  expect(invalidWizardStep({...complete,duration:'custom'},5,['dao'])).toBe(4);
  const custom={...complete,duration:'custom',deadline:'2030-01-01T12:00'};expect(invalidWizardStep(custom,5,['dao'],0)).toBeNull();expect(wizardDeadline(custom)?.toISOString()).toBe('2030-01-01T09:00:00.000Z');
  expect(wizardDeadline(complete,0)?.getTime()).toBe(7*86400000);expect(wizardDeadline({...complete,duration:'permanent'})).toBeNull();
 });
});
