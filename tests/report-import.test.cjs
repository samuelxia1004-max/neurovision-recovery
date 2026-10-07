const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const R=require('../app/report-import.js');
const parse=s=>R.extract(s,{report_id:'r1'}).candidates;
test('extracts every supported numeric field with explicit labels and units',()=>{
 const s='术前\n右眼 OD\nSPH -6.00 D CYL -1.25 D AXIS 180 deg\nSE -6.625 D\nIOP 15 mmHg\nVault 520 um\nACD 3.2 mm\nWTW 11.8 mm\nCCT 530 um\nPupil size 5.2 mm\nECD 2600 cells/mm2\nICL size 12.6 mm\nICL power -7.5 D\nTICL CYL -1.5 D\nICL AXIS 175 deg';
 const c=parse(s);assert.equal(c.length,15);assert.deepEqual(new Set(c.map(x=>x.field)),new Set(Object.keys(R.FIELDS)));assert.ok(c.every(x=>x.eye==='right'&&x.stage==='preop'&&x.requires_confirmation));assert.equal(c.find(x=>x.field==='axis').unit,'deg');
});
test('Chinese labels, full width signs, date and procedure retain source and date kind',()=>{
 const c=parse('术后\n左眼\n球镜 －６．００ D\n等效球镜 -6.25 D\n手术日期：2026年10月1日\n检查日期 2026/10/02\n术式：TICL');
 assert.deepEqual(c.map(x=>[x.field,x.value]),[['sph',-6],['se',-6.25],['date','2026-10-01'],['date','2026-10-02'],['procedure','ticl']]);assert.equal(c[0].eye,'left');assert.equal(c[0].source_snippet,'球镜 －６．００ D');assert.equal(c[2].date_kind,'surgery');assert.equal(c[3].date_kind,'exam');
});
test('handles explicit eye column order and numeric row field headers',()=>{
 assert.deepEqual(parse('术前\n项目 OS OD\nSPH -5.75 -6.00 D').map(x=>[x.eye,x.value]),[['left',-5.75],['right',-6]]);
 assert.deepEqual(parse('SPH(D) CYL(D) AXIS(deg)\nOD -6.00 -1.25 180\nOS -5.50 -0.75 90').map(x=>[x.field,x.eye,x.value,x.unit]),[['sph','right',-6,'D'],['cyl','right',-1.25,'D'],['axis','right',180,'deg'],['sph','left',-5.5,'D'],['cyl','left',-.75,'D'],['axis','left',90,'deg']]);
});
test('same-line eye labels are scoped to their values',()=>{
 assert.deepEqual(parse('IOP OD 15 mmHg OS 16 mmHg').map(x=>[x.eye,x.value]),[['right',15],['left',16]]);
 assert.deepEqual(parse('OD SPH -6 D OS SPH -5 D').map(x=>[x.eye,x.value]),[['right',-6],['left',-5]]);
 assert.deepEqual(parse('右眼手术日期 2026-10-01 左眼手术日期 2026-10-02').map(x=>[x.eye,x.value]),[['right','2026-10-01'],['left','2026-10-02']]);
 assert.deepEqual(parse('IOP 15 mmHg OD VAULT 500 um OS').map(x=>[x.field,x.eye]),[['iop','right'],['vault','left']]);
 assert.ok(parse('IOP 15 mmHg OD VAULT 500 um').every(x=>x.eye==='unknown'));
});
test('explicit mm/um and kPa units convert, missing or incompatible units stay marked',()=>{
 const c=parse('Vault 0.52 mm\nACD 3200 um\nIOP 2 kPa\nCCT 530\nIOP 15 D');
 assert.deepEqual(c.slice(0,3).map(x=>[x.value,x.unit]),[[520,'um'],[3.2,'mm'],[15,'mmHg']]);assert.equal(c[3].unit,null);assert.equal(c[3].suggested_unit,'um');assert.ok(c[3].flags.includes('unit_missing'));assert.ok(c[4].flags.includes('unit_mismatch'));
});
test('does not mine reference intervals, dates without labels or unlabeled numbers',()=>{
 const r=R.extract('参考范围 IOP 10-21 mmHg\nIOP 10-21 mmHg\n参考 SPH -6 D\n2026-10-01\n520 um\nIOP 15 mmHg 16 mmHg');assert.equal(r.candidates.length,0);assert.ok(r.warnings.length>=3);
 assert.equal(parse('IOP 15 mmHg 参考范围 10-21 mmHg')[0].value,15);
 for(const dash of ['—','―','–','‑','−','~','～','至']){const x=R.extract('眼压 10'+dash+'21 mmHg');assert.equal(x.candidates.length,0);assert.equal(x.warnings[0].code,'range_ignored');}
});
test('unknown eye and stage never invent laterality or postoperative status',()=>{
 const c=parse('SPH -6 D\nIOP 15 mmHg');assert.ok(c.every(x=>x.eye==='unknown'&&x.stage==='unknown'));assert.ok(c[0].flags.includes('eye_unknown'));
 const d=parse('右眼\n术前\nIOP 15 mmHg\n术后\nIOP 16 mmHg');assert.deepEqual(d.map(x=>x.stage),['preop','postop']);assert.ok(d.every(x=>!x.conflict_group));
});
test('low OCR confidence, unavailable confidence, out-of-range and bilateral values require review',()=>{
 const c=R.extract([{text:'OU AXIS 280 deg',confidence:61}]).candidates[0];assert.equal(c.confidence,.61);for(const flag of ['low_confidence','out_of_range','bilateral_value_needs_review'])assert.ok(c.flags.includes(flag));assert.ok(parse('IOP 15 mmHg')[0].flags.includes('confidence_unavailable'));
});
test('invalid calendar dates and unsupported procedures are not guessed',()=>{
 const r=R.extract('手术日期 2026-02-30\n术式 LASIK\nICL review\n日期 2026-10-02');assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].date_kind,'unknown');assert.equal(r.warnings[0].code,'invalid_date');
});
test('different reports preserve conflicting and identical values without merging',()=>{
 const a=R.extract('右眼\n术后\nIOP 15 mmHg',{report_id:'a'}),b=R.extract('右眼\n术后\nIOP 18 mmHg',{report_id:'b'});const out=R.combine([a,b]);assert.equal(out.candidates.length,2);assert.ok(out.candidates.every(c=>c.conflict_group&&c.flags.includes('conflicting_values')));assert.equal(a.candidates[0].conflict_group,undefined);
 const same=R.combine([a,R.extract('右眼\n术后\nIOP 15 mmHg',{report_id:'c'})]);assert.equal(same.candidates.length,2);assert.ok(same.candidates.every(c=>c.flags.includes('multiple_sources')));
});
test('extract retains payload text as data, never executes it',()=>{global.__ocrInjected=false;const c=parse('IOP 15 mmHg <script>global.__ocrInjected=true</script>')[0];assert.equal(c.value,15);assert.equal(global.__ocrInjected,false);assert.match(c.source_snippet,/<script>/);});
test('real PNG is accepted and disguised or oversized files are rejected',async()=>{
 const png=fs.readFileSync(path.join(__dirname,'fixtures/ocr-synthetic.png'));
 assert.equal((await R.validateImage(new File([png],'test.png',{type:'image/png'}))).type,'image/png');
 const jpg=fs.readFileSync(path.join(__dirname,'fixtures/ocr-synthetic.jpg'));assert.equal((await R.validateImage(new File([jpg],'test.jpg',{type:'image/jpeg'}))).type,'image/jpeg');
 await assert.rejects(()=>R.validateImage(new File([png],'fake.jpg',{type:'image/jpeg'})),/不一致/);
 await assert.rejects(()=>R.validateImage(new File(['not an image'],'report.png',{type:'image/png'})),/不是/);
 await assert.rejects(()=>R.validateImage({size:R.MAX_BYTES+1,arrayBuffer:async()=>new ArrayBuffer(0)}),/20 MB/);
 const large=Buffer.from(png);large.writeUInt32BE(20000,16);large.writeUInt32BE(20000,20);await assert.rejects(()=>R.validateImage(new File([large],'large.png')),/像素/);
});
test('SVG permits inert text and rejects active, external, entity and CSS content',async()=>{
 const safe='<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><text x="2" y="20">SPH -6 D</text></svg>';
 assert.equal((await R.validateImage(new File([safe],'test.svg',{type:'image/svg+xml'}))).type,'image/svg+xml');
 for(const fragment of ['<script>alert(1)</script>','<image href="https://example.com/report"/>','<foreignObject/>','<rect onclick="x()"/>','<text style="fill:&#117;rl(https://example.com/a)">x</text>','<rect fill="u&#114;l(https://example.com/a)"/>','<!DOCTYPE svg>'])await assert.rejects(()=>R.validateImage(new File([safe.replace('</svg>',fragment+'</svg>')],'unsafe.svg')),/SVG/);
});
test('TICL axes and cylinder do not populate refraction fields',()=>{
 const c=parse('TICL AXIS 170 deg\nICL CYL -1.5 D\n晶体轴位 90 度\nCYL -1.25 D\nAXIS 175 deg');assert.deepEqual(c.map(x=>x.field),['icl_axis','icl_cyl','icl_axis','cyl','axis']);
});
function recognitionHarness(hang){
 const vm=require('node:vm'),png=fs.readFileSync(path.join(__dirname,'fixtures/ocr-synthetic.png')),state={created:0,revoked:0,removed:0,workers:0};
 class TestURL extends URL {static createObjectURL(){state.created++;return 'blob:local/test';}static revokeObjectURL(){state.revoked++;}}
 class TestImage {constructor(){this.naturalWidth=1800;this.naturalHeight=1550;}set src(v){if(v&&hang!=='image')queueMicrotask(()=>this.onload?.());}}
 const document={currentScript:{src:'file:///app/report-import.js'},baseURI:'file:///app/index.html',head:{appendChild(){}},createElement(name){if(name==='script')return {remove(){state.removed++;}};return {width:0,height:0,getContext(){return{fillRect(){},drawImage(){}};},toBlob(fn){if(hang!=='canvas')queueMicrotask(()=>fn(new Blob([png],{type:'image/png'})));}};}};
 const sandbox={document,Image:TestImage,URL:TestURL,Blob,AbortController,Uint8Array,DataView,TextDecoder,TextEncoder,setTimeout,clearTimeout,queueMicrotask,console,atob,Worker:class{constructor(){state.workers++;throw Error('Unexpected worker after cancellation');}}};sandbox.globalThis=sandbox;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../app/report-import.js'),'utf8'),sandbox);return {api:sandbox.NVReportImport,file:new File([png],'synthetic.png',{type:'image/png'}),state};
}
test('timeout and abort cover image, canvas and local asset loading; later retries are not busy',async()=>{
 for(const stage of ['image','canvas','assets']){const h=recognitionHarness(stage);await assert.rejects(()=>h.api.recognize(h.file,{timeout_ms:15}),/超时/);await new Promise(r=>setTimeout(r,0));assert.equal(h.state.workers,0);assert.equal(h.state.created,h.state.revoked);if(stage==='assets')assert.equal(h.state.removed,1);const aborter=new AbortController();const p=h.api.recognize(h.file,{signal:aborter.signal,timeout_ms:100});aborter.abort();await assert.rejects(()=>p,/取消/);assert.equal(h.state.workers,0);}
});
test('browser worker runtime explicitly denies network and supplies WASM bytes',()=>{
 const source=R.workerSource({core:'var TesseractCore=()=>{};',worker:'/*test*/',wasm:'AA=='});assert.match(source,/network disabled/);assert.match(source,/wasmBinary:nvWasm/);assert.match(source,/external scripts disabled/);
 const code=fs.readFileSync(path.join(__dirname,'../app/report-import.js'),'utf8');assert.doesNotMatch(code,/localStorage|sessionStorage|indexedDB|sendBeacon/);
});
