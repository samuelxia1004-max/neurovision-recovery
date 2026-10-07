/* Fixed-condition visual performance snapshot. Research prototype; digital units. */
(function (root) {
  'use strict';
  const P = typeof module !== 'undefined' ? require('./psychometrics.js') : root.NVPsych;
  const C = typeof module !== 'undefined' ? require('./clinical.js') : root.NVClinical;
  const SCHEMA = 'neurovision.snapshot.v0.4', DAY = 86400000;
  const LEGACY_CONFIG = Object.freeze({ version:'snapshot-fixed-1', task:'gabor_orientation_2afc', contrasts:Object.freeze([.04,.12,.36]), trials_per_contrast:8, check_contrast:.5, checks:4, practice:2, spatial_frequency_cpd:3, aperture_deg:4, orientation_deg:45, mean_code:128, noise:0, stimulus_ms:400, fixation_ms:350, response_window_ms:1800, minimum_rt_ms:150, iti_ms:150, cap_ms:120000, warmup_intervals:30, max_frame_ratio:1.75, exposure_tolerance_frames:1.5 });
  const CONFIG = Object.freeze({...LEGACY_CONFIG,version:'snapshot-fixed-2',direction_policy:'balanced_constrained_shuffle',max_same_direction:3,max_alternating_direction:5});
  const clone = x => JSON.parse(JSON.stringify(x));
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  const between = (x,a,b) => finite(x) && x>=a && x<=b;
  const integer = (x,a,b) => Number.isInteger(x) && x>=a && x<=b;
  const object = x => x!==null && typeof x==='object' && !Array.isArray(x);
  const exactKeys = (x,keys) => object(x) && Object.keys(x).length===keys.length && keys.every(k=>Object.prototype.hasOwnProperty.call(x,k));
  const id = x => typeof x==='string' && /^[A-Za-z0-9_-]{1,100}$/.test(x);
  const iso = x => typeof x==='string' && x.length===24 && Number.isFinite(Date.parse(x)) && new Date(x).toISOString()===x;
  const canonical = x => JSON.stringify(x,(_,v)=>object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
  const equal = (a,b) => canonical(a)===canonical(b);
  const near = (a,b) => finite(a)&&finite(b)&&Math.abs(a-b)<.01;
  const fail = message => { throw Error(message || '视觉表现记录格式或原始数据不一致。'); };
  function tree(value,depth=0,budget={left:50000}) {
    if (--budget.left<0 || depth>8) fail('记录过大或嵌套过深。');
    if (value===null || typeof value==='boolean') return;
    if (typeof value==='number') { if(!finite(value)) fail(); return; }
    if (typeof value==='string') { if(value.length>3000) fail(); return; }
    if (Array.isArray(value)) { if(value.length>1000) fail(); value.forEach(x=>tree(x,depth+1,budget)); return; }
    if (!object(value) || Object.keys(value).length>40) fail();
    for(const [k,v] of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(k))fail();tree(v,depth+1,budget);}
  }
  function legacySchedule(seed) {
    if(!integer(seed,0,4294967295))fail('随机种子无效。');
    const random=P.rng(seed), directions=()=>P.shuffle([false,false,false,false,true,true,true,true],random);
    const levels=LEGACY_CONFIG.contrasts.map(contrast=>({contrast,directions:directions()}));
    const checks=P.shuffle([false,false,true,true],random);
    const practice=P.shuffle([false,true],random).map(right=>({kind:'practice',block:0,contrast:.5,right,phase:Math.floor(random()*2)}));
    const blocks=Array.from({length:4},(_,b)=>P.shuffle([
      ...levels.flatMap(level=>[0,1].map(j=>({kind:'scored',contrast:level.contrast,right:level.directions[b*2+j],phase:Math.floor(random()*2)}))),
      {kind:'check',contrast:.5,right:checks[b],phase:Math.floor(random()*2)}
    ],random));
    return [...practice,...P.shuffle(blocks,random).flatMap((block,b)=>block.map(t=>({...t,block:b+1})))].map((t,index)=>({index,kind:t.kind,block:t.block,contrast:t.contrast,right:t.right,phase:t.phase}));
  }
  function directionAllowed(sequence,right) {
    const n=sequence.length;
    if(n>=3&&sequence.slice(-3).every(t=>t.right===right))return false;
    if(n>=5){const last=[...sequence.slice(-5).map(t=>t.right),right];if(last.every((v,i)=>i===0||v!==last[i-1]))return false;}
    return true;
  }
  function schedule(seed,version=CONFIG.version) {
    if(version===LEGACY_CONFIG.version)return legacySchedule(seed);
    if(version!==CONFIG.version||!integer(seed,0,4294967295))fail('随机版本或种子无效。');
    // Keep contrast/block balance, then shuffle balanced direction pools subject
    // to finite sequence constraints. Backtracking retains feasibility without
    // switching to a predictable left/right cycle.
    const entries=legacySchedule(seed),random=P.rng((seed^0x9E3779B9)>>>0);
    const pools=new Map([['practice',[1,1]],['check',[2,2]],...CONFIG.contrasts.map(c=>['scored/'+c,[4,4]])]);
    const key=t=>t.kind==='scored'?'scored/'+t.contrast:t.kind,chosen=[];
    function fill(index){
      if(index===entries.length)return true;
      const entry=entries[index],counts=pools.get(key(entry));
      for(const right of P.shuffle([false,true],random)){
        const d=right?1:0;if(!counts[d]||!directionAllowed(chosen,right))continue;
        counts[d]--;chosen.push({...entry,right});
        if(fill(index+1))return true;
        chosen.pop();counts[d]++;
      }
      return false;
    }
    if(!fill(0))fail('无法生成平衡随机顺序。');
    return chosen;
  }
  function wilson(correct,n) {
    if(!integer(n,0,100000)||!integer(correct,0,n))fail('计数无效。');
    if(!n)return {accuracy:null,low:null,high:null};
    const z=1.959963984540054,p=correct/n,z2=z*z,den=1+z2/n,center=(p+z2/(2*n))/den,half=z*Math.sqrt(p*(1-p)/n+z2/(4*n*n))/den;
    return {accuracy:p,low:Math.max(0,center-half),high:Math.min(1,center+half)};
  }
  function frameTarget(frameMs){return Math.max(1,Math.round(CONFIG.stimulus_ms/frameMs))*frameMs;}
  function warmupOK(intervals) {
    if(!Array.isArray(intervals)||intervals.length!==30||!intervals.every(x=>between(x,0,100)))return false;
    const m=P.median(intervals);return between(m,4,35)&&intervals.filter(x=>x>m*CONFIG.max_frame_ratio).length<=1;
  }
  function fingerprint(s,version=CONFIG.version) {
    const parts=[s.device_id,s.screen,s.viewport,s.device_pixel_ratio,s.px_per_mm,s.distance_cm,s.brightness_percent,s.correction,s.ambient,s.user_agent,version,3,4,'OU','digital_code'];
    if(version===CONFIG.version)parts.push(s.clinical?[s.clinical.procedure,s.clinical.operated_eyes,s.clinical.left_surgery_date,s.clinical.right_surgery_date]:null);
    else if(version!==LEGACY_CONFIG.version)fail('固定条件版本无效。');
    return JSON.stringify(parts);
  }
  function inputMode(trials) {
    const types=new Set(trials.filter(t=>t.response!==null).map(t=>t.response_input));
    return types.size>1?'mixed':types.size?[...types][0]:'none';
  }
  function trialFlags(t,frameMs) {
    const flags=[];
    if(t.interrupted)flags.push('interrupted');
    if(t.response===null) {if(!t.interrupted)flags.push('timeout');}
    else if(t.rt_ms<150)flags.push('anticipatory');
    else if(t.rt_ms>1800)flags.push('late_response');
    if(t.onset_ms!==null && (!t.interrupted || t.offset_ms!==null) && (t.offset_ms===null || t.frame_intervals.some(x=>x>frameMs*CONFIG.max_frame_ratio) || Math.abs(t.exposure_ms-t.target_ms)>frameMs*CONFIG.exposure_tolerance_frames))flags.push('timing_unstable');
    return flags;
  }
  function summarize(record) {
    const scored=record.trials.filter(t=>record.schedule[t.schedule_index].kind==='scored'&&t.valid);
    const checks=record.trials.filter(t=>record.schedule[t.schedule_index].kind==='check'&&t.valid);
    const correct=scored.filter(t=>t.correct),checkCorrect=checks.filter(t=>t.correct).length;
    const flags=[];
    if(record.status!=='complete'||record.trials.length!==30)flags.push('incomplete');
    if(scored.length!==24)flags.push('invalid_scored');
    if(checks.length!==4||checkCorrect<3)flags.push('check_failed');
    if(record.status==='aborted'||record.trials.some(t=>t.interrupted))flags.push('interrupted');
    return {valid_trials:scored.length,correct:correct.length,...wilson(correct.length,scored.length),median_rt_ms:P.median(correct.map(t=>t.rt_ms)),levels:CONFIG.contrasts.map(contrast=>{
      const ts=scored.filter(t=>record.schedule[t.schedule_index].contrast===contrast),c=ts.filter(t=>t.correct).length;
      return {contrast,n:ts.length,correct:c,...wilson(c,ts.length)};
    }),checks:{n:checks.length,correct:checkCorrect},qualified:flags.length===0,flags,input_mode:inputMode(record.trials)};
  }
  function validate(record) {
    tree(record);
    if(!exactKeys(record,['schema','id','participant_id','created_at','completed_at','status','stop_reason','seed','config','access_confirmation','setup','input_mode','elapsed_ms','schedule','trials','summary'])||record.schema!==SCHEMA||!id(record.id)||!id(record.participant_id)||!iso(record.created_at)||!iso(record.completed_at)||!between(record.elapsed_ms,0,DAY))fail('记录标识或日期无效。');
    const wall=Date.parse(record.completed_at)-Date.parse(record.created_at);
    if(wall<0||Math.abs(wall-record.elapsed_ms)>2000)fail('记录时间与测量时长不一致。');
    if(!['complete','aborted'].includes(record.status)||!['complete','user_stop','window_blur','page_hidden','resize','time_limit'].includes(record.stop_reason)||(record.status==='complete')!==(record.stop_reason==='complete'))fail('结束状态无效。');
    if(record.status==='complete'&&record.elapsed_ms>=CONFIG.cap_ms || record.stop_reason==='time_limit'&&record.elapsed_ms<CONFIG.cap_ms)fail('测量超出时限。');
    const config=record.config?.version===LEGACY_CONFIG.version?LEGACY_CONFIG:CONFIG;
    if(!equal(record.config,config)||!integer(record.seed,0,4294967295)||!equal(record.schedule,schedule(record.seed,config.version)))fail('固定条件或随机顺序不一致。');
    const a=record.access_confirmation,s=record.setup;
    if(!exactKeys(a,['access','confirmed','confirmed_at'])||!['healthy','postop'].includes(a.access)||a.confirmed!==true||!iso(a.confirmed_at)||Date.parse(a.confirmed_at)>Date.parse(record.created_at)||Date.parse(record.created_at)-Date.parse(a.confirmed_at)>DAY)fail('本次使用确认无效。');
    const setupKeys=['device_id','distance_cm','px_per_mm','brightness_percent','stimulus_css_px','device_pixel_ratio','viewport','screen','user_agent','correction','ambient','calibration','calibration_confirmed_at','spatial_frequency_cpd','aperture_deg','eye','gamma','contrast_units','frame_ms','frame_check','fingerprint'];
    if(config.version===CONFIG.version){
      setupKeys.push('clinical','clinical_local_date');
      const day=s?.clinical_local_date,utcDay=record.completed_at.slice(0,10);
      if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+'T00:00:00Z'))||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day||Math.abs(Date.parse(day+'T00:00:00Z')-Date.parse(utcDay+'T00:00:00Z'))>DAY)fail('临床信息采集日期无效。');
      C.validate(s.clinical,a.access,day);
    }
    if(!exactKeys(s,setupKeys)||!id(s.device_id)||!between(s.distance_cm,30,100)||!between(s.px_per_mm,2,15)||!between(s.brightness_percent,10,100)||!between(s.stimulus_css_px,60,1200)||!between(s.device_pixel_ratio,.5,8)||!Array.isArray(s.viewport)||s.viewport.length!==2||!s.viewport.every(x=>integer(x,1,20000))||!Array.isArray(s.screen)||s.screen.length!==3||!s.screen.slice(0,2).every(x=>integer(x,1,20000))||!integer(s.screen[2],1,64)||typeof s.user_agent!=='string'||s.user_agent.length<1||s.user_agent.length>1000||!['none','glasses','contacts','other'].includes(s.correction)||!['daylight','room_light','dim'].includes(s.ambient)||s.calibration!=='physical_ruler_self_report'||!iso(s.calibration_confirmed_at)||s.calibration_confirmed_at!==a.confirmed_at||s.spatial_frequency_cpd!==3||s.aperture_deg!==4||s.eye!=='OU'||s.gamma!=='unmeasured'||s.contrast_units!=='digital_code'||!warmupOK(s.frame_check)||!near(s.frame_ms,P.median(s.frame_check))||s.fingerprint!==fingerprint(s,config.version))fail('屏幕校准、观看条件或显示节奏无效。');
    const size=2*s.distance_cm*10*Math.tan(2*Math.PI/180)*s.px_per_mm;
    if(!near(size,s.stimulus_css_px)||size>s.viewport[0]-48||size>s.viewport[1]-240)fail('刺激尺寸与物理校准不一致。');
    if(!Array.isArray(record.trials)||record.trials.length>30||record.status==='complete'&&record.trials.length!==30)fail('试次数量无效。');
    let previous=null;
    record.trials.forEach((t,i)=>{
      if(!exactKeys(t,['schedule_index','fixation_onset_ms','onset_ms','offset_ms','response_ms','response','response_input','rt_ms','exposure_ms','target_ms','frame_intervals','interrupted','correct','valid','flags'])||t.schedule_index!==i||!between(t.fixation_onset_ms,0,record.elapsed_ms)||!near(t.target_ms,frameTarget(s.frame_ms))||!Array.isArray(t.frame_intervals)||t.frame_intervals.length>1000||!t.frame_intervals.every(x=>between(x,0,DAY))||typeof t.interrupted!=='boolean'||typeof t.valid!=='boolean'||!Array.isArray(t.flags)||t.flags.length>4)fail('试次字段或顺序无效。');
      if(previous && (previous.onset_ms===null || t.fixation_onset_ms+1<previous.onset_ms+1800+150 || previous.response_ms!==null&&previous.response_ms>t.fixation_onset_ms || previous.offset_ms!==null&&previous.offset_ms>t.fixation_onset_ms))fail('试次时序重叠。');
      if(t.interrupted&&(record.status!=='aborted'||i!==record.trials.length-1))fail('中断试次位置无效。');
      if(t.onset_ms===null){
        if(!t.interrupted||t.offset_ms!==null||t.response!==null||t.response_input!==null||t.response_ms!==null||t.rt_ms!==null||t.exposure_ms!==null||t.frame_intervals.length)fail('未呈现试次包含回答或曝光。');
      }else{
        if(!between(t.onset_ms,t.fixation_onset_ms+349,record.elapsed_ms)||t.onset_ms>=CONFIG.cap_ms)fail('刺激出现时间无效。');
        if(t.offset_ms===null)fail('已呈现试次缺少曝光结束时间。');
        else if(!between(t.offset_ms,t.onset_ms,record.elapsed_ms)||!near(t.exposure_ms,t.offset_ms-t.onset_ms)||!near(t.frame_intervals.reduce((n,x)=>n+x,0),t.exposure_ms))fail('曝光与逐帧日志不一致。');
        if(!t.interrupted && record.elapsed_ms+1<t.onset_ms+1800)fail('试次未完成固定回答窗口。');
        if(t.response===null){if(t.response_input!==null||t.response_ms!==null||t.rt_ms!==null)fail('超时试次包含回答数据。');}
        else if(typeof t.response!=='boolean'||!['keyboard','pointer'].includes(t.response_input)||!between(t.response_ms,t.onset_ms,record.elapsed_ms)||!near(t.rt_ms,t.response_ms-t.onset_ms))fail('回答与反应时不一致。');
      }
      const expectedCorrect=t.response===null?null:t.response===record.schedule[i].right;
      const flags=trialFlags(t,s.frame_ms);
      if(t.correct!==expectedCorrect||!equal(t.flags,flags)||t.valid!==(flags.length===0))fail('正确性或计时质量标记不一致。');
      previous=t;
    });
    if(record.input_mode!==inputMode(record.trials)||!equal(record.summary,summarize(record)))fail('摘要与原始回答不一致。');
    return record;
  }
  const pending=new Map(),acknowledged=new Map();let journal=null;
  function getJournal(){
    if(journal)return journal;
    try{if(root.NVDrafts&&root.localStorage)journal=root.NVDrafts.createStore(root.localStorage,{validate});}catch(_){}
    return journal;
  }
  function isStored(record){return typeof root.NVRecovery?.containsSnapshot==='function'?root.NVRecovery.containsSnapshot(record):acknowledged.get(record.id)===JSON.stringify(record);}
  function draftStatus(participantId){
    const all=getJournal()?.list()||{records:[],issues:[]},saved=all.records.filter(x=>x.participant_id===participantId&&!isStored(x));
    const ids=new Set(saved.map(x=>x.id)),memory=pending.get(participantId);if(memory?.record&&!isStored(memory.record))ids.add(memory.record.id);
    const known=root.NVRecovery?.knownParticipants?.()||[participantId],orphans=all.records.filter(x=>!known.includes(x.participant_id)).length;
    const cap=getJournal()?.capacity(),messages=[];
    if(all.issues.length)messages.push('恢复副本需要核查。');
    if(orphans)messages.push(`另有 ${orphans} 份快照的原档案暂不可用，可备份恢复资料。`);
    if(cap&&cap.count!==null&&!cap.available)messages.push('恢复副本容量已满，请导出备份后在新的浏览器存储中继续。');
    return {count:ids.size,persistent_count:saved.length,backup_count:all.records.length,orphan_count:orphans,warning:messages.join(' ')};
  }
  function hasPending(participantId){return draftStatus(participantId).count>0;}
  function exportPending(){const value=getJournal();if(!value)fail('本机暂存不可读取。');return value.exportRaw();}
  function preserve(current){
    if(!current?.record)return;
    current.protection=getJournal()?.put(current.record)||{saved:false,message:'本机暂存不可用。'};
  }
  const api={SCHEMA,CONFIG,LEGACY_CONFIG,start,hasPending,draftStatus,exportPending,validate,summarize,schedule,fingerprint,trialFlags,wilson,frameTarget,inputMode,warmupOK};
  if(typeof module!=='undefined')module.exports=api;
  root.NVSnapshot=api;
  if(!root.document)return;
  let run=null,epoch=0,lastFocus=null,dialog=null;
  const CACHE='neurovision.snapshot.setup.v1';
  const labels={incomplete:'本次任务未完成',invalid_scored:'部分正式试次无效',check_failed:'容易试次未达到核对要求',interrupted:'测量发生中断'};
  const stopLabels={user_stop:'已手动结束',window_blur:'窗口失去焦点',page_hidden:'页面进入后台',resize:'窗口尺寸改变',time_limit:'已到 120 秒上限'};
  function $(id){return dialog.querySelector('#'+id);}
  function header(title,subtitle=''){return `<header class="nr-head"><div><p class="nr-kicker">NEUROVISION / SNAPSHOT</p><h2 id="ns-title">${title}</h2>${subtitle?`<p class="nr-sub">${subtitle}</p>`:''}</div><button type="button" class="nr-stop" id="ns-stop">结束 <span>Esc</span></button></header>`;}
  function wireStop(){ $('ns-stop').onclick=()=>run?.active?finish('user_stop'):close(); }
  function close(saved=false){
    epoch++;const current=run;if(current?.capTimer)clearTimeout(current.capTimer);
    if(current?.record){if(saved===true){pending.delete(current.options.participant_id);acknowledged.set(current.record.id,JSON.stringify(current.record));}else{preserve(current);pending.set(current.options.participant_id,current);}}
    run=null;dialog.close();
    if(current?.record&&typeof current.options.onPendingChange==='function'){try{current.options.onPendingChange(saved!==true);}catch(_){} }
    if(lastFocus&&document.contains(lastFocus))lastFocus.focus();else (document.querySelector('#main [data-start-snapshot]')||document.querySelector('#main'))?.focus();
  }
  function init(){
    if(dialog)return;
    dialog=document.createElement('dialog');dialog.className='nv-runner nv-snapshot';dialog.setAttribute('aria-labelledby','ns-title');document.body.append(dialog);
    dialog.addEventListener('cancel',event=>{event.preventDefault();if(run?.active)finish('user_stop');else close();});
    root.addEventListener('blur',()=>interrupt('window_blur'));
    document.addEventListener('visibilitychange',()=>{if(document.hidden)interrupt('page_hidden');});
    root.addEventListener('resize',()=>interrupt('resize'));
    document.addEventListener('keydown',event=>{if(!dialog.open||event.repeat||!['ArrowLeft','ArrowRight'].includes(event.key))return;if(run?.current?.onset_ms!==null&&run?.active){event.preventDefault();respond(event.key==='ArrowRight','keyboard');}});
  }
  function interrupt(reason){
    if(run?.active){finish(reason);return;}
    if(run?.preparing){epoch++;run.preparing=false;$('ns-error').textContent='检查已中断，请保持当前窗口并重新确认。';$('ns-ready').disabled=false;}
  }
  function start(options={}){
    if(!root.document)fail('开始任务需要浏览器。');init();
    if(dialog.open)return false;
    if(options.access!=='postop')fail('本工具仅用于 ICL 术后记录。');
    if(!id(options.participant_id)||typeof options.onComplete!=='function')fail('匿名档案或保存回调缺失。');
    lastFocus=document.activeElement;
    const stored=getJournal()?.list(options.participant_id).records.find(x=>!isStored(x));
    if(pending.has(options.participant_id)||stored){epoch++;run=pending.get(options.participant_id)||{record:stored,options,active:false,saving:false};run.options=options;result();dialog.showModal();return true;}
    const capacity=getJournal()?.capacity();if(capacity&&capacity.count!==null&&!capacity.available)fail('恢复副本容量已满，请先导出项目恢复资料，并在新的浏览器存储中继续。');
    const seedBytes=new Uint32Array(1);root.crypto.getRandomValues(seedBytes);
    lastFocus=document.activeElement;epoch++;run={options,seed:seedBytes[0],schedule:schedule(seedBytes[0]),trials:[],active:false,preparing:false,record:null,textures:new Map()};
    let cached=null;try{cached=JSON.parse(root.localStorage.getItem(CACHE)||'null');}catch(_){}
    dialog.innerHTML=header('ICL 术后测量设置','判断条纹方向，约 70 秒。首次需校准。')+`<div class="nr-setup ns-setup"><p class="ns-intro">双眼自然观看，保持本次佩戴情况。此研究快照记录本次方向辨别表现。</p>${C.form(options.clinical,options.access)}<div class="nr-cal"><div class="nr-label"><b>用实体尺核对 3 cm</b><span>移动滑块，使线段长度与尺子一致</span></div><div class="nr-ruler-wrap"><div id="ns-ruler"><span>3 cm</span></div></div><label class="nr-range">线段长度<input id="ns-scale" type="range" min="60" max="${Math.min(450,root.innerWidth-64)}" step="1" value="114"></label><div class="nr-fields"><label>观看距离 · cm<input id="ns-distance" type="number" min="30" max="100" value="60" inputmode="decimal"></label><label>系统亮度设置 · %<input id="ns-brightness" type="number" min="10" max="100" value="70" inputmode="numeric"></label><label>本次额外佩戴<select id="ns-correction"><option value="none">未额外佩戴眼镜</option><option value="glasses">框架眼镜</option><option value="contacts">隐形眼镜</option><option value="other">其他额外佩戴</option></select></label><label>室内照明<select id="ns-ambient"><option value="room_light">室内灯光</option><option value="daylight">日间自然光</option><option value="dim">较暗环境</option></select></label></div><p class="nr-help">固定设备和坐姿，关闭自动亮度与自动色温。数字对比度尚未经屏幕光度校准，跨设备结果不宜直接比较。</p></div><label class="nr-check"><input id="ns-cal-confirm" type="checkbox"> ${cached?'已重新核对实体尺、观看距离和屏幕亮度':'已用实体尺核对 3 cm，并确认观看距离和亮度'}</label><label class="nr-check ns-access"><input id="ns-access-confirm" type="checkbox"> 医生已允许我进行屏幕视觉测试，目前观看舒适</label><p id="ns-error" role="status"></p><button type="button" class="nr-primary" id="ns-ready">确认设置</button></div>`;
    if(cached&&object(cached)){if(between(cached.scale,60,+$('ns-scale').max))$('ns-scale').value=cached.scale;if(between(cached.distance_cm,30,100))$('ns-distance').value=cached.distance_cm;if(between(cached.brightness_percent,10,100))$('ns-brightness').value=cached.brightness_percent;if(['none','glasses','contacts','other'].includes(cached.correction))$('ns-correction').value=cached.correction;if(['daylight','room_light','dim'].includes(cached.ambient))$('ns-ambient').value=cached.ambient;}
    $('ns-ruler').style.width=$('ns-scale').value+'px';$('ns-scale').oninput=()=>{$('ns-ruler').style.width=$('ns-scale').value+'px';};$('ns-ready').onclick=prepare;wireStop();dialog.showModal();$('ns-scale').focus();return true;
  }
  async function prepare(){
    const error=$('ns-error');
    if(!$('ns-cal-confirm').checked||!$('ns-access-confirm').checked){error.textContent='请核对屏幕设置，并勾选本次使用确认。';return;}
    const distance=+$('ns-distance').value,brightness=+$('ns-brightness').value,px=+$('ns-scale').value/30;
    if(!between(distance,30,100)||!between(brightness,10,100)||!between(px,2,15)){error.textContent='观看距离请填写 30–100 cm，亮度填写 10–100%。';return;}
    const size=2*distance*10*Math.tan(2*Math.PI/180)*px,maxSize=Math.min(root.innerWidth-72,root.innerHeight-280,420);
    if(size<60||size>maxSize){error.textContent='当前 4° 图案无法完整放入窗口。请使用更大屏幕，或在规定范围内调整观看距离后重新核对。';return;}
    let clinical;try{clinical=clone(C.read(dialog,run.options.access));}catch(e){error.textContent=e.message;return;}
    const now=new Date().toISOString();
    run.access_confirmation={access:run.options.access,confirmed:true,confirmed_at:now};
    run.setup={device_id:root.NVStore?.deviceId?.()||root.crypto.randomUUID(),distance_cm:distance,px_per_mm:px,brightness_percent:brightness,stimulus_css_px:size,device_pixel_ratio:root.devicePixelRatio,viewport:[root.innerWidth,root.innerHeight],screen:[root.screen.width,root.screen.height,root.screen.colorDepth],user_agent:root.navigator.userAgent,correction:$('ns-correction').value,ambient:$('ns-ambient').value,calibration:'physical_ruler_self_report',calibration_confirmed_at:now,spatial_frequency_cpd:3,aperture_deg:4,eye:'OU',gamma:'unmeasured',contrast_units:'digital_code',frame_ms:null,frame_check:[],fingerprint:'',clinical:Object.freeze(clinical),clinical_local_date:C.localDay()};
    $('ns-ready').disabled=true;run.preparing=true;error.textContent='正在检查 30 个屏幕刷新间隔…';
    const token=epoch,intervals=[];let previous=null;
    await new Promise(resolve=>{function frame(time){if(token!==epoch){resolve();return;}if(previous!==null)intervals.push(time-previous);previous=time;if(intervals.length<30)root.requestAnimationFrame(frame);else resolve();}root.requestAnimationFrame(frame);});
    if(token!==epoch)return;
    if(!warmupOK(intervals)){run.preparing=false;error.textContent='显示节奏不稳定，请关闭高负载应用，保持当前窗口后重试。';$('ns-ready').disabled=false;return;}
    if(typeof run.options.onClinical==='function'){
      try{const saved=await run.options.onClinical(clone(clinical));if(token!==epoch)return;if(saved===false)throw Error('手术信息未能保存，请重试。');}
      catch(e){if(token!==epoch)return;run.preparing=false;error.textContent=e.message||'手术信息未能保存，请重试。';$('ns-ready').disabled=false;return;}
    }
    run.setup.frame_ms=P.median(intervals);run.setup.frame_check=intervals;run.setup.fingerprint=fingerprint(run.setup);
    try{root.localStorage.setItem(CACHE,JSON.stringify({scale:px*30,distance_cm:distance,brightness_percent:brightness,correction:run.setup.correction,ambient:run.setup.ambient}));}catch(_){}
    run.preparing=false;instructions();
  }
  function instructions(){
    dialog.innerHTML=header('判断条纹倾斜方向')+`<div class="nr-instructions"><div class="nr-example-pair"><figure><div class="nr-gabor nr-tilt-left"></div><figcaption>向左倾斜 ↖</figcaption></figure><figure><div class="nr-gabor nr-tilt-right"></div><figcaption>向右倾斜 ↗</figcaption></figure></div><h3>注视中央，出现图案后选一个方向。</h3><p>可以按键盘 ← / →，也可以点击下方方向按钮。看不清时仍请选一个方向；每次只记录第一次回答。</p><p>先练习 2 次，再连续完成 28 次。请尽量使用同一种输入方式，保持坐姿与观看距离。中途切换窗口或改变尺寸会结束本次任务。</p><p class="nr-help">注视中央，图案会短暂呈现。出现不适可随时按 Esc 结束。</p><button type="button" class="nr-primary" id="ns-begin">开始 2 次练习</button></div>`;wireStop();$('ns-begin').onclick=begin;$('ns-begin').focus();
  }
  function begin(){
    if(!run)return;
    if(document.hidden||!document.hasFocus()){return;}
    if(run.setup.viewport[0]!==root.innerWidth||run.setup.viewport[1]!==root.innerHeight||run.setup.device_pixel_ratio!==root.devicePixelRatio){const options=run.options;close();start(options);return;}
    dialog.innerHTML=header('视觉表现快照')+`<div class="nr-status"><span id="ns-phase">练习</span><span id="ns-count"></span></div><div class="nr-stage ns-stage"><canvas id="ns-canvas" aria-label="判断中央图案的倾斜方向"></canvas></div><div class="nr-responses"><button type="button" id="ns-left" disabled>← 向左倾斜</button><button type="button" id="ns-right" disabled>向右倾斜 →</button></div><p class="nr-stage-foot" id="ns-foot">注视中央，出现图案后回答。</p>`;wireStop();
    const canvas=$('ns-canvas');canvas.width=canvas.height=256;canvas.style.width=canvas.style.height=run.setup.stimulus_css_px+'px';$('ns-canvas').parentElement.style.height=Math.max(220,run.setup.stimulus_css_px+12)+'px';
    run.ctx=canvas.getContext('2d');run.schedule.forEach(item=>{const k=textureKey(item);if(!run.textures.has(k))run.textures.set(k,gabor(item));});
    $('ns-left').onpointerdown=e=>{if(e.isPrimary!==false&&e.button===0){e.preventDefault();respond(false,'pointer');}};
    $('ns-right').onpointerdown=e=>{if(e.isPrimary!==false&&e.button===0){e.preventDefault();respond(true,'pointer');}};
    run.created_at=new Date().toISOString();run.origin=root.performance.now();run.active=true;
    const cap=()=>{if(!run?.active)return;const remaining=CONFIG.cap_ms-elapsed();if(remaining>0)run.capTimer=root.setTimeout(cap,remaining);else finish('time_limit');};
    run.capTimer=root.setTimeout(cap,CONFIG.cap_ms);run.index=0;nextTrial();
  }
  function textureKey(t){return [t.contrast,t.right,t.phase].join('/');}
  function gabor(t){
    const img=run.ctx.createImageData(256,256);
    for(let y=0;y<256;y++)for(let x=0;x<256;x++){
      const dx=(x-127.5)/64,dy=(y-127.5)/64,r2=dx*dx+dy*dy;
      const envelope=r2<=4?Math.exp(-r2/(2*.65*.65)):0,coordinate=(dx+(t.right?1:-1)*dy)/Math.SQRT2;
      const v=Math.round(128*(1+t.contrast*envelope*Math.cos(2*Math.PI*3*coordinate+t.phase*Math.PI))),k=(y*256+x)*4;
      img.data[k]=img.data[k+1]=img.data[k+2]=v;img.data[k+3]=255;
    }return img;
  }
  function blank(fix=false){if(!run?.ctx)return;const c=run.ctx;c.fillStyle='#808080';c.fillRect(0,0,256,256);if(fix){c.strokeStyle='#4a4a4a';c.lineWidth=1;c.beginPath();c.moveTo(125,128);c.lineTo(131,128);c.moveTo(128,125);c.lineTo(128,131);c.stroke();}}
  function disable(value=true){if($('ns-left'))$('ns-left').disabled=$('ns-right').disabled=value;}
  function elapsed(){return root.performance.now()-run.origin;}
  function live(token){if(!run?.active||token!==epoch)return false;if(elapsed()>=CONFIG.cap_ms){finish('time_limit');return false;}if(run.setup.viewport[0]!==root.innerWidth||run.setup.viewport[1]!==root.innerHeight||run.setup.device_pixel_ratio!==root.devicePixelRatio){finish('resize');return false;}return true;}
  function nextTrial(){
    const token=epoch;if(!live(token))return;
    if(run.index===30){finish('complete');return;}
    const item=run.schedule[run.index];$('ns-phase').textContent=item.kind==='practice'?'练习':'正式任务';$('ns-count').textContent=item.kind==='practice'?`${run.index+1} / 2`:`${run.index-1} / 28`;disable();
    const t={schedule_index:run.index,fixation_onset_ms:elapsed(),onset_ms:null,offset_ms:null,response_ms:null,response:null,response_input:null,rt_ms:null,exposure_ms:null,target_ms:frameTarget(run.setup.frame_ms),frame_intervals:[],interrupted:false,correct:null,valid:false,flags:[]};run.current=t;
    // rAF stamps may precede or follow callback execution. Log actual draw/event
    // callback time on one monotonic clock; retain delay in the raw intervals.
    root.requestAnimationFrame(function fixation(){if(!live(token)||run.current!==t)return;const rel=elapsed();if(!t.fixationDrawn){t.fixation_onset_ms=rel;t.fixationDrawn=true;blank(true);}if(rel-t.fixation_onset_ms<350){root.requestAnimationFrame(fixation);return;}t.onset_ms=rel;t.last_frame_ms=rel;run.ctx.putImageData(run.textures.get(textureKey(item)),0,0);disable(false);t.endTimer=root.setTimeout(()=>completeTrial(t),Math.max(0,1800-(elapsed()-t.onset_ms)));root.requestAnimationFrame(function exposure(){if(!live(token)||run.current!==t||t.offset_ms!==null)return;const now=elapsed();t.frame_intervals.push(now-t.last_frame_ms);t.last_frame_ms=now;if(now-t.onset_ms>=t.target_ms-.1){t.offset_ms=now;t.exposure_ms=now-t.onset_ms;blank();}else root.requestAnimationFrame(exposure);});});
  }
  function respond(right,input){
    const token=epoch;if(!live(token))return;const t=run.current;
    if(!t||t.onset_ms===null||t.response!==null)return;
    t.response_ms=elapsed();t.rt_ms=t.response_ms-t.onset_ms;t.response=right;t.response_input=input;disable();
  }
  function seal(t,interrupted){
    if(t.endTimer)clearTimeout(t.endTimer);t.interrupted=interrupted;
    if(t.onset_ms!==null&&t.offset_ms===null){const now=elapsed();t.frame_intervals.push(now-t.last_frame_ms);t.offset_ms=now;t.exposure_ms=now-t.onset_ms;}
    t.correct=t.response===null?null:t.response===run.schedule[t.schedule_index].right;t.flags=trialFlags(t,run.setup.frame_ms);t.valid=t.flags.length===0;
    const {endTimer,fixationDrawn,last_frame_ms,...raw}=t;run.trials.push(raw);run.current=null;disable();blank();
  }
  function completeTrial(t){
    const token=epoch;if(!live(token)||run.current!==t)return;
    // Timers can wake slightly early; never shorten the promised response window.
    const remaining=1800-(elapsed()-t.onset_ms);if(remaining>0){t.endTimer=root.setTimeout(()=>completeTrial(t),remaining);return;}
    seal(t,false);const item=run.schedule[run.index];if(item.kind==='practice')$('ns-foot').textContent=t.valid?(t.correct?'方向正确。':'下一次留意条纹的倾斜方向。'):'请在图案出现后及时选择方向。';else $('ns-foot').textContent='保持观看距离，每次选一个方向。';run.index++;root.setTimeout(()=>{if(live(token))nextTrial();},150);
  }
  function finish(reason){
    if(!run?.active)return;
    const duration=elapsed();if(duration>=CONFIG.cap_ms)reason='time_limit';
    if(run.current)seal(run.current,true);
    run.active=false;clearTimeout(run.capTimer);epoch++;
    const record={schema:SCHEMA,id:'snapshot-'+root.crypto.randomUUID(),participant_id:run.options.participant_id,created_at:run.created_at,completed_at:new Date().toISOString(),status:reason==='complete'?'complete':'aborted',stop_reason:reason,seed:run.seed,config:clone(CONFIG),access_confirmation:run.access_confirmation,setup:run.setup,input_mode:inputMode(run.trials),elapsed_ms:elapsed(),schedule:run.schedule,trials:run.trials,summary:null};record.summary=summarize(record);run.record=record;result();
  }
  const percent=n=>n===null?'—':Math.round(n*100)+'%';
  function result(){
    preserve(run);const r=run.record,s=r.summary;
    let clinicalText='';try{if(r.setup.clinical)clinicalText=C.summary(r.setup.clinical,r.setup.clinical_local_date);}catch(_){clinicalText='手术信息需要核查';}
    dialog.innerHTML=header(s.qualified?'本次视觉表现':'本次结果需要留意')+`<div class="ns-result">${clinicalText?`<p class="nr-help">${clinicalText}</p>`:''}<p class="ns-result-state">${s.qualified?'已完成全部有效试次。':`${r.status==='aborted'?(stopLabels[r.stop_reason]||'任务已结束')+'。':''}${s.flags.map(x=>labels[x]).join('；')}。原始回答仍会保留。`}</p><div class="ns-metrics"><div><span>正式试次 · 答对 / 有效</span><strong>${s.correct} / ${s.valid_trials}</strong><small>正确率 ${percent(s.accuracy)} · 95% 区间 ${percent(s.low)}–${percent(s.high)}</small></div><div><span>答对时的反应时间中位数</span><strong>${s.median_rt_ms===null?'—':Math.round(s.median_rt_ms)}<small>${s.median_rt_ms===null?'':' ms'}</small></strong><small>仅包括答对且计时有效的正式试次</small></div></div><div class="ns-levels"><table><thead><tr><th>数字对比度</th><th>答对 / 有效</th><th>正确率 · 95% 区间</th></tr></thead><tbody>${s.levels.map(level=>`<tr><td>${Math.round(level.contrast*100)}%</td><td>${level.correct} / ${level.n}</td><td>${percent(level.accuracy)} <small>(${percent(level.low)}–${percent(level.high)})</small></td></tr>`).join('')}</tbody></table></div><p class="nr-help">容易试次：答对 ${s.checks.correct} / 有效 ${s.checks.n}，共安排 4 次。未回答或计时无效的试次不计入正确率分母。练习不计分。</p><p class="nr-help">结果描述固定条件下的任务表现；临床含义尚待验证。每个对比仅 8 题，请结合区间观察。</p><p class="nr-help ns-protection" role="status">${run.protection.saved?'已在本机暂存，刷新后可从同一档案返回。正式保存后记入记录，独立副本继续保留。':'本机暂存未成功，当前仅保留在此页面。离开或刷新前请下载备份。'}</p><p id="ns-save-error" role="status"></p><div class="ns-result-actions"><button type="button" class="nr-primary" id="ns-save">保存本次结果</button><button type="button" id="ns-download" class="ns-secondary">下载本次备份</button><button type="button" id="ns-raw-download" class="ns-secondary" hidden>下载应急原始日志</button><button type="button" id="ns-leave" class="ns-secondary">暂时关闭，保留结果</button></div></div>`;wireStop();$('ns-save').onclick=save;$('ns-download').onclick=download;$('ns-raw-download').onclick=downloadRaw;$('ns-leave').onclick=()=>close();$('ns-save').disabled=!!run.saving;$('ns-save').focus();
  }
  async function save(){
    const current=run;if(!current?.record||current.saving)return;current.saving=true;$('ns-save').disabled=true;
    try{
      validate(current.record);const saved=await current.options.onComplete(clone(current.record));
      if(saved===true){
        if(run===current){close(true);return;}
        if(pending.get(current.options.participant_id)===current){pending.delete(current.options.participant_id);acknowledged.set(current.record.id,JSON.stringify(current.record));try{current.options.onPendingChange?.(false);}catch(_){} }
        return;
      }
      throw Error('本机未能保存本次结果。');
    }
    catch(error){if(run!==current)return;$('ns-save-error').textContent=`${error.message||'本机保存失败。'} 请重试保存或下载备份；当前结果仍保留。`;$('ns-save').disabled=false;$('ns-raw-download').hidden=false;}
    finally{current.saving=false;}
  }
  function downloadContent(content,name){
    const url=root.URL.createObjectURL(new Blob([content],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=name;link.click();root.setTimeout(()=>root.URL.revokeObjectURL(url),1000);
  }
  function download(){
    if(!run?.record)return;
    try{validate(run.record);const content=root.NVRecovery.exportSnapshot(clone(run.record));if(typeof content!=='string')throw Error('备份接口不可用。');downloadContent(content,`neurovision-snapshot-${run.record.id}.json`);$('ns-save-error').textContent='已发起备份下载。确认文件已保存后，可离开；之后可在主页面导入。';}
    catch(error){$('ns-raw-download').hidden=false;$('ns-save-error').textContent=`有效备份未能生成：${error.message} 可下载应急原始日志保留回答，或暂时关闭后重试。`;}
  }
  function downloadRaw(){
    if(!run?.record)return;
    try{
      let validationError=null;try{validate(run.record);}catch(error){validationError=String(error.message||error);}
      const content=JSON.stringify({schema:'neurovision.snapshot.raw-log.v1',purpose:'emergency_raw_log',notice:'应急原始日志；未作为有效备份导出，不代表经验证的测量，不可直接导入正式记录。',exported_at:new Date().toISOString(),validation_error:validationError,raw_record:run.record},null,2);
      downloadContent(content,`neurovision-emergency-raw-${run.record.id}.json`);$('ns-save-error').textContent='已发起应急原始日志下载。它保留本次原始回答，不是有效测量备份；请保存文件以供核查。';
    }catch(error){$('ns-save-error').textContent=`原始日志下载失败：${error.message} 结果仍保留在此页面，可暂时关闭后重试。`;}
  }
})(typeof window==='undefined'?globalThis:window);
