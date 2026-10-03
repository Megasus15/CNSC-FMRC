/* Shared product build loop. Geometry, nozzle and bed use one world projection. */
(function () {
  "use strict";
  const SVG = "http://www.w3.org/2000/svg";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const artwork = new Map();
  const clamp = v => Math.max(0, Math.min(1, v));
  const ease = v => { const t=clamp(v); return t*t*(3-2*t); };
  const lerp = (a,b,t) => a+(b-a)*t;
  const ps = p => p.map(v=>v.toFixed(3)).join(" ");
  const path = points => points.map((p,i)=>(i?"L":"M")+ps(p)).join(" ")+"Z";
  function el(tag,attrs,parent) {
    const node=document.createElementNS(SVG,tag);
    for(const [k,v] of Object.entries(attrs)) node.setAttribute(k,v);
    if(parent) parent.appendChild(node);
    return node;
  }
  // Avoid invalidating SVG styles/layout when a value has not changed.
  const attributes=new WeakMap();
  function attr(node,name,value){
    value=String(value);
    let cache=attributes.get(node);
    if(!cache){cache=new Map();attributes.set(node,cache);}
    if(cache.get(name)!==value){node.setAttribute(name,value);cache.set(name,value);}
  }
  function text(node,value){if(node.textContent!==value) node.textContent=value;}
  const circle=(r,n=40)=>Array.from({length:n},(_,i)=>{
    const a=i/n*Math.PI*2; return [Math.cos(a)*r,Math.sin(a)*r];
  });
  const rect=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
  const cream=["#f5e4c4","#d6b583","#b18b60","#806140"];
  const gold=["#f1d497","#d6af67","#a97943","#70502f"];
  const maroon=["#c17e89","#a65e71","#753b51","#49283a"];
  // Printable cross sections, including holes, are shared by mesh and toolpath.
  const PRODUCTS=[
    {id:"gear",name:"GEAR",height:27,material:gold,profile(){
      const rim=Array.from({length:40},(_,i)=>{
        const a=i/40*Math.PI*2,r=i%4===1||i%4===2?35:29;
        return [Math.cos(a)*r,Math.sin(a)*r];
      });
      return [rim,circle(10,24)];
    }},
    {id:"vase",name:"VASE",height:62,material:cream,profile(q){
      const r=22+9*Math.sin(q*Math.PI*1.7)+10*q*q;
      return [circle(r),circle(q>.08?r-4:.15)];
    }},
    {id:"phone-stand",name:"PHONE STAND",height:55,material:maroon,profile(q){
      const back=-26+20*q,front=q<.14?26:lerp(26,back+9,ease((q-.14)/.15));
      return [rect(-30,back,30,front)];
    }},
    {id:"trophy",name:"TROPHY",height:61,material:gold,profile(q){
      const r=q<.12?24:q<.3?lerp(24,9,(q-.12)/.18):q<.46?9:lerp(9,31,(q-.46)/.54);
      return [circle(r),circle(q>.59?Math.max(.15,r-4):.15)];
    }},
    {id:"organizer",name:"DESK CADDY",height:47,material:cream,profile(q){
      const h=q>.09?1:.005;
      return [rect(-34,-26,34,26),rect(-30*h,-22*h,-3*h,22*h),rect(3*h,-22*h,30*h,22*h)];
    }}
  ];
  function loadArtwork(url){
    if(!artwork.has(url.href)) artwork.set(url.href,
      fetch(url.href,{credentials:"same-origin"}).then(r=>{
        if(!r.ok) throw new Error("Printer artwork unavailable"); return r.text();
      }).then(source=>{
        const doc=new DOMParser().parseFromString(source,"image/svg+xml"),svg=doc.documentElement;
        if(doc.querySelector("parsererror")||svg.localName!=="svg"||svg.getAttribute("viewBox")!=="0 0 960 760")
          throw new Error("Invalid printer artwork");
        return svg;
      }));
    return artwork.get(url.href);
  }
  async function enhance(scene){
    const fallback=scene.querySelector("img.hero-printer-art");
    if(!fallback||scene.dataset.mechanism) return;
    const url=new URL(fallback.src,location.href);
    if(url.origin!==location.origin||!url.pathname.endsWith("/assets/hero-printer-scene.svg")) return;
    scene.dataset.mechanism="loading";
    try{
      const svg=document.importNode(await loadArtwork(url),true);
      svg.setAttribute("class","hero-printer-mechanism"); svg.setAttribute("aria-hidden","true"); svg.setAttribute("focusable","false");
      const head=svg.querySelector(".hp-printhead"),gantry=svg.querySelector(".hp-gantry");
      const platform=svg.querySelector(".hp-build-platform"),slot=svg.querySelector(".hp-product-slot");
      const tubes=svg.querySelectorAll(".hp-filament-flex"),trail=svg.querySelector(".hp-deposition-path");
      const mini=svg.querySelector(".hp-screen-product"),progressReadout=svg.querySelector(".hp-screen-progress");
      const progressFill=svg.querySelector(".hp-screen-fill"),phaseReadout=svg.querySelector(".hp-screen-phase");
      const nameReadout=svg.querySelector(".hp-screen-product-name"),queueReadout=svg.querySelector(".hp-screen-queue");
      const traceCursor=svg.querySelector(".hp-screen-cursor"),tracePath=svg.querySelector(".hp-screen-toolpath");
      const mechanics=JSON.parse(svg.querySelector("#hp-mechanics")?.textContent||"null");
      const pair=v=>Array.isArray(v)&&v.length===2&&v.every(Number.isFinite);
      if(!head||!gantry||!platform||!slot||!mini||!trail||!tubes.length||
          !pair(mechanics?.projection?.origin)||!pair(mechanics.projection.xAxis)||!pair(mechanics.projection.yAxis)||
          !pair(mechanics.build?.center)||!pair(mechanics.build.head)||!pair(mechanics.build.park)||
          !Number.isFinite(mechanics.build.baseZ)||!Number.isFinite(mechanics.build.nozzleZ)||
          !Number.isInteger(mechanics.build.layerCount)||mechanics.build.layerCount<1)
        throw new Error("Printer build geometry missing");
      const {origin,xAxis,yAxis}=mechanics.projection,build=mechanics.build;
      const project=(x,y,z=0)=>[x*xAxis[0]+y*yAxis[0],x*xAxis[1]+y*yAxis[1]-z];
      const delta=project(...build.center,build.baseZ),anchor=[origin[0]+delta[0],origin[1]+delta[1]];
      const height=build.nozzleZ-build.baseZ,logo=mechanics.logo;
      const badge=scene.querySelector(".hero-printer-badge");
      scene.style.setProperty("--hero-logo-x",logo.x/960*100+"%");
      scene.style.setProperty("--hero-logo-y",logo.y/760*100+"%");
      scene.style.setProperty("--hero-logo-width",logo.width/960*100+"%");
      scene.style.setProperty("--hero-logo-height",logo.height/760*100+"%");
      scene.style.setProperty("--hero-logo-perspective","matrix("+logo.matrix.join(",")+")");
      const productGroup=el("g",{class:"hp-product-build"},slot);
      const productModel=el("g",{class:"hp-product-model"},productGroup);
      const activeLayer=el("g",{class:"hp-active-layer"},productModel);
      const shadow=el("path",{fill:"#211321",opacity:".15"});
      slot.insertBefore(shadow,productGroup);
      // Cache completed slices. Only the four active surface paths change per frame.
      function sliceNodes(parent,product){
        return [3,2,1,0].map((m,i)=>el("path",{fill:product.material[m],"fill-rule":"evenodd",
          stroke:i===3?product.material[1]:"none","stroke-width":".3","stroke-linejoin":"round"},parent));
      }
      function slicePaths(product,q0,q1){
        const lower=product.profile(q0),upper=product.profile(q1),z0=q0*product.height,z1=q1*product.height;
        const faces=[[],[],[],[]];
        upper.forEach((loop,hole)=>{
          faces[3].push(path(loop.map(p=>project(...p,z1))));
          loop.forEach((point,i)=>{
            const next=loop[(i+1)%loop.length],dx=next[0]-point[0],dy=next[1]-point[1];
            if((dy*.4-dx*.28)*(hole?-1:1)<=0) return;
            faces[hole?0:dy>0?1:2].push(path([project(...lower[hole][i],z0),
              project(...lower[hole][(i+1)%loop.length],z0),project(...next,z1),project(...point,z1)]));
          });
        });
        return faces.map(face=>face.join(" "));
      }
      function drawSlice(nodes,product,q0,q1){
        slicePaths(product,q0,q1).forEach((d,i)=>attr(nodes[i],"d",d));
      }
      const BUILD_STEPS=build.layerCount*8;
      const geometryCache=new Map();
      let currentIndex=-1,layers=[],activeNodes=[],shownLayers=-1,shownGeometry=null;
      function selectProduct(index){
        if(currentIndex===index) return;
        currentIndex=index;
        geometryCache.clear(); shownGeometry=null;
        const product=PRODUCTS[index];
        shadow.setAttribute("d",path(product.profile(0)[0].map(p=>{
          const xy=project(...p); return [anchor[0]+xy[0]+2,anchor[1]+xy[1]+1];
        })));
        productModel.replaceChildren();
        layers=Array.from({length:build.layerCount},(_,i)=>{
          const layer=el("g",{class:"hp-product-layer","data-layer":i},productModel);
          drawSlice(sliceNodes(layer,product),product,i/build.layerCount,(i+1)/build.layerCount);
          return layer;
        });
        // Show the same complete mesh on the monitor, not a generic stack icon.
        const miniature=productModel.cloneNode(true);
        miniature.removeAttribute("class"); mini.replaceChildren(miniature);
        const fit=Math.min(35/103,36/(product.height+34));
        mini.setAttribute("transform","translate(98 62) scale("+fit+")");
        mini.dataset.productId=product.id; productGroup.dataset.productId=product.id;
        productModel.appendChild(activeLayer); activeLayer.replaceChildren();
        activeNodes=sliceNodes(activeLayer,product); shownLayers=-1;
        nameReadout.textContent=product.name; queueReadout.textContent=(index+1)+"/"+PRODUCTS.length;
      }
      trail.setAttribute("pathLength","100"); trail.style.strokeDasharray="100 100";
      slot.appendChild(trail);
      scene.insertBefore(svg,fallback); scene.dataset.mechanism="ready";
      const PRINT=16000,COMPLETE=2200,EXIT=1100,RESET=1400,CYCLE=PRINT+COMPLETE+EXIT+RESET;
      const endpoints=PRODUCTS.map(product=>({start:product.profile(0)[0][0],end:product.profile(1)[0][0]}));
      function geometryFor(product,step){
        if(geometryCache.has(step)) return geometryCache.get(step);
        const q=step/BUILD_STEPS;
        const points=product.profile(q)[0];
        const lengths=points.map((p,i)=>{const n=points[(i+1)%points.length];return Math.hypot(n[0]-p[0],n[1]-p[1]);});
        const projected=points.map((p,i)=>{const n=points[(i+1)%points.length];return Math.hypot(...project(n[0]-p[0],n[1]-p[1]));});
        const geometry={points,lengths,projected,total:lengths.reduce((a,b)=>a+b,0),projectedTotal:projected.reduce((a,b)=>a+b,0),
          surfaces:slicePaths(product,Math.min(build.layerCount-1,Math.floor(q*build.layerCount))/build.layerCount,q),
          trail:path(points.map(p=>{const xy=project(...p,q*product.height);return [anchor[0]+xy[0],anchor[1]+xy[1]];})),
          trace:path(points.map(([x,y])=>[43+x*.72,41+y*.4]))};
        geometryCache.set(step,geometry); return geometry;
      }
      function contourAt(geometry,progress){
        const {points,lengths,projected,total,projectedTotal}=geometry;
        let distance=progress*total,passed=0,index=0;
        while(index<lengths.length-1&&distance>lengths[index]){distance-=lengths[index];passed+=projected[index++];}
        const f=lengths[index]?clamp(distance/lengths[index]):0,a=points[index],b=points[(index+1)%points.length];
        return {point:[lerp(a[0],b[0],f),lerp(a[1],b[1],f)],reveal:(passed+projected[index]*f)/projectedTotal};
      }
      function paint(time,still=false){
        const cycle=Math.floor(time/CYCLE),index=cycle%PRODUCTS.length,product=PRODUCTS[index],t=time%CYCLE;
        selectProduct(index);
        const printing=!still&&t<PRINT,complete=still||(t>=PRINT&&t<PRINT+COMPLETE);
        const exiting=!still&&t>=PRINT+COMPLETE&&t<PRINT+COMPLETE+EXIT,resetting=!printing&&!complete&&!exiting;
        const reset=resetting?ease((t-PRINT-COMPLETE-EXIT)/RESET):0;
        const progress=printing?t/PRINT:resetting?1-reset:1;
        // Subpixel build steps cache expensive meshes while XY motion remains
        // smooth. Bed height and the active mesh always use the same step.
        const step=printing?Math.floor(progress*BUILD_STEPS):BUILD_STEPS,built=step/BUILD_STEPS;
        const layerNumber=Math.min(build.layerCount-1,Math.floor(built*build.layerCount));
        const fraction=printing?progress*build.layerCount-layerNumber:1,completedCount=printing?layerNumber:build.layerCount;
        if(completedCount!==shownLayers){layers.forEach((layer,i)=>{layer.style.display=i<completedCount?"":"none";});shownLayers=completedCount;}
        attr(activeLayer,"display",printing?"inline":"none");
        const geometry=geometryFor(product,step);
        if(geometry!==shownGeometry){
          geometry.surfaces.forEach((d,i)=>attr(activeNodes[i],"d",d));
          attr(trail,"d",geometry.trail); attr(tracePath,"d",geometry.trace);
          shownGeometry=geometry;
        }
        // Interpolate the subpixel remainder without rebuilding the cached mesh.
        // The bed, active surface and deposited filament stay at nozzle height.
        const builtHeight=(printing?progress:built)*product.height;
        const surfaceOffset=printing?-(progress-built)*product.height:0;
        attr(activeLayer,"transform","translate(0 "+surfaceOffset.toFixed(4)+")");
        attr(trail,"transform","translate(0 "+surfaceOffset.toFixed(4)+")");
        // CoreXY: rails remain fixed; platform/nuts descend on their Z screws.
        const bedOffset=-height+(resetting?product.height*(1-reset):builtHeight);
        attr(platform,"transform","translate(0 "+bedOffset.toFixed(3)+")");
        // Updating the badge itself avoids inherited style recalculation across
        // hundreds of SVG descendants. The logo stays attached to the platform.
        if(badge) attr(badge,"style","transform:translate(-50%,"+(-50+bedOffset/logo.height*100).toFixed(4)+"%) matrix("+logo.matrix.join(",")+")");
        const contour=contourAt(geometry,fraction);
        let world=contour.point.map((v,i)=>v+build.center[i]);
        if(!printing){
          const last=endpoints[index].end.map((v,i)=>v+build.center[i]),park=still?1:ease((t-PRINT)/450);
          world=last.map((v,i)=>lerp(v,build.park[i],park));
          if(resetting){
            const next=endpoints[(index+1)%PRODUCTS.length].start,home=ease((reset-.35)/.65);
            world=build.park.map((v,i)=>lerp(v,next[i]+build.center[i],home));
          }
        }
        const relative=world.map((v,i)=>v-build.head[i]),[hx,hy]=project(...relative),[gx,gy]=project(0,relative[1]);
        attr(head,"transform","translate("+hx.toFixed(3)+" "+hy.toFixed(3)+")");
        attr(gantry,"transform","translate("+gx.toFixed(3)+" "+gy.toFixed(3)+")");
        const {start,end,control1,control2}=mechanics.feed;
        const hose="M"+ps(start)+"C"+ps(control1)+" "+ps([control2[0]+hx*.6,control2[1]+hy*.6])+" "+ps([end[0]+hx,end[1]+hy]);
        tubes.forEach(tube=>attr(tube,"d",hose));
        attr(trail,"stroke-dashoffset",((1-contour.reveal)*100).toFixed(4)); attr(trail,"display",printing?"inline":"none");
        attr(traceCursor,"cx",(43+(world[0]-build.center[0])*.72).toFixed(2));
        attr(traceCursor,"cy",(41+(world[1]-build.center[1])*.4).toFixed(2)); attr(traceCursor,"opacity",printing?"1":"0");
        // A restrained completion lift starts only after the carriage clears.
        const pop=complete&&!still?Math.sin(Math.PI*clamp((t-PRINT-500)/950)):0;
        const exit=exiting?ease((t-PRINT-COMPLETE)/EXIT):0,lift=pop*7+exit*20,scale=1+pop*.045-exit*.12;
        attr(productGroup,"transform","translate("+(anchor[0]+exit*10).toFixed(3)+" "+(anchor[1]-lift).toFixed(3)+") scale("+scale.toFixed(4)+")");
        attr(productGroup,"opacity",resetting?"0":(1-exit).toFixed(4));
        attr(shadow,"opacity",resetting?"0":(.15*(1-exit)*(1-pop*.35)).toFixed(3));
        attr(scene,"data-print-state",printing?"printing":complete?"complete":exiting?"popout":"resetting");
        attr(scene,"data-print-cycle",cycle); attr(scene,"data-print-progress",progress.toFixed(5));
        attr(scene,"data-print-x",relative[0].toFixed(3)); attr(scene,"data-print-y",relative[1].toFixed(3));
        attr(scene,"data-product-index",index); attr(scene,"data-product-id",product.id); attr(scene,"data-product-name",product.name);
        attr(scene,"data-build-height",builtHeight.toFixed(4)); attr(scene,"data-build-layer",layerNumber); attr(scene,"data-bed-offset",bedOffset.toFixed(4));
        text(progressReadout,Math.floor(progress*100)+"%"); attr(progressFill,"width",(104*progress).toFixed(2));
        text(phaseReadout,printing?"PRINTING":complete?"COMPLETE":exiting?"FINISHED":"RESETTING");
      }
      // Follow display cadence (including 90/120 Hz) instead of a fixed FPS gate.
      // Timestamp-based motion keeps the build duration identical at every rate.
      let frame=0,elapsed=0,previous=0,visible=true,scrolling=false,scrollTimer=0;
      const active=()=>scene.dataset.motion==="on"&&scene.dataset.machinePower!=="off"&&(!scene.dataset.machine||scene.dataset.machine==="printer")&&!reducedMotion.matches&&!document.hidden&&visible&&!scrolling&&scene.isConnected;
      const tick=now=>{
        frame=0;if(!active()) return;
        if(previous) elapsed+=Math.min(now-previous,64);
        previous=now;
        paint(elapsed);
        frame=requestAnimationFrame(tick);
      };
      const sync=()=>{
        cancelAnimationFrame(frame);frame=0;previous=0;
        if(scene.dataset.motion!=="on"||reducedMotion.matches){elapsed=0;paint(0,true);}
        attr(scene,"data-running",active()?"true":"false");
        if(active()) frame=requestAnimationFrame(tick);
      };
      paint(0,scene.dataset.motion!=="on"||reducedMotion.matches);
      new MutationObserver(sync).observe(scene,{attributes:true,attributeFilter:["data-motion","data-machine","data-machine-power"]});
      reducedMotion.addEventListener("change",sync);document.addEventListener("visibilitychange",sync);
      window.addEventListener("scroll",()=>{
        if(!scrolling){scrolling=true;sync();}
        clearTimeout(scrollTimer);
        scrollTimer=setTimeout(()=>{scrolling=false;sync();},150);
      },{passive:true});
      if("IntersectionObserver" in window) new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;sync();}).observe(scene);
      sync();
    }catch{scene.dataset.mechanism="fallback";}
  }
  function initialize(){document.querySelectorAll(".fmrc-hero-scene").forEach(enhance);}
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",initialize,{once:true});else initialize();
})();
