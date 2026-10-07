// Uses the shipped browser worker source in a Node VM, with no network APIs.
// This validates the real WASM engine and models; it is not a browser UI test.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const R=require('../app/report-import.js');require('../app/vendor/ocr/offline-assets.js');
const {createCanvas,GlobalFonts}=require('@napi-rs/canvas');
const fixtureDir=path.join(__dirname,'../tests/fixtures');fs.mkdirSync(fixtureDir,{recursive:true});
for(const p of ['/System/Library/Fonts/PingFang.ttc','/System/Library/Fonts/STHeiti Light.ttc'])if(fs.existsSync(p))GlobalFonts.registerFromPath(p,'Report Chinese');
const lines=['SYNTHETIC TEST REPORT','术后检查报告','右眼 OD','SPH -6.00 D   CYL -1.25 D   AXIS 180 deg','IOP 15 mmHg','拱高 520 um','ACD 3.20 mm','WTW 11.8 mm','CCT 530 um','Pupil size 5.2 mm','ECD 2600 cells/mm2','ICL size 12.6 mm','ICL power -7.5 D','手术日期: 2026-10-01','术式: TICL'];
const canvas=createCanvas(1800,1550),g=canvas.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,1800,1550);g.fillStyle='#000';g.font='44px "Report Chinese", Arial';lines.forEach((line,i)=>g.fillText(line,60,90+i*92));
const png=canvas.toBuffer('image/png'),jpg=canvas.toBuffer('image/jpeg');fs.writeFileSync(path.join(fixtureDir,'ocr-synthetic.png'),png);fs.writeFileSync(path.join(fixtureDir,'ocr-synthetic.jpg'),jpg);fs.writeFileSync(path.join(fixtureDir,'ocr-synthetic.txt'),lines.join('\n')+'\n');
let listener,pending,sequence=0,networkAttempts=0;
const sandbox={console,Uint8Array,Uint8ClampedArray,Int8Array,Uint16Array,Int16Array,Uint32Array,Int32Array,Float32Array,Float64Array,ArrayBuffer,DataView,WebAssembly,TextDecoder,TextEncoder,atob,btoa,setTimeout,clearTimeout,performance,WorkerGlobalScope:function(){},location:{href:'blob:null/local-ocr-synthetic'},postMessage(data){if(data.status==='progress')return;if(!pending||data.jobId!==pending.id)return;const p=pending;pending=null;data.status==='resolve'?p.resolve(data.data):p.reject(Error(String(data.data)));},addEventListener(name,fn){if(name==='message')listener=fn;},fetch(){networkAttempts++;throw Error('Network forbidden');}};
sandbox.self=sandbox;sandbox.globalThis=sandbox;
const context=vm.createContext(sandbox,{codeGeneration:{strings:false,wasm:true}});vm.runInContext(R.workerSource(global.NVOCRAssets),context,{timeout:30000});
// Count every accidental runtime request, even though the shipped worker guard already rejects it.
sandbox.fetch=()=>{networkAttempts++;return Promise.reject(Error('Network forbidden'));};
const send=(action,payload)=>new Promise((resolve,reject)=>{const id='synthetic-'+(++sequence);pending={id,resolve,reject};listener({data:{workerId:'synthetic',jobId:id,action,payload}});});
(async()=>{
 assert.equal((await R.validateImage(new File([png],'synthetic.png',{type:'image/png'}))).type,'image/png');assert.equal((await R.validateImage(new File([jpg],'synthetic.jpg',{type:'image/jpeg'}))).type,'image/jpeg');
 const started=performance.now();await send('load',{options:{lstmOnly:true,logging:false}});
 await send('loadLanguage',{langs:Object.entries(global.NVOCRAssets.languages).map(([code,data])=>({code,data:new Uint8Array(Buffer.from(data,'base64'))})),options:{cacheMethod:'none',gzip:true,lstmOnly:true}});
 await send('initialize',{langs:'eng+chi_sim',oem:1,config:{load_system_dawg:'0',load_freq_dawg:'0'}});
 await send('setParameters',{params:{tessedit_pageseg_mode:'3',preserve_interword_spaces:'1'}});
 const data=await send('recognize',{image:new Uint8Array(png),options:{},output:{text:true,blocks:true}});
 const parsed=R.extract(data,{report_id:'synthetic-1'}),result={synthetic_only:true,scope:'Node VM executes shipped browser Worker + embedded WASM and models; no browser page or file protocol exercised',javascript_dynamic_code_generation:false,elapsed_ms:Math.round(performance.now()-started),network_attempts:networkAttempts,text:data.text,confidence:data.confidence,candidates:parsed.candidates};
 fs.writeFileSync(path.join(__dirname,'ocr-synthetic-results.json'),JSON.stringify(result,null,2)+'\n');
 assert.equal(networkAttempts,0);assert.ok(parsed.candidates.some(c=>c.field==='sph'&&c.value===-6));assert.ok(parsed.candidates.some(c=>c.field==='iop'&&c.value===15));assert.ok(parsed.candidates.some(c=>c.field==='date'&&c.value==='2026-10-01'));
 console.log(JSON.stringify({elapsed_ms:result.elapsed_ms,network_attempts:networkAttempts,recognized_text:data.text,candidate_count:parsed.candidates.length,fields:parsed.candidates.map(c=>c.field)}));
})().catch(err=>{console.error(err);process.exitCode=1;});
