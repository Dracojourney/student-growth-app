const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const upstream='https://xrdporjhblugaauexndi.supabase.co',gateway='https://student-growth-app.netlify.app/cloud';
function setup(enabled=true){let transport;const calls=[];
 const ctx={Promise,Date,AbortController,Request,setTimeout,clearTimeout,SGA_SUPABASE_URL:upstream,SGA_SUPABASE_ANON_KEY:'public',
 document:{addEventListener(){}},localStorage:{getItem(){return null}},addEventListener(){},fetch:async(input,options)=>{calls.push({input,options});return {status:200};}};
 if(enabled)ctx.SGA_SUPABASE_GATEWAY=gateway;
 ctx.window=ctx;ctx.supabase={createClient:(url,key,options)=>{assert.equal(url,upstream);transport=options.global.fetch;return {auth:{onAuthStateChange(){}}};}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('js/sync.js','utf8'),ctx);
 return {fetch:(...args)=>transport(...args),calls};
}
test('auth and database requests use gateway once, preserving credentials, query and body',async()=>{
 const env=setup();
 for(const path of ['/auth/v1/token?grant_type=password','/rest/v1/children?on_conflict=family_id,child_id']){
  const body='{"test":"fake-only"}',headers={authorization:'Bearer test-token'};
  await env.fetch(upstream+path,{method:'POST',headers,body});
  const call=env.calls.at(-1);assert.equal(call.input,gateway+path);assert.equal(call.options.body,body);assert.equal(call.options.headers,headers);
 }
 assert.equal(env.calls.length,2);
});
test('unconfigured transport and unrelated URLs keep their original destination',async()=>{
 const direct=setup(false);await direct.fetch(upstream+'/auth/v1/settings');assert.equal(direct.calls[0].input,upstream+'/auth/v1/settings');
 const routed=setup();await routed.fetch('https://example.invalid/test');assert.equal(routed.calls[0].input,'https://example.invalid/test');
});
test('Request input preserves cancellation and routes to same fixed gateway',async()=>{
 const env=setup(),controller=new AbortController();controller.abort();
 await env.fetch(new Request(upstream+'/auth/v1/user',{signal:controller.signal,headers:{authorization:'Bearer fake-only'}}));
 const call=env.calls[0];assert.equal(call.input.url,gateway+'/auth/v1/user');assert.equal(call.input.headers.get('authorization'),'Bearer fake-only');assert.equal(call.options.signal.aborted,true);
});
