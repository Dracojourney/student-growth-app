module.exports = async(page)=>{
 const ctx=await page.context().browser().newContext({viewport:{width:390,height:700}});
 const p=await ctx.newPage();p.setDefaultTimeout(20000);
 const user={id:'11111111-1111-4111-8111-111111111111',email:'qa@invalid.example',aud:'authenticated',role:'authenticated'};
 const fid='22222222-2222-4222-8222-222222222222';
 const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const token=enc({alg:'HS256',typ:'JWT'})+'.'+enc({...user,sub:user.id,exp:Math.floor(Date.now()/1000)+3600})+'.test';
 let hang=false,held=0,writes=0,logoutScope=null;const checks=[];const check=(x,n)=>{if(!x)throw Error(n);checks.push(n)};
 await p.route('https://xrdporjhblugaauexndi.supabase.co/**',async route=>{
  const req=route.request(),u=new URL(req.url()),path=u.pathname;
  let data=null,status=200;
  if(path.endsWith('/token'))data={access_token:token,refresh_token:'qa-refresh',expires_in:3600,token_type:'bearer',user};
  else if(path.endsWith('/user'))data=user;
  else if(path.endsWith('/logout')){logoutScope=u.searchParams.get('scope');status=204;}
  else if(path.endsWith('/rpc/ensure_my_family'))data=fid;
  else if(req.method()==='GET'){
   if(path.endsWith('/family_settings')&&hang){held++;return;}
   if(path.endsWith('/family_settings'))data=[{family_id:fid,migration_state:{status:'done'}}];
   else if(path.endsWith('/families'))data=[{id:fid,owner_id:user.id,invite_code:'ABC234'}];
   else if(path.endsWith('/family_members'))data=[{user_id:user.id,email:user.email}];
   else data=[];
  }else {writes++;status=201;}
  await route.fulfill({status,contentType:'application/json',body:status===204?undefined:JSON.stringify(data)});
 });
 try{
  await p.goto('http://127.0.0.1:8931/index.html');
  await p.evaluate(async()=>SGASync.signIn('qa@invalid.example','test-password'));
  await p.waitForFunction(()=>SGASync.status().lastSyncAt>0&&!SGASync.status().syncing);
  check(await p.evaluate(()=>SGASync.status().signedIn),'登录初始化正常完成');
  await p.evaluate(()=>{verifyParent('4499');navigate('parent');openSyncSheet()});
  hang=true;const before=writes;const start=Date.now();
  await p.getByRole('button',{name:'立即同步',exact:true}).click();
  await p.getByRole('button',{name:'同步中…',exact:true}).waitFor();
  await p.getByRole('button',{name:'立即同步',exact:true}).waitFor({timeout:19000});
  const elapsed=Date.now()-start;
  check(held>0,'真正挂起数据库网络请求');
  check(elapsed>=14000&&elapsed<19000,'15秒内取消挂起请求');
  check(await p.getByRole('button',{name:'立即同步',exact:true}).isEnabled(),'超时后按钮恢复且可重试');
  check(await p.evaluate(()=>SGASync.status().lastError.includes('超时')&&!SGASync.status().syncing),'超时状态已释放并显示原因');
  check(writes===before,'拉取超时后没有上传旧数据');
  hang=false;await p.getByRole('button',{name:'立即同步',exact:true}).click();
  await p.waitForFunction(()=>document.getElementById('modal-root').hidden);
  check(await p.evaluate(()=>!SGASync.status().lastError),'恢复网络后重试成功');
  await p.evaluate(()=>openSyncSheet());await p.getByRole('button',{name:'退出登录',exact:true}).click();
  check(await p.getByRole('dialog',{name:'退出登录需家长验证'}).isVisible(),'真实退出按钮打开有语义的验证弹窗');
  check(await p.evaluate(()=>getComputedStyle(document.querySelector('.pin-card')).backgroundColor!=='rgba(0, 0, 0, 0)'),'验证卡片不透明');
  await p.getByRole('button',{name:'取消',exact:true}).click();
  check(await p.evaluate(()=>SGASync.status().signedIn),'取消退出保持登录');
  await p.evaluate(()=>openSyncSheet());await p.getByRole('button',{name:'退出登录',exact:true}).click();
  for(const n of ['4','4','9','9'])await p.getByRole('button',{name:n,exact:true}).click();
  await p.waitForFunction(()=>!SGASync.status().signedIn);
  check(logoutScope==='local','只退出当前设备，不登出其他设备');
  check(await p.evaluate(()=>!document.body.classList.contains('pin-modal-open')),'退出完成释放页面滚动');
  return {passed:checks.length,checks,timeoutMs:elapsed};
 }catch(e){return {failed:e.message,checks,status:await p.evaluate(()=>SGASync.status()),body:await p.locator('body').innerText()};}finally{await ctx.close();}
};
