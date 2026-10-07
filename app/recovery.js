(function (root) {
  'use strict';
  const SCHEMA = 'neurovision.recovery.v0.3', KEY = 'neurovision.recovery.v0.3', DAY = 86400000;
  const SCHEMA_V4 = 'neurovision.recovery.v0.4';
  const SCHEMA_V6 = 'neurovision.recovery.v0.6';
  const SCHEMA_V7 = 'neurovision.recovery.v0.7';
  const practiceModule = () => root.NVPerceptualTraining || (typeof require === 'function' ? require('./perceptual-training.js') : null);
  const daily = () => root.NVDaily || (typeof require === 'function' ? require('./daily.js') : null);
  const clinicalModule = () => root.NVClinical || (typeof require === 'function' ? require('./clinical.js') : null);
  const snapshotModule = () => root.NVSnapshot || (typeof require === 'function' ? require('./snapshot.js') : null);
  const medicalModule = () => root.NVMedical || (typeof require === 'function' ? require('./medical.js') : null);
  const upgrade = state => { if(![SCHEMA_V6,SCHEMA_V7].includes(state.schema)){state.schema=SCHEMA_V4;state.version='0.4.0';}state.observations ||= [];state.snapshots ||= [];return state; };
  const upgradeMedical = state => { upgrade(state);if(state.schema!==SCHEMA_V7){state.schema=SCHEMA_V6;state.version='0.6.0';}state.medical_reports ||= [];state.care_profiles ||= [];return state; };
  const upgradePractice = state => {upgradeMedical(state);state.schema=SCHEMA_V7;state.version='0.7.0';state.practice_sessions ||= [];return state;};
  const LIMITS = { practice_sessions:200, profiles: 20, diaries: 2000, observations:2000, snapshots:200, medical_reports:500, care_profiles:500, plans: 40, attempts: 200, training: 200 };
  const clone = value => JSON.parse(JSON.stringify(value));
  const canonical = value => JSON.stringify(value, function (key, item) { return object(item) ? Object.fromEntries(Object.keys(item).sort().map(name=>[name,item[name]])) : item; });
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const fail = message => { throw new Error(message || '文件格式或记录数据无效。'); };
  const text = (value, max = 100, min = 0) => typeof value === 'string' && value.length >= min && value.length <= max;
  const id = value => text(value, 100, 1) && /^[A-Za-z0-9_-]+$/.test(value);
  const iso = value => text(value, 24, 24) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  const score = value => finite(value) && Number.isInteger(value) && value >= 0 && value <= 10;
  const keys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
  const uuid = prefix => `${prefix}-${root.crypto.randomUUID()}`;
  const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const conditionAt = (sequence, index) => sequence[index - 1] === 'A' ? 'blur' : 'neutral';
  function planProgress(plan, now = Date.now()) {
    const completed = plan.attempts.filter(attempt => attempt.qualified).length;
    const last = plan.attempts.at(-1);
    const next = last ? Date.parse(last.completed_at) + DAY : Date.parse(plan.created_at);
    return { plan_id: plan.plan_id, sequence: plan.sequence, visit_index: completed + 1, completed, condition: completed < 4 ? conditionAt(plan.sequence, completed + 1) : null, next_allowed_at: new Date(next).toISOString(), ready: completed < 4 && now >= next };
  }
  function currentPlanFor(state, participant) {
    const plans=state.plans.filter(plan=>plan.participant_id===participant).sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at));
    return plans.find(plan=>planProgress(plan).completed<4) || plans.at(-1) || null;
  }
  function validateTree(value, depth = 0, budget = { left: 6000000 }) {
    if (--budget.left < 0 || depth > 8) fail('文件内容过大或嵌套过深。');
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'number') { if (!finite(value)) fail('数值必须为有限值。'); return; }
    if (typeof value === 'string') { if (!text(value, 2000)) fail('文本过长。'); return; }
    if (Array.isArray(value)) { if (value.length > 2000) fail('列表过长。'); value.forEach(item => validateTree(item, depth + 1, budget)); return; }
    if (!object(value) || Object.keys(value).length > 50) fail();
    for (const [key, item] of Object.entries(value)) {
      if (!text(key, 80, 1) || ['__proto__', 'prototype', 'constructor'].includes(key)) fail();
      validateTree(item, depth + 1, budget);
    }
  }
  function validateTraining(record) {
    validateTree(record);
    if (!keys(record, ['schema','id','participant_id','arm','created_at','completed_at','status','fatigue_pre','fatigue_post','stop_reason','setup','summary','trials','protocol']) || !['neurovision.training.v0.3','neurovision.training.v0.4'].includes(record.schema) || !id(record.id) || !id(record.participant_id) || !['adaptive','reference'].includes(record.arm) || !['complete','aborted'].includes(record.status) || !iso(record.created_at) || !iso(record.completed_at) || Date.parse(record.completed_at) < Date.parse(record.created_at)) fail('练习记录标识、组别或时间无效。');
    if (![record.fatigue_pre,record.fatigue_post].every(value => value === null || (record.schema==='neurovision.training.v0.4'?['comfortable','noticeable','rest','stop'].includes(value):score(value))) || !text(record.stop_reason, 200) || !object(record.setup) || !object(record.summary) || !Array.isArray(record.trials) || record.trials.length > 200) fail('练习记录超出允许的范围。');
    const summary = record.summary;
    if (!keys(summary,['valid_trials','accuracy','elapsed_ms','scheduled_rest_ms']) || !Number.isInteger(summary.valid_trials) || summary.valid_trials < 0 || summary.valid_trials > record.trials.length || !(summary.accuracy === null || finite(summary.accuracy) && summary.accuracy >= 0 && summary.accuracy <= 1) || !finite(summary.elapsed_ms) || summary.elapsed_ms < 0 || summary.elapsed_ms > DAY || ![0,30000].includes(summary.scheduled_rest_ms)) fail('练习摘要无效。');
    const setup=record.setup;
    if (!keys(setup,['distance_cm','px_per_mm','brightness_percent','stimulus_css_px','frame_ms','frame_check','device_pixel_ratio','viewport','device_id','user_agent','spatial_frequency_cpd','noise','aperture_deg','eye','gamma','contrast_units','controller','step_log10']) || !finite(setup.distance_cm) || setup.distance_cm<30 || setup.distance_cm>100 || !finite(setup.px_per_mm) || setup.px_per_mm<2 || setup.px_per_mm>15 || !finite(setup.brightness_percent) || setup.brightness_percent<10 || setup.brightness_percent>100 || !finite(setup.stimulus_css_px) || setup.stimulus_css_px<100 || setup.stimulus_css_px>500 || !finite(setup.device_pixel_ratio) || setup.device_pixel_ratio<=0 || setup.device_pixel_ratio>10 || !Array.isArray(setup.viewport) || setup.viewport.length!==2 || !setup.viewport.every(value=>Number.isInteger(value)&&value>0&&value<=20000) || !id(setup.device_id) || !text(setup.user_agent,1000,1) || !Array.isArray(setup.frame_check) || setup.frame_check.length!==60 || !setup.frame_check.every(value=>finite(value)&&value>=0&&value<=DAY) || setup.gamma!=='unmeasured' || setup.contrast_units!=='digital_code' || setup.controller!=='3-down-1-up' || setup.step_log10!==.06) fail('练习设备设置无效。');
    if (!['complete','user_stop','discomfort','time_limit','attempt_limit','window_blur','page_hidden','resize'].includes(record.stop_reason) || (record.status==='complete') !== (record.stop_reason==='complete')) fail('练习结束原因无效。');
    record.trials.forEach(trial => {
      if (!keys(trial,['x','right','seed','noise','spatial_frequency_cpd','response','rt_ms','onset','exposure_ms','target_ms','frame_intervals','flags','valid','correct']) || typeof trial.valid !== 'boolean' || !Array.isArray(trial.flags) || trial.flags.length>8 || !trial.flags.every(flag=>['interrupted','timeout','anticipatory','timing_unstable','late_response'].includes(flag)) || !Array.isArray(trial.frame_intervals) || trial.frame_intervals.length>1000 || !trial.frame_intervals.every(value=>finite(value)&&value>=0&&value<=DAY) || ![trial.rt_ms,trial.onset,trial.exposure_ms].every(value=>value===null || finite(value)&&value>=0) || !finite(trial.target_ms) || trial.target_ms<=0 || (trial.correct!==undefined && typeof trial.correct!=='boolean')) fail('练习试次格式无效。');
    });
    const validator=root.NVTrainingValidator?.validate || (typeof require==='function' ? require('./training.js').validate : null);
    if (!validator) fail('练习校验模块未加载，请重新打开完整项目。');
    validator(record);
    return record;
  }
  function validateState(state) {
    validateTree(state);
    const v7=state?.schema===SCHEMA_V7,v6=v7||state?.schema===SCHEMA_V6,v4=v6||state?.schema===SCHEMA_V4;
    if (!keys(state, ['schema','version','active_participant_id','profiles','diaries','plans','training',...(v4?['observations','snapshots']:[]),...(v6?['medical_reports','care_profiles']:[]),...(v7?['practice_sessions']:[])]) || !(v7 ? state.version==='0.7.0' : v6 ? state.version==='0.6.0' : v4 ? state.version==='0.4.0' : state.schema===SCHEMA && state.version==='0.3.0') || !id(state.active_participant_id)) fail();
    for (const field of ['profiles','diaries','plans','training',...(v4?['observations','snapshots']:[]),...(v6?['medical_reports','care_profiles']:[]),...(v7?['practice_sessions']:[])]) if (!Array.isArray(state[field]) || state[field].length > LIMITS[field]) fail(`${field} 条数超过上限。`);
    const profiles = new Set(), diaryIds = new Set(), diaryDays = new Set(), planIds = new Set(), sessionIds = new Set(), trainingIds = new Set();
    for (const profile of state.profiles) {
      if (!keys(profile, ['participant_id','created_at','access',...(v4?['clinical']:[]),...(v7?['restored_from_practice']:[])]) || !id(profile.participant_id) || !iso(profile.created_at) || !['healthy','postop'].includes(profile.access) || profiles.has(profile.participant_id)) fail('匿名档案格式或编号重复。');
      if(profile.restored_from_practice!==undefined&&profile.restored_from_practice!==true)fail('恢复档案标记无效。');
      if(profile.clinical!==undefined)clinicalModule().validate(profile.clinical,profile.access);
      profiles.add(profile.participant_id);
    }
    if (!profiles.has(state.active_participant_id)) fail('当前匿名档案不存在。');
    for(const [field,method] of [['medical_reports','validateReport'],['care_profiles','validateCare']]){
      const seen=new Set();
      for(const item of state[field]||[]){
        medicalModule()[method](item);
        if(!profiles.has(item.participant_id)||seen.has(item.id)||state.profiles.find(p=>p.participant_id===item.participant_id)?.access!=='postop')fail('临床资料所属 ICL 档案不存在或编号重复。');
        seen.add(item.id);
      }
    }
    const practiceIds=new Set();
    for(const record of state.practice_sessions||[]){
      practiceModule().validateRecord(record);
      if(!profiles.has(record.participant_id)||state.profiles.find(p=>p.participant_id===record.participant_id)?.access!=='postop'||practiceIds.has(record.id))fail('训练所属档案不存在或编号重复。');
      practiceIds.add(record.id);
    }
    for (const diary of state.diaries) {
      if (!keys(diary, ['id','participant_id','created_at','local_date','timezone_offset','comfort','fatigue','night_interference','night_experience','note']) || !id(diary.id) || !profiles.has(diary.participant_id) || !iso(diary.created_at) || !text(diary.local_date,10,10) || !Number.isInteger(diary.timezone_offset) || Math.abs(diary.timezone_offset) > 840 || !score(diary.comfort) || !score(diary.fatigue) || !['rated','not_experienced'].includes(diary.night_experience) || !text(diary.note,240)) fail('日记存在缺失项或超出范围。');
      const expectedDay = new Date(Date.parse(diary.created_at) - diary.timezone_offset * 60000).toISOString().slice(0,10);
      if (expectedDay !== diary.local_date || (diary.night_experience === 'rated' ? !score(diary.night_interference) : diary.night_interference !== null)) fail('日记日期或夜间体验无效。');
      const dayKey = `${diary.participant_id}/${diary.local_date}`;
      if (diaryIds.has(diary.id) || diaryDays.has(dayKey)) fail('日记编号或同日记录重复。');
      diaryIds.add(diary.id); diaryDays.add(dayKey);
    }
    const observationIds=new Set(), observationDays=new Set(), snapshotIds=new Set();
    for (const item of state.observations || []) {
      if(!keys(item,['id','participant_id','created_at','local_date','timezone_offset','protocol','reading','breaks','night','note']) || !id(item.id) || !profiles.has(item.participant_id) || !iso(item.created_at) || !Number.isInteger(item.timezone_offset) || Math.abs(item.timezone_offset)>840 || item.protocol!==daily().PROTOCOL || !daily().validAnswers(item)) fail('场景记录格式无效。');
      const day=new Date(Date.parse(item.created_at)-item.timezone_offset*60000).toISOString().slice(0,10), key=item.participant_id+'/'+day;
      if(item.local_date!==day || observationIds.has(item.id) || observationDays.has(key)) fail('场景记录日期或编号重复。');
      observationIds.add(item.id);observationDays.add(key);
    }
    for (const item of state.snapshots || []) {
      snapshotModule().validate(item);
      if(!profiles.has(item.participant_id) || snapshotIds.has(item.id)) fail('快照所属档案不存在或编号重复。');
      snapshotIds.add(item.id);
    }
    for (const plan of state.plans) {
      if (!keys(plan, ['plan_id','participant_id','created_at','sequence','attempts']) || !id(plan.plan_id) || !profiles.has(plan.participant_id) || !iso(plan.created_at) || !['ABBA','BAAB'].includes(plan.sequence) || planIds.has(plan.plan_id) || !Array.isArray(plan.attempts) || plan.attempts.length > LIMITS.attempts) fail('重测计划格式无效。');
      planIds.add(plan.plan_id); let completed = 0, last = null, device = null;
      for (const attempt of plan.attempts) {
        if (!keys(attempt,['session_id','visit_index','condition','started_at','completed_at','qualified','reason','device_key','value']) || !id(attempt.session_id) || sessionIds.has(attempt.session_id) || attempt.visit_index !== completed + 1 || completed >= 4 || attempt.condition !== conditionAt(plan.sequence, attempt.visit_index) || !iso(attempt.started_at) || !iso(attempt.completed_at) || Date.parse(attempt.started_at) < Date.parse(plan.created_at) || Date.parse(attempt.completed_at) < Date.parse(attempt.started_at) || (last && Date.parse(attempt.started_at) < Date.parse(last.completed_at)) || typeof attempt.qualified !== 'boolean' || !text(attempt.reason,200) || !text(attempt.device_key,1500) || !(attempt.value === null || finite(attempt.value) && Math.abs(attempt.value) <= 1.8)) fail('重测尝试、条件或日期无效。');
        if (attempt.qualified) {
          if (!finite(attempt.value) || !attempt.device_key || (last && Date.parse(attempt.started_at) - Date.parse(last.completed_at) < DAY) || (device && device !== attempt.device_key)) fail('合格重测未满足间隔或设备要求。');
          device = attempt.device_key; completed++;
        }
        last = attempt; sessionIds.add(attempt.session_id);
      }
    }
    for (const profile of profiles) {
      if (state.plans.filter(plan => plan.participant_id === profile && planProgress(plan).completed < 4).length > 1) fail('一个匿名档案只能有一个进行中的计划。');
    }
    for (const training of state.training) {
      if(!v4 && training.schema!=='neurovision.training.v0.3')fail('新版练习需要 0.4 备份结构。');
      validateTraining(training);
      if (!profiles.has(training.participant_id) || trainingIds.has(training.id)) fail('练习编号重复或匿名档案不存在。');
      trainingIds.add(training.id);
    }
    return state;
  }
  function deviceKey(setup) {
    if (!setup || !text(setup.device_id,100,1) || ![setup.distance_cm,setup.px_per_mm,setup.brightness_percent,setup.device_pixel_ratio,setup.spatial_frequency_cpd].every(finite) || !Array.isArray(setup.viewport) || setup.viewport.length !== 2 || !setup.viewport.every(finite) || !text(setup.user_agent,1000,1)) return '';
    return JSON.stringify([setup.device_id,setup.distance_cm,setup.px_per_mm,setup.brightness_percent,setup.viewport,setup.device_pixel_ratio,setup.user_agent,setup.spatial_frequency_cpd]);
  }
  function createStore(storage, options = {}) {
    const now = options.now || (() => new Date()), makeId = options.makeId || uuid, random = options.random || (() => { const bytes = new Uint32Array(1); root.crypto.getRandomValues(bytes); return bytes[0] / 4294967296; });
    let error = '', blocked = false, state, persisted = null;
    const profile = () => ({ participant_id:makeId('NV'), created_at:now().toISOString(), access:'postop' });
    const fresh = () => { const first = profile(); return { schema:SCHEMA,version:'0.3.0',active_participant_id:first.participant_id,profiles:[first],diaries:[],plans:[],training:[] }; };
    try { const saved = storage.getItem(KEY); state = saved ? validateState(JSON.parse(saved)) : fresh(); persisted=saved; if (!saved) {persisted=JSON.stringify(state); storage.setItem(KEY,persisted); if(storage.getItem(KEY)!==persisted)throw new Error('storage verification');} }
    catch (err) { state = state || fresh(); error = '本机存储无法读取或写入。当前使用临时档案，请导出备份；重新打开后可能丢失。'; blocked = true; }
    const snapshot = () => clone(state);
    function commit(next, atomic = false) {
      validateState(next);
      if(new TextEncoder().encode(JSON.stringify(next)).length>12000000)fail('备份已接近 12 MB，请先导出并在新的浏览器存储中继续。');
      let changedElsewhere=false;try {if(!blocked)changedElsewhere=storage.getItem(KEY)!==persisted;}catch(err){}
      if(changedElsewhere){error='其他窗口已更新档案。请刷新后继续保存；待保存快照会保留。';throw new Error(error);}
      try { if (blocked) throw new Error(); const serialized=JSON.stringify(next);storage.setItem(KEY,serialized);if(storage.getItem(KEY)!==serialized)throw new Error('storage verification');persisted=serialized; error = ''; }
      catch (err) { error = '本机存储未能保存。请立即导出备份；关闭页面后本次更改可能丢失。'; if (atomic) throw new Error('本机存储不可用，原记录保持不变，请导出本次记录。'); }
      state = next; return snapshot();
    }
    const activeProfile = () => state.profiles.find(item => item.participant_id === state.active_participant_id);
    const currentPlan = () => currentPlanFor(state,state.active_participant_id);
    function context() { const plan = currentPlan(); return { participant_id:state.active_participant_id,access:activeProfile().access,clinical:activeProfile().clinical?clone(activeProfile().clinical):null,active_plan:plan ? planProgress(plan,now().getTime()) : null }; }
    function medicalReports(){return clone((state.medical_reports||[]).filter(x=>x.participant_id===state.active_participant_id));}
    function careProfile(){return clone((state.care_profiles||[]).filter(x=>x.participant_id===state.active_participant_id).sort((a,b)=>a.created_at.localeCompare(b.created_at)).at(-1)||null);}
    function saveMedical(draft,kind){
      if(!object(draft)||draft.participant_id!==state.active_participant_id||activeProfile().access!=='postop')fail('档案已切换，请在当前档案重新打开资料表单。');
      const next=upgradeMedical(snapshot()),report=kind==='report',field=report?'medical_reports':'care_profiles';
      const item={...clone(draft),schema:report?'neurovision.medical-report.v1':'neurovision.care.v1',id:makeId(report?'report':'care'),created_at:now().toISOString()};
      medicalModule()[report?'validateReport':'validateCare'](item);
      next[field].push(item);commit(next,true);return clone(item);
    }
    function saveDiary(values) {
      const time = now(), next = snapshot(), existing = next.diaries.find(item => item.participant_id === next.active_participant_id && item.local_date === localDay(time));
      const diary = { id:existing?.id || makeId('diary'), participant_id:next.active_participant_id,created_at:time.toISOString(),local_date:localDay(time),timezone_offset:time.getTimezoneOffset(),comfort:values.comfort,fatigue:values.fatigue,night_interference:values.night_interference,night_experience:values.night_experience,note:values.note || '' };
      if (existing) next.diaries[next.diaries.indexOf(existing)] = diary; else next.diaries.push(diary);
      commit(next); return clone(diary);
    }
    function saveObservation(values) {
      const time=now(), next=upgrade(snapshot());
      const existing=next.observations.find(x=>x.participant_id===next.active_participant_id && x.local_date===localDay(time));
      const item={id:existing?.id||makeId('context'),participant_id:next.active_participant_id,created_at:time.toISOString(),local_date:localDay(time),timezone_offset:time.getTimezoneOffset(),protocol:daily().PROTOCOL,reading:values.reading,breaks:values.breaks,night:values.night,note:values.note||''};
      if(existing)next.observations[next.observations.indexOf(existing)]=item;else next.observations.push(item);
      commit(next);return clone(item);
    }
    function addSnapshot(record) {
      snapshotModule().validate(record);const next=upgrade(snapshot()), existing=next.snapshots.find(x=>x.id===record.id);
      if(existing){if(canonical(existing)!==canonical(record))fail('同编号快照内容不一致。');return true;}
      if(!next.profiles.some(x=>x.participant_id===record.participant_id))fail('快照所属档案不存在。');
      next.snapshots.push(clone(record));commit(next,true);return true;
    }
    function exportSnapshot(record) {
      snapshotModule().validate(record);const owner=state.profiles.find(x=>x.participant_id===record.participant_id);
      if(!owner)fail('所属档案不存在。');
      const backup=upgrade({schema:SCHEMA,version:'0.3.0',active_participant_id:owner.participant_id,profiles:[clone(owner)],diaries:[],plans:[],training:[]});backup.snapshots=[clone(record)];if(owner.restored_from_practice)upgradePractice(backup);validateState(backup);return JSON.stringify(backup);
    }
    function newProfile() { const next=snapshot(), item=profile(); next.profiles.push(item); next.active_participant_id=item.participant_id; commit(next); return clone(item); }
    function switchProfile(participant) { const next=snapshot(); next.active_participant_id=participant; commit(next); }
    function saveClinical(value) {
      const next=upgrade(snapshot()),profile=next.profiles.find(item=>item.participant_id===next.active_participant_id);
      clinicalModule().validate(value,profile.access,localDay(now()));profile.clinical=clone(value);commit(next,true);return true;
    }
    function setAccess(access) {
      const next=snapshot(),profile=next.profiles.find(item=>item.participant_id===next.active_participant_id);
      if(access==='healthy'&&profile.clinical&&profile.clinical.procedure!=='none')fail('当前为 ICL 术后档案；健康成人体验请建立独立档案。');
      if(access==='postop'&&profile.clinical?.procedure==='none')delete profile.clinical;
      profile.access=access;commit(next);
    }
    function createPlan() {
      if (activeProfile().access !== 'healthy') fail('研究体验仅向已选择健康成人的软件体验者开放。');
      if (currentPlan() && planProgress(currentPlan()).completed < 4) fail('请先完成当前计划。');
      const next=snapshot(), plan={plan_id:makeId('plan'),participant_id:next.active_participant_id,created_at:now().toISOString(),sequence:random()<.5?'ABBA':'BAAB',attempts:[]}; next.plans.push(plan); commit(next); return clone(plan);
    }
    function attachSession(session) {
      const study=session?.study;
      if (session?.task_id !== 'adaptation' || !study || !id(session.id)) return false;
      const next=snapshot(), plan=next.plans.find(item=>item.plan_id===study.plan_id && item.participant_id===study.participant_id);
      if (!plan || next.plans.some(item=>item.attempts.some(attempt=>attempt.session_id===session.id))) return false;
      const progress=planProgress(plan,now().getTime());
      if (progress.completed >= 4 || study.visit_index !== progress.visit_index || study.condition !== progress.condition || session.setup?.adaptation_condition !== study.condition || !iso(session.created_at) || !iso(session.completed_at)) return false;
      let qualified=session.status==='complete' && session.derived?.valid===true && finite(session.derived?.value) && Math.abs(session.derived.value)<=1.8;
      let reason=qualified?'':String(session.derived?.reason || '未达到本次质量要求').slice(0,200);
      const device=deviceKey(session.setup), firstDevice=plan.attempts.find(attempt=>attempt.qualified)?.device_key;
      if (Date.parse(session.created_at)<Date.parse(progress.next_allowed_at)) { qualified=false; reason='两次尝试间隔不足 24 小时'; }
      if (!device || firstDevice && device!==firstDevice) { qualified=false; reason='设备或观看设置不一致，请恢复原设置后重试'; }
      plan.attempts.push({session_id:session.id,visit_index:study.visit_index,condition:study.condition,started_at:session.created_at,completed_at:session.completed_at,qualified,reason,device_key:device,value:finite(session.derived?.value)&&Math.abs(session.derived.value)<=1.8?session.derived.value:null});
      commit(next); return true;
    }
    function addTraining(record) {
      validateTraining(record);
      const next=snapshot();if(record.schema==='neurovision.training.v0.4')upgrade(next);
      if (next.training.some(item=>item.id===record.id)) return false;
      if (!next.profiles.some(item=>item.participant_id===record.participant_id)) fail('练习所属匿名档案不存在。');
      next.training.push(clone(record)); commit(next,true); return true;
    }
    function exportTraining(record) {
      validateTraining(record);
      const profile=state.profiles.find(item=>item.participant_id===record.participant_id);
      if(!profile)fail('所属档案不存在。');
      const backup={schema:SCHEMA,version:'0.3.0',active_participant_id:profile.participant_id,profiles:[clone(profile)],diaries:[],plans:[],training:[clone(record)]};
      if(record.schema==='neurovision.training.v0.4'||profile.clinical)upgrade(backup);
      if(profile.restored_from_practice)upgradePractice(backup);validateState(backup);return JSON.stringify(backup);
    }
    function importJSON(raw) {
      if (typeof raw!=='string' || new TextEncoder().encode(raw).length>12000000) fail('文件过大，请导入小于 12 MB 的记录备份。');
      let incoming; try { const parsed=JSON.parse(raw);if(['neurovision.perceptual-training.v1','neurovision.perceptual-training.v2'].includes(parsed.schema)){
        practiceModule().validateRecord(parsed);const restored=upgradePractice(snapshot()),existing=restored.practice_sessions.find(r=>r.id===parsed.id);
        if(existing){if(canonical(existing)!==canonical(parsed))fail('同编号训练存在不同内容。');return 0;}
        let count=1;const person=restored.profiles.find(p=>p.participant_id===parsed.participant_id);
        if(person&&person.access!=='postop')fail('训练所属档案与 ICL 术后身份不一致。');
        if(!person){restored.profiles.push({participant_id:parsed.participant_id,created_at:now().toISOString(),access:'postop',restored_from_practice:true});count++;}
        restored.practice_sessions.push(clone(parsed));commit(restored,true);return count;
      }incoming=validateState(parsed); } catch(err) { fail(`导入失败：${err.message}`); }
      const next=snapshot();if(incoming.schema===SCHEMA_V7)upgradePractice(next);else if(incoming.schema===SCHEMA_V6)upgradeMedical(next);else if(incoming.schema===SCHEMA_V4)upgrade(next);let count=0;
      for (const [field,key] of [['profiles','participant_id'],['diaries','id'],['plans','plan_id'],['training','id'],['observations','id'],['snapshots','id'],['medical_reports','id'],['care_profiles','id'],['practice_sessions','id']]) {
        for (const item of incoming[field] || []) {
          const existing=next[field].find(value=>value[key]===item[key]);
          if (existing) {
            if(field==='profiles' && (!existing.clinical||!item.clinical||existing.restored_from_practice||item.restored_from_practice)) {
              const {clinical:a,...baseA}=existing,{clinical:b,...baseB}=item;
              if(existing.restored_from_practice||item.restored_from_practice){delete baseA.created_at;delete baseB.created_at;delete baseA.restored_from_practice;delete baseB.restored_from_practice;}
              if(canonical(baseA)!==canonical(baseB)||(a&&b&&canonical(a)!==canonical(b)))fail(`导入失败：${item[key]} 已存在不同内容，原记录保持不变。`);
              if(existing.restored_from_practice&&!item.restored_from_practice){existing.created_at=item.created_at;delete existing.restored_from_practice;count++;}
              if(!a&&b){existing.clinical=clone(b);count++;}
            } else if(canonical(existing)!==canonical(item)) fail(`导入失败：${item[key]} 已存在不同内容，原记录保持不变。`);
          }
          else { next[field].push(clone(item)); count++; }
        }
      }
      // Import never silently switches the person using this browser.
      validateState(next); commit(next,true); return count;
    }
    function practiceHistory(){return clone((state.practice_sessions||[]).filter(x=>x.participant_id===state.active_participant_id));}
    function savePractice(record){
      practiceModule().validateRecord(record);
      if(record.participant_id!==state.active_participant_id||activeProfile().access!=='postop')fail('档案已切换，请返回原 ICL 档案保存训练。');
      const prior=(state.practice_sessions||[]).find(x=>x.id===record.id);
      if(prior){if(canonical(prior)!==canonical(record))fail('训练编号已存在不同内容。');return true;}
      const next=upgradePractice(snapshot());next.practice_sessions.push(clone(record));commit(next,true);return true;
    }
    const canTrain=()=>state.training.length<200&&new TextEncoder().encode(JSON.stringify(state)).length<=11600000;
    return { snapshot,context,practiceHistory,savePractice,canPractice:()=>!blocked&&(state.practice_sessions||[]).length<LIMITS.practice_sessions&&new TextEncoder().encode(JSON.stringify(state)).length<=11600000,medicalReports,careProfile,saveReport:draft=>saveMedical(draft,'report'),saveCare:draft=>saveMedical(draft,'care'),canTrain,canSnapshot:()=>!blocked&&(state.snapshots||[]).length<200&&new TextEncoder().encode(JSON.stringify(state)).length<=11600000,saveClinical,saveObservation,addSnapshot,exportSnapshot,saveDiary,newProfile,switchProfile,setAccess,createPlan,attachSession,addTraining,exportTraining,importJSON,exportJSON:()=>JSON.stringify(state),storageError:()=>error };
  }

  const exported = { SCHEMA,SCHEMA_V4,SCHEMA_V6,SCHEMA_V7,KEY,DAY,LIMITS,localDay,conditionAt,planProgress,validateState,validateTraining,deviceKey,createStore };
  if (typeof module !== 'undefined' && module.exports) { module.exports=exported; return; }
  const PRACTICE_DRAFT_PREFIX='neurovision.practice-draft.v1.';
  const practiceDraftMemory=new Map();
  let practiceDraftError='';
  let store, container=null, message='', messageError=false, profileOpen=false,comparisonKey=null,medicalCleanup=null;
  const getStore=()=>{if(!store){let storage;try{storage=root.localStorage;}catch(err){storage={getItem(){throw err;},setItem(){throw err;}};}store=createStore(storage);}return store;};
  const safe=value=>String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function stagePractice(record){
    practiceModule().validateRecord(record);
    if(record.participant_id!==getStore().context().participant_id)fail('档案已切换，请返回原档案保存训练。');
    const key=PRACTICE_DRAFT_PREFIX+record.participant_id+'.'+record.id,raw=JSON.stringify(record);
    practiceDraftMemory.set(key,clone(record));
    try{root.localStorage.setItem(key,raw);if(root.localStorage.getItem(key)!==raw)throw Error('readback');practiceDraftError='';}
    catch(error){practiceDraftError='训练待保存副本暂留本页，请在关闭前保存或下载。';}
    return !practiceDraftError;
  }
  function pendingPractice(){
    const st=getStore(),owner=st.context().participant_id,prefix=PRACTICE_DRAFT_PREFIX+owner+'.',committed=st.practiceHistory(),records=new Map();
    const accept=(key,record)=>{try{practiceModule().validateRecord(record);if(record.participant_id===owner&&!committed.some(r=>r.id===record.id&&canonical(r)===canonical(record)))records.set(key,record);}catch(error){practiceDraftError='部分训练副本需要核对，请导出恢复资料。';}};
    try{for(let i=0;i<root.localStorage.length;i++){const key=root.localStorage.key(i);if(key?.startsWith(prefix))accept(key,JSON.parse(root.localStorage.getItem(key)));}}catch(error){practiceDraftError='训练副本读取失败，请导出恢复资料。';}
    for(const [key,record] of practiceDraftMemory)if(key.startsWith(prefix))accept(key,record);
    return [...records.values()];
  }
  function practiceRescue(){
    const records=new Map();let read_error=null;
    try{for(let i=0;i<root.localStorage.length;i++){const key=root.localStorage.key(i);if(key?.startsWith(PRACTICE_DRAFT_PREFIX))records.set(key,{key,value:root.localStorage.getItem(key)});}}catch(error){read_error=String(error.message||error);}
    return {entries:[...records.values()],memory:[...practiceDraftMemory.values()],read_error};
  }
  function savePractice(record){
    stagePractice(record);const saved=getStore().savePractice(record);
    if(saved){const key=PRACTICE_DRAFT_PREFIX+record.participant_id+'.'+record.id;practiceDraftMemory.delete(key);try{root.localStorage.removeItem(key);}catch(error){}practiceDraftError='';}
    return saved;
  }
  function retryPractice(id){const record=pendingPractice().find(r=>r.id===id);if(!record)fail('待保存训练不存在或已归档。');return savePractice(record);}
  const date=value=>new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
  const selected=(value,current)=>value===current?' selected':'';
  function trend(diaries) {
    const recent=[...diaries].sort((a,b)=>a.local_date.localeCompare(b.local_date)).slice(-14);
    if (!recent.length) return '<div class="recovery-empty"><p>暂无记录</p></div>';
    const w=440,h=156,left=22,right=14,top=13,bottom=29,t0=Date.parse(recent[0].local_date),t1=Date.parse(recent.at(-1).local_date);
    const x=item=>left+(t1===t0?.5:(Date.parse(item.local_date)-t0)/(t1-t0))*(w-left-right),y=value=>top+(10-value)/10*(h-top-bottom);
    const series=[['comfort','舒适','#456bd4'],['fatigue','疲劳','#b07842']];
    return `<svg class="recovery-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="当前档案最近 ${recent.length} 天的视觉舒适度与疲劳，0 到 10 分；下方记录表含具体数值。">${[0,5,10].map(n=>`<line x1="${left}" x2="${w-right}" y1="${y(n)}" y2="${y(n)}" stroke="#e2e9ed"/><text x="${left-7}" y="${y(n)+4}" text-anchor="end">${n}</text>`).join('')}${series.map(([key,label,color])=>`${recent.length>1?`<polyline points="${recent.map(item=>`${x(item)},${y(item[key])}`).join(' ')}" fill="none" stroke="${color}" stroke-width="1.7"/>`:''}${recent.map(item=>`<circle cx="${x(item)}" cy="${y(item[key])}" r="3" fill="white" stroke="${color}" stroke-width="1.8"><title>${item.local_date} ${label} ${item[key]} 分</title></circle>`).join('')}`).join('')}<text x="${left}" y="${h-6}">${recent[0].local_date.slice(5)}</text><text x="${w-right}" y="${h-6}" text-anchor="end">${recent.at(-1).local_date.slice(5)}</text></svg><div class="recovery-legend"><span><i></i>舒适度 · 越高越舒适</span><span><i></i>疲劳 · 越高越明显</span></div>`;
  }
  function quickCard() {
    const st=getStore(),ctx=st.context(),latest=(st.snapshot().snapshots||[]).filter(x=>x.participant_id===ctx.participant_id&&x.access_confirmation.access==='postop').sort((a,b)=>Date.parse(a.completed_at)-Date.parse(b.completed_at)).at(-1);
    const drafts=root.NVSnapshot?.draftStatus?.(ctx.participant_id);
    if(ctx.access!=='postop')return '<p class="recovery-note"><a href="#profile">建立 ICL 术后档案</a>后开始测量。</p>';
    return `<section class="daily-snapshot-card" aria-labelledby="snapshot-title"><div class="snapshot-copy"><h2 id="snapshot-title">视觉快照</h2><p>判断条纹倾斜方向，自动记录正确率与作答时间。</p><div class="snapshot-actions"><button class="btn" data-start-snapshot>${root.NVSnapshot?.hasPending?.(ctx.participant_id)?'返回待保存结果':'开始快照'}</button><span>约 70 秒 · 首次需校准</span></div>${drafts?.count?`<p class="snapshot-pending" role="status">${drafts.count} 份待保存${drafts.persistent_count?' · 已本机暂存':''}</p>`:''}${drafts?.warning?`<div class="snapshot-pending is-error" role="status">${safe(drafts.warning)} <button class="btn text" data-recovery="pending-backup">备份暂存数据</button></div>`:''}</div>${latest?`<div class="snapshot-last">最近一次 · ${safe(date(latest.completed_at))} <span>${latest.summary.correct} / ${latest.summary.valid_trials} 有效回答正确</span></div>`:''}</section>`;
  }
  function snapshotHistory() {
    const st=getStore(),ctx=st.context(),items=(st.snapshot().snapshots||[]).filter(x=>x.participant_id===ctx.participant_id&&x.access_confirmation.access==='postop').sort((a,b)=>Date.parse(b.completed_at)-Date.parse(a.completed_at));
    if(!items.length)return '';
    const pct=v=>v===null?'—':Math.round(v*100)+'%',latest=items[0],s=latest.summary;
    return `<section class="snapshot-history" aria-labelledby="snapshot-history-title"><div class="recovery-section-head"><div><h2 id="snapshot-history-title">短测记录</h2><span class="record-count">${items.length} 次</span></div><span>${safe(date(latest.completed_at))}</span></div><div class="snapshot-metrics"><div><span>正确 / 有效回答</span><strong>${s.correct}<small> / ${s.valid_trials}</small></strong></div><div><span>正确回答中位时间</span><strong>${s.median_rt_ms===null?'—':Math.round(s.median_rt_ms)}<small> ms</small></strong></div><div><span>95% 正确率区间</span><strong>${pct(s.low)}<small> – ${pct(s.high)}</small></strong></div></div><p class="recovery-note">${s.qualified?'本次满足快照质量要求。':'本次含未完成或质量标记，请展开查看。'}</p>${root.NVLongitudinal?.render(items,comparisonKey)||''}<details><summary>查看每次结果与测量条件</summary><div class="recovery-table-wrap"><table><thead><tr><th>时间</th><th>正确 / 有效</th><th>中位时间</th><th>质量</th><th>详情</th></tr></thead><tbody>${items.slice(0,30).map(x=>`<tr><td>${safe(date(x.completed_at))}</td><td>${x.summary.correct} / ${x.summary.valid_trials}</td><td>${x.summary.median_rt_ms===null?'—':Math.round(x.summary.median_rt_ms)+' ms'}</td><td>${x.summary.qualified?'合格':x.status==='aborted'?'已停止':'建议重测'}</td><td><details><summary>展开</summary><p>${safe(x.setup.clinical?clinicalModule().summary(x.setup.clinical,x.setup.clinical_local_date):'手术信息未记录')}</p><p>${x.setup.distance_cm} cm · ${x.setup.brightness_percent}% 亮度 · ${safe({keyboard:'键盘',pointer:'触屏 / 鼠标',mixed:'混合操作',none:'未回答'}[x.input_mode])}</p><p>核对题 ${x.summary.checks.correct} / ${x.summary.checks.n}；${x.summary.qualified?'质量合格':'质量标记：'+safe(x.summary.flags.join(', '))}</p>${x.summary.levels.map(l=>`<p>数字对比 ${l.contrast}：${l.correct} / ${l.n}，95% 区间 ${pct(l.low)}–${pct(l.high)}</p>`).join('')}</details></td></tr>`).join('')}</tbody></table></div><p class="recovery-note">显示最近 30 次，全部原始试次包含在“导出全部 JSON”中。每个对比水平仅 8 题，区间反映本次抽样不确定性。</p></details></section>`;
  }
  function renderProfile() {
    const st=getStore(),state=st.snapshot(),context=st.context(),observations=(state.observations||[]).filter(x=>x.participant_id===context.participant_id),today=observations.find(x=>x.local_date===localDay());
    if(context.access!=='postop')return '<div class="training-profile-page"><header class="training-page-head"><h1>手术档案</h1></header><p>建立档案后开始 ICL 术后练习。</p><button class="btn" data-recovery="new-profile">建立 ICL 档案</button><button class="btn text" data-recovery="export">导出已有记录</button></div>';
    return `<div class="training-profile-page"><header class="training-page-head"><div><p class="training-kicker">ICL / TICL</p><h1>手术档案</h1></div><a class="btn secondary" href="#recovery">查看训练方案</a></header>
    <div class="recovery-context"><span>${safe(clinicalModule().summary(context.clinical))}</span><details class="recovery-profile" data-dismiss-outside${profileOpen?' open':''}><summary>管理档案</summary><div><label>当前档案<select id="recovery-profile">${state.profiles.filter(x=>x.access==='postop').map(x=>`<option value="${safe(x.participant_id)}"${selected(x.participant_id,context.participant_id)}>${safe(x.participant_id)}</option>`).join('')}</select></label><button class="btn secondary" data-recovery="new-profile">建立新档案</button></div></details></div>
    ${st.storageError()?`<p class="page-error" role="alert">${safe(st.storageError())}</p>`:''}<p class="recovery-message${messageError?' is-error':''}" role="status">${safe(message)}</p>
    <section class="clinical-overview"><div class="clinical-overview-head"><h2>手术信息</h2><span>${st.medicalReports().length} 份检查报告</span></div><details class="clinical-editor" data-dismiss-outside${context.clinical?'':' open'}><summary>${context.clinical?'编辑手术信息':'填写手术信息'}</summary><div>${clinicalModule().form(context.clinical,context.access,'profile')}<button class="btn secondary" data-recovery="clinical">保存手术信息</button><p data-clinical-error class="nm-message is-error" role="status"></p></div></details></section>
    ${root.NVMedical?.panel(context,st.medicalReports(),st.careProfile(),{profile:true})||''}
    <details id="recovery-diary" class="training-daily-context" data-dismiss-outside><summary>更新今日用眼情况</summary>${daily().form(today)}</details>
    ${observations.length?`<details class="recovery-history"><summary>日常场景明细</summary><div class="recovery-table-wrap"><table><thead><tr><th>日期</th><th>阅读</th><th>用眼休息</th><th>夜间体验</th><th>备注</th></tr></thead><tbody>${observations.slice(-30).reverse().map(x=>`<tr><td>${safe(x.local_date)}</td>${daily().QUESTIONS.map(q=>`<td>${safe(daily().label(q.key,x[q.key]))}</td>`).join('')}<td>${safe(x.note||'—')}</td></tr>`).join('')}</tbody></table></div></details>`:''}
    <div class="recovery-data-tools"><button class="btn text" data-recovery="summary">导出随访摘要</button><button class="btn text" data-recovery="export">导出全部 JSON</button><button class="btn text" data-recovery="import">导入 JSON</button><button class="btn text" data-recovery="pending-backup">恢复资料备份</button><input type="file" accept="application/json,.json" id="recovery-import" hidden></div></div>`;
  }
  const render=renderProfile;
  function workbench(){const st=getStore(),context=st.context();return {context,reports:st.medicalReports(),care:st.careProfile(),history:st.practiceHistory(),observations:(st.snapshot().observations||[]).filter(x=>x.participant_id===context.participant_id),storage_error:st.storageError(),practice_capacity:st.canPractice(),pending_practice:pendingPractice(),practice_draft_error:practiceDraftError};}
  function refresh() {document.dispatchEvent(new CustomEvent('nv-recovery-change'));}
  function status(value,isError=false) { message=value; messageError=isError; refresh(); if(!container?.querySelector('.recovery-page'))document.dispatchEvent(new CustomEvent('nv-recovery-status',{detail:value})); }
  function download(content,name,type) { const url=URL.createObjectURL(new Blob([content],{type})),link=document.createElement('a'); link.href=url; link.download=name; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }
  function summary() {
    const state=getStore().snapshot(),context=getStore().context(),diaries=state.diaries.filter(item=>item.participant_id===context.participant_id).sort((a,b)=>a.local_date.localeCompare(b.local_date));
    const observations=(state.observations||[]).filter(x=>x.participant_id===context.participant_id), snapshots=(state.snapshots||[]).filter(x=>x.participant_id===context.participant_id);
    const lines=['NeuroVision 0.7 · ICL 术后训练与随访摘要',`匿名档案：${context.participant_id}`,`手术信息：${clinicalModule().summary(context.clinical)}`,`左眼手术日期：${context.clinical?.left_surgery_date||'未记录'}；右眼：${context.clinical?.right_surgery_date||'未记录'}`,`导出时间：${new Date().toISOString()}`,'场景选择描述日常影响；快照记录本次方向辨别表现。','',...observations.map(x=>`${x.local_date} | ${daily().QUESTIONS.map(q=>`${q.key}: ${daily().label(q.key,x[q.key])}`).join(' | ')}${x.note?' | '+x.note:''}`),'','视觉快照',...snapshots.map(x=>`${x.completed_at} | ${x.setup.clinical?clinicalModule().summary(x.setup.clinical,x.setup.clinical_local_date):'手术信息未记录'} | 正确/有效 ${x.summary.correct}/${x.summary.valid_trials} | 正确回答中位RT ${x.summary.median_rt_ms??'未得到'} ms | 质量 ${x.summary.qualified?'合格':x.summary.flags.join(',')} | 设置 ${x.setup.fingerprint} | 操作 ${x.input_mode}`),'','历史数字日记（原始 0–10 分量表）',...diaries.map(x=>`${x.local_date} | 舒适 ${x.comfort} | 疲劳 ${x.fatigue} | 夜间干扰 ${x.night_interference===null?'未经历':x.night_interference}${x.note?' | '+x.note:''}`)];
    lines.push('', '检查报告', ...getStore().medicalReports().flatMap(r=>[`${r.exam_date} | ${r.stage==='preop'?'术前':'术后'} | ${r.id}`, ...r.values.map(v=>`${{right:'右眼',left:'左眼',both:'双眼'}[v.eye]} | ${v.field} | ${v.value} ${v.unit} | 来源 ${v.source} · 已核对`)]));
    lines.push('', '视觉训练记录', ...getStore().practiceHistory().map(r=>`${r.completed_at} | ${r.status} | 主动练习 ${Math.round((r.active_ms+r.blocks.reduce((sum,b)=>sum+(b.overrun_ms||0),0))/1000)} 秒 | ${r.blocks.map(b=>b.label).join('、')} | 反馈 ${r.feedback}`));
    const care=getStore().careProfile();if(care)lines.push('', '恢复路径设置', `记录于 ${care.created_at}`, `关注场景：${care.symptoms.join(', ')||'未选择'}`, `医生确认项目（用户录入）：${care.clinician_targets.join(', ')||'未记录'}；允许练习：${care.clearance}；日期：${care.reviewed_on||'未记录'}`);
    download(lines.join('\n'),`neurovision-followup-${context.participant_id}-${localDay()}.txt`,'text/plain;charset=utf-8');
  }
  function bind(element) {
    medicalCleanup?.();medicalCleanup=null;container=element;
    const st=getStore(),find=selector=>container.querySelector(selector);
    medicalCleanup=root.NVMedical?.bind(container,{getContext:()=>st.context(),getReports:()=>st.medicalReports(),getCare:()=>st.careProfile(),saveReport:draft=>st.saveReport(draft),saveCare:draft=>st.saveCare(draft),notify:status});
    find('#snapshot-comparison')?.addEventListener('change',event=>{const ctx=st.context(),items=(st.snapshot().snapshots||[]).filter(x=>x.participant_id===ctx.participant_id&&x.access_confirmation.access==='postop');comparisonKey=root.NVLongitudinal.group(items).groups[Number(event.target.value)]?.key;refresh();document.getElementById('snapshot-comparison')?.focus();});
    find('.recovery-profile')?.addEventListener('toggle',event=>{profileOpen=event.target.open;});
    find('#recovery-profile')?.addEventListener('change',event=>{try{st.switchProfile(event.target.value);status('已切换匿名档案。');}catch(err){status(err.message,true);}});
    const form=find('#recovery-diary-form');if(form)daily().bind(form,values=>{try{st.saveObservation(values);status(st.storageError()?'今天的记录暂存在本页，请导出备份。':'今天的场景记录已保存。',!!st.storageError());}catch(err){status(err.message,true);}});
    for (const button of container.querySelectorAll('[data-recovery]')) button.addEventListener('click',()=>{
      try {
        const action=button.dataset.recovery;
        if(action==='clinical'){st.saveClinical(clinicalModule().read(container,st.context().access,'profile'));status('手术信息已保存。');}
        if(action==='new-profile'){st.newProfile();status('已建立新的 ICL 术后档案。');}
        if(action==='export')download(st.exportJSON(),`neurovision-recovery-${localDay()}.json`,'application/json');
        if(action==='summary')summary();
        if(action==='pending-backup')download(exportRescue(),`neurovision-recovery-rescue-${localDay()}.json`,'application/json');
        if(action==='import')find('#recovery-import').click();

      }catch(err){if(button.dataset.recovery==='clinical'){const node=find('[data-clinical-error]');if(node){node.textContent=err.message;return;}}status(err.message,true);}
    });
    find('#recovery-import')?.addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;try{if(file.size>12000000)fail('文件超过 12 MB，请选择记录备份。');const count=st.importJSON(await file.text());status(`已导入 ${count} 项新内容，当前档案保持不变。`);}catch(err){status(err.message,true);}finally{event.target.value='';}});
  }
  const addSnapshot=record=>{try{const changed=getStore().addSnapshot(record);if(changed){status('本次快照已保存。');document.dispatchEvent(new CustomEvent('nv-snapshot-saved'));}return changed;}catch(err){status(err.message,true);return false;}};
  const startSnapshot=()=>{
    const ctx=getStore().context();
    if(!root.NVSnapshot.hasPending(ctx.participant_id)&&!getStore().canSnapshot())fail('本机容量不足或存储不可用，请先导出已有记录。');
    root.NVSnapshot.start({...ctx,onComplete:addSnapshot,onClinical:value=>{getStore().saveClinical(value);refresh();return true;},onPendingChange:()=>{
      refresh();for(const button of document.querySelectorAll('[data-start-snapshot]'))button.textContent=root.NVSnapshot.hasPending(getStore().context().participant_id)?'返回待保存结果':'开始快照';
    }});
  };
  function exportRescue(){let primaryRaw=null,readError=null;try{primaryRaw=root.localStorage.getItem(KEY);}catch(error){readError=String(error.message||error);}return JSON.stringify({schema:'neurovision.recovery.rescue.v1',notice:'项目原始恢复资料，包含主档案原文本与独立快照副本；需核验后归入正式记录。',exported_at:new Date().toISOString(),primary_raw:primaryRaw,primary_read_error:readError,current_state:getStore().snapshot(),practice_pending_raw:practiceRescue(),snapshots:JSON.parse(root.NVSnapshot.exportPending())},null,2);}
  root.NVRecovery={exportRescue,containsSnapshot:record=>(getStore().snapshot().snapshots||[]).some(x=>x.id===record.id&&canonical(x)===canonical(record)),knownParticipants:()=>getStore().snapshot().profiles.map(x=>x.participant_id),workbench,renderProfile,stagePractice,pendingPractice,retryPractice,practiceHistory:()=>getStore().practiceHistory(),savePractice,render,bind,quickCard,snapshotHistory,startSnapshot,addSnapshot,exportSnapshot:record=>getStore().exportSnapshot(record),context:()=>getStore().context()};
})(typeof window!=='undefined'?window:globalThis);
