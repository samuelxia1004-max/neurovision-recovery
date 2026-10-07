(function(root){
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
  const inputNames={keyboard:'键盘',pointer:'触屏 / 鼠标'};
  const percent=value=>Number.isFinite(value)?Math.round(value*100)+'%':'—';
  const time=value=>new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
  function group(records){
    const groups=new Map(),excluded={quality:0,input:0,conditions:0};
    for(const item of records){
      if(item.status!=='complete'||!item.summary?.qualified){excluded.quality++;continue;}
      if(!Object.hasOwn(inputNames,item.input_mode)){excluded.input++;continue;}
      if(!item.setup?.fingerprint||!item.config?.version||!item.participant_id){excluded.conditions++;continue;}
      const key=JSON.stringify([item.participant_id,item.config.version,item.setup.fingerprint,item.input_mode]);
      if(!groups.has(key))groups.set(key,{key,records:[]});
      groups.get(key).records.push(item);
    }
    const result=[...groups.values()];
    for(const item of result)item.records.sort((a,b)=>a.completed_at.localeCompare(b.completed_at)||a.id.localeCompare(b.id));
    result.sort((a,b)=>b.records.at(-1).completed_at.localeCompare(a.records.at(-1).completed_at)||a.key.localeCompare(b.key));
    return {groups:result,excluded};
  }
  function chart(records){
    const recent=records.slice(-14),w=620,h=196,left=44,right=20,top=20,bottom=35;
    const start=Date.parse(recent[0].completed_at),end=Date.parse(recent.at(-1).completed_at);
    const x=r=>left+(start===end?.5:(Date.parse(r.completed_at)-start)/(end-start))*(w-left-right),y=n=>top+(1-n)*(h-top-bottom);
    return `<svg class="comparison-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="同条件最近 ${recent.length} 次正确率与各次 95% 区间；详细数值见下方表格。">${[0,.5,1].map(n=>`<line x1="${left}" x2="${w-right}" y1="${y(n)}" y2="${y(n)}" class="comparison-grid"/><text x="${left-9}" y="${y(n)+4}" text-anchor="end">${n*100}%</text>`).join('')}${recent.map(r=>{const s=r.summary,cx=x(r);return `<g><title>${escape(time(r.completed_at))}：${s.correct}/${s.valid_trials}；95% 区间 ${percent(s.low)}–${percent(s.high)}</title><line class="comparison-range" x1="${cx}" x2="${cx}" y1="${y(s.low)}" y2="${y(s.high)}"/><line class="comparison-range" x1="${cx-4}" x2="${cx+4}" y1="${y(s.low)}" y2="${y(s.low)}"/><line class="comparison-range" x1="${cx-4}" x2="${cx+4}" y1="${y(s.high)}" y2="${y(s.high)}"/><circle class="comparison-point" cx="${cx}" cy="${y(s.accuracy)}" r="4"/></g>`;}).join('')}<text x="${left}" y="${h-8}">${escape(time(recent[0].completed_at))}</text>${recent.length>1?`<text x="${w-right}" y="${h-8}" text-anchor="end">${escape(time(recent.at(-1).completed_at))}</text>`:''}</svg>`;
  }
  function render(records,selectedKey){
    const model=group(records),groups=model.groups,selected=groups.find(g=>g.key===selectedKey)||groups[0];
    if(!selected)return '<div class="snapshot-comparison"><h3>同条件比较</h3><p class="recovery-note">完成一次质量合格、使用同一种操作方式的快照后显示。</p></div>';
    const rows=selected.records,last=rows.at(-1),s=last.setup,excluded=Object.values(model.excluded).reduce((a,b)=>a+b,0);
    return `<div class="snapshot-comparison"><div class="comparison-heading"><h3>同条件比较</h3>${groups.length>1?`<label>测量条件<select id="snapshot-comparison">${groups.map((g,i)=>`<option value="${i}"${g===selected?' selected':''}>条件 ${i+1} · ${g.records.length} 次 · 最近 ${escape(time(g.records.at(-1).completed_at))}</option>`).join('')}</select></label>`:`<span>${rows.length} 次</span>`}</div><p class="comparison-conditions">${s.distance_cm} cm · ${s.brightness_percent}% 亮度 · ${inputNames[last.input_mode]} · ${escape({daylight:'日光',room_light:'室内灯光',dim:'昏暗环境'}[s.ambient]||s.ambient)}</p>${chart(rows)}<p class="recovery-note">圆点为每次正确率，竖线为 95% 区间。${rows.length===1?'再完成一次相同条件的快照后，可并列观察。':'短测波动与练习均会影响结果，变化的临床意义需结合随访评估。'}</p><details class="comparison-values"><summary>比较数据${excluded?` · ${excluded} 次待复核记录另列于明细`:''}</summary><div class="recovery-table-wrap"><table><thead><tr><th>时间</th><th>正确 / 有效</th><th>95% 区间</th><th>中位时间</th></tr></thead><tbody>${rows.slice(-14).map(r=>`<tr><td>${escape(time(r.completed_at))}</td><td>${r.summary.correct} / ${r.summary.valid_trials}</td><td>${percent(r.summary.low)}–${percent(r.summary.high)}</td><td>${r.summary.median_rt_ms===null?'—':Math.round(r.summary.median_rt_ms)+' ms'}</td></tr>`).join('')}</tbody></table></div><p class="recovery-note">图表显示所选条件最近 14 次。按档案、协议、设备、校准、观看与手术信息及操作类别匹配；混合操作、质量标记记录保留在全部明细。</p></details></div>`;
  }
  const api={group,render};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.NVLongitudinal=api;
})(typeof window!=='undefined'?window:globalThis);
