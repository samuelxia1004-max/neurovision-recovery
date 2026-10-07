/* A separate, validated journal for completed snapshots and their independent recovery copies. */
(function(root){
 'use strict';
 const PREFIX='neurovision.snapshot.pending.v1.',SCHEMA='neurovision.snapshot.pending.v1';
 const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
 const clone=v=>JSON.parse(JSON.stringify(v));
 const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
 const iso=v=>typeof v==='string'&&v.length===24&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
 function createStore(storage,{validate,now=()=>new Date(),maxEntries=200,maxBytes=6000000}={}){
  if(typeof validate!=='function')throw Error('暂存校验器未提供。');
  function entries(){
   const result=[];const length=storage.length;if(!Number.isInteger(length)||length<0)throw Error('暂存存储不可读取。');
   for(let i=0;i<length;i++){const key=storage.key(i);if(typeof key==='string'&&key.startsWith(PREFIX)){const value=storage.getItem(key);if(value!==null)result.push({key,value});}}
   return result;
  }
  function parse({key,value}){
   if(typeof value!=='string'||value.length>maxBytes)throw Error('暂存内容过大。');
   const item=JSON.parse(value);
   if(!item||Object.keys(item).sort().join(',')!=='record,schema,stored_at'||item.schema!==SCHEMA||!iso(item.stored_at)||!validId(item.record?.id)||key!==PREFIX+item.record.id)throw Error('暂存标识无效。');
   validate(item.record);return item;
  }
  function list(participantId){
   const records=[],issues=[];
   try{for(const item of entries()){try{const parsed=parse(item);if(participantId===undefined||parsed.record.participant_id===participantId)records.push(clone(parsed.record));}catch(_){issues.push({key:item.key,message:'一份暂存记录需要核查。'});}}}
   catch(_){issues.push({key:null,message:'本机暂存不可读取。'});}
   records.sort((a,b)=>Date.parse(a.completed_at)-Date.parse(b.completed_at)||a.id.localeCompare(b.id));
   return {records,issues};
  }
  function put(record){
   try{
    validate(record);if(!validId(record.id))throw Error('暂存标识无效。');
    const key=PREFIX+record.id,current=storage.getItem(key);
    if(current!==null){const old=parse({key,value:current});if(canonical(old.record)!==canonical(record))throw Error('同编号暂存已有不同内容。');return {saved:true};}
    const raw=JSON.stringify({schema:SCHEMA,stored_at:now().toISOString(),record}),all=entries();
    const size=new TextEncoder().encode(raw).length+all.reduce((sum,x)=>sum+new TextEncoder().encode(x.value).length,0);
    if(all.length>=maxEntries||size>maxBytes)throw Error('暂存容量已满。');
    storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw Error('暂存写入尚未确认。');
    return {saved:true};
   }catch(error){return {saved:false,message:error.message||'本机暂存未成功。'};}
  }
  function remove(record){
   try{
    if(!validId(record?.id))throw Error('暂存标识无效。');const key=PREFIX+record.id,raw=storage.getItem(key);
    if(raw===null)return {removed:true};
    if(canonical(parse({key,value:raw}).record)!==canonical(record))throw Error('暂存内容已改变，保留原文件。');
    storage.removeItem(key);if(storage.getItem(key)!==null)throw Error('暂存副本尚未清理。');return {removed:true};
   }catch(error){return {removed:false,message:error.message||'暂存副本尚未清理。'};}
  }
  function capacity(){try{const all=entries(),bytes=all.reduce((n,x)=>n+new TextEncoder().encode(x.value).length,0);return {available:all.length<maxEntries&&bytes<maxBytes,count:all.length,bytes,maxEntries,maxBytes};}catch(_){return {available:false,count:null,bytes:null,maxEntries,maxBytes};}}
  function exportRaw(){return JSON.stringify({schema:'neurovision.snapshot.pending-raw.v1',exported_at:now().toISOString(),notice:'快照恢复副本；导出时保留原文本，需核验后归入正式记录。',entries:entries()},null,2);}
  return {put,list,remove,exportRaw,capacity};
 }
 const api={PREFIX,SCHEMA,createStore};if(typeof module!=='undefined')module.exports=api;root.NVDrafts=api;
})(typeof window==='undefined'?globalThis:window);
