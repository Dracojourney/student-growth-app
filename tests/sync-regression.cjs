const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../js/sync.js'),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
function setup({local,cloud={},cursor={},failTable,hangTable,authLock=false,successfulAuth=false,failReadTable}={}){
 const tables={children:[],points_ledger:[],checkins:[],redemptions:[],child_task_config:[],family_reward_config:[],family_settings:[],...clone(cloud)};
 let activeHang=hangTable,activeReadFailure=failReadTable;
 let callback,inCallback=false;const writes=[];const signals=[];
 class Query{
  constructor(table){this.table=table;this.filters=[];this.op='select';this.offset=0;this.size=1000;}
  abortSignal(signal){this.signal=signal;signals.push(signal);return this;}
  select(){return this;}eq(k,v){this.filters.push(r=>r[k]===v);return this;}in(k,vs){this.filters.push(r=>vs.includes(r[k]));return this;}
  order(){return this;}range(a,b){this.offset=a;this.size=b-a+1;return this;}maybeSingle(){this.single=true;return this;}
  upsert(rows){this.op='upsert';this.rows=Array.isArray(rows)?rows:[rows];return this;}delete(){this.op='delete';return this;}
  then(ok,bad){return Promise.resolve().then(()=>{
   if(this.table===activeReadFailure&&this.op==='select')return {error:{message:'test cloud read failure'}};
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
 const client={from:t=>new Query(t),rpc:()=>authLock&&inCallback?new Promise(()=>{}):Promise.resolve({data:'family',error:null}),auth:{onAuthStateChange:fn=>{callback=fn},signOut:()=>Promise.resolve({}),signInWithPassword:()=>successfulAuth?authenticate():Promise.resolve({error:{message:'invalid credentials'}}),signUp:()=>successfulAuth?authenticate():Promise.resolve({error:{message:'invalid signup'}})}};
 function authenticate(){const session={user:{id:'user',email:'qa@example.com'}};callback('SIGNED_IN',session);return Promise.resolve({data:{session,user:session.user},error:null});}
 const state=clone(local||{childrenList:[],children:{}});
 const ctx={console,Date,Promise,AbortController,setTimeout:(fn,ms)=>ms<=30?setTimeout(fn,ms):1,clearTimeout,SGA_SUPABASE_URL:'https://test.invalid',SGA_SUPABASE_ANON_KEY:'public',
 localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
 document:{addEventListener:()=>{}},getAppState:()=>state,saveState:()=>{},render:()=>{},
 deleteChild:id=>{state.childrenList=state.childrenList.filter(c=>c.id!==id);delete state.children[id];}};
 ctx.window=ctx;ctx.supabase={createClient:()=>client};ctx.addEventListener=()=>{};
 vm.createContext(ctx);vm.runInContext(source.replace('var REQUEST_TIMEOUT_MS = 15000;', 'var REQUEST_TIMEOUT_MS = 25;'),ctx);
 return {state,tables,writes,signals,setHang:table=>{activeHang=table},setReadFailure:table=>{activeReadFailure=table},sync:ctx.SGASync,storage,login:async()=>{inCallback=true;callback('SIGNED_IN',{user:{id:'user',email:'qa@example.com'}});inCallback=false;await new Promise(r=>setTimeout(r,5));for(let i=0;i<35;i++)await new Promise(r=>setImmediate(r));}};
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

test('login resolves only after cloud family data has loaded',async()=>{
 const s=setup({successfulAuth:true,cloud:{children:[row],family_settings:[done]}});
 await s.sync.signIn('qa@example.com','correct');
 assert.equal(s.state.childrenList[0]?.id,'kid');
 assert.ok(s.sync.status().lastSyncAt>0);
});
test('login exposes cloud initialization failure and permits a successful retry',async()=>{
 const s=setup({successfulAuth:true,failReadTable:'children',cloud:{children:[row],family_settings:[done]}});
 await assert.rejects(s.sync.signIn('qa@example.com','correct'),e=>e.message.includes('云端'));
 s.setReadFailure(null);
 await s.sync.signIn('qa@example.com','correct');
 assert.equal(s.state.childrenList[0]?.id,'kid');
});
test('auto-confirmed signup also waits for cloud initialization',async()=>{
 const s=setup({successfulAuth:true,cloud:{children:[row],family_settings:[done]}});
 await s.sync.signUp('qa@example.com','correct');
 assert.equal(s.state.childrenList[0]?.id,'kid');
});
