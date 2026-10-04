document.addEventListener('DOMContentLoaded', () => {
  'use strict';
  const page = document.querySelector('.portal-settings'), prefs = window.AdminPreferences;
  if (!page || !prefs) return;
  const $ = id => document.getElementById(id);
  const desktop = window.matchMedia('(min-width:1025px)');
  const label = $('settingSidebarLabel'), width = $('settingSidebarWidth');
  const dialog = $('sidebarLogoDialog'), canvas = $('sidebarLogoCanvas'), ctx = canvas.getContext('2d');
  const owner = () => { const info = window.AdminSession?.getUserInfo(); return String((info?.data || info)?.id || '')+':'+window.AdminSession?.getToken(); };
  let artwork = null, state = {zoom:100,rotate:0,x:0,y:0}, pointer = null, opening = 0, editorOwner = '', uiOwner = owner();
  function syncWidthFill() {
    const fill = (Number(width.value)-Number(width.min))/(Number(width.max)-Number(width.min))*100;
    width.style.setProperty('--sidebar-range-fill',Math.max(0,Math.min(100,fill))+'%');
  }
  function sync() {
    const ownerChanged = uiOwner !== owner(); uiOwner = owner();
    if (ownerChanged) $('sidebarLogoMessage').textContent = '';
    if (editorOwner && editorOwner !== owner()) close();
    const values = prefs.get();
    if (ownerChanged || document.activeElement !== label) label.value = values.sidebarLabel;
    $('sidebarTitleCount').textContent = Array.from(label.value).length+' / 18';
    $('sidebarLogoAdjust').disabled = !values.sidebarLogo;
    width.value = values.sidebarWidth;
    syncWidthFill();
    $('sidebarWidthValue').textContent = values.sidebarWidth < 180 ? 'Icon rail' : values.sidebarWidth+' px';
    width.disabled = !desktop.matches;
    $('sidebarWidthHint').textContent = desktop.matches
      ? 'Drag the sidebar\'s right edge to resize, or click it to collapse and reopen. Arrow keys adjust its width.'
      : 'Navigation is arranged automatically on this screen. Your saved desktop width is used on larger screens.';
  }
  page.addEventListener('change',event => {
    const input = event.target;
    if (input.name === 'portalTheme') prefs.set({theme:input.value});
    if (input.dataset.portalPreference) prefs.set({[input.dataset.portalPreference]:input.checked});
  });
  $('settingsResetBtn').addEventListener('click',()=>{ prefs.reset(); $('sidebarLogoMessage').textContent = ''; });
  label.addEventListener('input',()=>{
    label.value = Array.from(label.value.replace(/[\u0000-\u001f\u007f]/g,'')).slice(0,18).join('');
    prefs.set({sidebarLabel:label.value});
  });
  label.addEventListener('blur',sync);
  width.addEventListener('input',()=>{
    if (!desktop.matches) return;
    window.AdminSidebar?.preview(width.value);
    syncWidthFill();
    $('sidebarWidthValue').textContent = Number(width.value)<180 ? 'Icon rail' : width.value+' px';
  });
  width.addEventListener('change',()=>{ if (desktop.matches) prefs.set({sidebarWidth:Number(width.value)<180?76:Number(width.value)}); });
  $('sidebarBrandDefault').addEventListener('click',()=>{ prefs.set({sidebarLabel:'UCN-FMRC',sidebarLogo:''}); $('sidebarLogoMessage').textContent = 'Default branding restored.'; });
  $('sidebarLogoUpload').addEventListener('click',()=>{ $('sidebarLogoInput').value=''; $('sidebarLogoInput').click(); });
  $('sidebarLogoAdjust').addEventListener('click',()=>openEditor(prefs.get().sidebarLogo));
  async function openEditor(src, selectedOwner = owner()) {
    if (selectedOwner !== owner()) return;
    editorOwner = selectedOwner;
    const revision = ++opening;
    try {
      const image = new Image();
      await new Promise((resolve,reject)=>{ image.onload=resolve; image.onerror=reject; image.src=src; });
      if (revision !== opening || selectedOwner !== owner()) return;
      artwork = image; state = {zoom:100,rotate:0,x:0,y:0};
      $('sidebarLogoEditorMessage').textContent='';
      draw(); dialog.showModal(); canvas.focus();
    } catch (_) { if (revision === opening && selectedOwner === owner()) { editorOwner=''; $('sidebarLogoMessage').textContent = 'This image could not be opened. Please choose another PNG, JPG, or WebP.'; } }
  }
  $('sidebarLogoInput').addEventListener('change',event=>{
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 5*1024*1024) {
      $('sidebarLogoMessage').textContent='Choose a PNG, JPG, or WebP image smaller than 5 MB.'; return;
    }
    const reader = new FileReader();
    const selectedOwner = owner();
    reader.onload=()=>openEditor(reader.result,selectedOwner);
    reader.onerror=()=>{ $('sidebarLogoMessage').textContent='This image could not be read. Please choose it again.'; };
    reader.readAsDataURL(file);
  });
  function draw() {
    ctx.clearRect(0,0,256,256);
    if (!artwork) return;
    const fit = Math.min(256/artwork.naturalWidth,256/artwork.naturalHeight);
    ctx.save(); ctx.beginPath(); ctx.arc(128,128,128,0,Math.PI*2); ctx.clip();
    ctx.translate(128+state.x,128+state.y); ctx.scale(state.zoom/100,state.zoom/100); ctx.rotate(state.rotate*Math.PI/180);
    ctx.drawImage(artwork,-artwork.naturalWidth*fit/2,-artwork.naturalHeight*fit/2,artwork.naturalWidth*fit,artwork.naturalHeight*fit); ctx.restore();
    $('sidebarLogoZoom').value=state.zoom; $('sidebarLogoRotate').value=state.rotate;
    $('sidebarLogoZoomValue').textContent=state.zoom+'%'; $('sidebarLogoRotateValue').textContent=state.rotate+'\u00b0';
  }
  $('sidebarLogoZoom').addEventListener('input',event=>{state.zoom=Number(event.target.value);draw();});
  $('sidebarLogoRotate').addEventListener('input',event=>{state.rotate=Number(event.target.value);draw();});
  $('sidebarLogoFit').addEventListener('click',()=>{state={zoom:100,rotate:0,x:0,y:0};draw();});
  canvas.addEventListener('pointerdown',event=>{event.preventDefault();canvas.focus();canvas.setPointerCapture(event.pointerId);pointer={id:event.pointerId,x:event.clientX,y:event.clientY,offsetX:state.x,offsetY:state.y};});
  canvas.addEventListener('pointermove',event=>{
    if (!pointer || event.pointerId!==pointer.id) return;
    const ratio=256/canvas.getBoundingClientRect().width;
    state.x=pointer.offsetX+(event.clientX-pointer.x)*ratio;state.y=pointer.offsetY+(event.clientY-pointer.y)*ratio;draw();
  });
  ['pointerup','pointercancel','lostpointercapture'].forEach(type=>canvas.addEventListener(type,()=>{pointer=null;}));
  canvas.addEventListener('keydown',event=>{
    const delta=event.shiftKey?16:4;
    if (event.key==='ArrowLeft') state.x-=delta;
    else if(event.key==='ArrowRight')state.x+=delta;
    else if(event.key==='ArrowUp')state.y-=delta;
    else if(event.key==='ArrowDown')state.y+=delta;
    else return;
    event.preventDefault();draw();
  });
  function close() { opening++; if(dialog.open) dialog.close(); pointer=null; editorOwner=''; artwork=null; }
  $('sidebarLogoClose').addEventListener('click',close);$('sidebarLogoCancel').addEventListener('click',close);
  dialog.addEventListener('cancel',()=>{opening++;pointer=null;editorOwner='';artwork=null;});
  $('sidebarLogoApply').addEventListener('click',()=>{
    if (!editorOwner || editorOwner !== owner()) { close(); return; }
    const pixels=ctx.getImageData(0,0,256,256).data;
    let visible=false;for(let i=3;i<pixels.length;i+=4){if(pixels[i]>0){visible=true;break;}}
    if(!visible){$('sidebarLogoEditorMessage').textContent='Keep your artwork inside the circle before applying it.';return;}
    const logo=canvas.toDataURL('image/png');
    if(logo.length>400000){$('sidebarLogoEditorMessage').textContent='Please choose a simpler logo image.';return;}
    prefs.set({sidebarLogo:logo});close();$('sidebarLogoMessage').textContent='Logo applied to your workspace.';
  });
  window.addEventListener('adminPreferencesChanged',sync);window.addEventListener('admin:session-updated',sync);desktop.addEventListener('change',sync);
  sync();
});
