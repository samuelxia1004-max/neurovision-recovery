(function (root) {
  'use strict';
  const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paths = {
    calendar: '<rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 11h16m-11 5h2m3 0h1"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    write: '<path d="M13 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-7M15 4l5 5M10 14l-1 4 4-1L22 8a2 2 0 0 0-5-5Z"/>',
    chart: '<path d="M4 4v16h16M7 15l4-5 4 2 5-7"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    play: '<path d="m8 5 11 7-11 7Z"/>'
  };
  function icon(name) { return `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.eye}</svg>`; }
  function recoveryIntro({days, today, latest, date, access}) {
    const count = Number.isInteger(days) && days >= 0 ? days : 0;
    const measured = Number.isInteger(latest?.summary?.correct) ? latest.summary : null;
    return `<section class="recovery-heading" aria-labelledby="recovery-title"><h1 id="recovery-title">${access==='postop'?'ICL 术后记录':'视觉记录'}</h1><time datetime="${safe(date)}">${safe(date.replaceAll('-', ' / '))}</time></section>
    <section class="recovery-overview" aria-label="当前档案概览">
      <div class="overview-item"><span class="overview-label">已记录</span><div class="overview-value">${count}<small>天</small></div></div>
      <div class="overview-item"><span class="overview-label">最近快照${measured ? ` · ${safe(new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit'}).format(new Date(latest.completed_at)).replaceAll('/','-'))}` : ''}</span><div class="overview-value">${measured ? measured.correct : '—'}<small>${measured ? '/ '+measured.valid_trials+' 正确' : '暂无记录'}</small></div></div>
      <div class="overview-item"><span class="overview-label">今日日常场景</span><div class="overview-value overview-status">${today ? '已记录' : '待记录'}</div></div>
    </section>`;
  }
  // Observation is confined to dialog open state; stimulus frames are not observed.
  function mount(env) {
    const {document: doc} = env, body = doc.body;
    const media = env.matchMedia('(prefers-reduced-motion: reduce)');
    const allowed = () => !media.matches;
    function synchronize() {
      body.classList.toggle('ui-motion-off', !allowed());
      body.classList.toggle('ui-motion-paused', doc.hidden || Boolean(doc.querySelector('dialog[open]')));

    }
    const watched = new WeakMap();
    function watchDialogs() {
      doc.querySelectorAll('dialog').forEach(dialog => {
        if (watched.has(dialog)) return;
        const observer = new env.MutationObserver(synchronize);
        observer.observe(dialog, {attributes:true, attributeFilter:['open']});
        watched.set(dialog, observer);
      });
      synchronize();
    }
    const dialogs = new env.MutationObserver(watchDialogs);
    dialogs.observe(body, {childList:true});
    media.addEventListener('change', synchronize);
    doc.addEventListener('visibilitychange', synchronize);
    doc.addEventListener('click', event => {
      const target = event.target.closest('button');
      if (!target) return;
      if (target.dataset.uiFocus) {
        const section = doc.getElementById(target.dataset.uiFocus);
        section?.scrollIntoView({behavior:allowed() ? 'smooth' : 'instant',block:'start'});
        section?.querySelector('select, input, textarea, button')?.focus({preventScroll:true});
      }
    });
    function refresh(main, settled = true) {
      synchronize();
      if (settled) main.querySelector('.recovery-heading')?.classList.add('is-settled');
      main.querySelectorAll('.recovery-chart polyline').forEach(line => line.setAttribute('pathLength','1'));
    }
    function enter(main, page) {
      main.dataset.page = page;
      refresh(main, false);
      if (!allowed() || doc.querySelector('dialog[open]')) return;
      const elements = page === 'recovery' ? main.querySelectorAll('.recovery-heading, .overview-item, .daily-snapshot-card, .recovery-diary') : main.children;
      [...elements].forEach((element, i) => {
        element.style.setProperty('--enter-delay', `${Math.min(i, 4) * 55}ms`);
        element.classList.add('motion-enter');
      });
    }
    watchDialogs();
    return {enter, refresh, allowed};
  }
  if (typeof module !== 'undefined' && module.exports) { module.exports = {icon,recoveryIntro,mount}; return; }
  root.NVInterface = {icon,recoveryIntro,...mount(root)};
})(typeof window === 'undefined' ? globalThis : window);
