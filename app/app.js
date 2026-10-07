(function (root) {
  'use strict';

  const PAGES = ['recovery', 'profile', 'records', 'measure'];
  const TITLES = {recovery: '今日训练', profile: '手术档案', records: '训练记录', measure: '视觉复测'};
  const TASKS = {
    contrast: {label: '对比辨别', purpose: '辨认低对比条纹的方向。'},
    multiscale: {label: '多尺度细节', purpose: '在不同粗细的条纹中辨认方向。'},
    collinear: {label: '轮廓与背景', purpose: '在两侧条纹陪衬下辨认中央目标。'},
    noise: {label: '干扰中辨别', purpose: '从视觉噪声中辨认目标方向。'}
  };
  const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
  const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
  const arrow = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>';

  function duration(seconds) {
    const value = Math.round(numeric(seconds));
    if (value < 60) return `${value} 秒`;
    return `${Math.floor(value / 60)} 分钟${value % 60 ? ` ${value % 60} 秒` : ''}`;
  }
  function clockTime(seconds) {
    const value = Math.round(numeric(seconds));
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  }
  function dateLabel(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('zh-CN', {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false}).format(date) : '日期未记录';
  }
  function heading(title, description = '') {
    return `<header class="training-page-heading"><div><h1>${safe(title)}</h1>${description ? `<p>${safe(description)}</p>` : ''}</div></header>`;
  }
  function validItems(plan) {
    return Array.isArray(plan?.items) ? plan.items.filter(item => Object.hasOwn(TASKS, item.task_id) && numeric(item.seconds) > 0) : [];
  }
  function readyPlan(plan, context) {
    return ['icl-training-plan-v1','icl-training-plan-v2'].includes(plan?.version) && plan.status === 'ready' && typeof context?.participant_id === 'string' && context.participant_id.length > 0 && plan.participant_id === context.participant_id && validItems(plan).length > 0 && validItems(plan).length === plan.items.length;
  }
  function frequencies(item) {
    return (Array.isArray(item.cpds) ? item.cpds : []).filter(value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 60);
  }
  function texture(item, small = false) {
    const cpds = frequencies(item);
    const middle = cpds[Math.floor(cpds.length / 2)];
    const pitch = middle ? Math.max(3, Math.min(16, 18 / Math.sqrt(middle))) : 9;
    return `<span class="frequency-texture texture-${safe(item.task_id)}${small ? ' is-small' : ''}" style="--texture-pitch:${pitch.toFixed(2)}px" aria-hidden="true"><i></i><i></i><i></i></span>`;
  }
  function frequencyLabel(item) {
    const cpds = frequencies(item);
    return cpds.length ? `${cpds.join(' / ')} cpd` : '方向辨认';
  }
  function trainingTrack(items) {
    let elapsed = 0;
    const total = items.reduce((sum, item) => sum + numeric(item.seconds), 0);
    return `<div class="training-track" aria-label="训练顺序与计划时长"><div class="training-track-heading"><span>按序进行</span><span>纹理示意</span></div><ol class="frequency-stations">${items.map((item, index) => `<li><span class="station-index">${String(index + 1).padStart(2, '0')}</span>${texture(item)}<span class="station-label">${safe(item.label || TASKS[item.task_id].label)}</span><span class="station-cpd">${safe(frequencyLabel(item))}</span></li>`).join('')}</ol><ol class="training-timebar" aria-label="各项练习时长占比">${items.map((item, index) => {
      const start = elapsed;
      elapsed += numeric(item.seconds);
      return `<li style="flex-grow:${numeric(item.seconds)}" class="timebar-part tone-${index % 4}" aria-label="${safe(item.label || TASKS[item.task_id].label)}，${clockTime(start)} 至 ${clockTime(elapsed)}"><span>${String(index + 1).padStart(2, '0')}</span></li>`;
    }).join('')}</ol><div class="training-ticks" aria-hidden="true"><span>00:00</span><span>${clockTime(total)}</span></div></div>`;
  }
  function trainingCards(items) {
    return `<section class="training-sequence" aria-labelledby="sequence-title"><div class="training-section-heading"><h2 id="sequence-title">本次练习</h2><span>完成一项后自动进入下一项</span></div><ol class="training-card-list">${items.map((item, index) => `<li class="training-card"><div class="training-card-top"><span class="training-order">${String(index + 1).padStart(2, '0')}</span><span class="training-evidence${item.evidence === 'mechanism_extension' ? ' is-exploratory' : ''}">${item.evidence === 'mechanism_extension' ? '探索练习' : '感知练习'}</span><span class="training-card-duration">${duration(item.seconds)}</span></div><div class="training-card-title"><h3>${safe(item.label || TASKS[item.task_id].label)}</h3>${texture(item, true)}</div><p class="training-purpose">${safe(TASKS[item.task_id].purpose)}</p><div class="training-reason"><span>安排依据</span><p>${safe(item.reason || '按当前档案安排。')}</p></div></li>`).join('')}</ol></section>`;
  }
  function stageRail(plan) {
    const stages = [['foundation','熟悉操作'], ['scales','跨尺度练习'], ['context','情境练习']];
    const current = Math.max(0, stages.findIndex(([id]) => id === plan.stage));
    return `<section class="practice-path" aria-label="当前练习安排"><div><span>练习安排</span><small>按有效作答与舒适记录更新</small></div><ol>${stages.map(([id,label],i) => `<li${i===current?' aria-current="step"':''}><span>${i+1}</span>${label}</li>`).join('')}</ol></section>`;
  }
  function recordDetail(record) {
    const api = root.NVPerceptualTraining || (typeof require === 'function' ? require('./perceptual-training.js') : null);
    if (!api || !record.blocks?.some(b => b.trials?.length)) return '';
    const summary = api.practiceSummary(record);
    return `<details class="practice-context-detail"><summary>查看本次练习条件</summary><p>图案呈现 ${(summary.exposure_ms/1000).toFixed(1)} 秒 · 中断题呈现 ${(summary.interrupted_exposure_ms/1000).toFixed(1)} 秒</p>${summary.channels.length ? `<div class="practice-context-table"><table><thead><tr><th>项目与条件</th><th>正确 / 作答</th><th>近期数字对比</th></tr></thead><tbody>${summary.channels.map(row => `<tr><td>${safe(TASKS[row.task_id]?.label || row.task_id)} · ${safe(row.cpd)} cpd${row.spacing_lambda ? ' · '+safe(row.spacing_lambda)+'λ' : ''}</td><td>${row.correct} / ${row.n}</td><td>${row.recent_contrast.toFixed(3)}</td></tr>`).join('')}</tbody></table></div><p>仅含正式练习；不同任务和呈现条件分别记录。</p>` : '<p>本次主要用于熟悉操作，继续练习后会形成条件记录。</p>'}${record.initialization?.channels.length ? '<p>本次 '+record.initialization.channels.length+' 个条件参考了近期同条件记录。</p>' : ''}</details>`;
  }
  function pendingPractice(workbench) {
    const pending = (Array.isArray(workbench?.pending_practice) ? workbench.pending_practice : []).filter(record => record.participant_id === workbench?.context?.participant_id);
    if (!pending.length) return '';
    return `<aside class="training-pending" aria-labelledby="pending-practice-title"><div><h2 id="pending-practice-title">有 ${pending.length} 次训练待保存</h2><p>${workbench.practice_draft_error ? safe(workbench.practice_draft_error) : "完成保存后会计入训练记录。"}</p></div><ul>${pending.map(record => `<li><span>${safe(dateLabel(record.completed_at || record.created_at))}</span><button class="btn secondary" data-retry-practice="${safe(record.id)}">保存记录</button></li>`).join('')}</ul></aside>`;
  }
  function homePage(workbench, plan, today = new Date()) {
    const context = workbench?.context || {};
    const isReady = readyPlan(plan, context);
    const items = isReady ? validItems(plan) : [];
    const total = items.reduce((sum, item) => sum + numeric(item.seconds), 0);
    const basis = Array.isArray(plan?.basis) ? plan.basis.filter(value => typeof value === 'string' && value.trim()).slice(0, 2) : [];
    const missing = Array.isArray(plan?.missing) ? plan.missing.filter(value => typeof value === 'string' && value.trim()) : [];
    const date = new Intl.DateTimeFormat('zh-CN', {month: 'long', day: 'numeric', weekday: 'long'}).format(today);
    const dailyComplete = plan?.status === 'daily_complete';
    const pendingTitle = dailyComplete ? '今天先练到这里' : plan?.status === 'needs_review' ? '先确认练习条件' : '补齐资料，安排本次训练';
    const pendingCopy = plan?.hold_reason || (missing.length ? '以下资料用于安排练习内容与时长。' : '请先在手术档案中完善手术信息、检查报告与练习条件。');
    return `<div class="training-home"><header class="training-page-heading"><div><p class="training-overline">ICL 术后视觉练习</p><h1>今日训练</h1></div><div class="training-page-meta"><time>${safe(date)}</time>${context.participant_id ? `<a href="#profile" aria-label="查看当前手术档案">档案 <span>${safe(context.participant_id.slice(0, 11))}</span></a>` : ''}</div></header>${pendingPractice(workbench)}${workbench?.storage_error ? `<div class="page-error" role="alert">${safe(workbench.storage_error)}</div>` : ''}<section class="training-session${isReady ? ' is-ready' : ' is-pending'}" aria-labelledby="session-title"><div class="training-session-copy"><span class="training-status${isReady ? '' : ' needs-attention'}">${isReady ? '方案已就绪' : dailyComplete ? '今日已完成' : plan?.status === 'needs_review' ? '等待确认' : '资料待完善'}</span><h2 id="session-title">${isReady ? '本次训练' : pendingTitle}</h2>${isReady ? `<p class="training-session-summary">${items.length} 项练习<span aria-hidden="true"> / </span>约 ${duration(total)}</p><p class="training-session-note">按手术档案确认练习条件，按近期作答安排项目。</p><button class="btn training-start" data-start-training>开始整套训练${arrow}</button><p class="training-start-note">可随时暂停或结束</p>` : `<p class="training-session-note">${safe(pendingCopy)}</p><a class="btn training-start" href="${dailyComplete ? '#records' : '#profile'}">${dailyComplete ? '查看训练记录' : plan?.status === 'needs_review' ? '查看练习条件' : '完善手术档案'}${arrow}</a>`}</div>${isReady ? trainingTrack(items) : dailyComplete ? `<div class="training-day-end"><span aria-hidden="true">✓</span><p>今日累计练习</p><strong>${duration(plan.daily_used_seconds)}</strong><p>记录已用于下一次安排</p></div>` : `<div class="training-requirements"><h3>训练前需要</h3><ul>${(missing.length ? missing : ['核对手术信息、检查报告与医生允许练习的记录。']).map(value => `<li>${safe(value)}</li>`).join('')}</ul><span class="training-requirements-note">资料保存后，方案会自动更新。</span></div>`}</section>${isReady ? stageRail(plan) + trainingCards(items) : ''}${basis.length ? `<section class="training-basis" aria-labelledby="basis-title"><div><h2 id="basis-title">方案依据</h2><a class="quiet-link" href="#profile">查看手术档案${arrow}</a></div><ul>${basis.map(value => `<li>${safe(value)}</li>`).join('')}</ul></section>` : ''}</div>`;
  }
  function recordTasks(record) {
    const blocks = Array.isArray(record.blocks) ? record.blocks : [];
    const trials = Array.isArray(record.trials) ? record.trials : [];
    const ids = [...new Set([...blocks, ...trials].map(item => item?.task_id).filter(id => Object.hasOwn(TASKS, id)))];
    return ids.length ? ids.map(id => TASKS[id].label).join(' · ') : '本次练习';
  }
  function practicedMs(record) {
    return numeric(record.active_ms) + (Array.isArray(record.blocks) ? record.blocks : []).reduce((sum, block) => sum + numeric(block.overrun_ms), 0);
  }
  function recordsPage(records, context, snapshotHTML = '', quickHTML = '') {
    const items = (Array.isArray(records) ? records : []).filter(record => record.participant_id === context?.participant_id && ['complete', 'stopped'].includes(record.status)).sort((a, b) => (Date.parse(b.completed_at || b.created_at) || 0) - (Date.parse(a.completed_at || a.created_at) || 0));
    const active = items.reduce((sum, record) => sum + practicedMs(record), 0);
    const minutes = active > 0 && active < 60000 ? '不足 1' : (Math.round(active / 6000) / 10).toLocaleString('zh-CN');
    const completed = items.filter(record => record.status === 'complete').length;
    const feedback = {comfortable: '舒适', noticeable: '轻度疲劳', stop: '因不适停止', unreported: '未填写'};
    return `<div class="training-records">${heading('训练记录', '查看当前档案的练习时长与每次感受。')}<dl class="practice-totals"><div><dt>已练时长</dt><dd>${minutes}<small>分钟</small></dd></div><div><dt>练习次数</dt><dd>${items.length}<small>次</small></dd></div><div><dt>完整完成</dt><dd>${completed}<small>次</small></dd></div></dl>${items.length ? `<section aria-label="每次训练记录"><ol class="practice-history">${items.map(record => `<li class="practice-record"><div class="practice-record-heading"><time datetime="${safe(record.completed_at || record.created_at)}">${safe(dateLabel(record.completed_at || record.created_at))}</time><span class="practice-record-state${record.status === 'stopped' ? ' was-stopped' : ''}">${record.status === 'complete' ? '已完成' : '提前结束'}</span></div><h2>${safe(recordTasks(record))}</h2><dl class="practice-record-detail"><div><dt>实际练习</dt><dd>${duration(practicedMs(record) / 1000)}</dd></div><div><dt>原定时长</dt><dd>${duration(numeric(record.planned_seconds))}</dd></div><div><dt>练习感受</dt><dd>${safe(feedback[record.feedback] || feedback.unreported)}</dd></div></dl>${recordDetail(record)}</li>`).join('')}</ol></section>` : `<section class="practice-empty"><span class="practice-empty-mark" aria-hidden="true">—</span><h2>还没有训练记录</h2><p>完成或提前结束的练习，都会保存在这里。</p><a class="btn secondary" href="#recovery">查看今日训练${arrow}</a></section>`}<details class="practice-retest"><summary><span>视觉复测<small>可选</small></span><span class="retest-toggle" aria-hidden="true">+</span></summary><div class="practice-retest-body"><p>在相同屏幕与观看条件下，补充一次方向辨认记录。</p>${quickHTML}${snapshotHTML || '<p class="retest-empty">暂无复测记录。</p>'}</div></details><div class="practice-record-tools"><a class="quiet-link" href="#profile">管理与导出资料${arrow}</a></div></div>`;
  }

  function mount(env) {
    const doc = env.document, main = doc.querySelector('#main');
    let page = currentPage(), toastTimer, pendingRefresh = false;
    function currentPage() { return PAGES.includes(env.location.hash.slice(1)) ? env.location.hash.slice(1) : 'recovery'; }
    function toast(message) {
      const element = doc.querySelector('#toast');
      element.textContent = String(message ?? '');
      element.style.display = 'block';
      env.clearTimeout(toastTimer);
      toastTimer = env.setTimeout(() => { element.style.display = 'none'; }, 5500);
    }
    function measurePage() {
      return heading('视觉复测', '保持相同屏幕、亮度与观看距离。') + env.NVRecovery.quickCard() + '<a class="quiet-link measure-return" href="#records">返回训练记录</a>';
    }
    function render() {
      try {
        if (page === 'recovery') {
          const workbench = env.NVRecovery.workbench();
          main.innerHTML = homePage(workbench, env.NVTrainingPlan.build(workbench)) + '<p class="training-scope">研究型练习 · ICL 恢复效果待验证</p>';
        } else if (page === 'profile') main.innerHTML = env.NVRecovery.renderProfile();
        else if (page === 'measure') main.innerHTML = measurePage();
        else main.innerHTML = recordsPage(env.NVRecovery.practiceHistory(), env.NVRecovery.context(), env.NVRecovery.snapshotHistory(), env.NVRecovery.quickCard());
        env.NVRecovery.bind(main);
      } catch (error) {
        main.innerHTML = heading(TITLES[page]) + `<div class="page-error" role="alert">${safe(error.message)}<p><a href="#profile">查看手术档案</a></p></div>`;
      }
      const active = page === 'measure' ? 'records' : page;
      doc.querySelectorAll('[data-page]').forEach(link => {
        if (link.dataset.page === active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      });
      doc.title = `NeuroVision · ${TITLES[page]}`;
      env.NVInterface?.enter(main, page);
      env.NVExperience?.refresh(main, page);
      pendingRefresh = false;
    }
    function refresh() {
      if (doc.querySelector('dialog[open]')) { pendingRefresh = true; return; }
      render();
    }
    function navigate(next) {
      page = PAGES.includes(next) ? next : 'recovery';
      if (env.location.hash !== '#' + page) env.history.replaceState(null, '', '#' + page);
      render();
      main.focus();
      env.scrollTo({top: 0, behavior: 'instant'});
    }
    function startTraining() {
      const workbench = env.NVRecovery.workbench();
      const plan = env.NVTrainingPlan.build(workbench);
      if (!readyPlan(plan, workbench.context)) {
        navigate('profile');
        toast(plan.hold_reason || '请完善手术档案后再开始。');
        return;
      }
      env.NVPerceptualTraining.start({
        plan,
        history: workbench.history || [],
        onDraft: record => env.NVRecovery.stagePractice(record),
        onSave: record => env.NVRecovery.savePractice(record),
        onClose: () => {
          render();
          (main.querySelector('[data-start-training]') || main).focus({preventScroll: true});
        },
        getContext: () => env.NVRecovery.context()
      });
    }
    doc.addEventListener('click', event => {
      const target = event.target.closest('a, button');
      if (!target) return;
      const href = target.getAttribute('href');
      if (target.matches('a[href^="#"]') && PAGES.includes(href.slice(1))) {
        event.preventDefault(); navigate(href.slice(1)); return;
      }
      try {
        if (target.hasAttribute('data-start-training')) startTraining();
        if (target.hasAttribute('data-start-snapshot')) env.NVRecovery.startSnapshot();
        if (target.hasAttribute('data-retry-practice')) {
          const saved = env.NVRecovery.retryPractice(target.getAttribute('data-retry-practice'));
          if (saved !== false) { refresh(); toast('训练记录已保存。'); }
          else toast('记录尚未保存，请在手术档案中导出资料备份。');
        }
      } catch (error) { toast(error.message); }
    });
    doc.addEventListener('nv-recovery-change', refresh);
    doc.addEventListener('nv-recovery-status', event => toast(event.detail));
    doc.addEventListener('nv-snapshot-saved', () => { if (page === 'records') refresh(); });
    doc.addEventListener('close', () => { if (pendingRefresh) refresh(); }, true);
    env.addEventListener('hashchange', () => navigate(currentPage()));
    render();
    return {render, navigate, startTraining};
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {duration, clockTime, readyPlan, homePage, recordsPage, mount};
    return;
  }
  mount(root);
})(typeof window === 'undefined' ? globalThis : window);
