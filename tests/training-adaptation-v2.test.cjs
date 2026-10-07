const test = require('node:test'), assert = require('node:assert/strict');
const P = require('../app/perceptual-training.js');
const {harness, plan} = require('./perceptual-training.test.cjs');
const copy = x => JSON.parse(JSON.stringify(x));
let source;
function historyRecord(){
 if(source)return copy(source);
 const h=harness({inputPlan:plan('contrast',30)}),c=h.start();h.begin();
 while(c.getState().mode==='running'){
  for(let i=0;i<300&&c.getState().mode==='running'&&c.getState().phase!=='answer';i++)h.advance(25);
  if(c.getState().mode==='running'&&c.getState().phase==='answer'){h.answer();h.advance(650);}
 }
 assert.equal(c.getState().mode,'summary');h.click('feel-comfortable');source=c.getRecord();P.validateRecord(source);assert.equal(source.status,'complete');return copy(source);
}
test('formal training has independent state; legacy records remain replayable',()=>{
 for(const version of [P.PLAN_VERSION,P.LEGACY_PLAN]){
 const h=harness({inputPlan:plan('contrast',30,{version})}),c=h.start();h.begin();
 for(let i=0;i<6;i++){h.answer(true);h.advance(650);}
 assert.equal(c.getCurrentTrial().contrast,version===P.PLAN_VERSION?.24:.24/1.2/1.2);
 c.stop();P.validateRecord(c.getRecord());assert.equal(c.getRecord().schema,version===P.PLAN_VERSION?P.SCHEMA:P.LEGACY_SCHEMA);
 }
});
test('warm start uses same context, display, duration and care, only after explicit condition confirmation',()=>{
 const r=historyRecord(),p=plan(),at=Date.parse(r.completed_at)+86400000;
 const yes=P.buildInitialization(p,r.setup,[r],at,true);assert.equal(yes.channels.length,1);assert.equal(yes.channels[0].key,'contrast:3:0:200');
 assert.ok(yes.channels[0].contrast>=.12&&yes.channels[0].contrast<.24);
 assert.equal(P.buildInitialization(p,r.setup,[r],at,false).channels.length,0);
 for(const mutate of [x=>x.participant_id='other',x=>x.source_care_id='other',x=>x.feedback='noticeable',x=>x.status='stopped',x=>x.setup.display_key='99x99x24',x=>x.schema=P.LEGACY_SCHEMA]){
  const x=copy(r);mutate(x);assert.equal(P.buildInitialization(p,r.setup,[x],at,true).channels.length,0);
 }
 assert.equal(P.buildInitialization(p,{...r.setup,dpr:1},[r],at,true).channels.length,0);
 assert.equal(P.buildInitialization(p,r.setup,[r],at+31*86400000,true).channels.length,0);
 assert.equal(P.buildInitialization(plan('noise'),r.setup,[r],at,true).channels.length,0);
});
test('runner applies and saves warm start after six familiarization answers; tampered provenance fails',()=>{
 const r=historyRecord();r.id='history-source';for(const t of r.blocks[0].trials)t.id=r.id+':t'+t.index; // final invalid trial has no earlier retry
 P.validateRecord(r);
 const h=harness({inputPlan:plan('contrast',30),history:[r],baseTime:'2026-10-03T02:00:00.000Z'}),c=h.start();h.node('same-conditions').checked=true;h.begin();
 assert.equal(c.getCurrentTrial().contrast,.24);
 for(let i=0;i<6;i++){h.answer();h.advance(650);}
 assert.ok(c.getCurrentTrial().contrast<.24);h.answer();c.stop();const out=c.getRecord();P.validateRecord(out);
 assert.equal(out.initialization.channels[0].source_id,'history-source');
 for(const mutate of [x=>x.initialization.channels[0].contrast=.04,x=>x.initialization.same_viewing_conditions=false,x=>x.initialization.channels[0].key='noise:3:0:200']){const x=copy(out);mutate(x);assert.throws(()=>P.validateRecord(x));}
});
test('exposure summary includes interrupted presentation while performance excludes familiarization and invalid answers',()=>{
 const r=historyRecord(),summary=P.practiceSummary(r);
 assert.equal(summary.channels.length,1);assert.ok(summary.channels[0].n<r.valid_trial_count);
 const all=r.blocks[0].trials.reduce((sum,t)=>sum+(t.first_off_ms===null?0:t.first_off_ms-t.first_on_ms),0);
 assert.equal(summary.exposure_ms,all);assert.ok(summary.exposure_ms>summary.channels[0].n*200);
});
