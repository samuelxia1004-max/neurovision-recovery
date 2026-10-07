(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NVPerceptualTraining = api;
})(typeof window === 'undefined' ? globalThis : window, function (root) {
  'use strict';

  const SCHEMA = 'neurovision.perceptual-training.v2', LEGACY_SCHEMA = 'neurovision.perceptual-training.v1';
  const PLAN_VERSION = 'icl-training-plan-v2', LEGACY_PLAN = 'icl-training-plan-v1';
  const TASKS = ['contrast', 'multiscale', 'collinear', 'noise'];
  const CPDS = [1.5, 3, 6];
  const MAX_TRIALS = 200, MAX_SECONDS = 240, REST_MS = 60000;
  const RESPONSE_MS = 5000, FEEDBACK_MS = 650, FIXATION_MS = 250;
  const MIN_SAMPLES = 8, NOISE_RMS = 0.025;
  const INVALID = ['timeout', 'timing', 'manual_pause', 'hidden', 'blur', 'resize', 'scheduled_rest', 'budget_expired', 'user_end', 'user_close', 'discomfort', 'owner_changed', 'render_error'];
  const STOP = ['user_end', 'user_close', 'discomfort', 'owner_changed', 'render_error', 'trial_limit'];
  const LABELS = { contrast: '对比辨别', multiscale: '多尺度辨别', collinear: '共线目标辨别', noise: '噪声中辨别' };
  let pending = null;
  const finite = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  const near = (a, b, tolerance = 0.000001) => finite(a, -1e12, 1e12) && Math.abs(a - b) <= tolerance;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const clone = value => JSON.parse(JSON.stringify(value));
  const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const idOK = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value);
  const isoOK = value => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
  function assert(ok, message) { if (!ok) throw Error(message); }
  function keys(object, allowed, label) {
    assert(object && typeof object === 'object' && !Array.isArray(object), label + '格式无效');
    assert(Object.keys(object).length === allowed.length && allowed.every(k => own(object, k)), label + '字段无效');
  }
  function tree(value, depth = 0, seen = new Set()) {
    assert(depth <= 8, '记录嵌套过深');
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'number') { assert(Number.isFinite(value), '记录含无效数字'); return; }
    if (typeof value === 'string') { assert(value.length <= 2000, '记录文本过长'); return; }
    assert(value && typeof value === 'object' && !seen.has(value), '记录必须为 JSON 数据');
    seen.add(value);
    assert(Object.keys(value).length <= (Array.isArray(value) ? 2000 : 50), '记录过大');
    if (Array.isArray(value)) {
      assert(value.length <= 2000 && Object.keys(value).length === value.length, '记录数组无效');
      for (let i = 0; i < value.length; i++) assert(own(value, i), '记录数组不能含空位');
    }
    Object.keys(value).forEach(k => { assert(!['__proto__', 'constructor', 'prototype'].includes(k), '记录字段无效'); tree(value[k], depth + 1, seen); });
    seen.delete(value);
  }

  function normalizePlan(plan) {
    assert(plan && [PLAN_VERSION, LEGACY_PLAN].includes(plan.version) && plan.status === 'ready' && idOK(plan.participant_id), '练习计划尚未准备好');
    assert(Array.isArray(plan.items) && plan.items.length >= 1 && plan.items.length <= 4, '请选择 1–4 个练习项目');
    const used = new Set();
    const items = plan.items.map(item => {
      assert(item && TASKS.includes(item.task_id) && !used.has(item.task_id), '练习项目无效或重复');
      used.add(item.task_id);
      assert(Number.isInteger(item.seconds) && item.seconds >= 1 && item.seconds <= MAX_SECONDS, '练习时间无效');
      assert(Array.isArray(item.cpds) && item.cpds.length >= 1 && item.cpds.length <= 3 && new Set(item.cpds).size === item.cpds.length && item.cpds.every(c => CPDS.includes(c)), '练习频率无效');
      assert(item.task_id !== 'multiscale' || CPDS.every(c => item.cpds.includes(c)), '多尺度练习需包含 1.5、3、6 cpd');
      const label = typeof item.label === 'string' && item.label.trim() ? item.label.trim().slice(0, 100) : LABELS[item.task_id];
      return { task_id: item.task_id, label, seconds: item.seconds, cpds: item.cpds.slice(), reason: typeof item.reason === 'string' ? item.reason.slice(0, 1000) : '' };
    });
    const total = items.reduce((sum, item) => sum + item.seconds, 0);
    assert(total <= MAX_SECONDS && plan.total_seconds === total, '练习总时间须与项目一致且不超过 4 分钟');
    const basis = Array.isArray(plan.plan_basis) ? plan.plan_basis : Array.isArray(plan.basis) ? plan.basis : [];
    return { version: plan.version, participant_id: plan.participant_id, status: 'ready', items, total_seconds: total, plan_basis: basis.filter(x => typeof x === 'string').slice(0, 10).map(x => x.slice(0, 500)), source_report_ids: Array.isArray(plan.source_report_ids) ? [...new Set(plan.source_report_ids.filter(idOK))].slice(0, 50) : [], source_care_id: idOK(plan.source_care_id) ? plan.source_care_id : null };
  }
  function staircase(state, correct) {
    assert(state && finite(state.contrast, 0.04, 0.6) && Number.isInteger(state.streak) && state.streak >= 0 && state.streak <= 2 && typeof correct === 'boolean', '阶梯状态无效');
    let contrast = state.contrast, streak = correct ? state.streak + 1 : 0;
    if (!correct) contrast = Math.min(0.6, contrast * 1.2);
    else if (streak === 3) { contrast = Math.max(0.04, contrast / 1.2); streak = 0; }
    return { contrast, streak };
  }
  function geometry(pxPerMm, distanceCm, dpr = 1) {
    assert(finite(pxPerMm, 2, 15) && finite(distanceCm, 30, 100) && finite(dpr, 0.5, 4), '请核对 30 mm 尺子与 30–100 cm 观看距离');
    return { ppd: 2 * distanceCm * 10 * Math.tan(Math.PI / 360) * pxPerMm, dpr };
  }
  function frequency(requested, ppd, dpr) {
    assert(CPDS.includes(requested) && finite(ppd, 1, 1000) && finite(dpr, 0.5, 4), '频率参数无效');
    const actual = CPDS.filter(c => c <= requested && ppd * dpr / c >= MIN_SAMPLES).pop();
    assert(actual, '当前校准下屏幕采样不足，请增大观看距离后重新核对尺子');
    return { requested_cpd: requested, cpd: actual, downgraded: actual !== requested, samples_per_cycle: ppd * dpr / actual };
  }
  function requiredSize(task, cpd, ppd, spacing = 4) {
    // Ordinary targets use sigma 0.5 degree; collinear Gabors use sigma 1 wavelength.
    return Math.ceil((task === 'collinear' ? 2 * (spacing + 3) * ppd / cpd : 3 * ppd) + 12);
  }
  function checkFit(plan, setup, available) {
    assert(finite(available, 64, 1000), '当前窗口太小，请扩大窗口后校准');
    const sizes = plan.items.flatMap(item => item.cpds.map(cpd => {
      const selected = frequency(cpd, setup.ppd, setup.dpr);
      return requiredSize(item.task_id, selected.cpd, setup.ppd, 4);
    }));
    const size = Math.max(220, ...sizes);
    assert(size <= available, '校准后的完整图案超出当前刺激区，请减小观看距离或扩大窗口后重新核对');
    return Math.ceil(size);
  }
  function randomU32(cryptoSource = root.crypto) {
    assert(cryptoSource && typeof cryptoSource.getRandomValues === 'function', '当前环境缺少安全随机数支持');
    const value = new Uint32Array(1); cryptoSource.getRandomValues(value); return value[0];
  }
  function signalFromU32(value, task) {
    assert(Number.isInteger(value) && value >= 0 && value <= 4294967295 && TASKS.includes(task), '随机信号无效');
    return task === 'collinear' ? { orientation_deg: 0, target_interval: value < 2147483648 ? 1 : 2 } : { orientation_deg: value < 2147483648 ? -45 : 45, target_interval: null };
  }
  function noiseField(count, seed, rms = NOISE_RMS) {
    assert(Number.isInteger(count) && count > 1 && count <= 16000000 && Number.isInteger(seed) && seed >= 0 && seed <= 4294967295 && rms === NOISE_RMS, '噪声参数无效');
    const values = new Float32Array(count); let state = seed >>> 0, sum = 0, energy = 0;
    // A recorded seed reproduces spatial noise; trial/interval selection uses crypto independently.
    for (let i = 0; i < count; i++) { state = (Math.imul(1664525, state) + 1013904223) >>> 0; const v = state / 4294967296 - 0.5; values[i] = v; sum += v; }
    const mean = sum / count;
    for (let i = 0; i < count; i++) energy += (values[i] - mean) ** 2;
    const scale = rms / Math.sqrt(energy / count);
    for (let i = 0; i < count; i++) values[i] = (values[i] - mean) * scale;
    return values;
  }
  function renderPixels(params, interval = 1) {
    const { task_id: task, cpd, ppd, dpr, contrast, orientation_deg: orientation, spacing_lambda: spacing, target_interval: targetInterval, noise_seed: noiseSeed, stimulus_css_px: cssSize } = params;
    assert(TASKS.includes(task) && CPDS.includes(cpd) && finite(contrast, 0.04, 0.6) && finite(dpr, 0.5, 4) && finite(ppd, 1, 1000) && Number.isInteger(cssSize) && cssSize >= requiredSize(task, cpd, ppd, spacing || 4) && cssSize <= 1000, '刺激尺寸或参数无效');
    assert(task === 'collinear' ? orientation === 0 && [1, 2].includes(targetInterval) && [3, 4].includes(spacing) && [1, 2].includes(interval) : [-45, 45].includes(orientation), '刺激方向无效');
    const size = Math.round(cssSize * dpr), data = new Uint8ClampedArray(size * size * 4);
    const noise = task === 'noise' ? noiseField(size * size, noiseSeed) : null;
    const wavelength = ppd * dpr / cpd, sigma = task === 'collinear' ? wavelength : ppd * dpr * 0.5, cutoff2 = (sigma * 3) ** 2;
    assert(wavelength >= MIN_SAMPLES - 0.000001, '刺激采样不足');
    const radians = orientation * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
    const gabor = (x, y, amplitude, vertical) => {
      const radius = x * x + y * y;
      return radius > cutoff2 ? 0 : amplitude * Math.exp(-radius / (2 * sigma * sigma)) * Math.cos(2 * Math.PI * (vertical ? x : x * cos + y * sin) / wavelength);
    };
    let min = 1, max = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - size / 2, dy = y + 0.5 - size / 2, pixel = y * size + x;
      let modulation = 0;
      if (task === 'collinear') {
        modulation = gabor(dx, dy - spacing * wavelength, 0.4, true) + gabor(dx, dy + spacing * wavelength, 0.4, true);
        if (interval === targetInterval) modulation += gabor(dx, dy, contrast, true);
      } else modulation = gabor(dx, dy, contrast, false);
      const luminance = 0.5 + modulation * 0.5 + (noise ? noise[pixel] : 0);
      assert(luminance >= 0 && luminance <= 1, '刺激亮度超出范围');
      min = Math.min(min, luminance); max = Math.max(max, luminance);
      const offset = pixel * 4, value = Math.round(luminance * 255);
      data[offset] = data[offset + 1] = data[offset + 2] = value; data[offset + 3] = 255;
    }
    return { width: size, height: size, data, min_luminance: min, max_luminance: max };
  }

  function channelKey(trial, separated = true) {
    return trial.task_id + ':' + trial.cpd + ':' + (trial.spacing_lambda || 0) + (separated ? ':' + trial.exposure_ms : '');
  }
  const median = values => { const a = values.slice().sort((x, y) => x - y); return a.length ? (a[Math.floor((a.length - 1) / 2)] + a[Math.floor(a.length / 2)]) / 2 : null; };
  function practiceSummary(record) {
    const channels = new Map(); let exposure = 0, interruptedExposure = 0;
    for (const block of record.blocks || []) for (const t of block.trials || []) {
      for (const prefix of ['first', 'second']) {
        if (Number.isFinite(t[prefix + '_on_ms']) && Number.isFinite(t[prefix + '_off_ms'])) {
          const ms = Math.max(0, t[prefix + '_off_ms'] - t[prefix + '_on_ms']);
          exposure += ms; if (!t.valid) interruptedExposure += ms;
        }
      }
      if (!t.valid || t.familiarization) continue;
      const key = channelKey(t);
      if (!channels.has(key)) channels.set(key, { key, task_id: t.task_id, cpd: t.cpd, spacing_lambda: t.spacing_lambda, n: 0, correct: 0, contrasts: [] });
      const row = channels.get(key); row.n++; row.correct += Number(t.correct); row.contrasts.push(t.contrast);
    }
    return { exposure_ms: exposure, interrupted_exposure_ms: interruptedExposure, channels: [...channels.values()].map(({contrasts, ...row}) => ({ ...row, recent_contrast: median(contrasts.slice(-6)) })) };
  }
  function displayKey() {
    const screen = root.screen || {};
    return [screen.width || root.innerWidth || 0, screen.height || root.innerHeight || 0, screen.colorDepth || 0].join('x');
  }
  function buildInitialization(plan, setup, history, at, confirmed) {
    const result = { policy: 'separate-duration-context-v1', same_viewing_conditions: confirmed === true, channels: [] };
    if (!result.same_viewing_conditions) return result;
    const allowed = new Set(plan.items.flatMap(item => item.cpds.flatMap(cpd => (item.task_id === 'collinear' ? [3, 4] : [0]).map(spacing => channelKey({ task_id: item.task_id, cpd: frequency(cpd, setup.ppd, setup.dpr).cpd, spacing_lambda: spacing, exposure_ms: 200 })))));
    const records = (history || []).filter(r => r.schema === SCHEMA && r.participant_id === plan.participant_id && r.source_care_id === plan.source_care_id && r.status === 'complete' && r.feedback === 'comfortable' && Date.parse(r.completed_at) <= at && at - Date.parse(r.completed_at) <= 30 * 86400000 && r.setup?.display_key === setup.display_key && ['ppd','dpr','distance_cm','px_per_mm'].every(k => near(r.setup[k], setup[k], 0.001)) && validate(r).valid).sort((a, b) => b.completed_at.localeCompare(a.completed_at));
    for (const r of records) {
      const summary = practiceSummary(r);
      for (const row of summary.channels) {
        if (!allowed.has(row.key) || result.channels.some(x => x.key === row.key)) continue;
        const block = r.blocks.find(b => b.task_id === row.task_id), trials = block.trials.filter(t => t.valid && !t.familiarization && channelKey(t) === row.key).slice(-6);
        if (trials.length < 6 || trials.filter(t => t.correct).length < 4 || block.trials.filter(t => t.valid).length / block.trials.length < 0.8) continue;
        const value = median(trials.map(t => t.contrast));
        result.channels.push({ key: row.key, contrast: Math.max(0.12, Math.min(0.6, value * 1.2)), median_contrast: value, sample_count: 6, source_id: r.id, source_completed_at: r.completed_at });
      }
    }
    return result;
  }
  function validateInitialization(record) {
    const init = record.initialization;
    keys(init, ['policy', 'same_viewing_conditions', 'channels'], '起始难度来源');
    assert(init.policy === 'separate-duration-context-v1' && typeof init.same_viewing_conditions === 'boolean' && Array.isArray(init.channels) && init.channels.length <= 15 && (init.same_viewing_conditions || init.channels.length === 0), '起始条件无效');
    const allowed = new Set(record.blocks.flatMap(block => block.requested_cpds.flatMap(cpd => (block.task_id === 'collinear' ? [3, 4] : [0]).map(spacing => channelKey({task_id: block.task_id, cpd: frequency(cpd, record.setup.ppd, record.setup.dpr).cpd, spacing_lambda: spacing, exposure_ms: 200})))));
    const states = new Map();
    for (const c of init.channels) {
      keys(c, ['key', 'contrast', 'median_contrast', 'sample_count', 'source_id', 'source_completed_at'], '难度通道');
      assert(allowed.has(c.key) && !states.has(c.key) && finite(c.median_contrast, .04, .6) && near(c.contrast, Math.max(.12, Math.min(.6, c.median_contrast * 1.2))) && c.sample_count === 6 && idOK(c.source_id) && c.source_id !== record.id && isoOK(c.source_completed_at) && c.source_completed_at <= record.created_at && Date.parse(record.created_at) - Date.parse(c.source_completed_at) <= 30 * 86400000, '难度来源或范围无效');
      states.set(c.key, { contrast: c.contrast, streak: 0 });
    }
    return states;
  }

  const RECORD_KEYS = ['schema', 'id', 'participant_id', 'created_at', 'completed_at', 'status', 'stop_reason', 'plan_version', 'plan_basis', 'source_report_ids', 'source_care_id', 'feedback', 'active_ms', 'elapsed_ms', 'planned_seconds', 'setup', 'blocks', 'trial_count', 'valid_trial_count', 'correct_count', 'practice_only'];
  const SETUP_KEYS = ['distance_cm', 'ruler_css_px', 'px_per_mm', 'dpr', 'ppd', 'gamma_calibrated', 'timing_method', 'calibrated_at', 'canvas_css_px', 'calibration_confirmed', 'symptoms_clear'];
  const BLOCK_KEYS = ['task_id', 'label', 'planned_seconds', 'active_ms', 'overrun_ms', 'requested_cpds', 'status', 'trials'];
  const TRIAL_KEYS = ['id', 'index', 'task_id', 'requested_cpd', 'cpd', 'downgraded', 'contrast', 'streak_before', 'contrast_after', 'streak_after', 'orientation_deg', 'target_interval', 'signal_u32', 'spacing_lambda', 'spacing_u32', 'noise_seed', 'noise_rms', 'flank_contrast', 'sigma_lambda', 'sigma_deg', 'cutoff_sigma', 'samples_per_cycle', 'stimulus_css_px', 'stimulus_px', 'exposure_ms', 'familiarization', 'started_ms', 'ended_ms', 'response_ms', 'answer', 'correct', 'valid', 'invalid_reason', 'feedback', 'first_on_ms', 'first_off_ms', 'second_on_ms', 'second_off_ms', 'retry_of'];
  function validateRecord(record) {
    tree(record); const separated = record.schema === SCHEMA; keys(record, separated ? [...RECORD_KEYS, 'initialization'] : RECORD_KEYS, '训练记录');
    assert((separated ? record.plan_version === PLAN_VERSION : record.schema === LEGACY_SCHEMA && record.plan_version === LEGACY_PLAN) && record.practice_only === true && idOK(record.id) && idOK(record.participant_id), '训练记录标识无效');
    assert(Array.isArray(record.plan_basis) && record.plan_basis.length <= 10 && record.plan_basis.every(x => typeof x === 'string' && x.length <= 500) && Array.isArray(record.source_report_ids) && record.source_report_ids.length <= 50 && new Set(record.source_report_ids).size === record.source_report_ids.length && record.source_report_ids.every(idOK) && (record.source_care_id === null || idOK(record.source_care_id)), '计划来源无效');
    assert(isoOK(record.created_at) && isoOK(record.completed_at) && record.completed_at >= record.created_at, '训练日期无效');
    assert(['complete', 'stopped'].includes(record.status) && (record.status === 'complete' ? record.stop_reason === null : STOP.includes(record.stop_reason)), '结束状态无效');
    assert(['comfortable', 'noticeable', 'stop', 'unreported'].includes(record.feedback), '训练后感受无效');
    assert(record.feedback !== 'stop' || record.status === 'stopped' && record.stop_reason === 'discomfort', '不适结束状态不一致');
    assert(Number.isInteger(record.active_ms) && finite(record.active_ms, 0, MAX_SECONDS * 1000) && finite(record.elapsed_ms, record.active_ms, 864000000), '实际练习时间无效');
    keys(record.setup, separated ? [...SETUP_KEYS, 'display_key'] : SETUP_KEYS, '校准');
    if (separated) assert(typeof record.setup.display_key === 'string' && /^\d+x\d+x\d+$/.test(record.setup.display_key) && record.setup.display_key.length <= 80, '显示条件标识无效');
    const setup = record.setup, calculated = geometry(setup.px_per_mm, setup.distance_cm, setup.dpr);
    assert(near(setup.ruler_css_px, setup.px_per_mm * 30) && near(setup.ppd, calculated.ppd) && setup.gamma_calibrated === false && setup.timing_method === 'performance_now_setTimeout' && setup.calibration_confirmed === true && setup.symptoms_clear === true && isoOK(setup.calibrated_at) && setup.calibrated_at <= record.created_at && Number.isInteger(setup.canvas_css_px) && finite(setup.canvas_css_px, 64, 1000), '校准记录无效');
    assert(Array.isArray(record.blocks) && record.blocks.length >= 1 && record.blocks.length <= 4, '练习章节无效');
    let count = 0, validCount = 0, correctCount = 0, active = 0, overrun = 0, planned = 0, previousEnd = 0, incompleteSeen = false;
    const tasks = new Set(), states = separated ? validateInitialization(record) : new Map(), trials = new Map();
    record.blocks.forEach(block => {
      keys(block, BLOCK_KEYS, '章节');
      assert(TASKS.includes(block.task_id) && !tasks.has(block.task_id) && typeof block.label === 'string' && block.label.length > 0 && block.label.length <= 100, '章节标识无效'); tasks.add(block.task_id);
      assert(Number.isInteger(block.planned_seconds) && finite(block.planned_seconds, 1, MAX_SECONDS) && Number.isInteger(block.active_ms) && finite(block.active_ms, 0, block.planned_seconds * 1000), '章节时间无效');
      assert(finite(block.overrun_ms, 0, record.elapsed_ms) && (block.overrun_ms === 0 || block.active_ms === block.planned_seconds * 1000), '预算超时记录无效');
      assert(Array.isArray(block.requested_cpds) && block.requested_cpds.length >= 1 && block.requested_cpds.length <= 3 && new Set(block.requested_cpds).size === block.requested_cpds.length && block.requested_cpds.every(c => CPDS.includes(c)), '章节频率无效');
      assert(block.task_id !== 'multiscale' || CPDS.every(c => block.requested_cpds.includes(c)), '多尺度章节频率不全');
      assert(['complete', 'stopped', 'not_started'].includes(block.status) && Array.isArray(block.trials) && block.trials.length <= MAX_TRIALS, '章节状态无效');
      assert(block.status !== 'complete' || block.active_ms === block.planned_seconds * 1000, '未完成预算不能记为完成');
      assert(block.status !== 'not_started' || block.active_ms === 0 && block.trials.length === 0, '未开始章节不能含练习数据');
      assert(!incompleteSeen || block.status === 'not_started', '章节顺序无效');
      if (block.status !== 'complete') incompleteSeen = true;
      let blockValid = 0, trialTime = 0;
      block.trials.forEach(trial => {
        keys(trial, TRIAL_KEYS, '题目'); count++;
        assert(trial.index === count && trial.id === record.id + ':t' + count && !trials.has(trial.id) && trial.task_id === block.task_id && block.requested_cpds.includes(trial.requested_cpd), '题目标识或顺序无效');
        assert(trial.requested_cpd === block.requested_cpds[blockValid % block.requested_cpds.length], '交错频率顺序无效');
        const selected = frequency(trial.requested_cpd, setup.ppd, setup.dpr), signal = signalFromU32(trial.signal_u32, block.task_id);
        assert(trial.cpd === selected.cpd && trial.downgraded === selected.downgraded && near(trial.samples_per_cycle, selected.samples_per_cycle) && trial.orientation_deg === signal.orientation_deg && trial.target_interval === signal.target_interval, '题目频率或随机信号不一致');
        assert(trial.sigma_lambda === (block.task_id === 'collinear' ? 1 : null) && near(trial.sigma_deg, block.task_id === 'collinear' ? 1 / trial.cpd : 0.5) && trial.cutoff_sigma === 3 && trial.stimulus_css_px === setup.canvas_css_px && trial.stimulus_px === Math.round(setup.canvas_css_px * setup.dpr) && requiredSize(block.task_id, trial.cpd, setup.ppd, trial.spacing_lambda || 4) <= setup.canvas_css_px, '题目空间尺寸无效');
        if (block.task_id === 'collinear') assert(Number.isInteger(trial.spacing_u32) && finite(trial.spacing_u32, 0, 4294967295) && trial.spacing_lambda === (trial.spacing_u32 < 2147483648 ? 3 : 4) && trial.flank_contrast === 0.4, '共线侧纹参数无效');
        else assert(trial.spacing_u32 === null && trial.spacing_lambda === null && trial.flank_contrast === null, '非共线任务含侧纹参数');
        if (block.task_id === 'noise') assert(Number.isInteger(trial.noise_seed) && finite(trial.noise_seed, 0, 4294967295) && trial.noise_rms === NOISE_RMS, '噪声参数无效');
        else assert(trial.noise_seed === null && trial.noise_rms === 0, '非噪声任务含噪声');
        assert(trial.familiarization === (blockValid < 6) && trial.exposure_ms === (trial.familiarization ? 500 : 200), '熟悉练习或曝光预算无效');
        const key = channelKey(trial, separated), before = states.get(key) || { contrast: 0.24, streak: 0 };
        assert(near(trial.contrast, before.contrast) && trial.streak_before === before.streak, '阶梯起点不一致');
        assert(finite(trial.started_ms, previousEnd, record.elapsed_ms) && finite(trial.ended_ms, trial.started_ms, record.elapsed_ms), '题目计时无效');
        previousEnd = trial.ended_ms; trialTime += trial.ended_ms - trial.started_ms;
        const stamps = ['first_on_ms', 'first_off_ms', 'second_on_ms', 'second_off_ms'];
        let stampPrevious = trial.started_ms, gap = false;
        stamps.forEach(k => { if (trial[k] === null) gap = true; else { assert(!gap && finite(trial[k], stampPrevious, trial.ended_ms), '呈现时间顺序无效'); stampPrevious = trial[k]; } });
        if (block.task_id !== 'collinear') assert(trial.second_on_ms === null && trial.second_off_ms === null, '单时段任务时间无效');
        assert(trial.retry_of === null || trials.has(trial.retry_of) && !trials.get(trial.retry_of).valid && trials.get(trial.retry_of).task_id === trial.task_id && trials.get(trial.retry_of).requested_cpd === trial.requested_cpd, '重做来源无效');
        if (trial.valid === true) {
          const choices = block.task_id === 'collinear' ? [1, 2] : [-45, 45], expected = block.task_id === 'collinear' ? trial.target_interval : trial.orientation_deg;
          assert(choices.includes(trial.answer) && trial.correct === (trial.answer === expected) && trial.invalid_reason === null && trial.feedback === (trial.correct ? 'correct' : 'incorrect') && finite(trial.response_ms, 0, RESPONSE_MS), '有效题答案或反馈无效');
          assert(trial.first_on_ms !== null && trial.first_off_ms !== null && near(trial.first_off_ms - trial.first_on_ms, trial.exposure_ms, 100), '第一时段曝光无效');
          if (block.task_id === 'collinear') assert(trial.second_on_ms !== null && trial.second_off_ms !== null && near(trial.second_off_ms - trial.second_on_ms, trial.exposure_ms, 100) && near(trial.second_on_ms - trial.first_off_ms, 500, 125), '第二时段或间隔无效');
          const off = block.task_id === 'collinear' ? trial.second_off_ms : trial.first_off_ms;
          assert(near(trial.ended_ms - off, trial.response_ms, 0.1), '回答计时不一致');
          const after = staircase(before, trial.correct);
          assert(near(trial.contrast_after, after.contrast) && trial.streak_after === after.streak, '有效题阶梯更新无效'); states.set(key, after);
          blockValid++; validCount++; if (trial.correct) correctCount++;
        } else {
          assert(trial.valid === false && trial.answer === null && trial.correct === null && trial.response_ms === null && INVALID.includes(trial.invalid_reason) && trial.feedback === trial.invalid_reason && near(trial.contrast_after, before.contrast) && trial.streak_after === before.streak, '无效题不得更新难度或伪造反馈');
          if (trial.invalid_reason === 'timeout') { const off = block.task_id === 'collinear' ? trial.second_off_ms : trial.first_off_ms; assert(off !== null && trial.ended_ms - off >= RESPONSE_MS, '超时题计时无效'); }
        }
        trials.set(trial.id, trial);
      });
      assert(trialTime <= block.active_ms + block.overrun_ms + 1, '题目耗时超过章节实际练习时间');
      active += block.active_ms; overrun += block.overrun_ms; planned += block.planned_seconds;
    });
    assert(count <= MAX_TRIALS && count === record.trial_count && validCount === record.valid_trial_count && correctCount === record.correct_count && active === record.active_ms && planned === record.planned_seconds && planned <= MAX_SECONDS, '训练汇总不一致');
    assert(record.elapsed_ms + 1 >= active + overrun, '总经过时间小于实际练习时间');
    assert(record.status !== 'complete' || !incompleteSeen && active === planned * 1000, '训练尚未完成');
    return record;
  }
  function validate(record) { try { validateRecord(record); return { valid: true, errors: [] }; } catch (error) { return { valid: false, errors: [error.message] }; } }

  function start(options = {}) {
    const document = root.document;
    assert(document && document.body && typeof root.performance?.now === 'function', '请在支持 Canvas 与计时的浏览器中打开练习');
    if (pending && !pending.isClosed()) { pending.show(); return pending; }
    const plan = normalizePlan(options.plan), owner = plan.participant_id, separated = plan.version === PLAN_VERSION;
    assert(typeof options.getContext === 'function', '缺少当前档案核对接口');
    const ownerOK = () => { try { const context = options.getContext(); return (context?.participant_id || context?.participant?.id) === owner; } catch (_) { return false; } };
    assert(ownerOK(), '当前档案与训练计划不一致');
    const previousFocus = document.activeElement, dialog = document.createElement('dialog');
    dialog.className = 'nv-perceptual-training'; dialog.setAttribute('aria-labelledby', 'npt-title'); document.body.append(dialog);
    const timers = new Set(), listeners = [];
    const now = () => root.performance.now();
    const query = id => dialog.querySelector('#npt-' + id);
    let mode = 'setup', phase = '', blockIndex = 0, setup = null, blocks = [], current = null, record = null, prepared = null;
    let sessionId = null, createdAt = null, origin = 0, activeMark = null, segmentMs = 0, validInBlock = 0, answeredIndex = 0, nextBlock = false;
    let trialCount = 0, retry = null, persisted = false, downloaded = false, saving = false, resizeNeeded = false;
    let summaryMessage = '', pauseReason = '', errorMessage = '', states = new Map();
    let draftRevision = 0, initialization = null;
    const elapsed = () => Math.max(0, now() - origin);
    const setTimer = (callback, delay) => { const id = root.setTimeout(() => { timers.delete(id); callback(); }, delay); timers.add(id); return id; };
    const clearTimers = () => { timers.forEach(id => root.clearTimeout(id)); timers.clear(); };
    const listen = (target, event, fn) => { target.addEventListener(event, fn); listeners.push(() => target.removeEventListener(event, fn)); };
    const header = title => '<header class="npt-head"><div><span class="npt-eyebrow">研究型视觉练习</span><h2 id="npt-title">' + escapeHTML(title) + '</h2></div><button type="button" id="npt-end" class="npt-link">结束</button></header>';
    const bindEnd = () => { query('end').onclick = () => close(); };
    const explain = '<p class="npt-note">研究型练习，效果待验证。练习成绩不代表临床疗效。</p>';
    function availableSize() { return Math.floor(Math.min(620, Math.max(0, root.innerWidth - 64), Math.max(0, root.innerHeight - 290))); }
    function blank() {
      const canvas = query('canvas'); if (!canvas || !setup) return;
      const ctx = canvas.getContext('2d'); if (ctx) { ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    }
    function closeExposure() {
      if (!current) { blank(); return; }
      const at = elapsed();
      if (phase === 'exposure1' && current.first_off_ms === null) current.first_off_ms = at;
      if (phase === 'exposure2' && current.second_off_ms === null) current.second_off_ms = at;
      blank();
    }
    function settle() {
      if (activeMark === null) return;
      const at = now(), delta = Math.max(0, at - activeMark), block = blocks[blockIndex]; activeMark = at;
      const counted = Math.min(delta, Math.max(0, block.planned_seconds * 1000 - block.active_ms));
      block.active_ms += counted; block.overrun_ms += delta - counted; segmentMs += counted;
    }
    function finalizeInvalid(reason) {
      if (!current) return;
      closeExposure(); current.ended_ms = elapsed(); current.invalid_reason = reason; current.feedback = reason;
      // Budget expiry may be observed after a busy browser frame. Keep actual stamps,
      // but the session's active budget includes the real overrun only as elapsed time.
      blocks[blockIndex].trials.push(current); retry = { id: current.id, cpd: current.requested_cpd }; current = null;
    }
    function updateProgress() {
      const block = blocks[blockIndex]; if (!block) return;
      const total = blocks.reduce((sum, b) => sum + b.active_ms, 0), remaining = Math.max(0, plan.total_seconds - total / 1000);
      if (query('remaining')) query('remaining').textContent = Math.ceil(remaining) + ' 秒';
      if (query('chapter')) query('chapter').textContent = (blockIndex + 1) + ' / ' + blocks.length + ' · ' + Math.max(0, Math.ceil(block.planned_seconds - block.active_ms / 1000)) + ' 秒';
      if (query('progress')) query('progress').value = total;
    }
    function guard() {
      if (mode !== 'running') return false;
      if (!ownerOK()) { stop('owner_changed'); return false; }
      settle(); updateProgress();
      if (blocks[blockIndex].active_ms >= blocks[blockIndex].planned_seconds * 1000) { finishBlock(); return false; }
      if (segmentMs >= REST_MS) { pause('scheduled_rest'); return false; }
      return true;
    }
    function tick() { if (guard()) setTimer(tick, 50); }
    function status(text, type) { if (query('status')) { query('status').textContent = text; query('status').className = 'npt-status' + (type ? ' npt-' + type : ''); } }
    function choices(enabled) { ['a', 'b'].forEach(id => { if (query(id)) query(id).disabled = !enabled; }); }
    function draw(interval) {
      const canvas = query('canvas'); assert(canvas && current, '刺激区不可用');
      const pixels = prepared && prepared[interval - 1], ctx = canvas.getContext('2d'); assert(ctx && pixels, '浏览器绘图不可用');
      const img = ctx.createImageData(pixels.width, pixels.height); img.data.set(pixels.data); ctx.putImageData(img, 0, 0);
    }
    function feedbackThenNext(text) {
      phase = 'feedback'; choices(false); status(text, 'feedback');
      setTimer(() => { if (guard()) beginTrial(); }, FEEDBACK_MS);
    }
    function timingInvalid() { finalizeInvalid('timing'); feedbackThenNext('呈现时序中断，本题不计。稍后重做。'); }
    function expose(interval) {
      if (!guard() || !current) return;
      try { draw(interval); } catch (error) { errorMessage = error.message; stop('render_error'); return; }
      phase = interval === 1 ? 'exposure1' : 'exposure2';
      current[interval === 1 ? 'first_on_ms' : 'second_on_ms'] = elapsed();
      if (!guard() || !current) return;
      if (interval === 2 && !near(current.second_on_ms - current.first_off_ms, 500, 125)) { timingInvalid(); return; }
      const exposure = current.exposure_ms;
      const trialId = current.id;
      setTimer(() => {
        if (!guard() || !current) return;
        closeExposure();
        const on = current[interval === 1 ? 'first_on_ms' : 'second_on_ms'], off = current[interval === 1 ? 'first_off_ms' : 'second_off_ms'];
        if (!near(off - on, exposure, 100)) { timingInvalid(); return; }
        if (current.task_id === 'collinear' && interval === 1) {
          phase = 'interval';
          setTimer(() => { if (!guard() || !current) return; if (!near(elapsed() - current.first_off_ms, 500, 125)) { timingInvalid(); return; } expose(2); }, 500);
        } else {
          phase = 'answer'; choices(true); status(current.task_id === 'collinear' ? '哪一次出现了中央条纹？' : '条纹向哪边倾斜？');
          setTimer(() => { if (!guard() || !current || current.id !== trialId || phase !== 'answer') return; finalizeInvalid('timeout'); feedbackThenNext('本题超时，不调整难度。准备后再试。'); }, RESPONSE_MS);
        }
      }, exposure);
    }
    function beginTrial() {
      if (!guard()) return;
      if (trialCount >= MAX_TRIALS) { stop('trial_limit'); return; }
      const block = blocks[blockIndex], requested = retry ? retry.cpd : block.requested_cpds[answeredIndex % block.requested_cpds.length];
      const selected = frequency(requested, setup.ppd, setup.dpr);
      const signal = randomU32(), target = signalFromU32(signal, block.task_id), spacingSignal = block.task_id === 'collinear' ? randomU32() : null;
      const spacing = spacingSignal === null ? null : spacingSignal < 2147483648 ? 3 : 4;
      const key = channelKey({ task_id: block.task_id, cpd: selected.cpd, spacing_lambda: spacing, exposure_ms: validInBlock < 6 ? 500 : 200 }, separated), state = states.get(key) || { contrast: 0.24, streak: 0 };
      trialCount++;
      current = {
        id: sessionId + ':t' + trialCount, index: trialCount, task_id: block.task_id, ...selected,
        contrast: state.contrast, streak_before: state.streak, contrast_after: state.contrast, streak_after: state.streak,
        ...target, signal_u32: signal, spacing_lambda: spacing, spacing_u32: spacingSignal,
        noise_seed: block.task_id === 'noise' ? randomU32() : null, noise_rms: block.task_id === 'noise' ? NOISE_RMS : 0, flank_contrast: block.task_id === 'collinear' ? 0.4 : null,
        sigma_lambda: block.task_id === 'collinear' ? 1 : null, sigma_deg: block.task_id === 'collinear' ? 1 / selected.cpd : 0.5, cutoff_sigma: 3, stimulus_css_px: setup.canvas_css_px, stimulus_px: Math.round(setup.canvas_css_px * setup.dpr),
        exposure_ms: validInBlock < 6 ? 500 : 200, familiarization: validInBlock < 6, started_ms: elapsed(), ended_ms: null,
        response_ms: null, answer: null, correct: null, valid: false, invalid_reason: null, feedback: null,
        first_on_ms: null, first_off_ms: null, second_on_ms: null, second_off_ms: null, retry_of: retry ? retry.id : null
      };
      retry = null; phase = 'fixation'; choices(false); blank();
      status(current.task_id === 'collinear' ? '注视中央，观察先后两次呈现' : '注视中央，准备辨别条纹');
      query('detail').textContent = (current.familiarization ? '熟悉操作 ' + (validInBlock + 1) + ' / 6' : '继续练习') + ' · ' + selected.cpd + ' cpd' + (selected.downgraded ? '（已按屏幕采样降频）' : '');
      // Prepare both images before presentation so image synthesis does not extend
      // the 500 ms inter-stimulus interval. Canvas onset remains software timed.
      try {
        prepared = [renderPixels({ ...current, ppd: setup.ppd, dpr: setup.dpr }, 1)];
        if (current.task_id === 'collinear') prepared.push(renderPixels({ ...current, ppd: setup.ppd, dpr: setup.dpr }, 2));
      } catch (error) { errorMessage = error.message; stop('render_error'); return; }
      if (!guard()) return;
      setTimer(() => expose(1), FIXATION_MS);
    }
    function respond(answer) {
      if (!guard() || phase !== 'answer' || !current) return;
      const expected = current.task_id === 'collinear' ? current.target_interval : current.orientation_deg;
      if (!(current.task_id === 'collinear' ? [1, 2] : [-45, 45]).includes(answer)) return;
      const end = elapsed(), off = current.task_id === 'collinear' ? current.second_off_ms : current.first_off_ms;
      if (end - off >= RESPONSE_MS) { finalizeInvalid('timeout'); feedbackThenNext('本题超时，不调整难度。'); return; }
      current.ended_ms = end; current.response_ms = end - off; current.answer = answer; current.correct = answer === expected; current.valid = true; current.feedback = current.correct ? 'correct' : 'incorrect';
      const key = channelKey(current, separated), after = staircase({ contrast: current.contrast, streak: current.streak_before }, current.correct);
      current.contrast_after = after.contrast; current.streak_after = after.streak; states.set(key, after);
      const text = current.correct ? '正确' : current.task_id === 'collinear' ? '中央条纹出现在第' + (expected === 1 ? '一' : '二') + '次' : '本次条纹向' + (expected === -45 ? '左' : '右') + '倾斜';
      blocks[blockIndex].trials.push(current); current = null; validInBlock++; answeredIndex++; feedbackThenNext(text);
    }
    function renderRunning() {
      const block = blocks[blockIndex], collinear = block.task_id === 'collinear';
      dialog.innerHTML = header(block.label) + '<div class="npt-metrics"><span>项目 <b id="npt-chapter"></b></span><span>剩余练习 <b id="npt-remaining"></b></span></div><progress id="npt-progress" class="npt-progress" max="' + plan.total_seconds * 1000 + '" value="0" aria-label="练习进度"></progress><p id="npt-detail" class="npt-detail"></p><div class="npt-stimulus"><canvas id="npt-canvas" aria-label="中央视觉刺激，请观察后作答"></canvas></div><p id="npt-status" class="npt-status" role="status" aria-live="polite"></p><div class="npt-answers"><button id="npt-a" type="button" disabled>' + (collinear ? '← 第一次' : '← 向左倾斜') + '</button><button id="npt-b" type="button" disabled>' + (collinear ? '第二次 →' : '向右倾斜 →') + '</button></div><div class="npt-controls"><button id="npt-pause" type="button" class="npt-secondary">暂停 / 休息</button><button id="npt-discomfort" type="button" class="npt-link">不适，结束练习</button></div>';
      bindEnd(); const canvas = query('canvas'); canvas.width = canvas.height = Math.round(setup.canvas_css_px * setup.dpr); canvas.style.width = canvas.style.height = setup.canvas_css_px + 'px';
      query('a').onclick = () => respond(collinear ? 1 : -45); query('b').onclick = () => respond(collinear ? 2 : 45);
      query('pause').onclick = () => pause('manual_pause'); query('discomfort').onclick = () => stop('discomfort'); updateProgress(); blank();
    }
    function activate() {
      if (!ownerOK()) { stop('owner_changed'); return; }
      if (nextBlock) { blockIndex++; validInBlock = 0; answeredIndex = 0; retry = null; nextBlock = false; }
      mode = 'running'; blocks[blockIndex].status = 'stopped'; activeMark = now(); renderRunning(); beginTrial(); if (mode === 'running') setTimer(tick, 50);
    }
    function renderPause() {
      const rest = mode === 'break', label = rest ? '休息一下，再继续' : '练习已暂停';
      const reason = pauseReason === 'resize' ? '窗口尺寸改变。本题不计，继续前将检查刺激能否完整显示。' : ['hidden', 'blur'].includes(pauseReason) ? '离开练习窗口时已暂停。本题不计，返回后重做。' : rest ? '休息时间不计入练习预算。视线移开屏幕后，感觉舒适再继续。' : '休息时间不计入练习预算，当前未完成题将在继续后重做。';
      dialog.innerHTML = header(label) + '<div class="npt-pause"><span class="npt-pause-mark" aria-hidden="true">Ⅱ</span><p>' + reason + '</p><p class="npt-note">出现明显眼痛或突然视力下降，请结束练习并联系医生。</p><p id="npt-error" role="alert"></p><button type="button" id="npt-resume">' + (nextBlock ? '继续下一个项目' : '继续练习') + '</button><button type="button" id="npt-discomfort" class="npt-secondary">不适，结束练习</button></div>';
      bindEnd(); query('resume').onclick = resume; query('discomfort').onclick = () => stop('discomfort'); query('resume').focus();
    }
    function pause(reason = 'manual_pause') {
      if (mode !== 'running') return;
      settle(); clearTimers(); finalizeInvalid(INVALID.includes(reason) ? reason : 'manual_pause'); activeMark = null;
      pauseReason = reason; resizeNeeded = resizeNeeded || reason === 'resize'; mode = reason === 'scheduled_rest' ? 'break' : 'paused'; renderPause();
    }
    function resume() {
      if (!['paused', 'break'].includes(mode)) return;
      if (!ownerOK()) { stop('owner_changed'); return; }
      if (document.hidden) { query('error').textContent = '请返回可见练习窗口后继续。'; return; }
      try {
        if (Math.abs(Math.min(root.devicePixelRatio || 1, 4) - setup.dpr) > 0.001) throw Error('屏幕缩放已改变，请结束并保存本次记录，再重新校准开始。');
        checkFit(plan, setup, availableSize());
        if (setup.canvas_css_px > availableSize()) throw Error('原刺激区超出当前窗口，请恢复窗口大小后继续。');
      } catch (error) { query('error').textContent = error.message; return; }
      resizeNeeded = false; segmentMs = 0; activate();
    }
    function finishBlock() {
      clearTimers(); finalizeInvalid('budget_expired'); activeMark = null; blocks[blockIndex].active_ms = blocks[blockIndex].planned_seconds * 1000; blocks[blockIndex].status = 'complete';
      if (blockIndex === blocks.length - 1) finish('complete', null);
      else { nextBlock = true; mode = 'break'; pauseReason = 'scheduled_rest'; renderPause(); }
    }
    function makeRecord(statusValue, reason) {
      const finalBlocks = clone(blocks); finalBlocks.forEach(block => { block.active_ms = Math.round(block.active_ms); });
      const all = finalBlocks.flatMap(block => block.trials), active = finalBlocks.reduce((sum, block) => sum + block.active_ms, 0);
      return { schema: separated ? SCHEMA : LEGACY_SCHEMA, ...(separated ? {initialization: clone(initialization)} : {}), id: sessionId, participant_id: owner, created_at: createdAt, completed_at: new Date().toISOString(), status: statusValue, stop_reason: reason, plan_version: plan.version, plan_basis: plan.plan_basis.slice(), source_report_ids: plan.source_report_ids.slice(), source_care_id: plan.source_care_id, feedback: reason === 'discomfort' ? 'stop' : 'unreported', active_ms: active, elapsed_ms: Math.max(active, elapsed()), planned_seconds: plan.total_seconds, setup: clone(setup), blocks: finalBlocks, trial_count: all.length, valid_trial_count: all.filter(t => t.valid).length, correct_count: all.filter(t => t.valid && t.correct).length, practice_only: true };
    }
    function stageDraft() {
      const revision = ++draftRevision;
      if (typeof options.onDraft !== 'function') return;
      try {
        validateRecord(record);
        Promise.resolve(options.onDraft(clone(record))).then(result => {
          if (revision !== draftRevision || mode !== 'summary' || persisted || downloaded) return;
          summaryMessage = result === true ? '结果已暂存，保存后进入练习记录。' : '当前结果暂留本页，请保存或下载后关闭。'; renderSummary();
        }, () => { if (revision === draftRevision && mode === 'summary' && !persisted && !downloaded) { summaryMessage = '当前结果暂留本页，请保存或下载后关闭。'; renderSummary(); } });
      } catch (_) { summaryMessage = '当前结果暂留本页，请保存或下载后关闭。'; }
    }
    function finish(statusValue, reason) {
      clearTimers(); activeMark = null; mode = 'summary'; record = makeRecord(statusValue, reason); current = null;
      renderSummary(); stageDraft();
    }
    function stop(reason = 'user_end') {
      if (mode === 'closed' || mode === 'summary') return;
      if (mode === 'setup') { dismiss(); return; }
      settle(); clearTimers(); finalizeInvalid(INVALID.includes(reason) ? reason : 'user_end'); activeMark = null;
      finish('stopped', STOP.includes(reason) ? reason : 'user_end');
    }
    function renderSummary() {
      const stopped = record.status === 'stopped', saved = persisted || downloaded;
      const why = { discomfort: '因不适结束。出现明显眼痛或突然视力下降时，请联系医生。', owner_changed: '档案已切换，记录仍属于开始时的档案。请切回该档案保存，或下载本次记录。', render_error: '刺激无法继续呈现，已结束。' }[record.stop_reason] || (stopped ? '已结束，实际完成时间已保留。' : '已用完本次计划的练习时间。');
      dialog.innerHTML = header(stopped ? '本次练习已结束' : '本次练习完成') + '<p class="npt-summary-lead">' + why + '</p><div class="npt-summary-numbers"><div><strong>' + ((record.active_ms + record.blocks.reduce((sum, block) => sum + block.overrun_ms, 0)) / 1000).toFixed(1) + '</strong><span>秒实际练习</span></div><div><strong>' + record.valid_trial_count + '</strong><span>题有效作答</span></div></div>' + explain + '<fieldset class="npt-feelings"><legend>现在的感受（可不选）</legend><button type="button" id="npt-feel-comfortable" aria-pressed="' + (record.feedback === 'comfortable') + '">舒适</button><button type="button" id="npt-feel-noticeable" aria-pressed="' + (record.feedback === 'noticeable') + '">轻度疲劳，休息后缓解</button><button type="button" id="npt-feel-stop" aria-pressed="' + (record.feedback === 'stop') + '">出现不适 / 加重</button></fieldset><p id="npt-message" class="npt-note" role="status">' + escapeHTML(summaryMessage || (saved ? '记录已保留，可以返回。' : '保存或下载后可返回；记录当前仍保留在本窗口。')) + '</p><p id="npt-error" role="alert">' + escapeHTML(errorMessage) + '</p><div class="npt-summary-actions"><button id="npt-save" type="button"' + (saving || persisted || typeof options.onSave !== 'function' ? ' disabled' : '') + '>' + (saving ? '正在保存…' : persisted ? '已保存' : '保存练习记录') + '</button><button id="npt-download" type="button" class="npt-secondary"' + (saving ? ' disabled' : '') + '>下载记录</button><button id="npt-close" type="button" class="npt-link">返回</button></div>';
      bindEnd(); ['comfortable', 'noticeable', 'stop'].forEach(value => { const button = query('feel-' + value); button.disabled = saved || saving || record.stop_reason === 'discomfort' && value !== 'stop'; button.onclick = () => { if (saved || saving || record.stop_reason === 'discomfort' && value !== 'stop') return; record.feedback = value; if (value === 'stop') { record.status = 'stopped'; record.stop_reason = 'discomfort'; } errorMessage = ''; renderSummary(); stageDraft(); }; });
      query('save').onclick = save; query('download').onclick = download; query('close').onclick = close;
    }
    async function save() {
      if (mode !== 'summary' || saving || persisted || typeof options.onSave !== 'function') return false;
      if (!ownerOK()) { errorMessage = '请切回开始时的档案再保存；也可下载保留这份记录。'; renderSummary(); return false; }
      try { validateRecord(record); } catch (error) { errorMessage = '记录校验未通过：' + error.message; renderSummary(); return false; }
      saving = true; errorMessage = ''; renderSummary();
      try {
        const result = await options.onSave(clone(record));
        if (result === false || result?.ok === false) throw Error('未确认保存成功');
        persisted = true; summaryMessage = '练习记录已保存。'; return true;
      } catch (error) { errorMessage = '保存失败，记录仍在。请重试或下载。' + (error?.message ? ' ' + String(error.message).slice(0, 160) : ''); return false; }
      finally { saving = false; renderSummary(); }
    }
    function download() {
      if (mode !== 'summary' || saving) return false;
      let url;
      try {
        validateRecord(record);
        const blob = new root.Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }); url = root.URL.createObjectURL(blob);
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'visual-practice-' + record.id + '.json'; document.body.append(anchor); anchor.click(); anchor.remove();
        downloaded = true; summaryMessage = '已发起记录下载，请保留下载文件。'; errorMessage = ''; renderSummary();
        root.setTimeout(() => root.URL.revokeObjectURL(url), 1000); return true;
      } catch (error) { if (url) root.URL.revokeObjectURL(url); errorMessage = '下载未成功，记录仍在。' + error.message; renderSummary(); return false; }
    }
    function dismiss() {
      clearTimers(); listeners.splice(0).forEach(remove => remove()); mode = 'closed'; if (dialog.open) dialog.close(); dialog.remove(); pending = null;
      if (previousFocus?.isConnected) previousFocus.focus(); if (typeof options.onClose === 'function') options.onClose(record ? clone(record) : null);
    }
    function close() {
      if (mode === 'closed') return;
      if (mode === 'setup') { dismiss(); return; }
      if (mode !== 'summary') { stop('user_close'); return; }
      if (saving) { errorMessage = '正在保存，请稍候。'; renderSummary(); return; }
      if (!persisted && !downloaded) { errorMessage = '请先保存或下载本次记录，再返回。'; renderSummary(); return; }
      dismiss();
    }
    function begin() {
      try {
        assert(ownerOK(), '档案已切换，请关闭后重新选择练习计划');
        assert(query('calibrated').checked, '请先用实体尺完成 30 mm 校准并确认距离');
        assert(query('symptoms').checked, '请确认当下没有明显眼痛或突然视力下降；如有，请结束并联系医生');
        const ruler = Number(query('scale').value), distance = Number(query('distance').value), dpr = Math.min(root.devicePixelRatio || 1, 4), computed = geometry(ruler / 30, distance, dpr);
        setup = { distance_cm: distance, ruler_css_px: ruler, px_per_mm: ruler / 30, dpr, ppd: computed.ppd, gamma_calibrated: false, timing_method: 'performance_now_setTimeout', calibrated_at: new Date().toISOString(), canvas_css_px: 0, calibration_confirmed: true, symptoms_clear: true };
        setup.canvas_css_px = checkFit(plan, setup, availableSize()); randomU32();
        if (separated) {
          setup.display_key = displayKey();
          initialization = buildInitialization(plan, setup, options.history, Date.now(), query('same-conditions')?.checked === true);
          states = new Map(initialization.channels.map(c => [c.key, {contrast: c.contrast, streak: 0}]));
        }
        sessionId = typeof root.crypto.randomUUID === 'function' ? root.crypto.randomUUID() : 'practice-' + [randomU32(), randomU32(), randomU32()].map(v => v.toString(16).padStart(8, '0')).join('');
        createdAt = new Date().toISOString(); origin = now(); blocks = plan.items.map(item => ({ task_id: item.task_id, label: item.label, planned_seconds: item.seconds, active_ms: 0, overrun_ms: 0, requested_cpds: item.cpds.slice(), status: 'not_started', trials: [] }));
        activate();
      } catch (error) { if (mode === 'setup') query('error').textContent = error.message; else { errorMessage = error.message; stop('render_error'); } }
    }
    function renderSetup() {
      dialog.innerHTML = header('准备开始练习') + '<p class="npt-summary-lead">' + plan.items.length + ' 个项目 · ' + Math.ceil(plan.total_seconds / 60) + ' 分钟以内。回答后会显示反馈，并逐步调整难度。</p><div class="npt-setup"><label for="npt-scale">用实体尺把下方线段调至 <strong>30 mm</strong></label><div class="npt-ruler-space"><div id="npt-ruler" class="npt-ruler" style="width:114px"></div></div><input id="npt-scale" type="range" min="60" max="' + Math.min(450, Math.max(60, root.innerWidth - 90)) + '" step="0.1" value="114" aria-label="调整 30 mm 线段长度"><label class="npt-distance" for="npt-distance">眼睛到屏幕的距离 <span><input id="npt-distance" type="number" min="30" max="100" step="1" value="60"> cm</span></label><label class="npt-check"><input type="checkbox" id="npt-calibrated">已用实体尺核对长度与观看距离，并保持屏幕亮度稳定</label><label class="npt-check"><input type="checkbox" id="npt-symptoms">当下没有明显眼痛或突然视力下降</label><p class="npt-note">出现上述症状时请结束并联系医生。每段最多练习 60 秒，休息后可继续；随时可以暂停或结束。</p>' + (separated && options.history?.some(r => r.schema === SCHEMA) ? '<label class="npt-check"><input type="checkbox" id="npt-same-conditions">屏幕、亮度和矫正状态与上次相同，可参考上次难度</label>' : '') + explain + '<p id="npt-error" role="alert"></p><button type="button" id="npt-begin">开始练习</button></div>';
      bindEnd(); query('scale').oninput = event => { query('ruler').style.width = event.target.value + 'px'; query('calibrated').checked = false; }; query('distance').oninput = () => { query('calibrated').checked = false; }; query('begin').onclick = begin;
    }
    listen(document, 'visibilitychange', () => { if (document.hidden) pause('hidden'); });
    listen(root, 'blur', () => pause('blur'));
    listen(root, 'resize', () => { if (mode === 'running') pause('resize'); else if (['paused', 'break'].includes(mode)) resizeNeeded = true; });
    listen(root, 'beforeunload', event => { if (setup && !persisted && !downloaded && mode !== 'closed') { event.preventDefault(); event.returnValue = ''; } });
    listen(document, 'keydown', event => { if (event.repeat || mode !== 'running') return; if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const collinear = blocks[blockIndex].task_id === 'collinear'; respond(event.key === 'ArrowLeft' ? collinear ? 1 : -45 : collinear ? 2 : 45); } else if (event.key === ' ') { event.preventDefault(); pause('manual_pause'); } });
    listen(dialog, 'cancel', event => { event.preventDefault(); close(); });
    const controller = {
      pause, resume, stop, close, save, download,
      show() { if (!dialog.open && mode !== 'closed') dialog.showModal(); dialog.focus(); },
      isClosed: () => mode === 'closed',
      getRecord: () => record ? clone(record) : null,
      getState: () => ({ mode, phase, owner, block_index: blockIndex, trial_count: trialCount, persisted, downloaded, saving, needs_resize_check: resizeNeeded }),
      getCurrentTrial: () => current ? clone(current) : null
    };
    pending = controller; renderSetup(); dialog.showModal(); return controller;
  }
  return { SCHEMA, LEGACY_SCHEMA, PLAN_VERSION, LEGACY_PLAN, channelKey, practiceSummary, buildInitialization, TASKS: TASKS.slice(), CPDS: CPDS.slice(), MAX_TRIALS, MAX_SECONDS, MIN_SAMPLES, NOISE_RMS, normalizePlan, staircase, geometry, frequency, requiredSize, checkFit, randomU32, signalFromU32, noiseField, renderPixels, validateRecord, validate, isValidRecord: record => validate(record).valid, start, getPending: () => pending };
});
