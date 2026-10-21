module.exports=async(page)=>{
 const context=await page.context().browser().newContext();const p=await context.newPage();
 try{
  await p.route('**/vendor/supabase.js*',route=>route.fulfill({contentType:'application/javascript',body:`
   window.restoreWrites=[];
   const rows={family_members:[{family_id:'family'}],children:[{child_id:'yuanyuan',name:'云端孩子',points:17}],family_settings:[{migration_state:{status:'done'}}],points_ledger:[{client_id:'saved',type:'bonus',amount:17,occurred_at:'2026-10-21T17:18:00Z'}]};
   class Query { constructor(table){this.table=table;} select(){return this;}eq(){return this;}order(){return this;}range(){return this;}maybeSingle(){this.single=true;return this;}upsert(){restoreWrites.push(this.table);return this;}delete(){restoreWrites.push(this.table);return this;}then(ok,bad){return Promise.resolve({data:this.single?((rows[this.table]||[])[0]||null):(rows[this.table]||[]),error:null}).then(ok,bad);} }
   window.supabase={createClient:()=>({from:t=>new Query(t),rpc:()=>Promise.resolve({data:'family',error:null}),auth:{onAuthStateChange:callback=>setTimeout(()=>callback('SIGNED_IN',{user:{id:'fake-user',email:'fake@example.invalid'}}),0)}})};
  `}));
  await p.goto('http://127.0.0.1:8931/index.html?restore=cloud');
  await p.waitForFunction(()=>SGASync.status().familyId);
  await p.evaluate(()=>{const cs=getChildState('yuanyuan');cs.points=999;cs.pointsHistory=[{id:'pending',type:'bonus',amount:999,time:Date.now()}];saveState(getAppState());verifyParent('4499');});
  await p.getByRole('button',{name:'恢复云端数据到本机',exact:true}).click();
  await p.getByRole('button',{name:'确认恢复',exact:true}).click();
  await p.getByRole('button',{name:'核对恢复的数据',exact:true}).waitFor();
  const result=await p.evaluate(()=>({complete:SGASync.status().restoreComplete,points:getChildState('yuanyuan').points,name:getChildProfile('yuanyuan').name,writes:restoreWrites,backupPoints:JSON.parse(localStorage.getItem(SGASync.status().restoreBackupKey)).children.yuanyuan.points}));
  if(!result.complete||result.points!==17||result.backupPoints!==999||result.writes.length)throw Error(JSON.stringify(result));
  return result;
 } finally {await context.close();}
};
