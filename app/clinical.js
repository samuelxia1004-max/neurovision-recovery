(function(root){
'use strict';
const TYPES={icl:'ICL 晶体植入',ticl:'TICL 散光型晶体植入',none:'未做 ICL 手术'};
const EYES={both:'双眼',left:'左眼',right:'右眼',none:'未手术'};
const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fail=m=>{throw Error(m);};
function localDay(date=new Date()){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function isDay(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}
function validate(value,access,referenceDate=localDay()){
 if(!value||Array.isArray(value)||Object.keys(value).sort().join(',')!==['procedure','operated_eyes','left_surgery_date','right_surgery_date'].sort().join(','))fail('手术信息字段无效。');
 if(!['healthy','postop'].includes(access))fail('使用路径无效。');
 if(access==='postop'&&!['icl','ticl'].includes(value.procedure))fail('请选择 ICL 或 TICL 术式。');
 if(access==='postop'&&!['both','left','right'].includes(value.operated_eyes))fail('请选择已手术的眼别。');
 if(access==='healthy'&&(value.procedure!=='none'||value.operated_eyes!=='none'))fail('健康成人路径不包含术后记录，请选择 ICL 术后路径。');
 const latest=String(referenceDate).slice(0,10);if(!isDay(latest))fail('记录日期无效。');
 for(const [key,eye] of [['left_surgery_date','left'],['right_surgery_date','right']]){
  const day=value[key],operated=value.operated_eyes===eye||value.operated_eyes==='both';
  if(day!==null&&(!isDay(day)||day>latest||day<'1900-01-01'))fail('手术日期请填写已发生的有效日期，或留空。');
  if(!operated&&day!==null)fail('未手术眼的日期应留空。');
 }
 return value;
}
function form(value,access,prefix='ns'){
 if(!['ns','profile'].includes(prefix))fail('表单标识无效。');
 if(access==='healthy')return '<p class="nr-help">当前档案：健康成人研究体验。</p>';
 const v=value||{},option=(value,label,current)=>`<option value="${value}"${value===current?' selected':''}>${label}</option>`;
 return `<fieldset class="ns-clinical"><legend>ICL 术后信息</legend><div class="nr-fields"><label>术式<select id="${prefix}-procedure"><option value="">请选择</option>${['icl','ticl'].map(k=>option(k,TYPES[k],v.procedure)).join('')}</select></label><label>已手术眼<select id="${prefix}-operated-eyes"><option value="">请选择</option>${['both','left','right'].map(k=>option(k,EYES[k],v.operated_eyes)).join('')}</select></label><label>左眼手术日期 · 可选<input id="${prefix}-left-date" type="date" max="${localDay()}" value="${safe(v.left_surgery_date)}"></label><label>右眼手术日期 · 可选<input id="${prefix}-right-date" type="date" max="${localDay()}" value="${safe(v.right_surgery_date)}"></label></div></fieldset>`;
}
function read(element,access,prefix='ns'){
 if(!['ns','profile'].includes(prefix))fail('表单标识无效。');
 if(access==='healthy')return validate({procedure:'none',operated_eyes:'none',left_surgery_date:null,right_surgery_date:null},access);
 const get=id=>element.querySelector('#'+prefix+'-'+id)?.value||'';
 return validate({procedure:get('procedure'),operated_eyes:get('operated-eyes'),left_surgery_date:get('left-date')||null,right_surgery_date:get('right-date')||null},access);
}
function summary(value,referenceDate=localDay()){
 if(!value)return '待填写手术信息';
 const access=value.procedure==='none'?'healthy':'postop';validate(value,access,referenceDate);
 if(value.procedure==='none')return '健康成人研究体验';
 const relative=(label,day)=>day?`${label}术后 ${Math.round((Date.parse(String(referenceDate).slice(0,10)+'T00:00:00Z')-Date.parse(day+'T00:00:00Z'))/86400000)} 天`:null;
 return [TYPES[value.procedure],EYES[value.operated_eyes],relative('左眼',value.left_surgery_date),relative('右眼',value.right_surgery_date)].filter(Boolean).join(' · ');
}
const api={TYPES,EYES,validate,form,read,summary,localDay};if(typeof module!=='undefined')module.exports=api;root.NVClinical=api;
})(typeof window==='undefined'?globalThis:window);
