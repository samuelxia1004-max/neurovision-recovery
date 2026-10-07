const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const P = require('../app/perceptual-training.js');
const source = fs.readFileSync(require.resolve('../app/perceptual-training.js'), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
function plan(task = 'contrast', seconds = 30, extra = {}) {
  return { version: P.PLAN_VERSION, participant_id: 'NV-ONE', status: 'ready', items: [{ task_id: task, label: '练习项目', seconds, cpds: task === 'multiscale' ? [1.5, 3, 6] : [3], reason: '已确认的练习方向', evidence: 'extra metadata accepted' }], total_seconds: seconds, basis: ['计划依据'], source_report_ids: ['report-1'], source_care_id: 'care-1', ...extra };
}

// This harness exercises only JavaScript, a virtual DOM, and a deterministic clock.
// It never opens a browser, local URL, CDP connection, or a real local file surface.
function harness({ inputPlan = plan(), onSave = () => true, onDraft, width = 1000, height = 1000, dpr = 2, random, history = [], baseTime = '2026-10-02T02:00:00.000Z' } = {}) {
  let time = 0, sequence = 0, dialog, owner = inputPlan.participant_id, controller, saved = [], drafts = [], closed = [], draws = 0;
  let rng = 12345678, queuedRandom = [], allocated = 0, revoked = 0, clicked = 0;
  const listeners = new Map(), timers = new Map(), base = Date.parse(baseTime);
  const addEvent = (target, type, fn) => { const key = target + ':' + type; if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key).add(fn); };
  const removeEvent = (target, type, fn) => { const key = target + ':' + type; listeners.get(key)?.delete(fn); if (listeners.get(key)?.size === 0) listeners.delete(key); };
  const make = tag => ({
    tagName: tag.toUpperCase(), isConnected: true, style: {}, disabled: false, value: '', checked: false, textContent: '',
    focus() {}, setAttribute(key, value) { this[key] = value; },
    addEventListener(type, fn) { addEvent(tag, type, fn); }, removeEventListener(type, fn) { removeEvent(tag, type, fn); },
    click() { if (tag === 'a') clicked++; else if (!this.disabled) this.onclick?.(); },
    getContext() { return { fillStyle: '', fillRect() {}, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() { draws++; } }; },
    remove() { this.isConnected = false; }
  });
  const document = {
    hidden: false, activeElement: make('previous'), body: { append(el) { if (el.tagName === 'DIALOG') dialog = el; } },
    createElement(tag) {
      const el = make(tag);
      if (tag === 'dialog') {
        el.elements = new Map(); el.querySelector = selector => el.elements.get(selector.slice(1));
        Object.defineProperty(el, 'innerHTML', { set(html) { el.html = html; el.elements.clear(); for (const match of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"[^>]*>/g)) { const node = make(match[1]); node.value = match[0].match(/\bvalue="([^"]*)"/)?.[1] || ''; node.disabled = /\sdisabled(?:\s|>)/.test(match[0]); node.checked = /\schecked(?:\s|>)/.test(match[0]); el.elements.set(match[2], node); } } });
        el.showModal = () => { el.open = true; }; el.close = () => { el.open = false; };
      }
      return el;
    },
    addEventListener(type, fn) { addEvent('document', type, fn); }, removeEventListener(type, fn) { removeEvent('document', type, fn); }
  };
  class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [base + time])); } static now() { return base + time; } }
  const window = {
    document, innerWidth: width, innerHeight: height, devicePixelRatio: dpr,
    performance: { now: () => time },
    crypto: { getRandomValues(array) { for (let i = 0; i < array.length; i++) { rng = (Math.imul(1664525, rng) + 1013904223) >>> 0; array[i] = queuedRandom.length ? queuedRandom.shift() : random ? random() : rng; } return array; }, randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, at: time + delay }); return id; }, clearTimeout(id) { timers.delete(id); },
    addEventListener(type, fn) { addEvent('window', type, fn); }, removeEventListener(type, fn) { removeEvent('window', type, fn); },
    Blob, URL: { createObjectURL() { allocated++; return 'blob:test-' + allocated; }, revokeObjectURL() { revoked++; } }
  };
  vm.runInNewContext(source, { window, document, Date: FakeDate, console });
  const node = name => dialog.elements.get('npt-' + name);
  const click = name => { assert.ok(node(name), 'missing element: ' + name); node(name).click(); };
  function advance(ms, blocked = false) {
    const end = time + ms;
    if (blocked) time = end;
    for (let iterations = 0; iterations < 100000; iterations++) {
      const next = [...timers.entries()].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      if (!blocked) time = Math.max(time, next[1].at);
      timers.delete(next[0]); next[1].fn();
    }
    time = end;
  }
  const emit = (target, type, event = {}) => { [...listeners.get(target + ':' + type) || []].forEach(fn => fn(event)); };
  const api = window.NVPerceptualTraining;
  const start = () => {
    controller = api.start({ plan: inputPlan, history, getContext: () => ({ participant_id: owner }), onSave: async record => { saved.push(copy(record)); return onSave(record); }, onDraft: onDraft ? record => { drafts.push(copy(record)); return onDraft(record); } : undefined, onClose: record => closed.push(record) });
    return controller;
  };
  const begin = ({ distance = 60, ruler = 114 } = {}) => { node('distance').value = String(distance); node('scale').value = String(ruler); node('calibrated').checked = true; node('symptoms').checked = true; click('begin'); };
  const reachAnswer = () => {
    for (let i = 0; i < 300 && controller.getState().mode === 'running' && controller.getState().phase !== 'answer'; i++) advance(25);
    assert.equal(controller.getState().phase, 'answer');
    return controller.getCurrentTrial();
  };
  const answer = (correct = true) => { const trial = reachAnswer(), expected = trial.task_id === 'collinear' ? trial.target_interval === 1 : trial.orientation_deg === -45; click(correct === expected ? 'a' : 'b'); return trial; };
  return { start, begin, advance, answer, reachAnswer, click, node, emit, api, window, document, timers, listeners, saved, drafts, closed, controller: () => controller, dialog: () => dialog, draws: () => draws, time: () => time, changeOwner(value = 'NV-TWO') { owner = value; }, queueRandom(values) { queuedRandom.push(...values); }, downloads: () => ({ allocated, revoked, clicked }) };
}
function sessionRecord(task = 'contrast') {
  const h = harness({ inputPlan: plan(task) }); const c = h.start(); h.begin(); h.answer(); h.advance(100); c.stop(); return c.getRecord();
}

test('normalizes one-item plans and provenance without copying medical/evidence payloads', () => {
  const normalized = P.normalizePlan(plan());
  assert.equal(normalized.items.length, 1); assert.equal(normalized.items[0].evidence, undefined);
  assert.deepEqual(normalized.plan_basis, ['计划依据']); assert.deepEqual(normalized.source_report_ids, ['report-1']); assert.equal(normalized.source_care_id, 'care-1');
  for (const patch of [{ status: 'blocked' }, { total_seconds: 31 }, { participant_id: '../private' }, { items: [] }]) assert.throws(() => P.normalizePlan(plan('contrast', 30, patch)));
  assert.throws(() => P.normalizePlan(plan('contrast', 361)));
  assert.throws(() => P.normalizePlan(plan('multiscale', 30, { items: [{ task_id: 'multiscale', seconds: 30, cpds: [3] }] })));
});
test('3-down 1-up updates only after the third correct answer, stays bounded, and is immutable', () => {
  const initial = { contrast: 0.24, streak: 0 }; let state = initial;
  state = P.staircase(state, true); state = P.staircase(state, true); assert.equal(state.contrast, 0.24);
  state = P.staircase(state, true); assert.equal(state.contrast, 0.2); assert.equal(state.streak, 0);
  assert.deepEqual(initial, { contrast: 0.24, streak: 0 }); state = P.staircase(state, false); assert.equal(state.contrast, 0.24);
  for (let i = 0; i < 100; i++) state = P.staircase(state, true); assert.equal(state.contrast, 0.04);
  for (let i = 0; i < 100; i++) state = P.staircase(state, false); assert.equal(state.contrast, 0.6);
  assert.throws(() => P.staircase(state, 1));
});
test('physical calibration derives ppd and conservative sampling downgrades 6 cpd', () => {
  const g = P.geometry(3.8, 60, 1); assert.ok(g.ppd > 39 && g.ppd < 40); assert.equal(P.geometry(3.8, 30, 1).ppd, g.ppd / 2);
  assert.deepEqual(P.frequency(6, g.ppd, 1), { requested_cpd: 6, cpd: 3, downgraded: true, samples_per_cycle: g.ppd / 3 });
  assert.equal(P.frequency(6, g.ppd, 2).cpd, 6);
  for (const bad of [[1.9, 60], [3.8, 29], [3.8, 101], [NaN, 60]]) assert.throws(() => P.geometry(...bad));
  assert.throws(() => P.frequency(1.5, 10, 1));
  assert.ok(P.requiredSize('collinear', 1.5, g.ppd, 4) > P.requiredSize('collinear', 1.5, g.ppd, 3));
});
test('crypto mapping is uniform at exact boundaries and permits genuine runs', () => {
  assert.equal(P.signalFromU32(0, 'contrast').orientation_deg, -45); assert.equal(P.signalFromU32(2147483647, 'noise').orientation_deg, -45);
  assert.equal(P.signalFromU32(2147483648, 'contrast').orientation_deg, 45); assert.equal(P.signalFromU32(4294967295, 'collinear').target_interval, 2);
  assert.deepEqual(Array.from({ length: 12 }, () => P.signalFromU32(0, 'contrast').orientation_deg), Array(12).fill(-45));
  assert.throws(() => P.randomU32(null));
});
test('noise has fixed reproducible RMS and each rendered pixel stays within luminance range', () => {
  const noise = P.noiseField(10000, 7), again = P.noiseField(10000, 7), other = P.noiseField(10000, 8);
  assert.deepEqual(noise, again); assert.notDeepEqual(noise, other);
  const mean = noise.reduce((sum, x) => sum + x, 0) / noise.length;
  const rms = Math.sqrt(noise.reduce((sum, x) => sum + x * x, 0) / noise.length);
  assert.ok(Math.abs(mean) < 1e-8); assert.ok(Math.abs(rms - P.NOISE_RMS) < 1e-8);
  const params = { task_id: 'noise', cpd: 3, ppd: 40, dpr: 1, contrast: 0.6, orientation_deg: 45, noise_seed: 7, stimulus_css_px: 160 };
  const image = P.renderPixels(params); assert.ok(image.min_luminance > 0); assert.ok(image.max_luminance < 1); assert.equal(image.data.length, 160 * 160 * 4);
  assert.throws(() => P.renderPixels({ ...params, stimulus_css_px: 100 }));
});
test('collinear intervals preserve two identical 40% flankers and differ only by central target', () => {
  const params = { task_id: 'collinear', cpd: 3, ppd: 30, dpr: 1, contrast: 0.6, orientation_deg: 0, spacing_lambda: 4, target_interval: 2, stimulus_css_px: 160 };
  const first = P.renderPixels(params, 1), second = P.renderPixels(params, 2), at = (image, x, y) => image.data[(y * image.width + x) * 4];
  assert.equal(at(first, 80, 40), at(second, 80, 40)); assert.equal(at(first, 80, 120), at(second, 80, 120));
  assert.ok(at(second, 80, 80) > at(first, 80, 80)); assert.ok(second.max_luminance < 1);
  assert.throws(() => P.renderPixels({ ...params, orientation_deg: 45 }, 1));
});
test('setup enforces physical calibration, symptom confirmation, and full canvas fit', () => {
  const h = harness(); const c = h.start(); h.click('begin'); assert.equal(c.getState().mode, 'setup'); assert.match(h.node('error').textContent, /实体尺/);
  h.node('calibrated').checked = true; h.click('begin'); assert.equal(c.getState().mode, 'setup'); assert.match(h.node('error').textContent, /眼痛/);
  h.begin(); assert.equal(c.getState().mode, 'running'); c.stop(); assert.equal(P.validate(c.getRecord()).valid, true);
  const small = harness({ inputPlan: plan('collinear', 30, { items: [{ task_id: 'collinear', seconds: 30, cpds: [1.5] }] }), width: 390, height: 812 }); const cc = small.start(); small.begin(); assert.equal(cc.getState().mode, 'setup'); assert.match(small.node('error').textContent, /超出/);
  small.begin({ distance: 45 }); assert.equal(cc.getState().mode, 'running');
});
test('orientation answers are gated until exposure ends and timely feedback updates staircase', () => {
  const h = harness(); const c = h.start(); h.begin(); const first = c.getCurrentTrial(); h.click('a'); assert.equal(c.getCurrentTrial().id, first.id);
  for (let i = 0; i < 3; i++) { h.answer(true); h.advance(650); }
  assert.equal(c.getCurrentTrial().contrast, 0.2); h.answer(false); assert.match(h.node('status').textContent, /本次条纹/);
  c.stop(); const record = c.getRecord(); assert.equal(record.valid_trial_count, 4); assert.equal(record.correct_count, 3); assert.equal(P.validate(record).valid, true);
});
test('familiarization lasts six valid responses and the next exposure is 200 ms', () => {
  const h = harness(); const c = h.start(); h.begin();
  for (let i = 0; i < 6; i++) { assert.equal(c.getCurrentTrial().exposure_ms, 500); h.answer(); h.advance(650); }
  assert.equal(c.getCurrentTrial().exposure_ms, 200); h.answer(); c.stop(); P.validateRecord(c.getRecord());
});
test('multiscale interleaves independent staircases and records display frequency downgrade', () => {
  const h = harness({ inputPlan: plan('multiscale'), dpr: 2 }); const c = h.start(); h.begin();
  const seen = [];
  for (let i = 0; i < 9; i++) { seen.push(c.getCurrentTrial().requested_cpd); h.answer(i % 3 !== 1); h.advance(650); }
  assert.deepEqual(seen, [1.5, 3, 6, 1.5, 3, 6, 1.5, 3, 6]); assert.equal(c.getCurrentTrial().cpd, 1.5); assert.equal(c.getCurrentTrial().contrast, 0.24, '200 ms conditions start independently from familiarization');
  c.stop(); const record = c.getRecord(); assert.ok(record.blocks[0].trials.find(t => t.cpd === 3 && t.contrast > 0.24)); P.validateRecord(record);
  const low = harness({ inputPlan: plan('contrast', 10, { items: [{ task_id: 'contrast', seconds: 10, cpds: [6] }] }), dpr: 1 }); const lc = low.start(); low.begin(); assert.equal(lc.getCurrentTrial().cpd, 3); assert.equal(lc.getCurrentTrial().downgraded, true);
});
test('collinear uses two equal presentations separated by 500 ms and 3/4 lambda staircases are independent', () => {
  const h = harness({ inputPlan: plan('collinear', 50), random: () => 0 }); const c = h.start(); h.begin();
  for (let i = 0; i < 3; i++) { const t = h.answer(); assert.equal(t.spacing_lambda, 3); assert.equal(t.first_off_ms - t.first_on_ms, 500); assert.equal(t.second_on_ms - t.first_off_ms, 500); assert.equal(t.second_off_ms - t.second_on_ms, 500); if (i < 2) h.advance(650); }
  h.queueRandom([0, 4294967295]); h.advance(650); assert.equal(c.getCurrentTrial().spacing_lambda, 4); assert.equal(c.getCurrentTrial().contrast, 0.24);
  h.answer(); c.stop(); P.validateRecord(c.getRecord());
});
test('old response timeout cannot invalidate a newer answer window', () => {
  const h = harness(); const c = h.start(); h.begin(); h.answer(); h.advance(650); h.answer(); h.advance(650); h.reachAnswer();
  const id = c.getCurrentTrial().id; h.advance(2200); assert.equal(c.getState().phase, 'answer'); assert.equal(c.getCurrentTrial().id, id); h.answer(); c.stop(); P.validateRecord(c.getRecord());
});
test('timeout is recorded without feedback correctness or staircase updates, then retries same frequency', () => {
  const h = harness({ inputPlan: plan('multiscale') }); const c = h.start(); h.begin(); const first = h.reachAnswer(); h.advance(5000); h.advance(650);
  assert.equal(c.getCurrentTrial().requested_cpd, first.requested_cpd); assert.equal(c.getCurrentTrial().retry_of, first.id); assert.equal(c.getCurrentTrial().contrast, 0.24); assert.equal(c.getCurrentTrial().exposure_ms, 500);
  c.stop(); const t = c.getRecord().blocks[0].trials[0]; assert.equal(t.valid, false); assert.equal(t.invalid_reason, 'timeout'); assert.equal(t.correct, null); P.validateRecord(c.getRecord());
});
for (const interruption of ['blur', 'hidden', 'resize', 'manual_pause']) test(interruption + ' invalidates in-progress exposure, excludes rest, and resumes with a fresh random trial', () => {
  const h = harness(); const c = h.start(); h.begin(); h.advance(400); const first = c.getCurrentTrial();
  if (interruption === 'manual_pause') c.pause(); else if (interruption === 'hidden') { h.document.hidden = true; h.emit('document', 'visibilitychange'); } else h.emit('window', interruption);
  assert.equal(c.getState().mode, 'paused'); const at = h.time(); h.advance(20000); h.document.hidden = false; c.resume(); assert.equal(c.getState().mode, 'running');
  assert.equal(c.getCurrentTrial().retry_of, first.id); assert.equal(c.getCurrentTrial().contrast, first.contrast); h.answer(); c.stop(); const record = c.getRecord();
  assert.equal(record.blocks[0].trials[0].invalid_reason, interruption); assert.ok(record.active_ms < record.elapsed_ms - 19000); assert.ok(record.elapsed_ms > at + 20000); P.validateRecord(record);
});
test('resizing or changing dpr cannot silently shrink a calibrated target', () => {
  const h = harness({ inputPlan: plan('collinear') }); const c = h.start(); h.begin(); h.emit('window', 'resize'); h.window.innerWidth = 250; c.resume(); assert.equal(c.getState().mode, 'paused'); assert.match(h.node('error').textContent, /超出/);
  h.window.innerWidth = 1000; h.window.devicePixelRatio = 1; c.resume(); assert.equal(c.getState().mode, 'paused'); assert.match(h.node('error').textContent, /缩放/);
});
test('60-second segment requires user continuation and pause time never exhausts remaining budget', () => {
  const h = harness({ inputPlan: plan('contrast', 61) }); const c = h.start(); h.begin(); h.advance(60000); assert.equal(c.getState().mode, 'break'); h.advance(123000); c.resume(); h.advance(1000);
  assert.equal(c.getState().mode, 'summary'); const record = c.getRecord(); assert.equal(record.status, 'complete'); assert.equal(record.active_ms, 61000); assert.ok(record.elapsed_ms >= 184000); P.validateRecord(record);
});
test('chapter boundary shows optional rest and only starts the next task on continue', () => {
  const inputPlan = plan('contrast', 2, { items: [{ task_id: 'contrast', label: '一', seconds: 1, cpds: [3] }, { task_id: 'noise', label: '二', seconds: 1, cpds: [3] }] });
  const h = harness({ inputPlan }); const c = h.start(); h.begin(); h.advance(1000); assert.equal(c.getState().mode, 'break'); h.advance(10000); c.resume(); assert.equal(c.getCurrentTrial().task_id, 'noise'); h.advance(1000);
  const record = c.getRecord(); assert.equal(record.status, 'complete'); assert.equal(record.active_ms, 2000); assert.equal(record.blocks.length, 2); P.validateRecord(record);
});
test('real clock overruns retain actual exposure timestamps without inflating planned budgets', () => {
  const h = harness({ inputPlan: plan('contrast', 1) }); const c = h.start(); h.begin(); h.advance(250); h.advance(1400, true);
  const record = c.getRecord(); assert.equal(record.status, 'complete'); assert.equal(record.active_ms, 1000); assert.equal(record.blocks[0].overrun_ms, 650); assert.equal(record.blocks[0].trials[0].ended_ms, 1650); assert.match(h.dialog().html, /1\.6|1\.7/); P.validateRecord(record);
});
test('long stimulus timing errors invalidate the trial instead of updating difficulty', () => {
  const h = harness(); const c = h.start(); h.begin(); h.advance(250); h.advance(700, true); assert.equal(c.getState().phase, 'feedback'); c.stop();
  const record = c.getRecord(); assert.equal(record.valid_trial_count, 0); assert.equal(record.blocks[0].trials[0].invalid_reason, 'timing'); P.validateRecord(record);
});
test('owner changes stop practice, preserve original ownership, and block save until switched back', async () => {
  const h = harness(); const c = h.start(); h.begin(); h.answer(); h.changeOwner(); h.advance(50); assert.equal(c.getState().mode, 'summary'); assert.equal(c.getRecord().participant_id, 'NV-ONE'); assert.equal(c.getRecord().stop_reason, 'owner_changed');
  assert.equal(await c.save(), false); assert.equal(h.saved.length, 0); h.changeOwner('NV-ONE'); assert.equal(await c.save(), true); P.validateRecord(h.saved[0]);
});
test('normal close or Escape retains data until successful save or download; listeners are cleaned', async () => {
  const h = harness(); const c = h.start(); h.begin(); h.answer(); c.close(); assert.equal(c.getState().mode, 'summary'); assert.equal(c.getRecord().stop_reason, 'user_close');
  c.close(); assert.equal(c.isClosed(), false); assert.match(h.dialog().html, /保存或下载/); assert.equal(h.start(), c);
  let prevented = false; h.emit('dialog', 'cancel', { preventDefault() { prevented = true; } }); assert.equal(prevented, true); assert.equal(c.isClosed(), false);
  assert.equal(await c.save(), true); c.close(); assert.equal(c.isClosed(), true); assert.equal(h.listeners.size, 0); assert.equal(h.timers.size, 0); assert.equal(h.closed.length, 1);
});
test('failed async save keeps an immutable retained record and supports retry without duplicate concurrent save', async () => {
  let attempt = 0, release;
  const h = harness({ onSave: record => { attempt++; record.participant_id = 'mutated'; if (attempt === 1) return new Promise((resolve, reject) => { release = reject; }); return true; } });
  const c = h.start(); h.begin(); h.answer(); c.stop(); const first = c.save(); assert.equal(c.getState().saving, true); assert.equal(await c.save(), false); c.close(); assert.equal(c.isClosed(), false);
  release(Error('disk unavailable')); assert.equal(await first, false); assert.equal(c.getRecord().participant_id, 'NV-ONE'); assert.match(h.dialog().html, /保存失败/);
  assert.equal(await c.save(), true); assert.equal(attempt, 2); c.close(); assert.equal(c.isClosed(), true);
});
test('download serializes validated data and releases its URL; beforeunload protects unsaved work', () => {
  const h = harness(); const c = h.start(); h.begin(); let prevented = false; h.emit('window', 'beforeunload', { preventDefault() { prevented = true; } }); assert.equal(prevented, true);
  c.stop(); assert.equal(c.download(), true); assert.deepEqual(h.downloads(), { allocated: 1, clicked: 1, revoked: 0 }); c.close(); h.advance(1000); assert.equal(h.downloads().revoked, 1);
});
test('onDraft receives only valid records and failed persistence makes no saved claim', async () => {
  const h = harness({ onDraft: record => { P.validateRecord(record); return false; } }); const c = h.start(); h.begin(); h.answer(); c.stop(); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.drafts.length, 1); assert.match(h.dialog().html, /当前结果暂留本页/); assert.equal(c.getState().persisted, false);
  h.click('feel-noticeable'); await Promise.resolve(); assert.equal(h.drafts.length, 2); assert.equal(h.drafts[1].feedback, 'noticeable');
  h.click('feel-stop'); assert.equal(c.getRecord().feedback, 'stop'); assert.equal(c.getRecord().stop_reason, 'discomfort'); assert.equal(c.getRecord().status, 'stopped'); P.validateRecord(c.getRecord());
});
test('discomfort immediately ends the session and is retained independently of optional final feedback', () => {
  const h = harness(); const c = h.start(); h.begin(); h.click('discomfort'); const record = c.getRecord(); assert.equal(record.stop_reason, 'discomfort'); assert.equal(record.feedback, 'stop'); assert.equal(record.status, 'stopped'); P.validateRecord(record);
  assert.equal(h.node('feel-comfortable').disabled, true); assert.match(h.dialog().html, /联系医生/);
});
test('200-trial cap stops further work with a valid partial record', () => {
  const h = harness({ inputPlan: plan('contrast', 240) }); const c = h.start(); h.begin();
  let safety = 0;
  while (c.getState().mode !== 'summary' && safety++ < 220) {
    if (['break', 'paused'].includes(c.getState().mode)) c.resume();
    if (c.getState().mode !== 'running') continue;
    h.answer(); h.advance(650);
  }
  const record = c.getRecord(); assert.equal(record.trial_count, 200); assert.equal(record.stop_reason, 'trial_limit'); assert.equal(record.status, 'stopped'); assert.ok(record.active_ms < 240000); P.validateRecord(record);
});
test('strict validator rejects fabricated totals, state updates, answer signals, timing, dimensions, and extra fields', () => {
  const original = sessionRecord(); assert.equal(P.validateRecord(original), original); assert.equal(P.validate(original).valid, true);
  const mutate = fn => { const record = copy(original); fn(record, record.blocks[0].trials[0]); assert.throws(() => P.validateRecord(record)); assert.equal(P.validate(record).valid, false); };
  mutate(r => r.correct_count++); mutate(r => r.active_ms++); mutate(r => r.planned_seconds++); mutate(r => r.status = 'complete'); mutate(r => r.setup.gamma_calibrated = true);
  mutate((r, t) => t.orientation_deg *= -1); mutate((r, t) => t.contrast_after = 0.1); mutate((r, t) => t.first_off_ms += 150); mutate((r, t) => t.answer = 100); mutate((r, t) => t.stimulus_css_px = 1); mutate((r, t) => t.feedback = 'improved');
  mutate(r => r.extra = 'private'); mutate(r => r.feedback = 'cured'); mutate(r => r.source_report_ids = ['../private']); mutate(r => r.plan_basis = ['x'.repeat(501)]);
  mutate(r => r.plan_basis = new Array(2001)); mutate(r => { r.plan_basis = ['reason']; delete r.plan_basis[0]; });
  const invalid = harness(); const c = invalid.start(); invalid.begin(); c.pause(); c.stop(); const record = c.getRecord(); record.blocks[0].trials[0].contrast_after = 0.4; assert.throws(() => P.validateRecord(record));
});
test('CSS keeps mid-gray stimulus field, visible focus, and no stimulus-time decorative animations', () => {
  const css = fs.readFileSync(require.resolve('../app/perceptual-training.css'), 'utf8');
  assert.match(css, /background: #808080/); assert.match(css, /animation: none !important/); assert.match(css, /focus-visible/); assert.match(css, /prefers-reduced-motion/);
});

module.exports = { harness, plan, sessionRecord };
