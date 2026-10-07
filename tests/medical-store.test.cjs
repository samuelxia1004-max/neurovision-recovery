const test=require('node:test'),assert=require('node:assert/strict'),R=require('../app/recovery.js');
const T='2026-10-02T02:00:00.000Z';
function harness(){const m=new Map();let n=0,fail=false;const storage={getItem:k=>m.get(k)||null,setItem:(k,v)=>{if(fail)throw Error('quota');m.set(k,v);}};const store=R.createStore(storage,{now:()=>new Date(T),makeId:p=>p+'-'+(++n)});return {store,storage,fail:()=>fail=true};}
const draft=owner=>({participant_id:owner,exam_date:'2026-09-25',stage:'postop',source:'manual',values:[{eye:'right',field:'vault',value:520,unit:'um',confirmed:true,source:'manual'}]});
const care=owner=>({participant_id:owner,symptoms:['near'],clinician_targets:['accommodation'],clearance:'reviewed',reviewed_on:'2026-09-25'});
test('medical reports upgrade an existing profile and round trip with all follow-up data',()=>{
 const h=harness(),person=h.store.context().participant_id;h.store.saveClinical({procedure:'icl',operated_eyes:'both',left_surgery_date:'2026-09-01',right_surgery_date:'2026-09-01'});h.store.saveReport(draft(person));h.store.saveCare(care(person));assert.equal(h.store.snapshot().schema,R.SCHEMA_V6);assert.equal(h.store.medicalReports()[0].values[0].value,520);assert.equal(h.store.careProfile().symptoms[0],'near');assert.equal(h.store.importJSON(h.store.exportJSON()),0);assert.deepEqual(R.createStore(h.storage).snapshot(),h.store.snapshot());
 h.store.saveObservation({reading:'usual',breaks:'usual',night:'not_experienced',note:''});
});
test('medical writes remain atomic when storage is unavailable',()=>{
 const h=harness(),before=h.store.exportJSON();h.fail();assert.throws(()=>h.store.saveReport(draft(h.store.context().participant_id)));assert.equal(h.store.exportJSON(),before);
});
test('form ownership is checked at save time after profile switches',()=>{
 const h=harness(),a=h.store.context().participant_id,r=draft(a);h.store.newProfile();assert.throws(()=>h.store.saveReport(r),/档案已切换/);assert.equal(h.store.medicalReports().length,0);h.store.switchProfile(a);h.store.saveReport(r);h.store.newProfile();assert.equal(h.store.medicalReports().length,0);assert.equal(h.store.careProfile(),null);
});
test('prior backups cannot downgrade an enriched clinical store',()=>{
 const h=harness(),old=h.store.exportJSON(),person=h.store.context().participant_id;h.store.saveReport(draft(person));h.store.saveCare(care(person));const before=h.store.exportJSON();h.store.importJSON(old);assert.equal(h.store.exportJSON(),before);h.store.saveClinical({procedure:'icl',operated_eyes:'right',left_surgery_date:null,right_surgery_date:null});assert.equal(h.store.snapshot().schema,R.SCHEMA_V6);assert.equal(h.store.medicalReports().length,1);
});
test('medical import refuses conflicting IDs, unconfirmed values, and unknown owners atomically',()=>{
 const h=harness();h.store.saveReport(draft(h.store.context().participant_id));const before=h.store.exportJSON();
 for(const mutate of [s=>s.medical_reports[0].values[0].value=530,s=>s.medical_reports[0].values[0].confirmed=false,s=>s.medical_reports[0].participant_id='unknown',s=>s.medical_reports.push(s.medical_reports[0]),s=>s.medical_reports[0].patient_name='unexpected']){const bad=JSON.parse(before);mutate(bad);assert.throws(()=>h.store.importJSON(JSON.stringify(bad)));assert.equal(h.store.exportJSON(),before);}
});
test('newer clinical settings are append-only and select the last same-time record',()=>{
 const h=harness(),person=h.store.context().participant_id;h.store.saveCare(care(person));h.store.saveCare({...care(person),symptoms:['night'],clearance:'pending',reviewed_on:null,clinician_targets:[]});assert.equal(h.store.snapshot().care_profiles.length,2);assert.equal(h.store.careProfile().clearance,'pending');
});
test('rescue conversion retains detailed medical records and schema',()=>{
 const h=harness();h.store.saveReport(draft(h.store.context().participant_id));h.store.saveCare(care(h.store.context().participant_id));const input={schema:'neurovision.recovery.rescue.v1',primary_raw:h.store.exportJSON(),current_state:h.store.snapshot(),snapshots:{schema:'neurovision.snapshot.pending-raw.v1',entries:[]}};const result=require('../analysis/recover_snapshot_backup.cjs').recover(input);assert.deepEqual(result.state,h.store.snapshot());
});
test('a stale clinical editor cannot overwrite a report saved from another window',()=>{
 const h=harness(),other=R.createStore(h.storage,{now:()=>new Date(T),makeId:p=>p+'-other'});h.store.saveReport(draft(h.store.context().participant_id));const saved=h.storage.getItem(R.KEY);assert.throws(()=>other.saveCare(care(other.context().participant_id)),/其他窗口/);assert.equal(h.storage.getItem(R.KEY),saved);
});
