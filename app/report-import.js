(function(root){
'use strict';
// OCR creates review candidates only. This module never writes storage or sends images.
const VERSION='1.0.0', MAX_BYTES=20*1024*1024, MAX_PIXELS=24000000;
const FIELDS={
 sph:{label:'球镜',unit:'D',min:-40,max:40,pattern:'\\bSPH\\b|球镜(?:度数)?|球面(?:度数)?'},
 cyl:{label:'柱镜',unit:'D',min:-20,max:20,pattern:'\\bCYL\\b|柱镜(?:度数)?|散光度数'},
 axis:{label:'轴位',unit:'deg',min:0,max:180,pattern:'\\bAXIS\\b|\\bAX\\b|轴位|散光轴'},
 se:{label:'等效球镜',unit:'D',min:-50,max:50,pattern:'\\bSE\\b|等效球镜'},
 iop:{label:'眼压',unit:'mmHg',min:0,max:80,pattern:'\\bIOP\\b|眼压'},
 vault:{label:'拱高',unit:'um',min:0,max:3000,pattern:'\\bVAULT\\b|拱高'},
 acd:{label:'前房深度',unit:'mm',min:0,max:10,pattern:'\\bACD\\b|前房深度'},
 wtw:{label:'白到白',unit:'mm',min:5,max:20,pattern:'\\bWTW\\b|白到白(?:距离)?|角膜横径'},
 cct:{label:'中央角膜厚度',unit:'um',min:100,max:1200,pattern:'\\bCCT\\b|中央角膜厚度|角膜厚度'},
 pupil_size:{label:'瞳孔直径',unit:'mm',min:0,max:12,pattern:'\\bPUPIL(?:\\s+(?:SIZE|DIAMETER))?\\b|瞳孔(?:直径|大小)'},
 ecd:{label:'角膜内皮细胞密度',unit:'cells/mm2',min:0,max:8000,pattern:'\\bECD\\b|(?:角膜)?内皮细胞密度'},
 icl_size:{label:'ICL 尺寸',unit:'mm',min:8,max:16,pattern:'\\bT?ICL\\s*(?:SIZE|尺寸|直径)|晶体(?:尺寸|直径)'},
 icl_power:{label:'ICL 度数',unit:'D',min:-40,max:40,pattern:'\\bT?ICL\\s*(?:POWER|度数)|晶体度数'},
 icl_cyl:{label:'TICL 柱镜',unit:'D',min:-20,max:20,pattern:'\\bT?ICL\\s*(?:CYL(?:INDER)?|散光(?:度数)?)|晶体散光(?:度数)?'},
 icl_axis:{label:'TICL 轴位',unit:'deg',min:0,max:180,pattern:'\\bT?ICL\\s*(?:AXIS|AX|轴位)|晶体轴位'}
};
const LABELS=Object.entries(FIELDS).map(([field,def])=>({field,def,re:new RegExp(def.pattern,'ig')}));
const DATE_LABEL=/手术日期|手术时间|检查日期|检查时间|报告日期|报告时间|\b(?:SURGERY|EXAM|REPORT)\s+DATE\b|\bDATE\b|日期/ig;
const NUM='[+−–-]?\\s*(?:\\d+(?:[.,]\\d+)?|\\.\\d+)';
const UNIT='(?:cells?\\s*\\/\\s*mm(?:²|2|\\^2)|个\\s*\\/\\s*mm(?:²|2|\\^2)|mm\\s*Hg|kPa|μm|µm|um|微米|毫米|mm|屈光度|diopters?|deg(?:rees?)?|D\\b|°|度)';
const valueRE=new RegExp('^\\s*[:：=]?\\s*('+NUM+')\\s*('+UNIT+')?','i');
const norm=s=>String(s??'').normalize('NFKC').replace(/[−‐‑‒–—―]/g,'-').replace(/μ/g,'µ').replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g,'$1').trim();
const eyeTokens=s=>[...s.matchAll(/\bOD\b|\bOS\b|\bOU\b|右眼|左眼|双眼|\bRIGHT\b|\bLEFT\b/ig)].map(m=>({index:m.index,end:m.index+m[0].length,eye:/OD|右眼|RIGHT/i.test(m[0])?'right':/OS|左眼|LEFT/i.test(m[0])?'left':'both'}));
const stageOf=s=>{const pre=/术前|PRE[ -]?OP(?:ERATIVE)?/i.test(s),post=/术后|POST[ -]?OP(?:ERATIVE)?/i.test(s);return pre===post?'unknown':pre?'preop':'postop';};
const conf=v=>typeof v==='number'&&Number.isFinite(v)?Math.max(0,Math.min(1,v>1?v/100:v)):null;
function unitOf(s){s=norm(s).toLowerCase().replace(/\s|\^/g,'');return ({d:'D',diopter:'D',diopters:'D','屈光度':'D',deg:'deg',degree:'deg',degrees:'deg','°':'deg','度':'deg',mmhg:'mmHg',kpa:'kPa',um:'um','µm':'um','微米':'um',mm:'mm','毫米':'mm','cell/mm2':'cells/mm2','cells/mm2':'cells/mm2','个/mm2':'cells/mm2'})[s]||null;}
function validDate(s){return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}
function linesOf(input){
 if(typeof input==='string')return input.split(/\r?\n/).map(text=>({text,confidence:null}));
 if(Array.isArray(input))return input.map(l=>typeof l==='string'?{text:l,confidence:null}:{text:String(l.text||''),confidence:conf(l.confidence),bbox:l.bbox||null});
 if(input&&input.blocks){const lines=[];for(const b of input.blocks)for(const p of b.paragraphs||[])for(const l of p.lines||[])lines.push(l);if(lines.length)return linesOf(lines);}
 return linesOf(input&&input.text||'');
}
function extract(input,meta={}){
 const lines=linesOf(input),candidates=[],warnings=[];let eye='unknown',stage='unknown',columns=null,rowFields=null;
 const reportId=String(meta.report_id||'report');
 const add=(field,raw,unit,ctx,extra={})=>{
  const def=FIELDS[field],flags=[];let value=raw,canonical=unitOf(unit);
  if(def){value=Number(String(raw).replace(/\s/g,'').replace(',','.'));if(!Number.isFinite(value))return;
   if(String(raw).includes(','))flags.push('number_format_needs_review');
   if(!unit){flags.push('unit_missing');canonical=null;}
   else if(canonical!==def.unit){if(canonical==='mm'&&def.unit==='um')value*=1000;else if(canonical==='um'&&def.unit==='mm')value/=1000;else if(canonical==='kPa'&&def.unit==='mmHg')value=Math.round(value*7.50061683*100)/100;else flags.push('unit_mismatch');if(!flags.includes('unit_mismatch'))canonical=def.unit;}
   if(value<def.min||value>def.max)flags.push('out_of_range');
  }
  if(ctx.eye==='unknown')flags.push('eye_unknown');if(ctx.eye==='both'&&def)flags.push('bilateral_value_needs_review');if(ctx.stage==='unknown')flags.push('stage_unknown');
  if(ctx.confidence===null)flags.push('confidence_unavailable');else if(ctx.confidence<.85)flags.push('low_confidence');
  candidates.push({id:`${reportId}:${candidates.length+1}`,report_id:reportId,field,eye:ctx.eye,stage:ctx.stage,value,unit:def?canonical:null,suggested_unit:def?.unit||null,original_value:String(raw),original_unit:unit||null,source_snippet:ctx.source,source_line:ctx.line+1,confidence:ctx.confidence,flags,requires_confirmation:true,...extra});
 };
 for(let line=0;line<lines.length;line++){
  const source=String(lines[line].text),full=norm(source);if(!full)continue;
  // A reference interval is never an observation, including when printed beside a result.
  if(/^\s*(?:参考|正常|范围|REFERENCE|NORMAL|REF\.?\s*RANGE)/i.test(full)){warnings.push({line:line+1,code:'reference_ignored'});continue;}
  const s=full.split(/参考|正常范围|参考范围|\bREFERENCE\b|\bREF\.?\s*RANGE\b/i)[0].trim();
  const detectedStage=stageOf(s);if(detectedStage!=='unknown')stage=detectedStage;else if(/术前|PRE[ -]?OP/i.test(s)&&/术后|POST[ -]?OP/i.test(s))stage='unknown';
  const eyes=eyeTokens(s),uniqueEyes=[...new Set(eyes.map(e=>e.eye))];let localEye=uniqueEyes.length===1?uniqueEyes[0]:uniqueEyes.length>1?'unknown':eye;
  const ctx={eye:localEye,stage,source,line,confidence:conf(lines[line].confidence)};
  const labels=[];for(const {field,def,re} of LABELS){re.lastIndex=0;for(const m of s.matchAll(re))labels.push({field,def,start:m.index,end:m.index+m[0].length,text:m[0]});}
  // Prefer longer labels (e.g. 等效球镜 over 球镜; ICL power is not a general ICL label).
  labels.sort((a,b)=>a.start-b.start||b.end-a.end);const kept=[];for(const l of labels)if(!kept.some(k=>l.start>=k.start&&l.end<=k.end))kept.push(l);
  const numbers=s.match(new RegExp(NUM,'g'))||[];
  if(uniqueEyes.length>=2&&kept.length===0&&numbers.length===0){columns=uniqueEyes;rowFields=null;continue;}
  if(kept.length>=2&&numbers.length===0){rowFields=kept.map(l=>({field:l.field,unit:(s.slice(l.end,kept[kept.indexOf(l)+1]?.start||s.length).match(new RegExp(UNIT,'i'))||[])[0]||null}));continue;}
  if(eyes.length===1&&kept.length===0&&rowFields){
   const tail=s.slice(eyes[0].end).trim(),values=tail.split(/[\s|;]+/).filter(Boolean);
   if(values.length===rowFields.length&&values.every(v=>new RegExp('^'+NUM+'$').test(v))){rowFields.forEach((f,i)=>add(f.field,values[i],f.unit,ctx));continue;}
  }
  if(uniqueEyes.length===1&&kept.length===0&&!/[0-9]/.test(s)){eye=uniqueEyes[0];ctx.eye=eye;columns=null;}
  const rowPrefix=kept.length>0&&eyes.some(e=>e.index<kept[0].start);
  const suffixEyes=kept.map((l,i)=>{const end=kept[i+1]?.start||s.length,part=s.slice(l.end,end),tokens=eyeTokens(part);return tokens.length===1&&part.slice(tokens[0].end).trim()===''&&valueRE.test(part.slice(0,tokens[0].index))?tokens[0]:null;});
  const suffixLayout=!rowPrefix&&suffixEyes.length>0&&suffixEyes.every(Boolean);
  for(let i=0;i<kept.length;i++){
   const l=kept[i],end=kept[i+1]?.start||s.length;let tail=s.slice(l.end,end),unitInLabel=null;
   const parenthetical=tail.match(new RegExp('^\\s*[（(\\[]\\s*('+UNIT+')\\s*[）)\\]]','i'));
   if(parenthetical){unitInLabel=parenthetical[1];tail=tail.slice(parenthetical[0].length);}
   const eyeBefore=eyes.filter(e=>e.index<l.start).at(-1),eyeAfter=eyes.find(e=>e.index>=l.end&&e.index<end);
   // A marker between two labeled values may be a suffix or the next prefix.
   // Trust a declared row prefix or a consistently suffixed row; otherwise retain unknown.
   let candidateEye=rowPrefix?(eyeBefore?.eye||eye):eye;
   // Labels followed by eye tokens: IOP OD 15 mmHg OS 16 mmHg.
   const fieldEyes=eyeTokens(tail);
   if(fieldEyes.length&&/^\s*[:：=]?\s*$/.test(tail.slice(0,fieldEyes[0].index))){
    for(let ei=0;ei<fieldEyes.length;ei++){const e=fieldEyes[ei],part=tail.slice(e.end,fieldEyes[ei+1]?.index||tail.length),m=part.match(valueRE);if(m&&!/^\s*[-~～至]\s*\d/.test(part.slice(m[0].length)))add(l.field,m[1],m[2]||unitInLabel,{...ctx,eye:e.eye});}
    continue;
   }
   // Standard report tables explicitly declare the left/right column order.
   if(columns&&columns.length===2){const pair=tail.match(new RegExp('^\\s*[:：]?\\s*('+NUM+')\\s*('+UNIT+')?\\s*[|;,]?\\s+('+NUM+')\\s*('+UNIT+')?\\s*$','i'));if(pair){add(l.field,pair[1],pair[2]||pair[4]||unitInLabel,{...ctx,eye:columns[0]});add(l.field,pair[3],pair[4]||pair[2]||unitInLabel,{...ctx,eye:columns[1]});continue;}}
   const m=tail.match(valueRE);if(!m)continue;
   if(/^\s*[-~～至]\s*\d/.test(tail.slice(m[0].length))){warnings.push({line:line+1,code:'range_ignored',field:l.field});continue;}
   if(/^\s*[|;,]?\s*[+\-]?\d/.test(tail.slice(m[0].length))){warnings.push({line:line+1,code:'ambiguous_values_ignored',field:l.field});continue;}
   // A trailing eye on an otherwise unambiguous field is allowed (IOP 15 mmHg OD).
   if(suffixLayout)candidateEye=suffixEyes[i].eye;
   else if(suffixEyes[i]){if(i===kept.length-1&&!rowPrefix)candidateEye=suffixEyes[i].eye;else if(i===kept.length-1&&candidateEye!==suffixEyes[i].eye)candidateEye='unknown';else if(!rowPrefix)candidateEye='unknown';}
   add(l.field,m[1],m[2]||unitInLabel,{...ctx,eye:candidateEye});
  }
  DATE_LABEL.lastIndex=0;for(const m of s.matchAll(DATE_LABEL)){
   const d=s.slice(m.index+m[0].length).match(/^\s*[:：]?\s*(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/);if(!d)continue;
   const day=`${d[1]}-${d[2].padStart(2,'0')}-${d[3].padStart(2,'0')}`;
   if(validDate(day))add('date',day,null,{...ctx,eye:eyes.filter(e=>e.index<m.index).at(-1)?.eye||ctx.eye},{date_kind:/手术|SURGERY/i.test(m[0])?'surgery':/检查|EXAM/i.test(m[0])?'exam':/报告|REPORT/i.test(m[0])?'report':'unknown'});else warnings.push({line:line+1,code:'invalid_date'});
  }
  for(const proc of s.matchAll(/(?:术式|手术方式|手术名称|\bPROCEDURE\b)\s*[:：]?\s*((?:EVO\s*)?T?ICL)\b/ig))add('procedure',/TICL/i.test(proc[1])?'ticl':'icl',null,{...ctx,eye:eyes.filter(e=>e.index<proc.index).at(-1)?.eye||ctx.eye});
 }
 markConflicts(candidates);
 return {version:VERSION,report_id:reportId,candidates,warnings,lines,review_required:true};
}
function markConflicts(candidates){
 const groups=new Map();for(const c of candidates){delete c.conflict_group;c.flags=c.flags.filter(f=>!['conflicting_values','multiple_sources'].includes(f));const key=[c.field,c.eye,c.stage,c.date_kind||''].join('|');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);}
 let n=0;for(const group of groups.values())if(group.length>1){const distinct=new Set(group.map(c=>JSON.stringify([c.value,c.unit]))),reports=new Set(group.map(c=>c.report_id));if(distinct.size>1){const id='conflict-'+(++n);for(const c of group){c.conflict_group=id;c.flags.push('conflicting_values');}}else if(reports.size>1)for(const c of group)c.flags.push('multiple_sources');}
 return candidates;
}
function combine(reports){const candidates=reports.flatMap(r=>r.candidates.map(c=>({...c,flags:[...c.flags]})));markConflicts(candidates);return {version:VERSION,candidates,warnings:reports.flatMap(r=>r.warnings||[]),review_required:true};}
function checkSvg(text){
 if(text.length>1024*1024)throw Error('SVG 文件过大（最多 1 MB）。');
 if(/<!DOCTYPE|<!ENTITY|<\?|&#|&(?!amp;|lt;|gt;|quot;|apos;)|\bon\w+\s*=|(?:href|src|style)\s*=|url\s*\(|@import|<\s*(?:script|foreignObject|image|use|style|iframe|object|embed|animate|set)\b/i.test(text))throw Error('SVG 含活动内容或外部资源，请转为 PNG/JPG。');
 const tags=[...text.matchAll(/<\s*\/?\s*([A-Za-z][\w:-]*)/g)].map(m=>m[1].toLowerCase());
 const allowed=new Set(['svg','g','path','rect','circle','ellipse','line','polyline','polygon','text','tspan','title','desc','defs','clippath']);
 if(!tags.includes('svg')||tags.some(t=>!allowed.has(t)))throw Error('SVG 格式不受支持，请转为 PNG/JPG。');
 if(typeof DOMParser!=='undefined'){const doc=new DOMParser().parseFromString(text,'image/svg+xml');if(doc.querySelector('parsererror')||doc.documentElement.localName!=='svg')throw Error('SVG 文件损坏。');}
}
async function validateImage(file){
 if(!file||typeof file.arrayBuffer!=='function'||!Number.isFinite(file.size)||file.size<=0)throw Error('请选择 PNG、JPG 或 SVG 图片。');
 if(file.size>MAX_BYTES)throw Error('图片过大（最多 20 MB）。');
 const bytes=new Uint8Array(await file.arrayBuffer());if(bytes.byteLength!==file.size)throw Error('图片读取不完整。');
 const png=[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v),jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 let type=png?'image/png':jpg?'image/jpeg':null;
 if(!type){const text=new TextDecoder().decode(bytes);if(/^\s*<svg\b/i.test(text)){checkSvg(text);type='image/svg+xml';}}
 if(!type)throw Error('文件内容不是受支持的 PNG、JPG 或安全 SVG。');
 const declared=String(file.type||'').toLowerCase();if(declared&&declared!==type&&declared!=='application/octet-stream')throw Error('文件类型与内容不一致。');
 let width=0,height=0;
 if(png){if(bytes.length<33||String.fromCharCode(...bytes.slice(12,16))!=='IHDR')throw Error('PNG 文件损坏。');const view=new DataView(bytes.buffer,bytes.byteOffset);width=view.getUint32(16);height=view.getUint32(20);}
 if(jpg){let i=2;while(i<bytes.length-8){if(bytes[i++]!==255)continue;while(bytes[i]===255)i++;const marker=bytes[i++];if(marker===218||marker===217)break;if(marker===216||marker===1||(marker>=208&&marker<=215))continue;const length=(bytes[i]<<8)|bytes[i+1];if(length<2||i+length>bytes.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){height=(bytes[i+3]<<8)|bytes[i+4];width=(bytes[i+5]<<8)|bytes[i+6];break;}i+=length;}if(!width||!height)throw Error('JPG 文件损坏或缺少尺寸信息。');}
 if(png||jpg){if(!width||!height)throw Error('图片尺寸无效。');if(width*height>MAX_PIXELS)throw Error('图片像素过多（最多 2400 万像素）。');}
 return {type,bytes,size:bytes.length};
}
function decode64(s){const raw=atob(s),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes;}
function workerSource(assets){
 if(!assets?.core||!assets?.worker||!assets?.wasm)throw Error('本地 OCR 依赖尚未加载。');
 // Runtime network is intentionally denied, including all accidental CDN fallbacks.
 return "self.fetch=function(){return Promise.reject(new Error('Offline OCR: network disabled'));};self.XMLHttpRequest=function(){throw new Error('Offline OCR: network disabled');};self.importScripts=function(){throw new Error('Offline OCR: external scripts disabled');};\n"+assets.core+'\nconst nvCoreFactory=TesseractCore;const nvWasm=Uint8Array.from(atob('+JSON.stringify(assets.wasm)+'),c=>c.charCodeAt(0));TesseractCore=options=>nvCoreFactory({...options,wasmBinary:nvWasm});\n'+assets.worker;
}
let assetsPromise=null;
function loadAssets(url,signal){
 if(root.NVOCRAssets)return Promise.resolve(root.NVOCRAssets);if(assetsPromise)return assetsPromise;
 assetsPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');const abort=()=>{cleanup();script.remove();reject(Error('识别已取消。'));};const cleanup=()=>{script.onload=null;script.onerror=null;signal?.removeEventListener('abort',abort);};script.src=url||new URL('vendor/ocr/offline-assets.js',moduleURL||document.baseURI).href;script.onload=()=>{cleanup();root.NVOCRAssets?resolve(root.NVOCRAssets):reject(Error('本地 OCR 资源加载不完整。'));};script.onerror=()=>{cleanup();script.remove();reject(Error('无法读取本地 OCR 资源，请保留 app/vendor/ocr 目录。'));};if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});document.head.appendChild(script);}).catch(e=>{assetsPromise=null;throw e;});return assetsPromise;
}
const moduleURL=typeof document!=='undefined'?document.currentScript?.src:null;
async function rasterize(file,validated,signal){
 const url=URL.createObjectURL(new Blob([validated.bytes],{type:validated.type}));
 try{const img=new Image();await new Promise((resolve,reject)=>{const cleanup=()=>{img.onload=null;img.onerror=null;signal?.removeEventListener('abort',abort);};const abort=()=>{cleanup();img.src='';reject(Error('识别已取消。'));};img.onload=()=>{cleanup();resolve();};img.onerror=()=>{cleanup();reject(Error('图片解码失败，请重新导出 PNG/JPG。'));};if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});img.src=url;});if(signal?.aborted)throw Error('识别已取消。');if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth*img.naturalHeight>MAX_PIXELS)throw Error('图片尺寸无效或超过 2400 万像素。');
  const scale=Math.min(1,3000/Math.max(img.naturalWidth,img.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.round(img.naturalWidth*scale);canvas.height=Math.round(img.naturalHeight*scale);const c=canvas.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,canvas.width,canvas.height);c.drawImage(img,0,0,canvas.width,canvas.height);const blob=await new Promise((resolve,reject)=>{const abort=()=>{signal?.removeEventListener('abort',abort);canvas.width=0;canvas.height=0;reject(Error('识别已取消。'));};if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});canvas.toBlob(value=>{signal?.removeEventListener('abort',abort);resolve(value);},'image/png');});if(signal?.aborted)throw Error('识别已取消。');if(!blob)throw Error('图片预处理失败。');return new Uint8Array(await blob.arrayBuffer());
 }finally{URL.revokeObjectURL(url);}
}
let active=false;
async function recognize(file,options={}){
 if(active)throw Error('另一份报告正在识别，请等待或取消。');active=true;let worker=null,url=null,timer=null,pending=null,cancelError=null,cancelReject;
 const lifecycle=new AbortController(),cancelled=new Promise((_,reject)=>{cancelReject=reject;});
 const cancel=message=>{if(cancelError)return;cancelError=Error(message);cancelReject(cancelError);lifecycle.abort();if(pending){pending.reject(cancelError);pending=null;}worker?.terminate();};
 const check=()=>{if(cancelError)throw cancelError;};
 const abort=()=>cancel('识别已取消。');
 const run=async()=>{
  check();const validated=await validateImage(file);check();const image=await rasterize(file,validated,lifecycle.signal);check();const assets=await loadAssets(options.assetsURL,lifecycle.signal);check();
  url=URL.createObjectURL(new Blob([workerSource(assets)],{type:'text/javascript'}));worker=new Worker(url);let seq=0;
  worker.onerror=()=>cancel('本地 OCR 引擎无法启动或运行。请检查浏览器是否允许本地脚本与 WebAssembly。');
  worker.onmessage=({data})=>{if(data.status==='progress'){options.onProgress?.({status:data.data.status,progress:data.data.progress});return;}if(!pending||data.jobId!==pending.id)return;const p=pending;pending=null;data.status==='resolve'?p.resolve(data.data):p.reject(Error('OCR 识别失败：'+String(data.data).slice(0,240)));};
  const send=(action,payload)=>new Promise((resolve,reject)=>{check();const id='ocr-'+(++seq);pending={id,resolve,reject};worker.postMessage({workerId:'local-report',jobId:id,action,payload});});
  await send('load',{options:{lstmOnly:true,logging:false}});
  await send('loadLanguage',{langs:Object.entries(assets.languages).map(([code,b64])=>({code,data:decode64(b64)})),options:{cacheMethod:'none',gzip:true,lstmOnly:true}});
  await send('initialize',{langs:'eng+chi_sim',oem:1,config:{load_system_dawg:'0',load_freq_dawg:'0'}});
  await send('setParameters',{params:{tessedit_pageseg_mode:'3',preserve_interword_spaces:'1'}});
  const data=await send('recognize',{image,options:{},output:{text:true,blocks:true}});
  check();
  return {...extract(data,{report_id:options.report_id||'report'}),text:data.text||'',ocr:{engine:assets.version,languages:['eng','chi_sim'],confidence:conf(data.confidence),local_only:true}};
 };
 try{options.signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>cancel('OCR 超时，请缩小图片或使用更清晰的截图。'),Math.max(1,Math.min(options.timeout_ms||120000,180000)));if(options.signal?.aborted)abort();return await Promise.race([run(),cancelled]);}
 finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);lifecycle.abort();worker?.terminate();if(url)URL.revokeObjectURL(url);active=false;}
}
const api={VERSION,FIELDS,MAX_BYTES,MAX_PIXELS,extract,combine,markConflicts,validateImage,recognize,loadAssets,workerSource};
if(typeof module!=='undefined')module.exports=api;root.NVReportImport=api;
})(typeof window==='undefined'?globalThis:window);
