(function(root){
'use strict';
const PROTOCOL='daily-context-0.4.0';
const QUESTIONS=[
 {key:'reading',title:'今天阅读文字时，最接近哪种情况？',options:[['usual','和平时一样','按习惯就能读'],['adjusted','需要调整','放大文字或调整距离'],['reread','需要反复看','重看才能辨认'],['stopped','难以继续','因为看不清而停下'],['not_experienced','今天未阅读','暂不记录这一项']]},
 {key:'breaks',title:'今天看屏幕或阅读时，是否额外休息？',options:[['usual','照常完成','保持平时的休息安排'],['once','额外休息一次','用眼后需要暂停'],['repeated','额外休息多次','多次停下来缓一缓'],['stopped','提前停止','没有完成原定活动'],['not_experienced','今天未进行','暂不记录这一项']]},
 {key:'night',title:'今天夜间的光晕或眩光，对你有什么影响？',options:[['none','注意不到','未察觉明显光晕或眩光'],['noticed','能察觉到','没有影响辨认'],['interfered','影响辨认','看清目标更费力'],['avoided','因此避开','减少或放弃这类活动'],['not_experienced','未经历夜间场景','暂不记录这一项']]}
];
const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function validAnswers(value){return value&&QUESTIONS.every(q=>q.options.some(([key])=>value[q.key]===key))&&typeof value.note==='string'&&value.note.length<=240;}
function label(key,value){return QUESTIONS.find(q=>q.key===key)?.options.find(o=>o[0]===value)?.[1]||'未记录';}
function form(today){return `<form id="recovery-diary-form" novalidate class="daily-scenarios"><div class="daily-step-head"><span class="daily-step-count" aria-live="polite">1 / 3</span><div class="daily-step-track" aria-hidden="true"><i></i><i></i><i></i></div></div>${QUESTIONS.map((q,i)=>`<fieldset class="scenario-question" data-daily-step="${i}"${i?' hidden':''}><legend>${q.title}</legend><div class="scenario-options">${q.options.map(([key,title,description])=>`<label class="scenario-option"><input type="radio" name="${q.key}" value="${key}"${today?.[q.key]===key?' checked':''}><span><strong>${title}</strong><small>${description}</small></span></label>`).join('')}</div></fieldset>`).join('')}<label class="recovery-note-input daily-note" hidden>补充一句 <span>可选</span><textarea name="note" rows="2" maxlength="240" placeholder="例如：看远处正常，看手机需要多休息">${safe(today?.note||'')}</textarea></label><div class="recovery-save"><button class="btn text" type="button" data-daily-back hidden>上一步</button><button class="btn" type="button" data-daily-next>下一步 <span aria-hidden="true">→</span></button><button class="btn" type="submit" data-daily-save hidden>${today?'更新今天记录':'保存今天记录'}</button><span>约 20 秒 · 3 个场景</span></div><p class="daily-form-error" role="status"></p></form>`;}
function bind(form,onSave){
 let step=0;const $=s=>form.querySelector(s),panels=[...form.querySelectorAll('[data-daily-step]')];
 function show(index,focus=false){step=index;panels.forEach((p,i)=>{p.hidden=i!==step;p.classList.toggle('is-current',i===step);});$('.daily-step-count').textContent=`${step+1} / 3`;form.querySelectorAll('.daily-step-track i').forEach((x,i)=>x.classList.toggle('is-done',i<=step));$('[data-daily-back]').hidden=step===0;$('[data-daily-next]').hidden=step===2;$('[data-daily-save]').hidden=step!==2;$('.daily-note').hidden=step!==2;$('.daily-form-error').textContent='';if(focus){const panel=panels[step];(panel.querySelector('input:checked')||panel.querySelector('input'))?.focus();}}
 function selected(){return Boolean(form.querySelector(`input[name="${QUESTIONS[step].key}"]:checked`));}
 $('[data-daily-next]').addEventListener('click',()=>{if(!selected()){$('.daily-form-error').textContent='请选择最接近今天的情况。';panels[step].querySelector('input')?.focus();return;}show(Math.min(2,step+1),true);});
 $('[data-daily-back]').addEventListener('click',()=>show(Math.max(0,step-1),true));
 form.addEventListener('submit',event=>{event.preventDefault();const values={};for(let i=0;i<QUESTIONS.length;i++){const q=QUESTIONS[i],chosen=form.querySelector(`input[name="${q.key}"]:checked`);if(!chosen){show(i,true);$('.daily-form-error').textContent='请选择最接近今天的情况。';return;}values[q.key]=chosen.value;}values.note=form.querySelector('[name="note"]').value;if(!validAnswers(values)){$('.daily-form-error').textContent='请检查选项和补充文字。';return;}onSave(values);});
 show(0);
}
const api={PROTOCOL,QUESTIONS,validAnswers,label,form,bind};if(typeof module!=='undefined')module.exports=api;root.NVDaily=api;
})(typeof window==='undefined'?globalThis:window);
