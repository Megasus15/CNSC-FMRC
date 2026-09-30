/* Geometry/animation checks, without a browser or production API.
 * Run from the repo root: node tools/design/check-hero-machines.cjs
 * Optional QA frame SVGs: add --frames (writes only under tmp/machine-render). */
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('home-page/hero-machine-scenes.js','utf8');
const start=source.indexOf('    function build(svg, type) {');
const end=source.indexOf('    function logo()',start);
const ease=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
const build=vm.runInNewContext(`(${source.slice(start,end).trim()})`,{sequence:0,ease,lerp:(a,b,t)=>a+(b-a)*t});
// A narrow SVG attribute harness exercises production paint() without layout.
// XML well-formedness and full layout need separate renderer/browser checks.
function artwork(type) {
  const raw=fs.readFileSync(`home-page/assets/hero-${type}-scene.svg`,'utf8');
  const nodes=[];
  const tags=[...raw.matchAll(/<([\w:-]+)\b([^<>]*?)(\/?)>/g)];
  for(const match of tags) {
    const attrs=Object.fromEntries([...match[2].matchAll(/([\w:-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
    const n={attrs,original:match[0],index:match.index,style:{},dataset:{},tag:match[1],textContent:''};
    n.setAttribute=(k,v)=>n.attrs[k]=String(v);
    n.getAttribute=k=>n.attrs[k]??null;
    n.removeAttribute=k=>delete n.attrs[k];
    Object.defineProperty(n,'id',{get:()=>n.attrs.id});
    Object.defineProperty(n,'attributes',{get:()=>Object.entries(n.attrs).map(([name,value])=>({name,value}))});
    if(n.tag==='metadata')n.textContent=raw.slice(match.index+match[0].length,raw.indexOf('</metadata>',match.index));
    nodes.push(n);
  }
  const svg=nodes[0];
  svg.querySelectorAll=selector=>nodes.slice(1).filter(n=>selector==='*'||selector==='[id]'&&n.attrs.id||selector.startsWith('.')&&(n.attrs.class||'').split(' ').includes(selector.slice(1)));
  svg.querySelector=selector=>svg.querySelectorAll(selector)[0];
  svg.serialize=()=>{
    let result=raw;
    for(const node of [...nodes].reverse()) {
      const styles=Object.entries(node.style).filter(([,v])=>v!=='').map(([k,v])=>`${k.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())}:${v}`).join(';');
      const attrs={...node.attrs,...(styles?{style:styles}:{})};
      const opening=`<${node.tag} ${Object.entries(attrs).map(([k,v])=>`${k}="${v}"`).join(' ')}${node.original.endsWith('/>')?'/':''}>`;
      if(node.tag==='text'&&node.textContent) {
        const close=result.indexOf('</text>',node.index);
        result=result.slice(0,node.index)+opening+node.textContent+result.slice(close);
      } else result=result.slice(0,node.index)+opening+result.slice(node.index+node.original.length);
    }
    return result;
  };
  return svg;
}
for(const type of ['laser','cnc']) {
  const svg=artwork(type),machine=build(svg,type);
  const m=JSON.parse(svg.querySelector('.hm-mechanics').textContent);
  const head=svg.querySelector('.hm-head'),tool=svg.querySelector('.hm-tool'),gantry=svg.querySelector('.hm-gantry');
  const translate=n=>n.getAttribute('transform').match(/-?\d+(?:\.\d+)?/g).map(Number);
  const world=n=>{
    const [sx,sy]=translate(n),[a,b]=m.projection.xAxis,[c,d]=m.projection.yAxis,det=a*d-b*c;
    return [m.head[0]+(d*sx-c*sy)/det,m.head[1]+(-b*sx+a*sy)/det];
  };
  assert.equal(m.products.length,5,'Each machine has five products');
  assert.equal(new Set(m.products.map(p=>p.id)).size,5);
  for(const product of m.products) {
    for(const loop of [product.outer,...product.holes.map(h=>h.loop)]) {
      assert.deepEqual(loop[0],loop.at(-1),'Closed finished profiles');
      loop.forEach(([x,y])=>assert(x>90&&x<260&&y>78&&y<220,'Profiles stay inside clamped stock'));
    }
  }
  const cycle=24700;
  for(let index=0;index<5;index++) {
    let last=0;
    for(let local=0;local<cycle;local+=50) {
      machine.paint(index*cycle+local,false);
      assert.equal(svg.dataset.productId,m.products[index].id);
      const [x,y]=world(head),[gx,gy]=translate(gantry);
      assert(x>=45&&x<=280&&y>=40&&y<=235,'Carriage travel stays within rails');
      assert(Math.abs(gx-(y-m.head[1])*m.projection.yAxis[0])<.002,'Head and Y gantry aligned');
      assert(Math.abs(gy-(y-m.head[1])*m.projection.yAxis[1])<.002);
      const offset=(1-Number(svg.querySelector('.hm-cut').dataset.progress))*100;
      assert(Number.isFinite(offset)&&offset>=0&&offset<=100.001);
      if(local>=1400&&local<18400){assert(offset<=100-last+.002,'Cut never reverses');last=100-offset;}
      let partial=false;
      for(const path of svg.querySelectorAll('.hm-cut-operation')) {
        if(path.style.display==='none')continue;
        const length=Number(path.style.strokeDasharray.split(' ')[0]),remaining=Number(path.style.strokeDashoffset);
        assert(remaining>=0&&remaining<=length+.001);
        if(partial)assert(remaining>=length-.001,'Later cuts stay hidden until the current operation finishes');
        if(remaining>.001)partial=true;
      }
      const phase=svg.querySelector('.hm-phase').textContent;
      if(type==='cnc') {
        const depth=translate(tool)[1];
        assert(depth>=-20&&depth<=14,'Z movement stays within flute and slide travel');
        if(phase==='ROUTING')assert(depth>0,'Tool enters stock only while routing');
        if(local<1000||local>=20000)assert.equal(depth,-20,'Safe Z during return/park');
      }
      if(type==='laser'&&phase!=='CUTTING')svg.querySelectorAll('.hm-tool-light').forEach(n=>assert.equal(n.style.visibility,'hidden','Laser off during travel'));
      if(local>=18400&&local<22200) {
        assert.equal(svg.dataset.phase,'complete');assert.equal(svg.querySelector('.hm-progress').textContent,'100%');
      }
      if(local>=22200)assert.equal(svg.dataset.phase,'resetting');
    }
    machine.paint(index*cycle+21000,true);
    assert.equal(svg.querySelector('.hm-phase').textContent,'COMPLETE');
    assert.equal(svg.querySelector('.hm-cut').dataset.progress,'1');
    if(process.argv.includes('--frames')) {
      fs.mkdirSync('tmp/machine-render',{recursive:true});
      for(const time of [0,10000,21000,24000]) {
        machine.paint(index*cycle+time,false);
        fs.writeFileSync(`tmp/machine-render/${type}-${index}-${time}.svg`,svg.serialize());
      }
    }
  }
  machine.paint(cycle*5,false);assert.equal(svg.dataset.productId,m.products[0].id,'Queue loops');
  console.log(`PASS ${type}: five full cycles, travel and Z clearance, cut advance, tool state, completion, reset, queue loop`);
}
