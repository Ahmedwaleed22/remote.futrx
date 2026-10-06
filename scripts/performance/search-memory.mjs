import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
const root=resolve(process.argv[2]||'.');
const {textFoldService}=await import(pathToFileURL(resolve(root,'frontend/src/services/platform/textFoldService.ts')));
global.gc?.();const before=process.memoryUsage();const start=performance.now();
for(let i=0;i<100;i++)textFoldService.fold(`${i}-`+'Some find-in-chat transcript text. '.repeat(2000));
global.gc?.();const after=process.memoryUsage();
console.log(JSON.stringify({scenario:'find-in-chat across 100 distinct ~68 KB transcript texts',elapsed_ms:performance.now()-start,retained_heap_delta_bytes:after.heapUsed-before.heapUsed,rss_bytes:after.rss,cached_characters:textFoldService.cachedCharacters??null}));
