/* Supabase 连接配置。
   anon key 为 publishable 公开值，设计上可随前端分发；
   service_role key 与数据库密码严禁写入任何前端文件。

   通过 Cloudflare Worker 代理访问 Supabase，绕过国内部分网络
   （家庭 WiFi、部分运营商 5G）对 *.supabase.co 域名的屏蔽。 */
const SGA_SUPABASE_URL = 'https://super.student-growth-app.workers.dev';
const SGA_SUPABASE_ANON_KEY = 'sb_publishable_gn1ozmfZAt5QiXSScbd4ag_hGQpD1m9';
