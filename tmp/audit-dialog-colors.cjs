const fs=require('fs'),path=require('path'),postcss=require('../backend/node_modules/postcss');
const gold=([r,g,b,a=1])=>r>170&&g>130&&g-b>20&&g>r*.6&&a>0;
for(const dir of ['home-page','products-page','customer-auth','services-page','about-page','contact-page'])for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.css'))){
 const file=path.join(dir,name);postcss.parse(fs.readFileSync(file,'utf8')).walkDecls(d=>{
  if(!/border|outline/.test(d.prop)||!d.parent.selector||/::after|::before/.test(d.parent.selector))return;
  const hex=[...d.value.matchAll(/#([\da-f]{3,8})\b/gi)].map(m=>{let h=m[1];if(h.length===3)h=h.split('').map(x=>x+x).join('');return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16));});
  const rgb=[...d.value.matchAll(/rgba?\(([^)]+)\)/g)].map(m=>m[1].match(/[\d.]+/g)?.map(Number)||[]);
  if([...hex,...rgb].some(gold))console.log(file+':'+d.source.start.line,d.parent.selector.replace(/\s+/g,' ').slice(0,130),d.prop+':'+d.value);
 });
}
