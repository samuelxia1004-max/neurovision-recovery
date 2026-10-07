'use strict';
// Convert validated snapshot recovery copies into an importable backup; never change input.
const fs=require('node:fs'),S=require('../app/snapshot.js'),R=require('../app/recovery.js'),D=require('../app/drafts.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
function recover(raw,{now=()=>new Date()}={}){
 const rescue=typeof raw==='string'?JSON.parse(raw):raw;
 if(rescue?.schema!=='neurovision.recovery.rescue.v1'||rescue.snapshots?.schema!=='neurovision.snapshot.pending-raw.v1'||!Array.isArray(rescue.snapshots.entries)||rescue.snapshots.entries.length>200)throw Error('恢复资料结构无效。');
 let state=null,source='copies_only';
 for(const [name,value] of [['primary',rescue.primary_raw],['current_state',rescue.current_state]]){try{const candidate=typeof value==='string'?JSON.parse(value):value;R.validateState(candidate);state=clone(candidate);source=name;break;}catch(_){}}
 if(!state)state={schema:R.SCHEMA_V4,version:'0.4.0',active_participant_id:'',profiles:[],diaries:[],plans:[],training:[],observations:[],snapshots:[]};
 else if(state.schema===R.SCHEMA)Object.assign(state,{schema:R.SCHEMA_V4,version:'0.4.0',observations:[],snapshots:[]});
 const map=new Map();for(const entry of rescue.snapshots.entries){if(typeof entry?.key!=='string'||typeof entry.value!=='string'||!entry.key.startsWith(D.PREFIX)||map.has(entry.key))throw Error('恢复副本键无效或重复。');map.set(entry.key,entry.value);}
 const memory={get length(){return map.size;},key:i=>[...map.keys()][i]??null,getItem:k=>map.get(k)??null};
 const result=D.createStore(memory,{validate:S.validate}).list();
 if(result.issues.length)throw Error(`有 ${result.issues.length} 份恢复副本未通过校验；请保留源文件逐项核查。`);
 const latestByOwner=new Map();for(const r of result.records)latestByOwner.set(r.participant_id,r);
 const reconstructed=[],ids=new Map(state.snapshots.map(x=>[x.id,x]));let added=0;
 for(const record of result.records){
  if(ids.has(record.id)){if(canonical(ids.get(record.id))!==canonical(record))throw Error('主档案与恢复副本存在同编号内容冲突；未生成输出。');continue;}
  if(!state.profiles.some(x=>x.participant_id===record.participant_id)){
   const latest=latestByOwner.get(record.participant_id),profile={participant_id:record.participant_id,created_at:now().toISOString(),access:latest.access_confirmation.access};
   if(latest.setup.clinical)profile.clinical=clone(latest.setup.clinical);
   state.profiles.push(profile);reconstructed.push(record.participant_id);
  }
  state.snapshots.push(clone(record));ids.set(record.id,record);added++;
 }
 let addedPractice=0;
 const draftRecords=[];
 for(const entry of rescue.practice_pending_raw?.entries||[]){
  if(typeof entry?.key!=='string'||!entry.key.startsWith('neurovision.practice-draft.v1.')||typeof entry.value!=='string')throw Error('训练恢复副本格式无效。');
  draftRecords.push(JSON.parse(entry.value));
 }
 draftRecords.push(...(rescue.practice_pending_raw?.memory||[]),...(rescue.practice_pending||[]));
 if(draftRecords.length>400)throw Error('训练恢复副本过多。');
 if(draftRecords.length){
  const training=require('../app/perceptual-training.js');
  Object.assign(state,{schema:R.SCHEMA_V7,version:'0.7.0',medical_reports:state.medical_reports||[],care_profiles:state.care_profiles||[],practice_sessions:state.practice_sessions||[]});
  const pending=new Map();for(const record of draftRecords){training.validateRecord(record);const old=pending.get(record.id);if(old&&canonical(old)!==canonical(record))throw Error('训练恢复副本同编号内容冲突。');pending.set(record.id,record);}
  for(const record of pending.values()){
   const old=state.practice_sessions.find(r=>r.id===record.id);if(old){if(canonical(old)!==canonical(record))throw Error('主档案与训练副本内容冲突。');continue;}
   if(!state.profiles.some(p=>p.participant_id===record.participant_id)){state.profiles.push({participant_id:record.participant_id,created_at:now().toISOString(),access:'postop',restored_from_practice:true});reconstructed.push(record.participant_id);}
   state.practice_sessions.push(clone(record));addedPractice++;
  }
 }
 if(!state.profiles.length)throw Error('资料中没有可恢复的档案。');
 if(!state.profiles.some(x=>x.participant_id===state.active_participant_id))state.active_participant_id=state.profiles[0].participant_id;
 R.validateState(state);const content=JSON.stringify(state);if(Buffer.byteLength(content)>12000000)throw Error('合并结果超过应用导入上限；未生成输出。');
 return {state,report:{source,state_policy:'采用有效主档案；主档案无效时采用有效当前页状态，再补独立快照。两份档案状态不自动合并。',added_practice_sessions:addedPractice,added_snapshots:added,total_snapshots:state.snapshots.length,reconstructed_profiles:reconstructed.length,profile_note:'重建档案保留原participant_id；created_at为本次重建时间，access与clinical取该档案最新快照原始条件。'}};
}
if(require.main===module){
 try{const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('用法：node analysis/recover_snapshot_backup.cjs 原始恢复资料.json 新的导入备份.json');if(fs.statSync(input).size>50000000)throw Error('输入超过 50 MB。');const result=recover(fs.readFileSync(input,'utf8'));fs.writeFileSync(output,JSON.stringify(result.state),{flag:'wx'});console.log(JSON.stringify(result.report,null,2));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={recover};
