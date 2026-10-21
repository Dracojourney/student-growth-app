const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'_site');
if(path.dirname(out)!==root||path.basename(out)!=='_site')throw Error('Unexpected publish directory');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out);
for(const name of ['index.html','.nojekyll','css/styles.css','js/data.js','js/store.js','js/config.js','js/sync.js','js/app.js','vendor/supabase.js']){fs.mkdirSync(path.dirname(path.join(out,name)),{recursive:true});fs.copyFileSync(path.join(root,name),path.join(out,name));}
fs.cpSync(path.join(root,'assets'),path.join(out,'assets'),{recursive:true,filter:source=>fs.statSync(source).isDirectory()||/\.(png|jpe?g|webp|gif|svg|avif|woff2?)$/i.test(source)});
const commit=process.env.GITHUB_SHA||cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
fs.writeFileSync(path.join(out,'deployment.json'),JSON.stringify({commit,builtAt:new Date().toISOString()},null,2));
const config=fs.readFileSync(path.join(out,'js/config.js'),'utf8');
const jwt=config.match(/SGA_SUPABASE_ANON_KEY\s*=\s*'([^']+)'/);
if(jwt&&jwt[1].split('.').length===3){const payload=JSON.parse(Buffer.from(jwt[1].split('.')[1],'base64url').toString());if(payload.role!=='anon')throw Error('Only the public anonymous key may be published');}
const html=fs.readFileSync(path.join(out,'index.html'),'utf8');
for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)){const url=match[1].split('?')[0];if(!/^https?:/.test(url)&&!fs.existsSync(path.join(out,url)))throw Error('Missing static file '+url);}
if(fs.existsSync(path.join(out,'supabase'))||fs.existsSync(path.join(out,'.git')))throw Error('Unexpected development files');
console.log('Clean Pages artifact ready: '+out);
