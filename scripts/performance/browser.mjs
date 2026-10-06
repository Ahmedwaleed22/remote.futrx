// A real Chromium run against built UI assets and isolated synthetic API/WS
// fixtures. Never logs in, uploads user files, or contacts production.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
const root=resolve(process.argv[2]||'.');
const drafts=process.argv.includes('--drafts');
const label=process.argv.includes('--baseline')?'baseline':drafts?'drafts':'candidate';
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{
 try {
  const path=new URL(req.url,'http://fixture').pathname;
  const file=path==='/'||path.startsWith('/chats/')||path.startsWith('/settings')?'index.html':path.slice(1);
  const raw=await readFile(resolve(root,'backend/public',file));
  res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream'});res.end(raw);
 } catch {res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,args:['--js-flags=--expose-gc']});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const requestCounts={};
const projects=Array.from({length:5},(_,i)=>({id:(i+1).toString(16).padStart(6,'0'),slug:`project-${i}`,name:`Project ${i}`,status:'running',createdAt:1,updatedAt:1}));
const chats=Array.from({length:1000},(_,i)=>({id:(i+100).toString(16).padStart(6,'0'),title:`Load chat ${i}`,provider:'codex',mode:'default',projectId:projects[i%5].id,cwd:'/workspace',createdAt:1,lastMessageAt:100000-i,lastReadAt:100000-i}));
const metadata=chats[0];
const capabilities={provider:'codex',label:'Codex',default:true,executionScopes:['host','project'],authentication:{mode:'none',satisfiesAccessGate:true},features:{sessions:{resume:true,fork:true},skills:'none',browserTools:true,scheduledTools:true,executionPolicies:true,streamingPresentation:'tokens'},source:'live',models:[{id:'',label:'Auto',inputModalities:['text','image'],reasoningEfforts:[],serviceTiers:[]}],modes:[{value:'default',label:'Default'}],defaultMode:'default'};
const uploaded=[];let uploadId=0;let uploadDeletes=0;let patchDelay=0;
await page.route('**/auth/me',route=>route.fulfill({json:{authenticated:true,claimed:true,localAdminConfigured:true,email:'load@example.test',adminEmail:'load@example.test',isAdmin:true,isRegistered:true}}));
await page.route('**/api/**',async route=>{
 const req=route.request(),u=new URL(req.url()),path=u.pathname;requestCounts[path]=(requestCounts[path]||0)+1;
 let data={};
 if(path==='/api/agent-auth')data={providers:[{...capabilities,status:{authenticated:true,login:{active:false}}}]};
 else if(path==='/api/agent-capabilities')data={providers:[capabilities]};
 else if(path==='/api/me/settings')data={};
 else if(path==='/api/projects')data=projects;
 else if(path==='/api/applications/ui')data=[];
 else if(path.includes('/applications'))data=[];
 else if(path==='/api/chats') {const offset=Number(u.searchParams.get('before')||0);const filtered=u.searchParams.has('q')?chats.filter(c=>c.title.toLowerCase().includes(u.searchParams.get('q').toLowerCase())):chats;data=u.searchParams.has('limit')?{chats:filtered.slice(offset,offset+100),hasMore:offset+100<filtered.length,nextBefore:String(offset+100),total:filtered.length}:filtered;}
 else if(/\/api\/chats\/[a-f0-9]+$/.test(path)) data={...metadata,...chats.find(c=>path.endsWith(c.id))};
 else if(path.endsWith('/transcript'))data={turns:[{id:'turn-1',startSeq:1,endSeq:3,events:[{type:'user',text:'Synthetic question',seq:1,t:1},{type:'assistant_text',text:'Synthetic response',seq:2,t:2},{type:'complete',seq:3,t:3}]}],lastSeq:3,hasMore:false};
 else if(path.endsWith('/history/repos')||path.endsWith('/apps')||path.endsWith('/skills'))data=[];
 else if(path.endsWith('/container')) {await new Promise(r=>setTimeout(r,u.searchParams.has('resources')?10:150));data={name:'fixture-container',state:'RUNNING',limits:{},resources:{},network:[],agents:[{id:'codex',label:'Codex',installed:true}],authBundles:[]};}
 else if(path.endsWith('/shares')||path.endsWith('/access')||path.endsWith('/secrets'))data=[];
 else if(path==='/api/server/info')data={memory:{totalBytes:8e9},cpu:{},disk:{},version:'fixture'};
 else if(path.startsWith('/api/uploads')) {
  const headers={'Tus-Resumable':'1.0.0','Upload-Offset':String(req.postDataBuffer()?.length||0)};
  if(req.method()==='POST'){uploaded.push(req.headers()['upload-metadata']);return route.fulfill({status:201,headers:{...headers,Location:`${url}/api/uploads/${++uploadId}`}});}
  if(req.method()==='DELETE'){uploadDeletes++;return route.fulfill({status:204,headers});}
  if(req.method()==='PATCH'&&patchDelay)await new Promise(r=>setTimeout(r,patchDelay));
  return route.fulfill({status:204,headers});
 }
 else if(path.endsWith('/media-open'))return route.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
 return route.fulfill({json:data});
});
let stream;let socketCount=0;
await page.routeWebSocket('**/ws/**',ws=>{
 if(ws.url().includes('/ws/workspace')) {
  const limited=new URL(ws.url()).searchParams.has('chatLimit');
  ws.send(JSON.stringify({type:'workspace.snapshot',chats:limited?chats.slice(0,100):chats,projects,totalChats:chats.length,hasMore:limited,nextBefore:limited?'100':undefined}));
 } else if(ws.url().includes('/ws/chat/')) {
  stream=ws;socketCount++;ws.send(JSON.stringify({type:'sync',running:false,t:4}));
 }
});
const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
async function metrics(){await cdp.send('HeapProfiler.collectGarbage');const {metrics}=await cdp.send('Performance.getMetrics');return Object.fromEntries(metrics.filter(x=>['JSHeapUsedSize','Nodes','Documents','LayoutCount','TaskDuration'].includes(x.name)).map(x=>[x.name,x.value]));}
const timings=[];
try {
 const begin=performance.now();await page.goto(`${url}/chats/${metadata.id}`);
 await page.locator('textarea').waitFor();await page.waitForFunction(()=>!document.querySelector('textarea').disabled);
 timings.push(performance.now()-begin);
 const before=await metrics();
 if(drafts){
  await page.locator('textarea').fill('This unsent draft must survive navigation');
  patchDelay=400;
  await page.locator('input[type=file]').setInputFiles({name:'screen.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
 }
 for(let i=0;i<(drafts?3:12);i++){
  const begin=performance.now();
  await page.getByRole('button',{name:'Open container info for Project 0',exact:true}).click();
  await page.getByRole('button',{name:'Chats',exact:true}).waitFor();
  await page.getByRole('tab',{name:'Settings',exact:true}).first().click();
  await page.getByText('Resource limits',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Chats',exact:true}).click();
  await page.locator('textarea').waitFor();await page.waitForFunction(()=>!document.querySelector('textarea').disabled);
  timings.push(performance.now()-begin);
  if(drafts)assert.equal(await page.locator('textarea').inputValue(),'This unsent draft must survive navigation');
 }
 if(drafts){
  await page.getByRole('button',{name:'Remove screen.png'}).waitFor();
  assert.equal(uploadDeletes,0,'navigation must not delete an in-progress upload');
  assert.equal(uploaded.length,1,'returning must not create duplicate uploads');
  await page.reload();await page.locator('textarea').waitFor();
  assert.equal(await page.locator('textarea').inputValue(),'This unsent draft must survive navigation');
  await page.getByRole('button',{name:'Remove screen.png'}).waitFor();
  await page.getByRole('button',{name:'Remove screen.png'}).click();
  await page.reload();await page.locator('textarea').waitFor();
  assert.equal(await page.getByRole('button',{name:'Remove screen.png'}).count(),0);
 } else {
  assert.ok(stream,'chat stream connected');
  // Unique large native telemetry payloads are diagnostic-only, not UI data.
  for(let i=0;i<100;i++){
   stream.send(JSON.stringify({type:'provider_event',name:'load/telemetry',seq:i+4,t:i+4,data:{payload:`${i}-`+'x'.repeat(512*1024)}}));
   if(i%10===9)await page.waitForTimeout(20);
  }
  await page.waitForTimeout(500);
 }
 const after=await metrics();
 const result={label,fixture_chats:chats.length,navigation_cycles:drafts?3:12,navigation_ms:timings,heap_before_bytes:before.JSHeapUsedSize,heap_after_bytes:after.JSHeapUsedSize,nodes_before:before.Nodes,nodes_after:after.Nodes,socket_connections:socketCount,request_counts:requestCounts,page_errors:errors,uploads:uploaded.length,upload_deletes:uploadDeletes};
 assert.deepEqual(errors,[]);
 await mkdir('/workspace/.browser/performance',{recursive:true});
 await page.screenshot({path:`/workspace/.browser/performance/${label}.png`});
 console.log(JSON.stringify(result));
} catch(error) {
 await mkdir('/workspace/.browser/performance',{recursive:true});
 await page.screenshot({path:`/workspace/.browser/performance/${label}-error.png`});
 console.error(JSON.stringify({errors,url:page.url(),text:(await page.locator('body').innerText()).slice(-4000)}));
 throw error;
} finally {await browser.close();await new Promise(r=>server.close(r));}
