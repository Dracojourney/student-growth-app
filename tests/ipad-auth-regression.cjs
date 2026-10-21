module.exports = async(page)=>{
 const ctx=await page.context().browser().newContext({viewport:{width:1024,height:1366},isMobile:true,hasTouch:true});
 const p=await ctx.newPage(),checks=[];p.setDefaultTimeout(20000);
 const check=(x,n)=>{if(!x)throw Error(n);checks.push(n)};
 const user={id:'11111111-1111-4111-8111-111111111111',email:'qa@invalid.example',aud:'authenticated',role:'authenticated'};
 const fid='22222222-2222-4222-8222-222222222222',enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const token=enc({alg:'HS256',typ:'JWT'})+'.'+enc({...user,sub:user.id,exp:Math.floor(Date.now()/1000)+3600})+'.test';
 let mode='network';
 await p.route('https://xrdporjhblugaauexndi.supabase.co/**',async r=>{
  const req=r.request(),path=new URL(req.url()).pathname;let data=null,status=200;
  if(path.endsWith('/token')){
   if(mode==='network')return r.abort('failed');
   if(mode==='password'){status=400;data={error:'invalid_grant',error_description:'Invalid login credentials',msg:'Invalid login credentials'};}
   else data={access_token:token,refresh_token:'qa-refresh',expires_in:3600,token_type:'bearer',user};
  }else if(path.endsWith('/user'))data=user;
  else if(path.endsWith('/rpc/ensure_my_family'))data=fid;
  else if(req.method()==='GET'){
   if(path.endsWith('/family_settings'))data=[{migration_state:{status:'done'}}];
   else if(path.endsWith('/children')){
    if(mode==='cloudFailure'){status=500;data={message:'测试：云端读取失败'};}
    else data=[{family_id:fid,child_id:'remote-kid',name:'云端孩子',points:30,avatar:'assets/7f6a586da67e68725726b453a7f7e552596926e1.jpg',banner:'assets/b46a96378349883a9aeacdd698817ecd6c79328d.png'}];
   }else if(path.endsWith('/points_ledger'))data=[{family_id:fid,child_id:'remote-kid',client_id:'cloud-initial',type:'initial',amount:30,occurred_at:'2026-10-21T00:00:00Z'}];
   else data=[];
  }else status=201;
  await r.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 try{
  await p.goto('http://127.0.0.1:8931/index.html');
  await p.evaluate(()=>{addChild({name:'本机旧孩子'},getNewChildTaskTemplate(),11);verifyParent('4499');navigate('parent');openSyncSheet()});
  await p.getByLabel('邮箱',{exact:true}).fill(user.email);await p.getByLabel('密码（至少 6 位）',{exact:true}).fill('test-password');
  await p.getByRole('button',{name:'登录',exact:true}).click();
  await p.getByRole('status').filter({hasText:'无法连接云同步服务'}).waitFor();
  check(await p.getByRole('button',{name:'登录',exact:true}).isEnabled(),'网络失败后恢复登录按钮');
  check(await p.evaluate(()=>!document.getElementById('modal-root').hidden&&!SGASync.status().signedIn),'网络失败不误报登录成功');
  mode='password';await p.getByRole('button',{name:'登录',exact:true}).click();
  await p.getByRole('status').filter({hasText:'邮箱或密码错误'}).waitFor();check(true,'密码错误与网络失败明确区分');
  mode='cloudFailure';await p.getByRole('button',{name:'登录',exact:true}).click();
  await p.getByRole('status').filter({hasText:'账号已登录，但云端数据尚未加载'}).waitFor();
  check(await p.evaluate(()=>!document.getElementById('modal-root').hidden),'云读取失败保留错误说明而不关闭弹窗');
  check(await p.evaluate(()=>getChildren().some(c=>c.name==='本机旧孩子')),'失败时保留本机旧数据');
  mode='healthy';await p.getByRole('button',{name:'登录',exact:true}).click();
  await p.waitForFunction(()=>document.getElementById('modal-root').hidden);
  check(await p.evaluate(()=>getChildren().length===1&&getChildren()[0].name==='云端孩子'),'成功后展示云端家庭且移除旧本机孩子');
  check(await p.evaluate(()=>getChildState('remote-kid').points===30),'云端积分加载正确');
  check(await p.evaluate(()=>document.getElementById('toast-root').textContent.includes('登录并同步成功')),'云端加载完成后才提示成功');
  return {passed:checks.length,checks};
 }catch(e){return {failed:e.message,checks,body:await p.locator('body').innerText()};}finally{await ctx.close();}
};
