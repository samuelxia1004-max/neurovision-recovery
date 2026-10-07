const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),test=require('node:test');
const I=require('../app/practice-insights.js'),P=require('../app/perceptual-training.js');
const virtual=Object.fromEntries(['app/index.html','app/practice-insights.css'].map(f=>[f,fs.readFileSync(path.join(__dirname,'..',f),'utf8')]));
test('Current-care history separates exposure, conditions and legacy records',()=>{
const raw=JSON.parse(fs.readFileSync('qa/fixtures/synthetic-browser-session.json','utf8'));
const baseInput={now:'2026-10-07T03:00:00.000Z',context:{participant_id:raw.participant_id},care:{id:raw.source_care_id},history:[raw]};
let n=0;function check(ok,msg){assert.ok(ok,msg);n++;}
check(P.validate(raw).valid,'fixture validity');
const before=JSON.stringify(raw),s=I.build(baseInput);
check(s.sessions===1,'session count');
check(s.formal_answers===raw.blocks.flatMap(b=>b.trials).filter(t=>t.valid&&!t.familiarization&&t.exposure_ms===200).length,'formal separation');
check(s.familiarization_answers===6,'familiarization separated');
check(Object.values(s.coverage).every(v=>v===0),'stopped session cannot unlock coverage');
check(s.days.length===7&&s.days.reduce((a,d)=>a+d.sessions,0)===1,'weekly calendar');
check(s.stimulus_seconds===P.practiceSummary(raw).exposure_ms/1000,'actual stimulus time');
check(I.build({...baseInput,history:[raw,raw]}).sessions===1,'deduplication');
for(const changed of [{...baseInput,care:{id:'other'}},{...baseInput,context:{participant_id:'other'}},{...baseInput,now:'2026-12-01T03:00:00.000Z'},{...baseInput,now:'2026-10-01T03:00:00.000Z'}])check(I.build(changed).sessions===0,'scope filtering');
const invalid=structuredClone(raw);invalid.blocks[0].trials[0].contrast_after=.5;
check(I.build({...baseInput,history:[invalid]}).sessions===0,'tamper exclusion');
check(JSON.stringify(raw)===before,'immutable input');
check(I.home(baseInput,{status:'ready'}).includes('练习覆盖'),'home integration');
check(I.home(baseInput,{status:'needs_data'})==='','pending state');
check(I.records(baseInput).includes('200 ms')&&I.records(baseInput).includes('数字对比'),'condition summary');
check(!/恢复率|恢复百分比|治疗成功率/.test(I.home(baseInput,{status:'ready'})+I.records(baseInput)),'record interpretation');
check(virtual['app/index.html'].includes('practice-insights.js')&&virtual['app/index.html'].indexOf('practice-insights.js')<virtual['app/index.html'].indexOf('src="app.js"'),'script dependency order');
check(virtual['app/practice-insights.css'].includes('prefers-reduced-motion')&&!virtual['app/practice-insights.css'].replace(/\/\*[\s\S]*?\*\//g,'').includes('dialog'),'motion scope');

const legacy=structuredClone(raw);legacy.id='legacy-insights-fixture';legacy.schema=P.LEGACY_SCHEMA;legacy.plan_version=P.LEGACY_PLAN;delete legacy.initialization;delete legacy.setup.display_key;
const states=new Map();
for(const b of legacy.blocks)for(const t of b.trials){
 t.id=legacy.id+':t'+t.index;
 const key=P.channelKey(t,false),before=states.get(key)||{contrast:.24,streak:0},after=t.valid?P.staircase(before,t.correct):before;
 t.contrast=before.contrast;t.streak_before=before.streak;t.contrast_after=after.contrast;t.streak_after=after.streak;
 states.set(key,after);
}
check(P.validate(legacy).valid,'legacy fixture valid');
const legacyStats=I.build({now:'2026-10-07T03:00:00.000Z',context:{participant_id:legacy.participant_id},care:{id:legacy.source_care_id},history:[legacy]});
check(legacyStats.sessions===1,'legacy history retained');
check(legacyStats.channels.every(c=>c.display==='旧版单次条件'),'legacy geometry not merged');
assert.equal(n,23);

});

test('Stopped-session headings include only tasks that actually began',()=>{
 const UI=require('../app/app.js');
 const record=JSON.parse(fs.readFileSync('qa/fixtures/synthetic-browser-session.json','utf8'));
 assert.equal(record.blocks.filter(b=>b.status!=='not_started').length,1);
 const html=UI.recordsPage([record],{participant_id:record.participant_id});
 assert.match(html,/<h2>对比辨别<\/h2>/);
 assert.doesNotMatch(html,/<h2>对比辨别 · 多尺度细节<\/h2>/);
});
