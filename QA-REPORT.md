# 儿童打卡项目检查与发布记录

日期：2026-10-21。项目：D:\AI Project\student_growth_app。

## 已验证

- Node 回归测试 8 项通过（tests/sync-regression.cjs）。
- Playwright 页面与按钮检查 32 项通过（26 项主流程 + 6 项编辑/排序检查）（tests/browser-regression.cjs）。
- 使用独立测试家庭进行真实 Supabase 验证 18 项通过，其中双设备/离线/配置等 13 项、账号与家庭隔离/邀请码等 5 项。
- 已实际下载 1008 条积分流水，并与云端记录数核对。
- JavaScript 语法检查、Git 差异格式检查、干净发布目录构建通过。

## 修复

1. 任务说明、奖励和其他动态内容采用 HTML 转义，图片路径与颜色受限制，阻止存储型脚本注入。
2. 积分输入拒绝小数、负数、空值，避免 parseInt 静默截断。
3. 全部任务完成后仍保留任务列表与撤销入口。
4. 孩子卡片支持 Enter/空格，表单 label 与输入框关联。
5. Supabase 认证错误正常抛出，登录失败不再误报成功；密码框支持较长密码。
6. 同步读取按确定排序分页，防止超过 API 单页限制后丢记录。
7. 拉取时保留本地待删除状态，避免孩子被旧云记录恢复。
8. 合并云端奖励撤销标记，保留撤销关联，避免界面仍显示可撤销。
9. 上传与拉取串行，上传使用稳定快照；游标以开始上传时间推进。
10. 数据全部成功上传后才写迁移完成标记；资料上传不再覆盖云端按流水计算的余额。
11. 首次登录已有家庭完整采用云端，避免把无关本地孩子写回；切换家庭时隔离同步游标并备份原本地状态。
12. 云端新增孩子立即注册任务，支持直接打卡。

## 覆盖场景

页面：打卡、重复打卡、撤销、成绩目标、切换孩子、家长密码、新增/删除孩子、初始积分、其他奖励、自定义任务启停、注入回归、奖励新增和兑换、兑换记录、修改密码、刷新保存、手机/桌面布局。

真实云端：错误密码重试、长密码登录、首次下载、超过1000条流水、奖励新增与撤销、重复并发同步、新增孩子及打卡、断网失败和恢复重试、任务配置、删除传播、云端余额核对、不同家庭RLS、账号切换与返回、邀请码加入及防止反向污染。

## 发布

站点：https://dracojourney.github.io/student-growth-app/

GitHub Actions 工作流：.github/workflows/pages.yml。每次推送 main，先检查语法和同步测试，再通过 scripts/build-pages.cjs 重建 _site，只发布 index.html、assets、css、js、vendor、.nojekyll 和 deployment.json。

旧发布内容将由这一完整产物替换，不把数据库迁移、测试、脚本、本地配置或备份放入站点。deployment.json 可用于核对线上提交。

## 使用边界

未登录的数据仍在当前浏览器 localStorage；登录后通过 Supabase 云同步。家长 PIN 是设备本地的防误操作门，不是服务端身份验证，也不跨设备同步。测试结果覆盖上述场景，不代表对所有并发竞争或数据库攻击完成形式化验证。

复跑同步测试：node --test tests/sync-regression.cjs。

Playwright 脚本导出接收 page 的异步函数；云端脚本使用测试页内临时 __qa 凭据，文件中不保存账号密码。请始终使用独立测试家庭运行云端脚本。

参考：[GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[Supabase 分页](https://supabase.com/docs/reference/javascript/using-modifiers-range)。

## 2026-10-21 退出弹窗与同步卡住修复

修复了退出验证引用不存在样式导致透明重叠的问题，补齐遮罩、卡片、取消、滚动锁和安全区。认证回调延后发起云查询，所有数据库请求添加15秒取消超时；超时释放同步状态，手动同步的异常处理和按钮恢复补齐。退出仅作用于当前设备。

本轮10项Node回归测试通过（包含认证锁、挂起请求、取消、恢复重试），Playwright12项网络挂起和真实退出操作专项检查通过，另验证错误/正确PIN、取消、手机高度适配和意外异常后按钮恢复。独立真实Supabase账号完成初始化、积分记录上传核对和重复同步；这些验证没有登录或检查用户截图中的账号数据。

参考：[Supabase认证回调阻塞说明](https://supabase.com/docs/guides/troubleshooting/why-is-my-supabase-api-call-not-returning-PGzXw0)。

## iPad 登录失败后旧数据仍显示（qa3）

已复现邮箱认证成功但云读取失败时，界面提前显示登录成功、仍保留本地数据。登录/自动确认注册现在等待云初始化，失败保留可见提示并允许重试；Safari Load failed 与密码错误分别显示。13项同步回归和8项iPad尺寸/触屏登录失败-重试场景通过，后者已在Playwright WebKit实际内核重跑通过。使用Windows Playwright WebKit26.5对真实公网测试：公共服务HTTP200，无效测试邮箱登录正常返回Invalid login credentials；这不等价于在用户的实体iPad上测试。新增“检测云连接”，使用公共key和无效测试资料探测，不读取用户输入的邮箱密码，不访问家庭数据。用户实体iPad的具体连接失败原因仍待诊断。
