(function(root){
'use strict';
const VERSION='icl-training-plan-v2',DAY=86400000;
const TASKS={contrast:{label:'对比辨别',evidence:'paper_inspired',cpds:[3]},multiscale:{label:'多尺度细节',evidence:'paper_inspired',cpds:[1.5,3,6]},collinear:{label:'轮廓与背景',evidence:'mechanism_extension',cpds:[3]},noise:{label:'干扰中辨别',evidence:'mechanism_extension',cpds:[3]}};
const medical=()=>root.NVMedical||(typeof require==='function'?require('./medical.js'):null);
const day=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
function build(input={}){
 const context=input.context||{},person=context.participant_id,now=input.now?new Date(input.now):new Date(),today=day(now),clinical=context.clinical;
 const result={version:VERSION,stage:'foundation',daily_used_seconds:0,daily_limit_seconds:240,participant_id:person||'',status:'needs_data',items:[],total_seconds:0,basis:[],missing:[],hold_reason:'',source_report_ids:[],source_care_id:null};
 const hold=(status,reason)=>{result.status=status;result.hold_reason=reason;return result;};
 if(input.practice_capacity===false)return hold('needs_data','本机训练记录容量已满，请导出备份后在新的浏览器存储中继续。');
 if(input.storage_error)return hold('needs_data','请先导出资料并恢复本机存储，再开始训练。');
 if(context.access!=='postop'||!['icl','ticl'].includes(clinical?.procedure)){result.missing.push('ICL / TICL 手术信息');return hold('needs_data','填写手术信息后生成方案。');}
 const eyes=clinical.operated_eyes==='both'?['left','right']:[clinical.operated_eyes],dates=eyes.map(eye=>clinical[eye+'_surgery_date']);
 if(!eyes.every(e=>['left','right'].includes(e))||dates.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d||'')||d>today||!Number.isFinite(Date.parse(d)))){result.missing.push('已手术眼的手术日期');return hold('needs_data','补全左右眼手术日期后生成方案。');}
 const latestSurgery=[...dates].sort().at(-1),care=input.care?.participant_id===person?input.care:null;
 result.basis.push(`${clinical.procedure.toUpperCase()} · ${clinical.operated_eyes==='both'?'双眼':clinical.operated_eyes==='left'?'左眼':'右眼'} · 最近手术 ${latestSurgery}`);
 if(!care||care.clearance!=='reviewed'||!care.reviewed_on||care.reviewed_on<latestSurgery||care.reviewed_on>today){result.missing.push('术后医生允许练习的确认信息');return hold('needs_review','请记录术后医生确认信息。');}
 result.source_care_id=care.id;
 if(care.symptoms.includes('double'))return hold('needs_review','已记录重影，请先由医生评估双眼视觉并更新练习安排。');
 if(!care.clinician_targets.includes('contrast'))return hold('needs_review','当前医生目标为调节或集合，请由门诊安排对应设备练习；本机训练需确认对比辨别目标。');
 const reports=(input.reports||[]).filter(r=>r.participant_id===person&&r.stage==='postop'&&r.exam_date<=today);
 result.source_report_ids=reports.slice(-50).map(r=>r.id);
 if(medical().reportIssues(context,reports).length)return hold('needs_data','同日检查值有冲突，请核对检查报告。');
 // An eye-specific postoperative report must follow that eye’s surgery.
 if(reports.some(r=>r.values.some(v=>v.eye==='both'?r.exam_date<latestSurgery:clinical[v.eye+'_surgery_date']&&r.exam_date<clinical[v.eye+'_surgery_date'])))return hold('needs_data','部分术后检查早于对应手术日期，请核对报告阶段与日期。');
 const history=(input.history||[]).filter(r=>r.participant_id===person&&Date.parse(r.completed_at)<=now.getTime()&&r.created_at.slice(0,10)>=latestSurgery).sort((a,b)=>a.completed_at.localeCompare(b.completed_at));
 const adverse=[...history].reverse().find(r=>r.feedback==='stop'||r.stop_reason==='discomfort');
 if(adverse&&(!(Date.parse(care.created_at)>Date.parse(adverse.completed_at))||care.reviewed_on<day(new Date(adverse.completed_at))))return hold('needs_review','上次练习因不适停止，请复查后更新医生确认信息。');
 const latest=history.at(-1),observations=(input.observations||[]).filter(x=>x.participant_id===person&&x.local_date===today).at(-1);
 if(observations&&(observations.breaks==='stopped'||observations.reading==='stopped'))return hold('needs_review','今天的用眼活动已因不适或看不清停止，请先联系医生。');
 // Allocation is an engineering exposure policy; each context retains its own evidence.
 const candidates=history.filter(r=>r.source_care_id===care.id&&now.getTime()-Date.parse(r.completed_at)<=30*DAY);
 const completed=candidates.filter(r=>r.status==='complete'&&r.feedback==='comfortable'&&r.valid_trial_count>=24&&r.correct_count/r.valid_trial_count>=.7&&r.blocks?.length>=2&&r.blocks.every(b=>b.trials?.filter(t=>t.valid).length>=12&&b.trials.filter(t=>t.valid).length/b.trials.length>=.8));
 const recent=candidates.slice(-2),separateDays=new Set(recent.map(r=>day(new Date(r.completed_at))));
 const readyHistory=recent.length===2&&separateDays.size===2&&recent.every(r=>completed.includes(r));
 const counts={1.5:0,3:0,6:0},contexts={collinear:0,noise:0};
 for(const r of completed.slice(-6))for(const b of r.blocks)for(const t of b.trials||[]){
   if(!t.valid||t.familiarization||t.exposure_ms!==200)continue;
   if(b.task_id==='multiscale'&&Object.hasOwn(counts,t.cpd))counts[t.cpd]++;
   if(Object.hasOwn(contexts,b.task_id))contexts[b.task_id]++;
 }
 const short=care.symptoms.includes('near')||latest?.feedback==='noticeable'||(observations&&['once','repeated'].includes(observations.breaks));
 const established=readyHistory&&!short&&Object.values(counts).every(n=>n>=6);
 const allToday=[...history,...(input.pending_practice||[]).filter(r=>r.participant_id===person)];
 const counted=new Set();let used=0;
 for(const r of allToday){if(counted.has(r.id)||day(new Date(r.created_at))!==today)continue;counted.add(r.id);used+=Math.max(0,Number(r.active_ms)||0)+(r.blocks||[]).reduce((n,b)=>n+Math.max(0,Number(b.overrun_ms)||0),0);}
 result.daily_used_seconds=Math.ceil(used/1000);
 const remaining=Math.max(0,result.daily_limit_seconds-result.daily_used_seconds);
 if(remaining<60){result.stage='rest';return hold('daily_complete','今天的练习安排已完成，明天再继续。');}
 const seconds=Math.floor(Math.min(established?240:120,remaining)/2);
 const add=(task_id,reason)=>result.items.push({task_id,...TASKS[task_id],cpds:[...TASKS[task_id].cpds],seconds,reason});
 add('contrast','从清晰条纹开始，根据作答调整对比。');
 if(established){
   const task=contexts.collinear<=contexts.noise?'collinear':'noise';
   add(task,task==='collinear'?'跨尺度练习记录已充足，本次练习背景中的中心目标。':'跨尺度练习记录已充足，本次练习干扰中的方向。');
   result.stage='context';
 }else{
   add('multiscale',short?'本次缩短练习，粗、中、细条纹分别调整难度。':'覆盖粗、中、细三种条纹，各自调整难度。');
   result.stage=completed.length?'scales':'foundation';
 }
 result.status='ready';result.total_seconds=result.items.reduce((sum,x)=>sum+x.seconds,0);
 result.basis.push(`医生确认 ${care.reviewed_on} · 对比辨别`);
 result.basis.push(reports.length?`采用 ${reports.length} 份术后报告核对资料一致性；眼压、拱高保留为随访数据。`:'检查数值尚缺；起始难度由现场练习调整。');
 result.basis.push(`本次每项 ${seconds} 秒；每段最多 60 秒，休息后继续。`);
 result.basis.push('项目由有效练习条件匹配；时长为软件负担预算，ICL 疗效与最佳剂量仍待验证。');
 if(established)result.basis.push('探索练习沿用相同总时长。');
 return result;
}
const api={VERSION,TASKS,build};if(typeof module!=='undefined')module.exports=api;root.NVTrainingPlan=api;
})(typeof window==='undefined'?globalThis:window);
