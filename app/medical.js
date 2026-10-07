(function(root){
'use strict';
const REPORT_SCHEMA='neurovision.medical-report.v1',CARE_SCHEMA='neurovision.care.v1';
// Broad input checks are deliberately not diagnostic reference intervals.
const FIELDS={
 sph:{label:'球镜 SPH',unit:'D',min:-40,max:40,group:'屈光与视力'},
 cyl:{label:'柱镜 CYL',unit:'D',min:-20,max:20,group:'屈光与视力'},
 axis:{label:'散光轴位',unit:'deg',min:0,max:180,group:'屈光与视力'},
 se:{label:'等效球镜 SE',unit:'D',min:-50,max:50,group:'屈光与视力'},
 acuity_logmar:{label:'视力（logMAR）',unit:'logMAR',min:-.5,max:3,group:'屈光与视力'},
 iop:{label:'眼压 IOP',unit:'mmHg',min:0,max:80,group:'眼部检查'},
 vault:{label:'ICL 拱高',unit:'um',min:0,max:3000,group:'眼部检查'},
 acd:{label:'前房深度 ACD',unit:'mm',min:0,max:10,group:'眼部检查'},
 wtw:{label:'白到白 WTW',unit:'mm',min:5,max:20,group:'眼部检查'},
 cct:{label:'中央角膜厚度',unit:'um',min:100,max:1200,group:'眼部检查'},
 pupil_size:{label:'瞳孔直径',unit:'mm',min:0,max:12,group:'眼部检查'},
 ecd:{label:'角膜内皮细胞密度',unit:'cells/mm2',min:0,max:8000,group:'眼部检查'},
 icl_size:{label:'ICL 尺寸',unit:'mm',min:8,max:16,group:'植入晶体'},
 icl_power:{label:'ICL 度数',unit:'D',min:-40,max:40,group:'植入晶体'},
 icl_cyl:{label:'TICL 柱镜度数',unit:'D',min:-20,max:20,group:'植入晶体'},
 icl_axis:{label:'TICL 植入轴位',unit:'deg',min:0,max:180,group:'植入晶体'},
 aa:{label:'调节幅度 AA',unit:'D',min:0,max:30,group:'视功能检查'},
 npc:{label:'集合近点 NPC',unit:'cm',min:0,max:100,group:'视功能检查',scope:'binocular'},
 pfv:{label:'正融像集合 PFV',unit:'prism_diopter',min:0,max:100,group:'视功能检查',scope:'binocular'},
 nra:{label:'负相对调节 NRA',unit:'D',min:0,max:15,group:'视功能检查',scope:'binocular'},
 pra:{label:'正相对调节 PRA',unit:'D',min:-20,max:0,group:'视功能检查',scope:'binocular'},
 ac_lag:{label:'调节滞后',unit:'D',min:-5,max:5,group:'视功能检查'}
};
const SYMPTOMS={night:'夜间光晕 / 眩光',near:'阅读与近用疲劳',double:'双眼协同 / 重影',contrast:'低对比细节辨别'};
const TARGETS={accommodation:'调节功能',vergence:'集合与融合',contrast:'对比辨别'};
const SOURCES={manual:'手动录入',ocr:'图片识别后核对',text:'文字提取后核对'};
const CONDITIONS={refraction:{label:'验光方式',values:{unknown:'未记录',subjective:'主观验光',autorefraction:'电脑验光'}},correction:{label:'视力矫正状态',values:{unknown:'未记录',uncorrected:'裸眼',best_corrected:'最佳矫正',habitual:'日常矫正'}},pupil_light:{label:'瞳孔测量照度',values:{unknown:'未记录',photopic:'明视',mesopic:'中间视',scotopic:'暗视'}},icl_model:{label:'植入晶体型号',values:{unknown:'未记录',evo:'EVO',evo_plus:'EVO+',other:'其他型号'}}};
const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fail=m=>{throw Error(m);};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,names)=>object(v)&&Object.keys(v).sort().join(',')===[...names].sort().join(',');
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const isISO=v=>typeof v==='string'&&v.length===24&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const isDay=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const localDay=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const unitLabel=unit=>({'um':'μm','deg':'°','cells/mm2':'个/mm²','prism_diopter':'△'}[unit]||unit);
const eyeLabel=eye=>({right:'右眼',left:'左眼',both:'双眼 OU'}[eye]||'眼别待确认');
const finite=v=>typeof v==='number'&&Number.isFinite(v);
function validateValue(value){
 if(!exact(value,['eye','field','value','unit','source','confirmed'])||!Object.hasOwn(FIELDS,value.field)||!Object.hasOwn(SOURCES,value.source)||value.confirmed!==true)fail('每项数据需要明确眼别、来源与人工核对。');
 const def=FIELDS[value.field];
 if(!(def.scope==='binocular'?['both']:['left','right']).includes(value.eye))fail(`${def.label}需要记录为${def.scope==='binocular'?'双眼 OU 测量':'明确的左眼或右眼测量'}。`);
 if(!finite(value.value)||value.value<def.min||value.value>def.max||value.unit!==def.unit)fail(`${def.label}的数值或单位无效，请核对原报告（录入范围 ${def.min} 至 ${def.max} ${unitLabel(def.unit)}）。`);
 return value;
}
function validateReport(record,referenceDay=localDay()){
 if(!exact(record,['schema','id','participant_id','created_at','exam_date','stage','source','values',...(record?.conditions!==undefined?['conditions']:[])])||record.schema!==REPORT_SCHEMA||!validId(record.id)||!validId(record.participant_id)||!isISO(record.created_at))fail('检查报告的标识、时间或字段无效。');
 if(!isDay(referenceDay)||!isDay(record.exam_date)||record.exam_date<'1900-01-01'||record.exam_date>referenceDay||!['preop','postop'].includes(record.stage)||!Object.hasOwn(SOURCES,record.source))fail('请确认已发生的检查日期与术前 / 术后阶段。');
 if(!Array.isArray(record.values)||record.values.length<1||record.values.length>50)fail('每份报告需包含 1 至 50 项已核对数据。');
 const seen=new Set();
 for(const value of record.values){validateValue(value);const key=value.eye+'.'+value.field;if(seen.has(key))fail('同一份报告的同眼同指标存在重复或冲突，请拆分为不同报告。');seen.add(key);}
 if(record.conditions!==undefined&&(!exact(record.conditions,Object.keys(CONDITIONS))||Object.entries(CONDITIONS).some(([key,def])=>!Object.hasOwn(def.values,record.conditions[key]))))fail('检查条件或晶体型号无效。');
 return record;
}
function validateCare(record,referenceDay=localDay()){
 if(!exact(record,['schema','id','participant_id','created_at','symptoms','clinician_targets','clearance','reviewed_on'])||record.schema!==CARE_SCHEMA||!validId(record.id)||!validId(record.participant_id)||!isISO(record.created_at))fail('随访计划记录格式无效。');
 for(const [key,defs] of [['symptoms',SYMPTOMS],['clinician_targets',TARGETS]])if(!Array.isArray(record[key])||record[key].length>Object.keys(defs).length||new Set(record[key]).size!==record[key].length||record[key].some(x=>!Object.hasOwn(defs,x)))fail('随访关注项无效或重复。');
 if(!['reviewed','pending'].includes(record.clearance))fail('请选择医生确认状态。');
 if(record.clearance==='reviewed'){
  if(!isDay(record.reviewed_on)||record.reviewed_on<'1900-01-01'||record.reviewed_on>referenceDay)fail('请填写医生已确认的日期。');
 }else if(record.reviewed_on!==null||record.clinician_targets.length)fail('尚未经医生确认时，请清空确认日期与医生目标。');
 return record;
}
function ownedReports(context,reports){return (Array.isArray(reports)?reports:[]).filter(x=>x.participant_id===context.participant_id).sort((a,b)=>b.exam_date.localeCompare(a.exam_date)||b.created_at.localeCompare(a.created_at));}
function currentCare(context,care){const items=Array.isArray(care)?care:[care];return items.filter(x=>x&&x.participant_id===context.participant_id).sort((a,b)=>a.created_at.localeCompare(b.created_at)).at(-1)||null;}
function reportIssues(context,reports){
 const groups=new Map();
 for(const report of ownedReports(context,reports))for(const value of report.values){const key=[report.stage,report.exam_date,value.eye,value.field].join('/');if(!groups.has(key))groups.set(key,[]);groups.get(key).push({report_id:report.id,value:value.value,conditions:report.conditions||null});}
 const issues=[];for(const [key,items] of groups){if(new Set(items.map(x=>x.value)).size<2)continue;const [stage,exam_date,eye,field]=key.split('/');issues.push({stage,exam_date,eye,field,items});}return issues;
}
function previewEligibility(context,reports,care){const settings=currentCare(context,care),reasons=[];if(context.access!=='postop'||!['icl','ticl'].includes(context.clinical?.procedure))reasons.push('完善 ICL / TICL 手术信息');if(settings?.clearance!=='reviewed')reasons.push('记录医生允许练习的确认日期');if(!settings?.clinician_targets?.includes('contrast'))reasons.push('记录医生提出的对比辨别目标');if(settings?.symptoms?.includes('double'))reasons.push('先与医生核对双眼重影');if(reportIssues(context,reports).length)reasons.push('请医生核对同日冲突的检查值');return {allowed:reasons.length===0,reasons};}
function buildPaths(context,reports,care){
 const settings=currentCare(context,care),symptoms=settings?.symptoms||[],targets=settings?.clearance==='reviewed'?settings.clinician_targets:[],items=ownedReports(context,reports).filter(r=>r.stage==='postop'),issues=reportIssues(context,reports).filter(x=>x.stage==='postop');
 const has=field=>items.some(r=>r.values.some(v=>v.field===field));
 const missing=fields=>fields.filter(x=>!has(x)).map(x=>FIELDS[x].label);
 const paths=[
 {id:'night',title:'夜间光晕与眩光复查',tag:'眼科复查',selected:symptoms.includes('night'),why:'记录夜间发生的场景，带上屈光、瞳孔与拱高检查，交由手术医生判断。',fields:['sph','cyl','iop','vault','pupil_size'],evidence:'光晕的来源需要眼科检查；此处不据拱高或眼压数值生成训练。',source:'https://www.fda.gov/medical-devices/phakic-intraocular-lenses/during-after-surgery'},
 {id:'contrast',title:'对比知觉学习',tag:'研究练习',selected:symptoms.includes('contrast')||targets.includes('contrast'),why:'与医生讨论低对比视觉的测量条件，保留同一设备下的辨别记录。',fields:['sph','cyl','acuity_logmar'],evidence:'三焦 IOL 人群的一项随机试验显示部分对比敏感度改善，视觉质量问卷没有组间改善。ICL 人群的疗效尚待验证。',source:'https://doi.org/10.1007/s10792-023-02809-9'},
 {id:'stereo',title:'立体调节训练',tag:'专用设备',selected:symptoms.includes('near')||targets.includes('accommodation'),why:'准备调节幅度与调节滞后数据，询问是否适合门诊的专用立体设备。',fields:['aa','ac_lag','nra','pra'],evidence:'一项研究中，14 名 ICL 受试者单次训练后短期调节滞后改善；ICL 组为前后比较，无假训练对照。普通二维屏幕不能复现该设备。',source:'https://doi.org/10.1016/j.pdpdt.2026.105605'},
 {id:'lens',title:'临床透镜调节',tag:'验配后',selected:targets.includes('accommodation'),why:'由视光人员结合屈光和双眼检查决定透镜、目标与复查安排。',fields:['sph','cyl','aa','nra','pra','ac_lag'],evidence:'非 ICL 人群的 12 周随机研究比较两种积极疗法；传统训练在调节灵敏度上优于 VR，无假训练组。不能由此确定 ICL 术后的疗效或处方。',source:'https://doi.org/10.1186/s12886-022-02393-z'},
 {id:'vergence',title:'已确诊集合不足的训练',tag:'确诊后',selected:symptoms.includes('double')||targets.includes('vergence'),why:'准备集合近点与正融像集合检查；是否存在集合不足须经临床确诊。',fields:['npc','pfv'],evidence:'成人集合不足随机试验中，客观 NPC / PFV 改善，但症状变化与安慰训练没有显著组间差异；该研究并非 ICL 人群。',source:'https://pubmed.ncbi.nlm.nih.gov/33186192/'}
 ];
 return paths.map(path=>({...path,missing:missing(path.fields),conflicts:issues.filter(x=>path.fields.includes(x.field)),latest:items[0]?.exam_date||null,reviewed:settings?.clearance==='reviewed'})).sort((a,b)=>Number(b.selected)-Number(a.selected));
}
function reportTable(record){
 const rows=Object.entries(FIELDS).filter(([field])=>record.values.some(v=>v.field===field));
 const cell=(value,binocular=false)=>`<td${binocular?' colspan="2"':''}>${value?`${binocular?'<span class="nm-binocular-tag">双眼 OU</span> ':''}${safe(value.value)}<small>${safe(SOURCES[value.source])}</small>`:'<span class="nm-unknown">未记录</span>'}</td>`;
 return `<div class="nm-table-wrap"><table class="nm-table"><thead><tr><th>检查项目</th><th>右眼 OD</th><th>左眼 OS</th><th>单位</th></tr></thead><tbody>${rows.map(([field,def])=>`<tr><th scope="row">${safe(def.label)}</th>${def.scope==='binocular'?cell(record.values.find(v=>v.field===field&&v.eye==='both'),true):['right','left'].map(eye=>cell(record.values.find(v=>v.field===field&&v.eye===eye))).join('')}<td>${safe(unitLabel(def.unit))}</td></tr>`).join('')}</tbody></table></div><p class="nm-note nm-conditions-line">${Object.entries(CONDITIONS).map(([key,def])=>`${safe(def.label)}：${safe(def.values[record.conditions?.[key]||'unknown'])}`).join(' · ')}</p>`;
}
function conditionsForm(){return `<details class="nm-conditions"><summary>检查条件与晶体型号 · 可选</summary><div class="nm-condition-grid">${Object.entries(CONDITIONS).map(([key,def])=>`<label>${safe(def.label)}<select data-nm-condition="${key}">${Object.entries(def.values).map(([value,label])=>`<option value="${safe(value)}">${safe(label)}</option>`).join('')}</select></label>`).join('')}</div><p class="nm-note">明视与暗视瞳孔、裸眼与矫正视力不能直接比较。屈光散光轴位和 TICL 植入轴位分别记录。双眼条件不同，请分成两份报告保存。</p></details>`;}
function conflictNotice(issues){return issues.length?`<aside class="nm-conflicts" role="status"><strong>${issues.length} 组同日检查值待核对</strong><p>原始记录均已保留。不同测量条件或录入更正都可能产生差异，请带给医生核对。</p><ul>${issues.map(x=>`<li>${safe(x.exam_date)} · ${x.stage==='preop'?'术前':'术后'} · ${eyeLabel(x.eye)} ${safe(FIELDS[x.field].label)}：${x.items.map(v=>safe(v.value)).join(' / ')} ${safe(unitLabel(FIELDS[x.field].unit))}</li>`).join('')}</ul></aside>`:'';}
function entryRows(){let group='';return Object.entries(FIELDS).map(([field,def])=>{let title='';if(def.group!==group){group=def.group;title=`<tr class="nm-group-row"><th colspan="4">${safe(group)}</th></tr>`;}const input=eye=>`<input inputmode="decimal" type="number" step="any" min="${def.min}" max="${def.max}" data-nm-field="${field}" data-nm-eye="${eye}" aria-label="${eyeLabel(eye)} ${safe(def.label)}，单位 ${safe(unitLabel(def.unit))}" placeholder="未记录" autocomplete="off">`;return `${title}<tr><th scope="row">${safe(def.label)}</th>${def.scope==='binocular'?`<td colspan="2"><label class="nm-binocular-input"><span>双眼 OU</span>${input('both')}</label></td>`:['right','left'].map(eye=>`<td>${input(eye)}</td>`).join('')}<td>${safe(unitLabel(def.unit))}</td></tr>`;}).join('');}
function reportForm(){return `<details class="nm-editor" data-dismiss-outside data-nm-editor><summary><span>添加手术 / 检查报告</span><small>支持图片识别、粘贴文字或手动填写</small></summary><div class="nm-editor-body"><form data-nm-report-form><div class="nm-form-head"><label>检查日期<input data-nm-date type="date" max="${localDay()}" required></label><label>本次检查阶段<select data-nm-stage required><option value="">请选择</option><option value="preop">术前检查</option><option value="postop">术后检查</option></select></label></div>
 <details class="nm-importer" data-nm-importer><summary>从报告图片或文字提取</summary><div class="nm-import-body"><p class="nm-note">先裁去姓名与证件信息，保留指标、单位和眼别。识别在本机完成；仅保存你核对后的数值。</p><label class="nm-upload">选择报告图片<input type="file" data-nm-upload accept="image/png,image/jpeg,image/svg+xml,.png,.jpg,.jpeg,.svg"></label><p class="nm-note">PNG / JPG / SVG · 最大 20 MB</p><div class="nm-preview" data-nm-preview hidden></div><label>或粘贴报告文字<textarea data-nm-text maxlength="20000" rows="4" placeholder="例如：术后　检查日期 2026-10-01&#10;右眼 眼压 15 mmHg　拱高 480 μm"></textarea></label><div class="nm-actions"><button type="button" class="btn secondary" data-nm-extract>提取文字中的指标</button><button type="button" class="btn text" data-nm-cancel>清除识别材料</button></div><p class="nm-progress" data-nm-progress role="status" aria-live="polite"></p><div data-nm-candidates></div></div></details>
 <p class="nm-note">一份记录对应同一天、同一阶段的检查。不同报告分别保存；留空表示未知。视力仅接收 logMAR。集合近点、正融像集合与正负相对调节在双眼 OU 栏记录，其余指标按原报告分别填入左右眼。</p>${conditionsForm()}<div class="nm-table-wrap"><table class="nm-table nm-entry-table"><thead><tr><th>检查项目</th><th>右眼 OD</th><th>左眼 OS</th><th>单位</th></tr></thead><tbody>${entryRows()}</tbody></table></div><label class="nm-check nm-confirm"><input type="checkbox" data-nm-confirm required><span>我已对照原报告核对日期、阶段、左右眼、数值、单位和检查条件。</span></label><div class="nm-actions"><button class="btn" type="submit">保存这份报告</button><span>数值范围仅用于检查录入格式</span></div><p class="nm-note">如需更正，请添加新报告并保留原记录。同日、同阶段的不同数值会标记为待核对。</p></form><p data-nm-message class="nm-message" role="status" aria-live="polite"></p></div></details>`;}
function careForm(context,care){const current=currentCare(context,care),checked=(arr,key)=>arr?.includes(key)?' checked':'';return `<details class="nm-care-editor" data-dismiss-outside><summary>设置关注项与医生确认信息</summary><form data-nm-care-form><fieldset><legend>最近希望改善的日常场景</legend><div class="nm-check-grid">${Object.entries(SYMPTOMS).map(([key,label])=>`<label class="nm-check"><input type="checkbox" name="nm-symptom" value="${key}"${checked(current?.symptoms,key)}><span>${label}</span></label>`).join('')}</div></fieldset><fieldset><legend>医生计划</legend><label class="nm-check"><input data-nm-reviewed type="checkbox"${current?.clearance==='reviewed'?' checked':''}><span>医生已评估，并允许我进行所讨论的视功能练习</span></label><div class="nm-clinician-inputs" data-nm-clinician${current?.clearance==='reviewed'?'':' hidden'}><label>确认日期<input data-nm-reviewed-date type="date" max="${localDay()}" value="${safe(current?.reviewed_on)}"></label><p class="nm-note">仅勾选医生明确提出的目标。症状或报告数值不能替代诊断。</p><div class="nm-check-grid">${Object.entries(TARGETS).map(([key,label])=>`<label class="nm-check"><input type="checkbox" name="nm-target" value="${key}"${checked(current?.clinician_targets,key)}><span>${label}</span></label>`).join('')}</div></div></fieldset><button class="btn secondary" type="submit">保存关注项与确认信息</button><p data-nm-care-message class="nm-message" role="status"></p></form></details>`;}
function pathCards(context,reports,care){const eligibility=previewEligibility(context,reports,care);return buildPaths(context,reports,care).map(path=>`<article class="nm-path${path.selected?' is-relevant':''}" data-nm-path="${path.id}"><div class="nm-path-meta"><span>${safe(path.tag)}</span>${path.selected?'<b>与你的关注项相关</b>':''}</div><h3>${safe(path.title)}</h3><p>${safe(path.why)}</p>${path.conflicts.length?`<p class="nm-conflict-note">相关指标有同日不同值，先交由医生核对。${path.conflicts.map(x=>`${safe(x.exam_date)} ${eyeLabel(x.eye)}${safe(FIELDS[x.field].label)}`).join('；')}</p>`:''}<details><summary>准备复查指标</summary><div><p><strong>建议带上</strong> ${path.fields.map(x=>safe(FIELDS[x].label)).join('、')}</p><p>${path.missing.length?`术后资料尚缺：${path.missing.map(safe).join('、')}。`:'这些指标在术后资料中已有记录，请在复查时核对日期与测量条件。'}</p>${path.latest?`<p>最近一份术后报告：${safe(path.latest)}。较早数据仍独立保留。</p>`:'<p>尚无术后报告；术前数值仅作为背景资料。</p>'}</div></details>${path.id==='contrast'?`<button class="btn text" type="button" data-nm-contrast${eligibility.allowed?'':' disabled'} aria-describedby="nm-preview-reason">预览交互</button><p class="nm-preview-reason" id="nm-preview-reason">${eligibility.allowed?'仅预览方向辨别交互；不形成疗程或训练剂量，ICL 疗效尚未验证。':eligibility.reasons.map(safe).join('；')+'。'}</p>`:''}</article>`).join('');}
function panel(context,reports=[],care=null,options={}){
 const items=ownedReports(context,reports),current=currentCare(context,care),latest=items[0],issues=reportIssues(context,reports);
 return `<section class="nm-medical" data-nm-owner="${safe(context.participant_id)}" aria-labelledby="nm-reports-title"><div class="nm-section-head"><div><h2 id="nm-reports-title">检查报告</h2><p>把每次报告放在同一份档案中，保留检查日期与来源。</p></div><span class="nm-count">${items.length} 份报告</span></div>${conflictNotice(issues)}${latest?`<details class="nm-report-latest" open><summary><strong>最近检查 · ${safe(latest.exam_date)}</strong><span>${latest.stage==='preop'?'术前':'术后'} · ${latest.values.length} 项</span></summary>${reportTable(latest)}</details>`:'<div class="nm-empty"><div class="nm-eye-mark" aria-hidden="true">OD <span>·</span> OS</div><p>先录入一份检查报告</p><span>球镜、散光、拱高、眼压与视功能指标均可分别记录。</span></div>'}${reportForm()}${items.length>1?`<details class="nm-history"><summary>查看全部 ${items.length} 份检查报告</summary>${items.map(r=>`<details><summary>${safe(r.exam_date)} · ${r.stage==='preop'?'术前':'术后'} · ${r.values.length} 项 <small>${safe(SOURCES[r.source])}</small></summary>${reportTable(r)}</details>`).join('')}</details>`:''}</section><section class="nm-paths" aria-labelledby="nm-paths-title"><div class="nm-section-head"><div><h2 id="nm-paths-title">练习目标与医生确认</h2><p>保存后自动更新训练项目与时长。</p></div><span class="nm-care-status">${current?.clearance==='reviewed'?`已记录医生确认 · ${safe(current.reviewed_on)}`:'等待医生确认'}</span></div>${careForm(context,care)}<div class="nm-path-grid">${options.profile?'':pathCards(context,reports,care)}</div><p class="nm-safety">如出现突然视力下降、明显眼痛或红眼加重，请及时联系手术医生。</p></section>`;
}
function parseReview(candidates,selections,stage){
 if(!['preop','postop'].includes(stage))fail('先选择本次报告的术前 / 术后阶段，再填入指标。');
 const values=[],seen=new Set();
 for(const choice of selections){
  if(!choice.confirmed)continue;const candidate=candidates[choice.index];if(!candidate||!Object.hasOwn(FIELDS,candidate.field))fail('识别指标无效。');
  if(candidate.stage!=='unknown'&&candidate.stage!==stage)fail('所选指标包含不同检查阶段，请分别保存术前和术后报告。');
  const v={eye:choice.eye,field:candidate.field,value:choice.value,unit:choice.unit,source:choice.source,confirmed:true};validateValue(v);
  const key=v.eye+'.'+v.field;if(seen.has(key))fail('已选指标有同眼重复或冲突，请只保留原报告正确的一项。');seen.add(key);values.push(v);
 }
 if(!values.length)fail('请逐项核对并勾选要填入的指标。');return values;
}
function bind(container,callbacks){
 const mount=container.querySelector('.nm-medical');if(!mount)return ()=>{};
 const owner=mount.dataset.nmOwner,find=s=>container.querySelector(s),all=s=>[...container.querySelectorAll(s)];
 let stopped=false,controller=null,previewURL=null,candidates=[],candidateSource='text',generation=0,provenance=new Map(),observer=null;
 const active=()=>!stopped&&mount.isConnected&&callbacks.getContext().participant_id===owner;
 const guard=()=>{if(!active())fail('档案已切换或页面已关闭，请重新打开当前档案后操作。');};
 const message=(value,error=false,care=false)=>{const node=find(care?'[data-nm-care-message]':'[data-nm-message]');if(node){node.textContent=value;node.classList.toggle('is-error',error);}};
 const progress=value=>{const node=find('[data-nm-progress]');if(node)node.textContent=value;};
 const clearMaterials=()=>{generation++;controller?.abort();controller=null;if(previewURL){URL.revokeObjectURL(previewURL);previewURL=null;}candidates=[];const preview=find('[data-nm-preview]');if(preview){preview.replaceChildren();preview.hidden=true;}const text=find('[data-nm-text]');if(text)text.value='';const upload=find('[data-nm-upload]');if(upload)upload.value='';const review=find('[data-nm-candidates]');if(review)review.replaceChildren();progress('');};
 const cleanup=()=>{if(stopped)return;stopped=true;clearMaterials();observer?.disconnect();};
 const editor=find('[data-nm-editor]'),importer=find('[data-nm-importer]');
 editor?.addEventListener('toggle',()=>{if(!editor.open)clearMaterials();});
 importer?.addEventListener('toggle',()=>{if(!importer.open)clearMaterials();});
 find('[data-nm-cancel]')?.addEventListener('click',clearMaterials);
 const renderCandidates=result=>{
  candidates=result.candidates||[];const usable=candidates.filter(c=>Object.hasOwn(FIELDS,c.field)),meta=candidates.filter(c=>c.field==='date'||c.field==='procedure');
  find('[data-nm-candidates]').innerHTML=`<div class="nm-review-head"><h3>核对提取结果</h3><p>每项确认后填入下方表格。检查日期和阶段需在表格上方填写；眼别不明或冲突的项需逐项处理。</p></div>${meta.length?`<div class="nm-meta-hints">${meta.map(c=>`<p>${c.field==='date'?({surgery:'手术日期',exam:'检查日期',report:'报告日期',unknown:'未分类日期'}[c.date_kind]||'日期'):'术式'}线索：<strong>${safe(c.value)}</strong><small>${safe(c.source_snippet)}</small></p>`).join('')}<p>日期线索不会自动写入。手术日期请在手术信息区核对保存。</p></div>`:''}${usable.length?`<div class="nm-review-list">${candidates.map((c,index)=>{if(!Object.hasOwn(FIELDS,c.field))return '';const def=FIELDS[c.field],flags=c.flags||[];return `<div class="nm-review-row" data-nm-review="${index}"><div><strong>${safe(def.label)}</strong><small class="nm-source-snippet">原文：${safe(String(c.source_snippet||'').slice(0,500))}</small><small>${c.confidence===null?'置信度未提供':`OCR 置信度 ${Math.round(c.confidence*100)}%`} · ${c.stage==='preop'?'术前':c.stage==='postop'?'术后':'阶段待确认'}${c.conflict_group?' · 多个值冲突':''}${flags.includes('unit_missing')?' · 原文单位缺失':''}${flags.includes('unit_mismatch')?' · 单位不匹配':''}${flags.includes('out_of_range')?' · 数值需重新核对':''}</small></div><div class="nm-review-controls"><label>眼别<select data-nm-review-eye><option value="">确认眼别</option>${def.scope==='binocular'?`<option value="both"${c.eye==='both'?' selected':''}>双眼 OU</option>`:`<option value="right"${c.eye==='right'?' selected':''}>右眼 OD</option><option value="left"${c.eye==='left'?' selected':''}>左眼 OS</option>`}</select></label><label>数值<input data-nm-review-value type="number" step="any" value="${safe(c.value)}" min="${def.min}" max="${def.max}"></label><label>单位<select data-nm-review-unit>${c.unit===def.unit?'':'<option value="">核对原文单位</option>'}<option value="${safe(def.unit)}">${safe(unitLabel(def.unit))}</option></select></label><label class="nm-check"><input type="checkbox" data-nm-review-confirm><span>已核对</span></label></div></div>`;}).join('')}</div><button type="button" class="btn secondary" data-nm-apply>将已核对的指标填入表格</button>`:'<p class="nm-note">未识别到可填写的指标。可尝试更清晰的图片，或直接在下表录入。</p>'}`;
  find('[data-nm-apply]')?.addEventListener('click',()=>{try{guard();const examDate=find('[data-nm-date]').value;if(!isDay(examDate)||examDate<'1900-01-01'||examDate>localDay())fail('先核对并填写本次检查日期，再填入指标。');const stage=find('[data-nm-stage]').value,choices=all('[data-nm-review]').map(row=>({index:Number(row.dataset.nmReview),eye:row.querySelector('[data-nm-review-eye]').value,value:row.querySelector('[data-nm-review-value]').value===''?NaN:Number(row.querySelector('[data-nm-review-value]').value),unit:row.querySelector('[data-nm-review-unit]').value,confirmed:row.querySelector('[data-nm-review-confirm]').checked,source:candidateSource}));const values=parseReview(candidates,choices,stage);
   // Validate the full change set before mutating any form field.
   for(const v of values){const input=find(`[data-nm-field="${v.field}"][data-nm-eye="${v.eye}"]`);if(input.value!==''&&Number(input.value)!==v.value)fail(`${eyeLabel(v.eye)}${FIELDS[v.field].label}已有不同数值；请清空原值或分开保存报告。`);}
   for(const v of values){find(`[data-nm-field="${v.field}"][data-nm-eye="${v.eye}"]`).value=String(v.value);provenance.set(v.eye+'.'+v.field,{...v,stage});}find('[data-nm-confirm]').checked=false;message(`已填入 ${values.length} 项。请核对检查日期、阶段和左右眼后保存。`);
  }catch(error){message(error.message,true);}});
  const skipped=(result.warnings||[]).length;progress(`提取到 ${usable.length} 项指标，等待逐项核对。${skipped?`另有 ${skipped} 处参考区间或格式问题未纳入，请对照原报告补全。`:''}`);
 };
 find('[data-nm-extract]')?.addEventListener('click',()=>{try{guard();controller?.abort();generation++;const text=find('[data-nm-text]').value;if(!text.trim())fail('请先粘贴报告文字。');if(text.length>20000)fail('报告文字最多 20,000 字符。');if(!root.NVReportImport?.extract)fail('报告提取模块未加载，请重新打开完整项目。');candidateSource='text';renderCandidates(root.NVReportImport.extract(text,{report_id:'local-draft'}));}catch(error){message(error.message,true);}});
 find('[data-nm-upload]')?.addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;clearMaterials();const ticket=++generation;
  try{guard();if(!root.NVReportImport?.recognize)fail('图片识别模块未加载，请重新打开完整项目。');controller=new AbortController();progress('正在检查图片…');const validated=await root.NVReportImport.validateImage(file);guard();if(ticket!==generation)return;
   previewURL=URL.createObjectURL(new Blob([validated.bytes],{type:validated.type}));const img=document.createElement('img');img.src=previewURL;img.alt='待核对的报告图片，仅在本页临时预览';find('[data-nm-preview]').replaceChildren(img);find('[data-nm-preview]').hidden=false;candidateSource='ocr';progress('正在本机识别报告…');
   const result=await root.NVReportImport.recognize(file,{report_id:'local-draft',signal:controller.signal,onProgress:state=>{if(active()&&ticket===generation)progress(`正在本机识别报告${finite(state.progress)?` · ${Math.round(Math.max(0,Math.min(1,state.progress))*100)}%`:'…'}`);}});guard();if(ticket!==generation)return;renderCandidates(result);
  }catch(error){if(active()&&ticket===generation){progress('');message(error.message,true);}}finally{if(ticket===generation)controller=null;}
 });
 all('[data-nm-condition]').forEach(input=>input.addEventListener('change',()=>{find('[data-nm-confirm]').checked=false;}));
 all('[data-nm-field]').forEach(input=>input.addEventListener('input',()=>{provenance.delete(input.dataset.nmEye+'.'+input.dataset.nmField);find('[data-nm-confirm]').checked=false;}));
 find('[data-nm-stage]')?.addEventListener('change',()=>{find('[data-nm-confirm]').checked=false;});
 find('[data-nm-date]')?.addEventListener('change',()=>{find('[data-nm-confirm]').checked=false;});
 find('[data-nm-report-form]')?.addEventListener('submit',async event=>{event.preventDefault();let submit=event.submitter||event.target.querySelector('[type="submit"]');try{guard();if(!find('[data-nm-confirm]').checked)fail('请先核对原报告并勾选确认。');const stage=find('[data-nm-stage]').value,values=all('[data-nm-field]').filter(input=>input.value.trim()!=='').map(input=>{const field=input.dataset.nmField,eye=input.dataset.nmEye,value=Number(input.value),prior=provenance.get(eye+'.'+field);if(prior&&prior.stage!==stage)fail('报告阶段发生变化，请重新核对已提取指标的阶段。');return {eye,field,value,unit:FIELDS[field].unit,source:prior&&prior.value===value?prior.source:'manual',confirmed:true};});const source=values.some(v=>v.source==='ocr')?'ocr':values.some(v=>v.source==='text')?'text':'manual',draft={participant_id:owner,exam_date:find('[data-nm-date]').value,stage,source,values,conditions:Object.fromEntries(all('[data-nm-condition]').map(input=>[input.dataset.nmCondition,input.value]))};validateReport({...draft,schema:REPORT_SCHEMA,id:'draft',created_at:new Date().toISOString()});guard();submit.disabled=true;const saved=await callbacks.saveReport(draft);if(saved===false)fail('报告尚未保存，请重试或导出已有资料。');if(!active())return;clearMaterials();provenance.clear();event.target.reset();message('报告已保存。每份报告独立保留，可在报告列表中核对。');callbacks.notify?.('检查报告已保存。',false);}catch(error){if(active())message(error.message,true);}finally{if(submit)submit.disabled=false;}});
 find('[data-nm-reviewed]')?.addEventListener('change',event=>{find('[data-nm-clinician]').hidden=!event.target.checked;if(!event.target.checked){find('[data-nm-reviewed-date]').value='';all('[name="nm-target"]').forEach(x=>x.checked=false);}});
 find('[data-nm-care-form]')?.addEventListener('submit',async event=>{event.preventDefault();const submit=event.submitter||event.target.querySelector('[type="submit"]');try{guard();const reviewed=find('[data-nm-reviewed]').checked,draft={participant_id:owner,symptoms:all('[name="nm-symptom"]:checked').map(x=>x.value),clinician_targets:reviewed?all('[name="nm-target"]:checked').map(x=>x.value):[],clearance:reviewed?'reviewed':'pending',reviewed_on:reviewed?find('[data-nm-reviewed-date]').value:null};validateCare({...draft,schema:CARE_SCHEMA,id:'draft',created_at:new Date().toISOString()});guard();submit.disabled=true;const saved=await callbacks.saveCare(draft);if(saved===false)fail('关注项尚未保存，请重试。');if(!active())return;message('关注项与医生确认信息已保存。',false,true);callbacks.notify?.('训练方案已根据资料更新。',false);}catch(error){if(active())message(error.message,true,true);}finally{if(submit)submit.disabled=false;}});
 find('[data-nm-contrast]')?.addEventListener('click',()=>{try{guard();const eligibility=previewEligibility(callbacks.getContext(),callbacks.getReports?.()||[],callbacks.getCare?.());if(!eligibility.allowed)fail(eligibility.reasons.join('；')+'。');if(callbacks.onContrastPreview)callbacks.onContrastPreview();else fail('交互预览尚未加载，请重新打开完整项目。');}catch(error){const note=find('#nm-preview-reason');if(note){note.textContent=error.message;note.setAttribute('role','status');}}});
 if(typeof MutationObserver!=='undefined'){observer=new MutationObserver(()=>{if(!active())cleanup();});observer.observe(document.documentElement,{subtree:true,childList:true});}
 return cleanup;
}
const api={REPORT_SCHEMA,CARE_SCHEMA,FIELDS,SYMPTOMS,TARGETS,CONDITIONS,validateValue,validateReport,validateCare,currentCare,reportIssues,previewEligibility,buildPaths,parseReview,panel,bind};
if(typeof module!=='undefined')module.exports=api;root.NVMedical=api;
})(typeof window==='undefined'?globalThis:window);
