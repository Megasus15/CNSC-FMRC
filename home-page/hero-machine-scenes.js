/* Alternative machines share the printer's projection, palette and lifecycle.
 * Only the selected scene runs; no WebGL context or third-party model is needed. */
(() => {
  'use strict';
  const source = new URL('.', document.currentScript.src);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const labels = { printer: '3D printer building product designs', laser: 'Laser cutter making five precision-cut products', cnc: 'CNC router making five wooden products' };
  const cache = new Map();
  let sequence = 0;
  const ease = t => { t = Math.max(0, Math.min(1, t)); return t*t*(3-2*t); };
  const lerp = (a,b,t) => a+(b-a)*t;
  const selected = scene => Object.hasOwn(labels, scene.dataset.machine) ? scene.dataset.machine : 'printer';
  function load(type) {
    if (!cache.has(type)) {
      const pending = fetch(new URL(`assets/hero-${type}-scene.svg?v=1.1`, source)).then(response => {
        if (!response.ok) throw new Error('Machine artwork unavailable');
        return response.text();
      }).then(text => {
        const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
        if (doc.querySelector('parsererror') || doc.documentElement.getAttribute('viewBox') !== '0 0 960 760') throw new Error('Invalid machine artwork');
        return doc.documentElement;
      }).catch(error => { cache.delete(type); throw error; });
      cache.set(type, pending);
    }
    return cache.get(type);
  }
  function initialize(scene) {
    const machines = new Map();
    let desired = '', current = null, frame = 0, previous = 0, visible = true, scrolling = false, timer = 0, request = 0;
    const live = () => current && selected(scene) !== 'printer' && scene.dataset.motion !== 'off' && scene.dataset.machinePower !== 'off' && !reduced.matches && !document.hidden && visible && !scrolling && scene.isConnected;
    function build(svg, type) {
      // Separate paint-server IDs when an editor contains more than one scene.
      const prefix = `machine-${++sequence}-`;
      const ids = new Map([...svg.querySelectorAll('[id]')].map(node => [node.id, prefix+node.id]));
      svg.querySelectorAll('*').forEach(node => {
        for (const attribute of [...node.attributes]) {
          let value = attribute.value;
          for (const [id,next] of ids) value = value.replaceAll(`url(#${id})`, `url(#${next})`);
          if (attribute.name === 'id') value = ids.get(value) || value;
          node.setAttribute(attribute.name, value);
        }
      });
      svg.setAttribute('class', 'hero-machine-art');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      const m = JSON.parse(svg.querySelector('.hm-mechanics').textContent);
      const {origin, xAxis, yAxis} = m.projection;
      const project = (x,y,z=0) => [origin[0]+x*xAxis[0]+y*yAxis[0], origin[1]+x*xAxis[1]+y*yAxis[1]-z];
      const node = selector => svg.querySelector(selector);
      const head=node('.hm-head'),gantry=node('.hm-gantry'),cut=node('.hm-cut'),trace=node('.hm-screen-trace');
      const cable=node('.hm-cable'),progress=node('.hm-progress'),phase=node('.hm-phase'),fill=node('.hm-progress-fill');
      const tool=node('.hm-tool'),glint=node('.hm-spindle-glint'),stock=node('.hm-stock');
      const productNodes=svg.querySelectorAll('.hm-finished-product');
      const cuts=svg.querySelectorAll('.hm-cut-operation'),traces=svg.querySelectorAll('.hm-screen-operation');
      const lights=svg.querySelectorAll('.hm-tool-light');
      cut.removeAttribute('pathLength');trace.removeAttribute('pathLength');
      const screenPoint=p=>[10+(p[0]-95)*.23,31+(p[1]-90)*.19];
      const pathFor=(points,projection)=>points.map((p,i)=>(i?'L':'M')+projection(p).join(',')).join(' ');
      const CYCLE=24700,APPROACH=1400,WORK=17000,END=APPROACH+WORK,RETRACT=1600,HOLD=2200,RESET=2500;
      function operation(points,depth) {
        const lengths=points.slice(1).map((p,i)=>Math.hypot(p[0]-points[i][0],p[1]-points[i][1]));
        const projected=points.slice(1).map((p,i)=>{const a=project(...points[i]),b=project(...p);return Math.hypot(b[0]-a[0],b[1]-a[1]);});
        const mini=points.slice(1).map((p,i)=>{const a=screenPoint(points[i]),b=screenPoint(p);return Math.hypot(b[0]-a[0],b[1]-a[1]);});
        return {points,depth,lengths,projected,mini,total:lengths.reduce((a,b)=>a+b,0),length:projected.reduce((a,b)=>a+b,0),miniLength:mini.reduce((a,b)=>a+b,0)};
      }
      function pocketPath(loop) {
        // Concentric clearing passes stay inside these rounded, convex pockets.
        const vertices=loop.slice(0,-1),cx=vertices.reduce((a,p)=>a+p[0],0)/vertices.length,cy=vertices.reduce((a,p)=>a+p[1],0)/vertices.length;
        const radius=Math.max(...vertices.map(p=>Math.hypot(p[0]-cx,p[1]-cy)));
        const count=Math.max(2,Math.ceil(radius/3));
        return Array.from({length:count},(_,i)=>loop.map(p=>[cx+(p[0]-cx)*(i+1)/count,cy+(p[1]-cy)*(i+1)/count])).flat();
      }
      const jobs=m.products.map(product=>{
        const operations=[];
        for(const hole of product.holes) {
          const points=type==='cnc'&&hole.depth<m.thickness&&product.id!=='wave-sign'?pocketPath(hole.loop):hole.loop;
          const passes=type==='cnc'?Math.ceil(hole.depth/5):1;
          for(let pass=1;pass<=passes;pass++)operations.push(operation(points,hole.depth*pass/passes));
        }
        const passes=type==='cnc'?3:1;
        for(let pass=1;pass<=passes;pass++)operations.push(operation(product.outer,m.thickness*pass/passes));
        const distance=operations.reduce((sum,op)=>sum+op.total,0),travel=600;
        const cuttingTime=WORK-(operations.length-1)*travel;
        let at=APPROACH,drawn=0,miniDrawn=0;
        operations.forEach((op,i)=>{
          op.start=at;op.duration=cuttingTime*op.total/distance;op.drawn=drawn;op.miniDrawn=miniDrawn;
          drawn+=op.length;miniDrawn+=op.miniLength;at+=op.duration+(i<operations.length-1?travel:0);
        });
        return {product,operations,travel,total:drawn,miniTotal:miniDrawn};
      });
      let index=-1,job,lastPercent=-1,lastPhase='';
      function select(next) {
        if(index===next)return;
        index=next;job=jobs[index];lastPercent=-1;lastPhase='';
        productNodes.forEach((product,i)=>product.style.display=i===index?'':'none');
        node('.hm-product-name').textContent=job.product.name;
        node('.hm-queue').textContent=`${index+1}/5`;
        svg.dataset.productId=job.product.id;
        cuts.forEach((path,i)=>{
          const op=job.operations[i],mini=traces[i];
          path.style.display=mini.style.display=op?'':'none';
          if(!op)return;
          path.setAttribute('d',pathFor(op.points,p=>project(...p,m.cutZ)));
          mini.setAttribute('d',pathFor(op.points,screenPoint));
          path.style.strokeDasharray=`${op.length} ${op.length}`;
          mini.style.strokeDasharray=`${op.miniLength} ${op.miniLength}`;
        });
        node('.hm-screen-outline').setAttribute('d',pathFor(job.product.outer,screenPoint));
      }
      function pointAt(op,q) {
        let distance=q*op.total,i=0,drawn=0,mini=0;
        while(i<op.lengths.length-1&&distance>op.lengths[i]){distance-=op.lengths[i];drawn+=op.projected[i];mini+=op.mini[i++];}
        const f=op.lengths[i]?Math.min(1,distance/op.lengths[i]):0;
        return {point:op.points[i].map((v,j)=>lerp(v,op.points[i+1][j],f)),drawn:drawn+op.projected[i]*f,mini:mini+op.mini[i]*f};
      }
      const transform=(element,x,y)=>element.setAttribute('transform',`translate(${x.toFixed(3)} ${y.toFixed(3)})`);
      function paint(elapsed,still) {
        select(Math.floor(elapsed/CYCLE)%jobs.length);
        const t=elapsed%CYCLE,first=job.operations[0],last=job.operations.at(-1);
        let world=m.park,lift=20,drawn=0,miniDrawn=0,cutting=false;
        if(still){drawn=job.total;miniDrawn=job.miniTotal;}
        else if(t<APPROACH){
          world=m.park.map((v,i)=>lerp(v,first.points[0][i],ease(t/1000)));
          lift=lerp(20,-first.depth,ease((t-1000)/400));
        } else if(t<END){
          const oi=job.operations.findIndex(op=>t<op.start+op.duration+job.travel);
          const op=job.operations[Math.max(0,oi)],local=t-op.start;
          if(local<=op.duration){
            const q=ease(local/op.duration),point=pointAt(op,q);
            world=point.point;drawn=op.drawn+point.drawn;miniDrawn=op.miniDrawn+point.mini;
            lift=-op.depth;cutting=true;
          } else {
            const next=job.operations[oi+1]||op,r=(local-op.duration)/job.travel;
            world=op.points.at(-1).map((v,i)=>lerp(v,next.points[0][i],ease((r-.25)/.5)));
            lift=r<.25?lerp(-op.depth,20,ease(r/.25)):r>.75?lerp(20,-next.depth,ease((r-.75)/.25)):20;
            drawn=op.drawn+op.length;miniDrawn=op.miniDrawn+op.miniLength;
          }
        } else {
          drawn=job.total;miniDrawn=job.miniTotal;
          lift=lerp(-last.depth,20,ease((t-END)/500));
          world=last.points.at(-1).map((v,i)=>lerp(v,m.park[i],ease((t-END-500)/1100)));
        }
        const q=Math.min(1,drawn/job.total),done=still||t>=END;
        const reset=!still&&t>=END+RETRACT+HOLD;
        const clear=still?1:ease((t-END-RETRACT)/600);
        const fade=reset?1-ease((t-END-RETRACT-HOLD)/1000):1;
        const reload=reset?ease((t-END-RETRACT-HOLD-1000)/1500):0;
        stock.style.opacity=String(reset?reload:1-clear);
        productNodes[index].setAttribute('opacity',String(clear*fade));
        cut.style.opacity=String(reset?fade:1-clear);
        const dx=world[0]-m.head[0],dy=world[1]-m.head[1];
        const hx=dx*xAxis[0]+dy*yAxis[0],hy=dx*xAxis[1]+dy*yAxis[1];
        transform(head,hx,hy);transform(tool,0,type==='cnc'?-lift:0);
        transform(gantry,dy*yAxis[0],dy*yAxis[1]);
        const end=[m.cableEnd[0]+hx,m.cableEnd[1]+hy];
        const control=type==='laser'?project((350+world[0])/2,(20+world[1])/2,260):[(m.cableStart[0]+end[0])/2,Math.min(m.cableStart[1],end[1])-65];
        cable.setAttribute('d',`M${m.cableStart.join(',')}Q${control.join(',')} ${end.join(',')}`);
        job.operations.forEach((op,i)=>{
          const amount=Math.max(0,Math.min(op.length,drawn-op.drawn));
          const small=Math.max(0,Math.min(op.miniLength,miniDrawn-op.miniDrawn));
          cuts[i].style.strokeDashoffset=(op.length-amount).toFixed(3);
          traces[i].style.strokeDashoffset=(op.miniLength-small).toFixed(3);
          cuts[i].style.visibility=amount>0?'visible':'hidden';
          traces[i].style.visibility=small>0?'visible':'hidden';
        });
        cut.dataset.progress=String(q);
        lights.forEach(light=>light.style.visibility=cutting?'visible':'hidden');
        if(glint)glint.style.opacity=cutting?String(.45+.45*Math.sin(elapsed/95)):'1';
        const displayQ=reset?1-ease((t-END-RETRACT-HOLD)/RESET):q;
        const percent=done&&!reset?100:Math.min(99,Math.floor(displayQ*100));
        if(percent!==lastPercent){progress.textContent=`${percent}%`;fill.setAttribute('width',String(displayQ*78));lastPercent=percent;}
        const state=still?'COMPLETE':t<APPROACH?'POSITIONING':t<END?(cutting?(type==='laser'?'CUTTING':'ROUTING'):'POSITIONING'):reset?'RESETTING':'COMPLETE';
        if(state!==lastPhase){phase.textContent=state;lastPhase=state;}
        svg.dataset.phase=done&&!reset?'complete':reset?'resetting':'working';
      }
      return {svg,paint,elapsed:0};
    }
    function logo() {
      const original=scene.querySelector('.hero-printer-logo');
      if (original) machines.forEach(machine=>machine.svg.querySelector('.hm-logo').setAttribute('href', original.src));
    }
    const tick = now => {
      frame=0;
      if(!live()) return;
      if(previous) current.elapsed+=Math.min(64,now-previous);
      previous=now;
      current.paint(current.elapsed,false);
      frame=requestAnimationFrame(tick);
    };
    function sync() {
      cancelAnimationFrame(frame);frame=0;previous=0;
      if(current) {
        const still=scene.dataset.motion==='off'||reduced.matches;
        current.paint(current.elapsed,still);
        current.svg.dataset.running=String(Boolean(live()));
      }
      if(live()) frame=requestAnimationFrame(tick);
    }
    async function choose() {
      const type=selected(scene);
      scene.setAttribute('aria-label', labels[type]);
      scene.setAttribute('role','group');
      if(type===desired) { sync();return; }
      desired=type;
      const revision=++request;
      current=null;
      machines.forEach(machine=>machine.svg.style.display='none');
      scene.dataset.machineReady='false';
      sync();
      if(type==='printer') return;
      try {
        if(!machines.has(type)) {
          const svg=document.importNode(await load(type),true);
          if(revision!==request) return;
          const machine=build(svg,type);
          machines.set(type,machine);scene.appendChild(svg);
        }
        if(revision!==request) return;
        current=machines.get(type);current.svg.style.display='';
        scene.dataset.machineReady='true';logo();sync();
      } catch(error) {
        // Keep the original illustration visible if an asset is unavailable.
        scene.dataset.machineReady='false';
        scene.setAttribute('aria-label',labels.printer);
        desired='';
        console.warn('Hero machine artwork could not be loaded.',error);
      }
    }
    new MutationObserver(choose).observe(scene,{attributes:true,attributeFilter:['data-machine','data-motion','data-machine-power']});
    const original=scene.querySelector('.hero-printer-logo');
    if(original) new MutationObserver(logo).observe(original,{attributes:true,attributeFilter:['src']});
    reduced.addEventListener('change',sync);
    document.addEventListener('visibilitychange',sync);
    window.addEventListener('scroll',()=>{
      scrolling=true;sync();clearTimeout(timer);
      timer=setTimeout(()=>{scrolling=false;sync();},150);
    },{passive:true});
    if('IntersectionObserver' in window) new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;sync();}).observe(scene);
    choose();
  }
  function init() { document.querySelectorAll('.fmrc-hero-scene').forEach(initialize); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
