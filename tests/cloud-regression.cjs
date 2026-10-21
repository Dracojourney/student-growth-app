module.exports = async(page)=>{
 const checks=[];const check=(v,label)=>{if(!v)throw Error(label);checks.push(label);};
 const creds=await page.evaluate(()=>({email:__qa.email,password:__qa.password}));
 await page.reload();await page.waitForFunction(()=>SGASync.status().familyId&&!SGASync.status().syncing);
 await page.evaluate(async(c)=>{window.__qa=c;__qa.client=window.supabase.createClient(SGA_SUPABASE_URL,SGA_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});await __qa.client.auth.signInWithPassword(c);await SGASync.syncAll()},creds);
 const ctx=await page.context().browser().newContext({viewport:{width:390,height:844}});
 const b=await ctx.newPage();b.setDefaultTimeout(8000);
 try{
 await b.goto('http://127.0.0.1:8931/index.html');
 await b.getByRole('button',{name:'家长管理',exact:true}).click();for(const n of ['4','4','9','9'])await b.getByRole('button',{name:n,exact:true}).click();
 await b.locator('[data-action=sync]').click();await b.getByLabel('邮箱',{exact:true}).fill(creds.email);await b.getByLabel('密码（至少 6 位）',{exact:true}).fill('deliberately-wrong-password');
 await b.getByRole('button',{name:'登录',exact:true}).click();await b.waitForFunction(()=>document.getElementById('toast-root').textContent.includes('邮箱或密码错误'));
 check(await b.getByRole('button',{name:'登录',exact:true}).isEnabled(),'错误密码显示失败且可重试');
 await b.getByLabel('密码（至少 6 位）',{exact:true}).fill(creds.password);await b.getByRole('button',{name:'登录',exact:true}).click();await b.waitForFunction(()=>SGASync.status().familyId&&!SGASync.status().syncing);
 check(await b.evaluate(()=>getChildState('yuanyuan').pointsHistory.length>=1008),'第二设备下载超过1000条流水');
 const bonus=await page.evaluate(async()=>{const e=grantOtherReward('yuanyuan','双设备撤销验证',23).entry;await SGASync.syncAll();return e.id});
 await b.evaluate(()=>SGASync.syncAll());check(await b.evaluate(id=>getChildState('yuanyuan').pointsHistory.some(e=>e.id===id),bonus),'A新增奖励传到B');
 await b.evaluate(async(id)=>{const r=undoOtherReward('yuanyuan',id);if(!r.success)throw Error(r.reason);await SGASync.syncAll()},bonus);
 await page.evaluate(()=>SGASync.syncAll());
 check(await page.evaluate(id=>getChildState('yuanyuan').pointsHistory.find(e=>e.id===id).revoked===true,bonus),'B撤销奖励状态传回A');
 const concurrent=await page.evaluate(()=>Promise.all([SGASync.syncAll(),SGASync.syncAll(),SGASync.syncAll()]));
 check(concurrent.every(Boolean),'重复并发同步均成功');
 const newId=await page.evaluate(async()=>{const r=addChild({name:'云端测试孩子',gender:'boy',avatar:ASSETS.avatarYuanyuan,banner:ASSETS.bannerYuanyuan},getNewChildTaskTemplate(),30);if(!r.success)throw Error(r.reason);await SGASync.syncAll();return r.child.id;});
 await b.evaluate(()=>SGASync.syncAll());check(await b.evaluate(id=>!!getChildProfile(id),newId),'新增孩子跨设备同步');
 await b.evaluate(id=>{setCurrentChild(id);navigate('checkin')},newId);
 await b.getByRole('button',{name:'打卡',exact:true}).first().click();await b.getByRole('button',{name:'好的',exact:true}).click();await b.evaluate(()=>SGASync.syncAll());await page.evaluate(()=>SGASync.syncAll());
 check(await page.evaluate(id=>getChildState(id).points===40,newId),'云端新增孩子任务立即可打卡');
 await ctx.setOffline(true);await b.evaluate(id=>grantOtherReward(id,'离线奖励',7),newId);
 const offline=await b.evaluate(()=>SGASync.syncAll());check(offline===false,'离线同步返回失败');
 await ctx.setOffline(false);check(await b.evaluate(()=>SGASync.syncAll()),'恢复网络后重试成功');await page.evaluate(()=>SGASync.syncAll());
 check(await page.evaluate(id=>getChildState(id).points===47,newId),'离线改动恢复后传到A');
 const taskId=await b.evaluate(async()=>{const r=addCustomTask('yuanyuan',{name:'云端任务',desc:'双设备配置',points:9,icon:'📝',iconBg:'#E2F2FC'});if(!r.success)throw Error(r.reason);await SGASync.syncAll();return r.task?.id||r.id;});
 await page.evaluate(()=>SGASync.syncAll());check(await page.evaluate(()=>getChildTasks('yuanyuan').some(t=>t.name==='云端任务')),'自定义任务配置同步');
 await page.evaluate(async(id)=>{deleteChild(id);await SGASync.syncAll()},newId);await b.evaluate(()=>SGASync.syncAll());check(await b.evaluate(id=>!getChildProfile(id),newId),'删除孩子传到第二设备且不复活');
 const consistency=await page.evaluate(async()=>{const fid=SGASync.status().familyId;const c=await __qa.client.from('children').select('child_id,points').eq('family_id',fid);return c.data.every(r=>getChildState(r.child_id)?.points===r.points)});
 check(consistency,'云端触发器余额与本地一致');
 return {passed:checks.length,checks};
 }catch(e){return {failed:e.message,passed:checks.length,checks,state:await b.evaluate(()=>SGASync.status())};}finally{await ctx.close();}
};
