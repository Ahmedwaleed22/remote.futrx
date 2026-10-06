import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
const root = resolve(process.argv[2] || '.');
const { chatEventStateProjector: projector } = await import(pathToFileURL(resolve(root,'frontend/src/state/hooks/chat/chatEventStateProjector.ts')));
const initial = [];
let seq = 0;
for (let turn=0; turn<100; turn++) {
 initial.push({type:'user', text:'Load test question',seq:++seq,t:seq});
 for (let delta=0;delta<40;delta++) initial.push({type:'assistant_text',text:'Some streamed response text. ',seq:++seq,t:seq});
 initial.push({type:'complete',seq:++seq,t:seq});
}
let state = projector.fromEvents(initial,{hasMore:false});
state = projector.append(state,[{type:'user',text:'Another question',seq:++seq,t:seq}]);
global.gc?.();
const before = process.memoryUsage();
const timings=[];
const begin=performance.now();
for(let batch=0;batch<1000;batch++) {
 const events=[];
 for(let i=0;i<4;i++) events.push({type:'assistant_text',text:'additional delta ',seq:++seq,t:seq});
 const start=performance.now(); state=projector.append(state,events); timings.push(performance.now()-start);
}
const elapsed=performance.now()-begin;
global.gc?.();
const after=process.memoryUsage();
timings.sort((a,b)=>a-b);
console.log(JSON.stringify({scenario:'100 loaded turns + 4000 live deltas in 1000 batches',elapsed_ms:elapsed,p50_batch_ms:timings[499],p95_batch_ms:timings[949],p99_batch_ms:timings[989],retained_heap_delta_bytes:after.heapUsed-before.heapUsed,rss_bytes:after.rss,events:state.events.length,blocks:state.blocks.length}));
