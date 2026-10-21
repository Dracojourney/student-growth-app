const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../js/sync.js'),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
function setup({local,cloud={},cursor={},failTable,hangTable,authLock=false,restoreMode=false,failRestoreStorage=false}={}){
 const tables={family_members:[{family_id:'family',user_id:'user'}],children:[],points_ledger:[],checkins:[],redemptions:[],child_task_config:[],family_reward_config:[],family_settings:[],...clone(cloud)};
 let activeHang=hangTable;
 let callback,inCallback=false;const writes=[];const signals=[];
 class Query{
  constructor(table){this.table=table;this.filters=[];this.op='select';this.offset=0;this.size=1000;}
  abortSignal(signal){this.signal=signal;signals.push(signal);return this;}
  select(){return this;}eq(k,v){this.filters.push(r=>r[k]===v);return this;}in(k,vs){this.filters.push(r=>vs.includes(r[k]));return this;}
  order(){return this;}range(a,b){this.offset=a;this.size=b-a+1;return this;}maybeSingle(){this.single=true;return this;}
  upsert(rows){this.op='upsert';this.rows=Array.isArray(rows)?rows:[rows];return this;}delete(){this.op='delete';return this;}
  then(ok,bad){return Promise.resolve().then(()=>{
   if(this.table===activeHang)return new Promise(()=>{});
   if(this.table===failTable&&this.op!=='select')return {error:{message:'test write failure'}};
   let rows=tables[this.table]||[];const matches=r=>this.filters.every(f=>f(r));
   if(this.op==='select'){const selected=rows.filter(matches).slice(this.offset,this.offset+this.size);return {data:this.single?(selected[0]||null):clone(selected),error:null};}
   writes.push(this.table);
   if(this.op==='delete')tables[this.table]=rows.filter(r=>!matches(r));
   else for(const row of this.rows){const keys=this.table==='children'?['family_id','child_id']:this.table==='points_ledger'||this.table==='redemptions'?['family_id','child_id','client_id']:this.table==='checkins'?['family_id','child_id','day','task_id']:this.table==='child_task_config'?['family_id','child_id']:['family_id'];const i=rows.findIndex(r=>keys.every(k=>r[k]===row[k]));if(i<0)rows.push(clone(row));else rows[i]={...rows[i],...clone(row)};}
   return {data:null,error:null};
  }).then(ok,bad);}
 }
 const storage=new Map([['sga_cloud_sync_state',JSON.stringify(cursor)]]);
 const client={from:t=>new Query(t),rpc:name=>{writes.push('rpc:'+name);return authLock&&inCallback?new Promise(()=>{}):Promise.resolve({data:'family',error:null})},auth:{onAuthStateChange:fn=>{callback=fn},signOut:()=>Promise.resolve({}),signInWithPassword:()=>Promise.resolve({error:{message:'invalid credentials'}}),signUp:()=>Promise.resolve({error:{message:'invalid signup'}})}};
 const state=clone(local||{childrenList:[],children:{}});
 const ctx={console,Date,Promise,AbortController,location:{search:restoreMode?'?restore=cloud':''},setTimeout:(fn,ms)=>ms<=30?setTimeout(fn,ms):1,clearTimeout,SGA_SUPABASE_URL:'https://test.invalid',SGA_SUPABASE_ANON_KEY:'public',
 localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>{if(failRestoreStorage&&k==='student_growth_app_v1')throw Error('test quota exceeded');storage.set(k,v)},removeItem:k=>storage.delete(k)},
 document:{addEventListener:()=>{}},getAppState:()=>state,saveState:()=>{},render:()=>{},
 deleteChild:id=>{state.childrenList=state.childrenList.filter(c=>c.id!==id);delete state.children[id];}};
 ctx.window=ctx;ctx.supabase={createClient:()=>client};ctx.addEventListener=()=>{};
 vm.createContext(ctx);vm.runInContext(source.replace('var REQUEST_TIMEOUT_MS = 15000;', 'var REQUEST_TIMEOUT_MS = 25;'),ctx);
 return {state,tables,writes,signals,setHang:table=>{activeHang=table},sync:ctx.SGASync,storage,login:async()=>{inCallback=true;callback('SIGNED_IN',{user:{id:'user',email:'qa@example.com'}});inCallback=false;await new Promise(r=>setTimeout(r,5));for(let i=0;i<35;i++)await new Promise(r=>setImmediate(r));}};
}
const profile={id:'kid',name:'测试孩子',gender:'',grade:'',avatar:'',banner:''};
const child=()=>({points:0,pointsHistory:[],checkins:{},redemptions:[],taskConfig:{overrides:{},custom:[]}});
const row={family_id:'family',child_id:'kid',name:'测试孩子',points:0,updated_at:'2026-01-01T00:00:00Z'};
const done={family_id:'family',migration_state:{status:'done'}};
test('local deletion is not resurrected by pull before push',async()=>{
 const s=setup({local:{childrenList:[],children:{}},cursor:{initialized:true,childIds:['kid']},cloud:{children:[row],family_settings:[done]}});
 await s.login();assert.equal(s.state.childrenList.length,0);assert.equal(s.tables.children.length,0);
});
test('all ledger rows are downloaded beyond API page limit',async()=>{
 const ledger=Array.from({length:1005},(_,i)=>({family_id:'family',child_id:'kid',client_id:'entry'+i,type:'bonus',amount:1,occurred_at:'2026-01-01T00:00:00Z'}));
 const s=setup({local:{childrenList:[],children:{}},cloud:{children:[{...row,points:1005}],points_ledger:ledger,family_settings:[done]}});
 await s.login();assert.equal(s.state.children.kid.pointsHistory.length,1005);
});
test('cloud revoked flag updates an existing local reward',async()=>{
 const cs=child();cs.pointsHistory=[{id:'bonus1',type:'bonus',amount:8,time:1}];cs.points=8;
 const s=setup({local:{childrenList:[profile],children:{kid:cs}},cursor:{initialized:true,childIds:['kid']},cloud:{children:[row],points_ledger:[{family_id:'family',child_id:'kid',client_id:'bonus1',type:'bonus',amount:8,revoked:true,occurred_at:'2026-01-01T00:00:00Z'}]}});
 await s.login();assert.equal(s.state.children.kid.pointsHistory[0].revoked,true);
});
test('first login adopts cloud without uploading unrelated local children',async()=>{
 const s=setup({local:{childrenList:[{...profile,id:'seed'}],children:{seed:child()}},cloud:{children:[row],family_settings:[done]}});
 await s.login();assert.deepEqual(s.state.childrenList.map(c=>c.id),['kid']);assert.equal(s.tables.children.some(c=>c.child_id==='seed'),false);
});
test('failed upload does not publish the migration-completed marker',async()=>{
 const s=setup({local:{childrenList:[profile],children:{kid:child()}},failTable:'child_task_config'});
 await s.login();assert.equal(s.tables.family_settings.length,0);assert.match(s.sync.status().lastError,/failure/);
});
test('profile uploads never overwrite ledger-derived cloud balance',async()=>{
 const s=setup({local:{childrenList:[profile],children:{kid:child()}}});
 await s.login();assert.equal(Object.hasOwn(s.tables.children[0],'points'),false);
});

test('authentication errors reject instead of reporting login success',async()=>{
 const s=setup();await assert.rejects(s.sync.signIn('qa@example.com','wrong'),e=>e.message==='invalid credentials');
 await assert.rejects(s.sync.signUp('qa@example.com','wrong'),e=>e.message==='invalid signup');
});

test('cloud restoration waits for explicit action, backs up local state and never uploads',async()=>{
 const old=child();old.points=999;old.pointsHistory=[{id:'unsynced',type:'bonus',amount:999,time:Date.now()}];
 const s=setup({restoreMode:true,local:{childrenList:[profile],children:{kid:old}},cursor:{initialized:true,childIds:['kid']},cloud:{children:[{...row,points:17}],family_settings:[done],points_ledger:[{family_id:'family',child_id:'kid',client_id:'saved',type:'bonus',amount:17,occurred_at:'2026-10-21T17:18:00Z'}]}});
 await s.login();assert.equal(s.state.children.kid.points,999);assert.equal(s.writes.length,0);
 assert.equal(await s.sync.restoreCloudToLocal(),true);
 assert.equal(s.state.children.kid.points,17);assert.equal(s.state.children.kid.pointsHistory.length,1);
 const backup=JSON.parse(s.storage.get(s.sync.status().restoreBackupKey));assert.equal(backup.children.kid.points,999);
 await s.sync.syncAll();await s.sync.pushNow();assert.equal(s.writes.length,0);assert.equal(s.sync.status().restoreComplete,true);
});
test('failed or empty cloud restore never replaces the local working copy',async()=>{
 for(const hang of [null,'child_task_config']){
  const local={childrenList:[profile],children:{kid:{...child(),points:23}}};
  const s=setup({restoreMode:true,local,hangTable:hang,cloud:{children:hang?[row]:[],family_settings:[done]}});
  await s.login();assert.equal(await s.sync.restoreCloudToLocal(),false);
  assert.deepEqual(s.state,local);assert.equal(s.writes.length,0);assert.equal(s.sync.status().restoreComplete,false);
 }
});

test('restore refuses missing membership and never reports success after quota failure',async()=>{
 const local={childrenList:[profile],children:{kid:{...child(),points:23}}};
 const missing=setup({restoreMode:true,local,cloud:{family_members:[]}});await missing.login();
 assert.equal(missing.sync.status().familyId,null);assert.equal(missing.writes.length,0);assert.deepEqual(missing.state,local);
 const quota=setup({restoreMode:true,failRestoreStorage:true,local,cloud:{children:[row],family_settings:[done]}});await quota.login();
 assert.equal(await quota.sync.restoreCloudToLocal(),false);assert.equal(quota.sync.status().restoreComplete,false);
 assert.deepEqual(quota.state,local);assert.equal(quota.writes.length,0);assert.match(quota.sync.status().lastError,/quota/);
});

test('custom task undo survives pull-before-push and reaches another device without duplicate deductions',async()=>{
 const task='custom_123_test',day='2026-10-21',oldTime=Date.parse('2026-10-21T01:00:00Z'),newTime=oldTime+1000;
 const cs=child();cs.checkins[day]={[task]:{completed:false,time:newTime,points:9,historyId:'earned'}};
 cs.pointsHistory=[{id:'earned',type:'earn',amount:9,time:oldTime},{id:'undo',type:'revoke',amount:9,time:newTime}];
 const stale={family_id:'family',child_id:'kid',day,task_id:task,completed:true,points:9,client_updated_at:new Date(oldTime).toISOString()};
 const a=setup({local:{childrenList:[profile],children:{kid:cs}},cursor:{initialized:true,childIds:['kid']},cloud:{children:[row],family_settings:[done],checkins:[stale]}});
 await a.login();assert.equal(a.state.children.kid.checkins[day][task].completed,false);
 assert.equal(a.tables.checkins[0].completed,false,'undo must replace the stale cloud completion');
 assert.equal(await a.sync.syncAll(),true);assert.equal(a.tables.points_ledger.length,2);
 const previous=child();previous.points=9;previous.checkins[day]={[task]:{completed:true,time:oldTime,points:9,historyId:'earned'}};
 previous.pointsHistory=[{id:'earned',type:'earn',amount:9,time:oldTime}];
 const b=setup({local:{childrenList:[profile],children:{kid:previous}},cursor:{initialized:true,childIds:['kid']},cloud:a.tables});
 await b.login();assert.equal(b.state.children.kid.checkins[day][task].completed,false);
 assert.equal(b.state.children.kid.points,0);assert.equal(b.tables.points_ledger.length,2);
});
test('switching families never uploads the previous family state',async()=>{
 const s=setup({local:{childrenList:[profile],children:{kid:child()}},cursor:{initialized:true,familyId:'other-family',childIds:['kid']}});
 await s.login();assert.equal(s.state.childrenList.length,0);assert.equal(s.tables.children.length,0);
});

test('auth initialization does not run Supabase queries inside auth callback',async()=>{
 const s=setup({authLock:true});await s.login();
 assert.equal(s.sync.status().familyId,'family');
});
test('hanging cloud request releases syncing state and reports a retryable timeout',async()=>{
 const s=setup({local:{childrenList:[profile],children:{kid:child()}},cursor:{initialized:true},hangTable:'family_settings'});
 await s.login();
 const result=await Promise.race([s.sync.syncAll(),new Promise(r=>setTimeout(()=>r('never-settled'),150))]);
 assert.equal(result,false);
 assert.equal(s.sync.status().syncing,false);
 assert.match(s.sync.status().lastError,/超时/);
 assert.ok(s.signals.some(signal=>signal.aborted),'the hung request must be cancelled');
 assert.equal(s.tables.points_ledger.length,0,'failed pull must never lead to upload');
 s.setHang(null);assert.equal(await s.sync.syncAll(),true,'retry after timeout must succeed');
});
