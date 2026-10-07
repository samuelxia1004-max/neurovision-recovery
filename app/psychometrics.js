/* Bayesian psychophysics in digital stimulus units. No browser dependency. */
(function(root){
'use strict';
const VERSION='0.2.0';
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const logistic=x=>1/(1+Math.exp(-x));
function rng(seed){let a=seed>>>0;return()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function median(xs){if(!xs.length)return null;const a=[...xs].sort((a,b)=>a-b),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
function quantile(values,weights,q){let s=0;for(let i=0;i<values.length;i++){s+=weights[i];if(s>=q)return values[i];}return values.at(-1);}
function shuffle(xs,random=Math.random){const a=[...xs];for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
const configs={contrast:{min:Math.log10(.0125),max:Math.log10(.5),steps:81,slopes:[3,5,8,12],target:.75},focus:{min:-.9,max:.9,steps:73,slopes:[3,5,8,12,18],target:.5}};
function probability(kind,x,theta,slope){return kind==='contrast'?.5+.48*logistic(slope*(x-theta)+Math.log(25/23)):.02+.96*logistic(slope*(x-theta));}
function create(kind){const c=configs[kind];if(!c)throw Error('Unknown estimator');const grid=Array.from({length:c.steps},(_,i)=>c.min+i*(c.max-c.min)/(c.steps-1));return{kind,grid,slopes:[...c.slopes],weights:Array(c.steps*c.slopes.length).fill(1/(c.steps*c.slopes.length)),n:0};}
function marginal(s){return s.grid.map((_,i)=>s.slopes.reduce((v,__,j)=>v+s.weights[i*s.slopes.length+j],0));}
function update(s,x,yes,valid=true){if(!valid)return s;if(!Number.isFinite(x)||typeof yes!=='boolean')throw Error('Invalid observation');let total=0;for(let i=0;i<s.grid.length;i++)for(let j=0;j<s.slopes.length;j++){const k=i*s.slopes.length+j,p=probability(s.kind,x,s.grid[i],s.slopes[j]);s.weights[k]*=yes?p:1-p;total+=s.weights[k];}s.weights=s.weights.map(w=>w/total);s.n++;return s;}
function next(s){const m=marginal(s);const qs=[.15,.3,.5,.7,.85];const candidates=[...new Set(qs.map(q=>quantile(s.grid,m,q)))];let best=candidates[0],gain=-Infinity;const entropy=p=>p>0&&p<1?-p*Math.log(p)-(1-p)*Math.log(1-p):0;for(const x of candidates){let predictive=0,conditional=0;for(let i=0;i<s.grid.length;i++)for(let j=0;j<s.slopes.length;j++){const p=probability(s.kind,x,s.grid[i],s.slopes[j]),w=s.weights[i*s.slopes.length+j];predictive+=w*p;conditional+=w*entropy(p);}const mi=entropy(predictive)-conditional;if(mi>gain){gain=mi;best=x;}}return best;}
function summary(s){const m=marginal(s),theta=quantile(s.grid,m,.5),lo=quantile(s.grid,m,.025),hi=quantile(s.grid,m,.975);const flags=[];const edge=m.slice(0,3).reduce((a,b)=>a+b,0)+m.slice(-3).reduce((a,b)=>a+b,0);if(s.n<32)flags.push('too_few_trials');if(edge>.12)flags.push('range_limit');if(hi-lo>(s.kind==='contrast'?.7:.6))flags.push('wide_interval');const transform=x=>s.kind==='contrast'?Math.pow(10,x):x;return{value:transform(theta),low:transform(lo),high:transform(hi),unit:s.kind==='contrast'?'数字对比度':'Δα',flags,n:s.n,grid:s.grid,posterior:m,latent:{value:theta,low:lo,high:hi},edge_mass:edge};}
function finished(s){const e=summary(s);return s.n>=48||(s.n>=32&&e.flags.length===0);}
function combine(a,b,mode){const samples=[];let cumulative=0;for(let i=0;i<a.grid.length;i++)for(let j=0;j<b.grid.length;j++){const weight=a.posterior[i]*b.posterior[j];samples.push({value:mode==='ratio'?Math.pow(10,a.grid[i]-b.grid[j]):a.grid[i]-b.grid[j],weight});}samples.sort((x,y)=>x.value-y.value);const q=p=>{cumulative=0;for(const s of samples){cumulative+=s.weight;if(cumulative>=p)return s.value;}return samples.at(-1).value;};return{value:q(.5),low:q(.025),high:q(.975)};}
// BSR denominator is the more sensitive monocular condition, sampled jointly to
// retain uncertainty about which eye is better rather than fixing an eye post hoc.
function binocularRatio(left,right,both){const points=[],qvals=Array.from({length:51},(_,i)=>(i+.5)/51);for(const ql of qvals)for(const qr of qvals)for(const qb of qvals){points.push(Math.pow(10,Math.min(quantile(left.grid,left.posterior,ql),quantile(right.grid,right.posterior,qr))-quantile(both.grid,both.posterior,qb)));}points.sort((a,b)=>a-b);return{value:points[Math.floor(points.length*.5)],low:points[Math.floor(points.length*.025)],high:points[Math.floor(points.length*.975)]};}
function timingFlags({rt_ms,frame_intervals=[],frame_ms=16.67,exposure_ms,target_ms,hidden=false,max_rt_ms=Infinity}){const flags=[];if(hidden)flags.push('interrupted');if(Number.isFinite(rt_ms)&&rt_ms>max_rt_ms)flags.push('late_response');if(!Number.isFinite(rt_ms)||rt_ms<150)flags.push(rt_ms===null?'timeout':'anticipatory');if(frame_intervals.some(t=>t>frame_ms*1.75)||Math.abs(exposure_ms-target_ms)>frame_ms*1.5)flags.push('timing_unstable');return flags;}
function csvCell(v){const s=v==null?'':String(v);return '"'+(/^[=+@\-\t\r]/.test(s)?"'"+s:s).replace(/"/g,'""')+'"';}
const api={VERSION,configs,clamp,rng,median,shuffle,probability,create,marginal,update,next,summary,finished,combine,binocularRatio,timingFlags,csvCell};if(typeof module!=='undefined')module.exports=api;root.NVPsych=api;root.NVPsychLegacy=api;
})(typeof window==='undefined'?globalThis:window);
