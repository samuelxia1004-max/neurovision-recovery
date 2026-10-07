/* Reconstruct historical training records for backup compatibility. */
(function(root){
'use strict';
const PROTOCOL='nv-practice-0.3.0', PROTOCOL_V4='nv-practice-0.4.0', MIN=Math.log10(.025), MAX=Math.log10(.4), STEP=.06;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
function controller(arm){
  if(!['adaptive','reference'].includes(arm))throw Error('未知练习条件');
  return {arm,x:arm==='reference'?MAX:Math.log10(.16),streak:0,n:0};
}
function update(s,correct,valid=true){
  if(typeof correct!=='boolean')throw Error('需要明确回答');
  if(!valid)return s;
  s.n++;
  if(s.arm==='reference')return s;
  if(correct){s.streak++;if(s.streak===3){s.x=clamp(s.x-STEP,MIN,MAX);s.streak=0;}}
  else{s.x=clamp(s.x+STEP,MIN,MAX);s.streak=0;}
  return s;
}
const FEELING={comfortable:'观看轻松',noticeable:'感到费力，仍能继续',rest:'需要休息',stop:'难以继续'};
const feelingOptions=()=>'<option value="">请选择</option>'+Object.entries(FEELING).map(([key,label])=>`<option value="${key}">${label}</option>`).join('');
function validate(r){
  const fail=()=>{throw Error('练习记录与试次不一致');};
  const finite=x=>typeof x==='number'&&Number.isFinite(x);
  if(!r||!((r.schema==='neurovision.training.v0.3'&&r.protocol===PROTOCOL)||(r.schema==='neurovision.training.v0.4'&&r.protocol===PROTOCOL_V4))||typeof r.id!=='string'||r.id.length>100||typeof r.participant_id!=='string'||!r.participant_id||r.participant_id.length>100||!['adaptive','reference'].includes(r.arm)||!['complete','aborted'].includes(r.status)||!Number.isFinite(Date.parse(r.created_at))||!Number.isFinite(Date.parse(r.completed_at))||!Array.isArray(r.trials)||r.trials.length>100||!r.setup||!r.summary)fail();
  if(r.schema==='neurovision.training.v0.4'){if(!Object.hasOwn(FEELING,r.fatigue_pre)||(r.fatigue_post!==null&&!Object.hasOwn(FEELING,r.fatigue_post)))fail();}else if(!Number.isInteger(r.fatigue_pre)||r.fatigue_pre<0||r.fatigue_pre>10||(r.fatigue_post!==null&&(!Number.isInteger(r.fatigue_post)||r.fatigue_post<0||r.fatigue_post>10)))fail();
  if(r.setup.spatial_frequency_cpd!==6||r.setup.noise!==.06||r.setup.aperture_deg!==4||r.setup.eye!=='OU'||!finite(r.setup.frame_ms)||r.setup.frame_ms<4||r.setup.frame_ms>35)fail();
  const state=controller(r.arm);let correct=0;
  for(const t of r.trials){
    if(!t||typeof t.valid!=='boolean'||typeof t.right!=='boolean'||!Array.isArray(t.flags)||!Array.isArray(t.frame_intervals)||!finite(t.x)||Math.abs(t.x-state.x)>1e-9||!Number.isInteger(t.seed)||t.seed<0||t.seed>4294967295||t.noise!==.06||t.spatial_frequency_cpd!==6||(t.response!==null&&typeof t.response!=='boolean'))fail();
    if(t.valid){
      if(t.flags.length||!finite(t.rt_ms)||t.rt_ms<150||t.rt_ms>2200||!finite(t.exposure_ms)||!finite(t.target_ms)||Math.abs(t.target_ms-Math.round(500/r.setup.frame_ms)*r.setup.frame_ms)>1e-6||Math.abs(t.exposure_ms-t.target_ms)>r.setup.frame_ms*1.5||t.frame_intervals.length<5||t.frame_intervals.some(v=>!finite(v)||v<0||v>r.setup.frame_ms*1.75)||typeof t.response!=='boolean'||t.correct!==(t.response===t.right))fail();
      if(t.correct)correct++;
      update(state,t.correct);
    }
  }
  if(r.summary.valid_trials!==state.n||r.summary.accuracy!==(state.n?correct/state.n:null)||!finite(r.summary.elapsed_ms)||r.summary.elapsed_ms<0||(r.status==='complete'&&state.n!==48))fail();
  return r;
}
const api={PROTOCOL,PROTOCOL_V4,FEELING,controller,update,validate};
if(typeof module!=='undefined')module.exports=api;
root.NVTrainingValidator=api;
})(typeof window==='undefined'?globalThis:window);
