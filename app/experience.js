(function (root) {
  'use strict';
  let dispose = () => {};

  function refresh(main, page) {
    dispose();
    dispose = () => {};
    if (!main || main.id !== 'main') return;
    const doc = main.ownerDocument;
    const env = doc.defaultView || root;
    const body = doc.body;
    if (!body) return;
    const media = env.matchMedia('(prefers-reduced-motion: reduce)');
    const decorations = [];
    let active = true;

    // Decorative shapes are confined to the existing presentation-only art.
    main.querySelectorAll('.hero-visual, .task-featured .stimulus-art').forEach(host => {
      if (host.querySelector('.xp-optics')) return;
      const optics = doc.createElement('span');
      optics.className = 'xp-optics';
      optics.setAttribute('aria-hidden', 'true');
      const orbit = doc.createElement('span');
      orbit.className = 'xp-orbit';
      optics.appendChild(orbit);
      host.appendChild(optics);
      decorations.push(optics);
    });

    const enabled = () => !media.matches && !body.classList.contains('ui-motion-off');
    const paused = () => doc.hidden || body.classList.contains('ui-motion-paused') || Boolean(doc.querySelector('dialog[open]'));
    const allowed = () => active && enabled() && !paused();
    const clearFeedback = () => main.querySelectorAll('.xp-clicked, .xp-picked').forEach(node => node.classList.remove('xp-clicked', 'xp-picked'));

    function synchronize() {
      if (!active) return;
      const motionEnabled = enabled();
      const motionPaused = paused();
      main.classList.toggle('xp-motion-enabled', motionEnabled);
      main.classList.toggle('xp-motion-stopped', motionPaused);
      if (!motionEnabled || motionPaused) clearFeedback();
    }
    function clicked(event) {
      if (!allowed()) return;
      const button = event.target.closest?.('.btn');
      if (!button || !main.contains(button) || button.disabled) return;
      button.classList.add('xp-clicked');
    }
    function changed(event) {
      if (!allowed()) return;
      const input = event.target;
      if (!input.matches?.('.scenario-option input[type="radio"]') || !input.checked) return;
      const question = input.closest('.scenario-question');
      question?.querySelectorAll('.xp-picked').forEach(node => node.classList.remove('xp-picked'));
      input.closest('.scenario-option')?.classList.add('xp-picked');
    }
    function animationEnded(event) {
      if (event.animationName === 'xp-control-halo') event.target.classList.remove('xp-clicked');
      if (event.animationName === 'xp-selection-halo') event.target.closest('.scenario-option')?.classList.remove('xp-picked');
    }

    // Only global preference classes are observed, never task/stimulus content.
    const observer = new env.MutationObserver(synchronize);
    observer.observe(body, {attributes: true, attributeFilter: ['class']});
    media.addEventListener('change', synchronize);
    doc.addEventListener('visibilitychange', synchronize);
    main.addEventListener('click', clicked);
    main.addEventListener('change', changed);
    main.addEventListener('animationend', animationEnded);
    synchronize();

    dispose = () => {
      active = false;
      observer.disconnect();
      media.removeEventListener('change', synchronize);
      doc.removeEventListener('visibilitychange', synchronize);
      main.removeEventListener('click', clicked);
      main.removeEventListener('change', changed);
      main.removeEventListener('animationend', animationEnded);
      clearFeedback();
      decorations.forEach(node => node.remove());
      main.classList.remove('xp-motion-enabled', 'xp-motion-stopped');
    };
  }

  root.NVExperience = {refresh, destroy: () => { dispose(); dispose = () => {}; }};
})(typeof window === 'undefined' ? globalThis : window);
