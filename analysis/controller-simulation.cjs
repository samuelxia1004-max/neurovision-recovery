'use strict';
const T=require('../app/perceptual-training.js'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
let seed=4102026;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296),mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
const scenarios=[{id:'low',threshold:.06,lapse:0,missing:0},{id:'medium',threshold:.15,lapse:0,missing:0},{id:'high',threshold:.35,lapse:0,missing:0},{id:'lapse',threshold:.15,lapse:.1,missing:0},{id:'omission',threshold:.15,lapse:0,missing:.25},{id:'guess',threshold:null,lapse:0,missing:0}];
const p=(c,t,lapse)=>t===null?.5:.5+(1-lapse)*.5*(1-Math.exp(-Math.LN2*(c/t)**2));
const rows=[];
for(const s of scenarios){
 const totals=Object.fromEntries(['mixed_duration','separate_duration','same_duration_history'].map(k=>[k,{early:[],final:[],invalid_updates:0}]));
 for(let observer=0;observer<1000;observer++){
  const prior=[];let state={contrast:.24,streak:0};
  for(let i=0;i<60;i++){prior.push(state.contrast);state=T.staircase(state,random()<p(state.contrast,s.threshold,s.lapse));}
  const a=prior.slice(-6).sort((x,y)=>x-y),seedContrast=Math.max(.12,Math.min(.6,1.2*(a[2]+a[3])/2));
  const responses=Array.from({length:30},()=>[random(),random()]);
  for(const rule of Object.keys(totals)){
   const states=new Map(),early=[];let last=.24;
   for(let i=0;i<30;i++){
    const exposure=i<6?500:200,key=T.channelKey({task_id:'contrast',cpd:3,spacing_lambda:null,exposure_ms:exposure},rule!=='mixed_duration');
    const before=states.get(key)||{contrast:rule==='same_duration_history'&&exposure===200?seedContrast:.24,streak:0};
    const threshold=s.threshold===null?null:s.threshold*(exposure===500?.65:1);
    if(i>=6&&i<12)early.push(p(before.contrast,threshold,s.lapse));
    if(responses[i][1]>=s.missing)states.set(key,T.staircase(before,responses[i][0]<p(before.contrast,threshold,s.lapse)));
    else if(states.has(key)&&states.get(key)!==before)totals[rule].invalid_updates++;
    if(exposure===200)last=(states.get(key)||before).contrast;
   }
   totals[rule].early.push(mean(early));totals[rule].final.push(last);
  }
 }
 for(const [rule,t] of Object.entries(totals))rows.push({scenario:s.id,rule,mean_first_six_formal_correct_probability:mean(t.early),mean_final_digital_contrast:mean(t.final),invalid_updates:t.invalid_updates});
}
const files=['app/perceptual-training.js','app/training-plan.js'];
const report={status:rows.every(r=>r.invalid_updates===0&&r.mean_final_digital_contrast>=.04&&r.mean_final_digital_contrast<=.6)?'PASS':'FAIL',seed:4102026,scenarios,runs_per_scenario:1000,paired_strategy_count:3,current_trials_per_strategy:30,prior_trials_for_history:60,scope:'Fixed synthetic observers; no neural learning or patient outcomes. Durations differ by an assumed 0.65 threshold multiplier. Same-duration history uses an idealized always-available 60-trial history; software additionally checks record quality, care, display and confirmation. Common response uniforms pair strategies. Higher accuracy can simply mean easier stimulation.',source_hashes:Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',f))).digest('hex')])),rows};
console.log(JSON.stringify(report,null,2));

