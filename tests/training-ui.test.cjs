const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const UI = require('../app/app.js');

const context = {participant_id: 'NV-UI-A', access: 'postop', clinical: {procedure: 'icl'}};
function plan() {
  return {version: 'icl-training-plan-v1', participant_id: context.participant_id, status: 'ready', total_seconds: 180,
    items: [
      {task_id: 'contrast', label: '对比辨别', seconds: 60, cpds: [3], reason: '医生确认对比辨别练习。', evidence: 'paper_inspired'},
      {task_id: 'noise', label: '干扰中辨别', seconds: 120, cpds: [1.5, 3, 6], reason: '近两次练习舒适。', evidence: 'mechanism_extension'}
    ], basis: ['双眼 ICL', '医生确认 2026-10-02', '额外长说明不放首页'], missing: [], hold_reason: ''};
}
function record(overrides = {}) {
  return {id: 'session-a', participant_id: context.participant_id, created_at: '2026-10-02T09:00:00.000Z', completed_at: '2026-10-02T09:03:00.000Z', status: 'complete', feedback: 'comfortable', active_ms: 65000, planned_seconds: 180, blocks: [{task_id: 'contrast'}, {task_id: 'noise'}], trials: [], ...overrides};
}
function harness() {
  const events = {}, windowEvents = {}, nav = ['recovery', 'profile', 'records'].map(page => ({dataset: {page}, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; }}));
  let renders = 0, html = '', selectedPlan = plan(), dialogOpen = false, saved = 0, staged = 0, retried = 0;
  const main = {id: 'main', dataset: {}, get innerHTML() { return html; }, set innerHTML(value) { html = value; renders++; }, focus() { this.focused = true; }, querySelector() { return null; }};
  const toast = {style: {}, textContent: ''};
  const doc = {querySelector(selector) { if (selector === '#main') return main; if (selector === '#toast') return toast; if (selector === 'dialog[open]') return dialogOpen ? {} : null; return null; }, querySelectorAll() { return nav; }, addEventListener(name, fn) { events[name] = fn; }};
  const env = {document: doc, location: {hash: '#recovery'}, history: {replaceState(a, b, hash) { env.location.hash = hash; }}, setTimeout() { return 1; }, clearTimeout() {}, scrollTo() {}, addEventListener(name, fn) { windowEvents[name] = fn; }, NVInterface: {enter() {}}, NVExperience: {refresh() {}}, NVRecovery: {
    workbench: () => ({context}), context: () => context, renderProfile: () => '<h1>手术档案</h1>', practiceHistory: () => [record()], snapshotHistory: () => '<p>历史复测</p>', quickCard: () => '<button data-start-snapshot>开始快照</button>', bind() {},
    stagePractice(value) { staged++; return value; },
    savePractice() { saved++; events['nv-recovery-change'](); return true; },
    retryPractice(id) { retried++; assert.equal(id, 'session-a'); return true; },
    startSnapshot() { env.snapshotStarted = true; }
  }, NVTrainingPlan: {build: () => selectedPlan}, NVPerceptualTraining: {start(options) { dialogOpen = true; env.runnerOptions = options; }}};
  const app = UI.mount(env);
  const click = (attributes = {}) => {
    const target = {getAttribute(name) { return attributes[name] ?? null; }, hasAttribute(name) { return Object.hasOwn(attributes, name); }, matches(selector) { return selector === 'a[href^="#"]' && Boolean(attributes.href?.startsWith('#')); }};
    target.closest = () => target;
    events.click({target, preventDefault() {}});
  };
  return {app, env, doc, main, nav, events, toast, click, get renders() { return renders; }, get saved() { return saved; }, get staged() { return staged; }, get retried() { return retried; }, setPlan(value) { selectedPlan = value; }, close() { dialogOpen = false; env.runnerOptions.onClose(); }};
}

test('ready plan displays the real ordered schedule, duration ratio and evidence labels', () => {
  const html = UI.homePage({context}, plan(), new Date('2026-10-02T00:00:00Z'));
  assert.equal((html.match(/data-start-training/g) || []).length, 1);
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.match(html, /约 3 分钟/);
  assert.match(html, /flex-grow:60/);
  assert.match(html, /flex-grow:120/);
  assert.match(html, /00:00 至 01:00/);
  assert.match(html, /01:00 至 03:00/);
  assert.match(html, /感知练习/);
  assert.match(html, /探索练习/);
  assert.match(html, /医生确认对比辨别练习。/);
  assert.doesNotMatch(html, /额外长说明不放首页|data-start-snapshot|恢复百分比|data-start="/);
});

test('missing, held, invalid and different-person plans never offer a training start', () => {
  for (const value of [
    {...plan(), status: 'needs_data', missing: ['左眼手术日期'], hold_reason: '补全手术日期。'},
    {...plan(), status: 'needs_review', missing: [], hold_reason: '先确认练习条件。'},
    {...plan(), participant_id: 'NV-OTHER'},
    {...plan(), items: [{task_id: 'contrast', seconds: -60}]},
    {...plan(), items: [{task_id: 'made-up', seconds: 60}]},
    undefined
  ]) {
    const html = UI.homePage({context}, value);
    assert.doesNotMatch(html, /data-start-training|class="training-card"|方案已就绪/);
    assert.match(html, /href="#profile"/);
    assert.doesNotMatch(html, /undefined|NaN/);
  }
  assert.match(UI.homePage({context}, {...plan(), status: 'needs_data', missing: ['左眼手术日期']}), /左眼手术日期/);
});

test('externally supplied labels, basis, hold reasons and pending records are escaped', () => {
  const value = plan();
  value.items[0].label = '<img src=x onerror=alert(1)>';
  value.items[0].reason = '<script>reason</script>';
  value.items[0].cpds = [3, '" onload="x'];
  value.basis[0] = '<b>basis</b>';
  const html = UI.homePage({context, storage_error: '<i>quota</i>', pending_practice: [record({id: '" onclick="x'}), record({participant_id: 'NV-OTHER'})]}, value);
  assert.doesNotMatch(html, /<img|<script|<b>basis|<i>quota|onload="x|data-retry-practice="" onclick=/);
  assert.match(html, /&lt;img/);
  assert.match(html, /有 1 次训练待保存/);
  assert.match(html, /data-retry-practice="&quot; onclick=&quot;x"/);
});

test('records use actual active time, retain stopped feedback and only include the current profile', () => {
  const html = UI.recordsPage([record(), record({id: 'stopped', status: 'stopped', feedback: 'noticeable', active_ms: 55000}), record({id: 'other', participant_id: 'NV-OTHER', active_ms: 900000000})], context);
  assert.match(html, /<dd>2<small>分钟/);
  assert.match(html, /<dd>2<small>次/);
  assert.match(html, /<dd>1<small>次/);
  assert.match(html, /提前结束/);
  assert.match(html, /轻度疲劳/);
  assert.match(html, /1 分钟 5 秒/);
  assert.match(html, /干扰中辨别/);
  assert.doesNotMatch(html, /恢复率|%|900000000/);
  assert.match(html, /<details class="practice-retest">/);
  assert.doesNotMatch(html, /practice-retest" open/);
});

test('empty records remain an invitation to start without fabricated session data', () => {
  const html = UI.recordsPage([], context);
  assert.match(html, /还没有训练记录/);
  assert.match(html, /<dd>0<small>分钟/);
  assert.doesNotMatch(html, /class="practice-record"/);
});

test('start revalidates the plan; a newly held plan routes to the profile', () => {
  const h = harness();
  h.setPlan({...plan(), status: 'needs_review', hold_reason: '练习条件发生变化。'});
  h.click({'data-start-training': ''});
  assert.equal(h.env.runnerOptions, undefined);
  assert.equal(h.env.location.hash, '#profile');
  assert.equal(h.toast.textContent, '练习条件发生变化。');
  assert.equal(h.nav[1].attributes['aria-current'], 'page');
});

test('finish stages and saves data without removing the open dialog; close refreshes records', () => {
  const h = harness();
  h.click({'data-start-training': ''});
  const rendersBeforeSave = h.renders;
  const options = h.env.runnerOptions;
  assert.equal(options.getContext().participant_id, context.participant_id);
  options.onDraft(record());
  assert.equal(h.staged, 1);
  assert.equal(options.onSave(record()), true);
  assert.equal(h.saved, 1);
  assert.equal(h.renders, rendersBeforeSave, 'save events must not redraw the active stimulus or result view');
  h.close();
  assert.equal(h.renders, rendersBeforeSave + 1);
  assert.equal(h.main.focused, true);
});

test('all navigation and the legacy measurement route retain one current main-nav item', () => {
  const h = harness();
  h.click({href: '#records'});
  assert.match(h.main.innerHTML, /训练记录/);
  assert.equal(h.nav[2].attributes['aria-current'], 'page');
  h.app.navigate('measure');
  assert.match(h.main.innerHTML, /视觉复测/);
  assert.equal(h.nav[2].attributes['aria-current'], 'page');
  assert.equal(h.nav.filter(link => link.attributes['aria-current']).length, 1);
  h.click({'data-start-snapshot': ''});
  assert.equal(h.env.snapshotStarted, true);
  h.app.navigate('unknown');
  assert.equal(h.env.location.hash, '#recovery');
  h.click({'data-retry-practice': 'session-a'});
  assert.equal(h.retried, 1);
  assert.equal(h.toast.textContent, '训练记录已保存。');
});

test('offline shell loads the plan and runner before recovery, while measurement stays out of the main nav', () => {
  const shell = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8');
  const navigation = shell.match(/<nav[\s\S]*?<\/nav>/)[0];
  assert.deepEqual([...navigation.matchAll(/data-page="([^"]+)"/g)].map(match => match[1]), ['recovery', 'profile', 'records']);
  assert.ok(shell.indexOf('src="training-plan.js"') < shell.indexOf('src="recovery.js"'));
  assert.ok(shell.indexOf('src="perceptual-training.js"') < shell.indexOf('src="recovery.js"'));
  assert.ok(shell.indexOf('src="app.js"') > shell.indexOf('src="recovery.js"'));
  assert.match(shell, /connect-src 'none'/);
  assert.match(shell, /wasm-unsafe-eval/);
  assert.match(shell, /src="report-import.js"/);
  assert.doesNotMatch(shell, /practice-preview.js|data-page="methods"|ui-motion-toggle/);
});

test('recorded display overruns count toward actual practice time but not planned time', () => {
  const html = UI.recordsPage([record({active_ms: 60000, planned_seconds: 60, blocks: [{task_id: 'contrast', overrun_ms: 5000}, {task_id: 'noise', overrun_ms: null}]})], context);
  assert.match(html, /<dd>1.1<small>分钟/);
  assert.match(html, /实际练习<\/dt><dd>1 分钟 5 秒/);
  assert.match(html, /原定时长<\/dt><dd>1 分钟<\/dd>/);
});
