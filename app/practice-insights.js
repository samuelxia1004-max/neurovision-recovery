(function(root,factory){
'use strict';
const api=factory(root);
if(typeof module!=='undefined'&&module.exports)module.exports=api;
else root.NVPracticeInsights=api;
})(typeof window==='undefined'?globalThis:window,function(root){
'use strict';
const DAY=86400000,LABELS={contrast:'对比辨别',multiscale:'多尺度细节',collinear:'轮廓与背景',noise:'干扰中辨别'};
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localDay=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
const median=values=>{const a=values.slice().sort((x,y)=>x-y);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2:null;};
const training=()=>root.NVPerceptualTraining||(typeof require==='function'?require('./perceptual-training.js'):null);
function build(input={}){
 const now=new Date(input.now||Date.now()),at=now.getTime(),person=input.context?.participant_id,care=input.care?.id;
 const api=training(),seen=new Set();
 const records=(Array.isArray(input.history)?input.history:[]).filter(r=>{
  if(!r||seen.has(r.id)||!['neurovision.perceptual-training.v1','neurovision.perceptual-training.v2'].includes(r.schema)||r.participant_id!==person||!care||r.source_care_id!==care)return false;
  const end=Date.parse(r.completed_at);
  if(!Number.isFinite(at)||!Number.isFinite(end)||end>at||at-end>30*DAY||!api?.validate(r).valid)return false;
  seen.add(r.id);return true;
 }).sort((a,b)=>a.completed_at.localeCompare(b.completed_at));
 const qualified=records.filter(r=>r.status==='complete'&&r.feedback==='comfortable'&&r.valid_trial_count>=24&&r.correct_count/r.valid_trial_count>=.7&&r.blocks.length>=2&&r.blocks.every(b=>b.trials.filter(t=>t.valid).length>=12&&b.trials.filter(t=>t.valid).length/b.trials.length>=.8));
 const coverage={'1.5':0,'3':0,'6':0,collinear:0,noise:0};
 for(const r of qualified.slice(-6))for(const b of r.blocks)for(const t of b.trials){
  if(!t.valid||t.familiarization||t.exposure_ms!==200)continue;
  if(b.task_id==='multiscale'&&Object.hasOwn(coverage,String(t.cpd)))coverage[String(t.cpd)]++;
  if(['collinear','noise'].includes(b.task_id))coverage[b.task_id]++;
 }
 const groups=new Map();let formal=0,invalid=0,familiarization=0,exposure=0,downgraded=0;
 for(const r of records){
  const s=r.setup,display=JSON.stringify([r.schema,s.display_key||r.id,s.ppd,s.dpr,s.distance_cm,s.px_per_mm,s.gamma_calibrated]);
  const summary=api.practiceSummary(r);exposure+=summary.exposure_ms;
  for(const b of r.blocks)for(const t of b.trials){
   if(!t.valid){invalid++;continue;}
   if(t.familiarization){familiarization++;continue;}
   if(t.exposure_ms!==200)continue;
   formal++;if(t.downgraded)downgraded++;
   const key=display+'|'+api.channelKey(t);
   if(!groups.has(key))groups.set(key,{task_id:b.task_id,cpd:t.cpd,spacing_lambda:t.spacing_lambda,display:s.display_key||'旧版单次条件',distance_cm:s.distance_cm,n:0,correct:0,sessions:new Set(),recent:[],last_record:null});
   const g=groups.get(key);
   if(g.last_record!==r.id){g.recent=[];g.last_record=r.id;}
   g.n++;g.correct+=Number(t.correct);g.sessions.add(r.id);g.recent.push(t.contrast);
  }
 }
 const days=[];
 for(let i=6;i>=0;i--){
  const d=new Date(now);d.setHours(0,0,0,0);d.setDate(d.getDate()-i);
  const date=localDay(d),matches=records.filter(r=>localDay(new Date(r.created_at))===date);
  const active=matches.reduce((n,r)=>n+r.active_ms+r.blocks.reduce((sum,b)=>sum+b.overrun_ms,0),0);
  days.push({date,day:d.getDate(),sessions:matches.length,active_seconds:Math.ceil(active/1000)});
 }
 return {scope:'current-care-30-days',sessions:records.length,formal_answers:formal,familiarization_answers:familiarization,invalid_trials:invalid,stimulus_seconds:exposure/1000,downgraded_formal_answers:downgraded,coverage,days,channels:[...groups.values()].map(({sessions,recent,last_record,...g})=>({...g,sessions:sessions.size,recent_contrast:median(recent.slice(-6))}))};
}
function home(input,plan){
 if(!['ready','daily_complete'].includes(plan?.status))return '';
 const s=build(input),labels=[['1.5','粗条纹'],['3','中条纹'],['6','细条纹'],['collinear','背景'],['noise','干扰']];
 const practiced=s.days.filter(d=>d.sessions>0).length;
 return '<section class="practice-insight-grid" aria-label="近期练习"><div class="practice-week"><header><h2>当前安排</h2><span>近七天 · '+practiced+' 天有练习</span></header><ol>'+s.days.map(d=>'<li><time datetime="'+d.date+'">'+d.day+'</time><span class="'+(d.sessions?'has-practice':'no-practice')+'" aria-label="'+d.date+'，'+d.sessions+' 次练习，'+d.active_seconds+' 秒">'+(d.sessions?'✓':'·')+'</span></li>').join('')+'</ol><a class="quiet-link" href="#records">查看每次记录</a></div><div class="practice-coverage"><header><h2>练习覆盖</h2><span>当前安排 · 最近六次有效会话</span></header><ul>'+labels.map(([key,label])=>'<li><span>'+label+'</span><meter min="0" max="6" value="'+Math.min(6,s.coverage[key])+'" aria-label="'+label+'：'+s.coverage[key]+' 次有效正式作答"></meter><b>'+s.coverage[key]+'</b></li>').join('')+'</ul><p>次数用于安排下一项练习。</p>'+(s.downgraded_formal_answers?'<p>部分细条纹已按屏幕采样能力降频。</p>':'')+'</div></section>';
}
function records(input){
 const s=build(input);
 if(!s.sessions)return '';
 return '<details class="practice-channel-summary"><summary>近期条件记录 <span>'+s.channels.length+' 组</span></summary><p>当前医生确认后的近三十天。屏幕、视距、频率、间距和呈现时长分别记录。</p><div class="practice-context-table"><table><thead><tr><th>项目与条件</th><th>正确 / 正式作答</th><th>最近会话数字对比</th></tr></thead><tbody>'+s.channels.map(c=>'<tr><td>'+escape(LABELS[c.task_id]||c.task_id)+' · '+c.cpd+' cpd'+(c.spacing_lambda?' · '+c.spacing_lambda+'λ':'')+'<small>'+escape(c.display)+' · '+c.distance_cm+' cm · 200 ms</small></td><td>'+c.correct+' / '+c.n+'</td><td>'+c.recent_contrast.toFixed(3)+'</td></tr>').join('')+'</tbody></table></div><p>数字对比是最近会话末六题的刺激中位数。</p></details>';
}
return {build,home,records,localDay};
});
