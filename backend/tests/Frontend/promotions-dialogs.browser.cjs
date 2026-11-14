const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {browserFixture, chrome} = require('./helpers/website-browser.cjs');

test('Promotions dialogs share the portal design and preserve edits, theme, search and archive workflows', {skip: !chrome, timeout: 240000}, async t => {
  const seed = () => ({
    promotions: Array.from({length:14},(_,i)=>({id:i+1,title:i?'Campaign '+i:'Workshop Sale',discount_percent:10,scope:i?'all_products':'specific_products',product_ids:i?[]:[1,2],starts_at:null,ends_at:null,is_enabled:true,is_live:true})),
    announcements: Array.from({length:14},(_,i)=>({id:i+1,title:i?'Announcement '+i:'Workshop Notice',message:'Workshop services are available.\n\nContact FMRC for details.',placement:'both',cta_label:'View products',cta_url:'/products-page/product.html',starts_at:null,ends_at:null,is_enabled:true,is_live:true})),
    settings: {announcement_theme_primary:'#c0392b',announcement_theme_secondary:'#800000',promo_spotlight_emoji_left:'🎉',promo_spotlight_emoji_right:'🎉',promo_spotlight_eyebrow:'LIMITED-TIME PROMOTION'},
  });
  let data=seed(),fail=false,hold=false,holdSettings=false;
  const writes=[],replies=[],settingReplies=[];
  const products=Array.from({length:12},(_,i)=>({id:i+1,name:i?'Workshop product '+i:'Engraved Coaster',code:'CODE-'+i}));
  const font=process.env.FMRC_BROWSER_POPPINS;
  const setup=`${font?`{const s=document.createElement('style');s.textContent=${JSON.stringify(`@font-face{font-family:Poppins;src:url(data:font/ttf;base64,${fs.readFileSync(font).toString('base64')}) format('truetype');font-weight:400;font-display:swap}`)};document.head.append(s);}`:''}`;
  const h=await browserFixture(t,async({req,route,json})=>{
    if(route==='/api/admin/products/promotion-options'){json({data:products});return true;}
    if(route==='/api/site-settings'){
      const snapshot=structuredClone(data.settings);
      if(holdSettings)await new Promise(resolve=>settingReplies.push(resolve));
      json({data:snapshot});return true;
    }
    if(route==='/api/admin/site-settings'&&req.method==='PUT'){
      let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);writes.push({route,body,method:req.method});
      if(hold)await new Promise(resolve=>replies.push(resolve));
      if(fail){json({message:'The theme could not be saved.'},503);return true;}
      data.settings={...data.settings,...body};json({data:data.settings});return true;
    }
    const match=route.match(/^\/api\/admin\/(promotions|announcements)(?:\/(\d+|archive-bulk))?$/);
    if(match){
      const kind=match[1],id=Number(match[2]);
      if(req.method==='GET'){json({data:data[kind]});return true;}
      let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);writes.push({route,body,method:req.method});
      if(hold)await new Promise(resolve=>replies.push(resolve));
      if(fail){json({message:'The campaign could not be saved or archived.'},422);return true;}
      if(match[2]==='archive-bulk'){data[kind]=data[kind].filter(item=>!body.ids.includes(item.id));json({processed_ids:body.ids,processed_count:body.ids.length,skipped_ids:[]});return true;}
      if(req.method==='POST')data[kind].push({...body,id:100,is_live:true});
      else data[kind]=data[kind].map(item=>item.id===id?{...item,...body}:item);
      json({data:data[kind].find(item=>item.id===id)||data[kind].at(-1)});return true;
    }
    return false;
  },{setup});
  t.after(()=>{replies.splice(0).forEach(resolve=>resolve());settingReplies.splice(0).forEach(resolve=>resolve());});
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  const viewport=async(width,height=900,scale=1)=>{await h.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:scale,mobile:false});await h.pause(50);};
  const click=async selector=>{await h.until(`document.querySelector(${JSON.stringify(selector)})`);await h.run(`{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'nearest',behavior:'instant'});n.focus({preventScroll:true});n.click();}`);};
  const input=(selector,value)=>h.run(`{const n=document.querySelector(${JSON.stringify(selector)});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));}`);
  const key=async key=>{await h.send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:{Tab:9,Escape:27,Enter:13}[key],...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});await h.send('Input.dispatchKeyEvent',{type:'keyUp',key});};
  const popup=title=>h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent===${JSON.stringify(title)}`);
  const idle=()=>h.until(`document.body.style.position!=='fixed'&&!document.querySelector('.modal-overlay.show,.admin-system-popup.show')`);
  const open=async kind=>{
    const selectors={addPromotion:'#btnOpenAddPromotion',editPromotion:'[data-edit-promotion="1"]',addAnnouncement:'#btnOpenAddAnnouncement',editAnnouncement:'[data-edit-announcement="1"]',theme:'#btnOpenCustomizeModal'};
    await click(selectors[kind]);const root={addPromotion:'modalAddPromotion',editPromotion:'modalAddPromotion',addAnnouncement:'modalAddAnnouncement',editAnnouncement:'modalAddAnnouncement',theme:'modalCustomizeTheme'}[kind];
    await h.until(`document.getElementById('${root}').classList.contains('show')&&document.body.style.position==='fixed'`);
    return root;
  };
  for(const role of ['admin','staff']){
    data=seed();fail=false;hold=false;holdSettings=false;
    await viewport(1440);await h.go('/'+role+'-page/promotions.html');await h.until(`document.querySelector('[data-edit-promotion="1"]')&&!document.querySelector('.admin-global-page-skeleton')`);
    for(const theme of ['light','dark'])for(const width of [320,390,768,1024,1440]){
      await viewport(width);await h.run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      for(const kind of ['addPromotion','editPromotion','addAnnouncement','editAnnouncement','theme']){
        const root=await open(kind);await h.run(`Promise.all(document.getElementById('${root}').getAnimations({subtree:true}).filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);
        const g=await h.run(`(()=>{const r=document.getElementById('${root}'),c=r.querySelector('.portal-detail-dialog__card'),b=r.querySelector('.portal-detail-dialog__body'),head=r.querySelector('header'),foot=r.querySelector('.portal-detail-dialog__footer'),rect=n=>{const q=n.getBoundingClientRect();return{top:q.top,bottom:q.bottom,left:q.left,right:q.right};};return{card:rect(c),body:rect(b),head:rect(head),foot:rect(foot),overflow:b.scrollWidth>b.clientWidth+1||c.scrollHeight>c.clientHeight+1,radius:getComputedStyle(c).borderRadius};})()`);
        assert(g.card.left>=0&&g.card.right<=width+1&&g.card.bottom<=901&&g.card.top>=0&&!g.overflow&&g.radius==='12px',`${role} ${kind} ${width} ${JSON.stringify(g)}`);
        assert(g.head.bottom<=g.body.top+1&&g.foot.top>=g.body.bottom-1,'Only the body scrolls');
        const saveId=kind==='theme'?'btnSaveThemeModal':kind.includes('Announcement')?'btnSaveAnnouncement':'btnSavePromotion';
        assert.equal(await h.run(`document.getElementById('${saveId}').disabled`),kind==='theme'||kind.startsWith('edit'),'Clean edits start disabled');
        if([390,1440].includes(width))await h.shot(`promotions-${role}-${kind}-${width}-${theme}`);
        await key('Escape');await idle();
      }
    }
    for(const [width,height,scale] of [[852,393,1],[720,450,2]]){
      await viewport(width,height,scale);const root=await open('theme');assert.equal(await h.run(`document.getElementById('${root}').querySelector('.portal-detail-dialog__card').getBoundingClientRect().bottom<=innerHeight`),true);await key('Escape');await idle();
    }
    await viewport(1440);await input('#promotionSearchInput','Workshop');assert.equal(await h.run(`document.querySelectorAll('#promotionTableBody [data-edit-promotion]').length`),1);await click('[data-admin-bulk-enter="promotions"]');await click('[data-admin-bulk-page="promotions"]');assert.deepEqual(await h.run(`AdminBulkSelection.get('promotions').getSelectedIds()`),[1],'Page selection follows filtered rows');await click('[data-admin-bulk-cancel="promotions"]');await input('#promotionSearchInput','missing');assert.match(await h.run(`document.getElementById('promotionTableBody').textContent`),/No matching/);await input('#promotionSearchInput','');
    await input('#announcementSearchInput','Workshop Notice');assert.equal(await h.run(`document.querySelectorAll('#announcementTableBody [data-edit-announcement]').length`),1);await input('#announcementSearchInput','');
    await open('editPromotion');const unchanged=writes.length;await h.run(`document.getElementById('promotionForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`);assert.equal(writes.length,unchanged,'Unchanged Enter/programmatic submit writes nothing');
    await input('#promotionProductSearch','Workshop product 9');assert.equal(await h.run(`document.getElementById('btnSavePromotion').disabled`),true,'Searching is not an edit');assert.equal(await h.run(`document.querySelectorAll('#promotionProductPicker label:not([hidden])').length`),1);await input('#promotionProductSearch','');
    await input('#promotionTitle','Updated campaign');assert.equal(await h.run(`document.getElementById('btnSavePromotion').disabled`),false);await input('#promotionTitle','Workshop Sale');assert.equal(await h.run(`document.getElementById('btnSavePromotion').disabled`),true);
    await input('#promotionDiscount','25');await input('#promotionStart','2026-12-10T09:00');await input('#promotionEnd','2026-12-20T17:00');
    fail=true;hold=true;await click('#btnSavePromotion');await h.until(`document.getElementById('promotionReset').disabled`);await key('Escape');await click('#btnSavePromotion');hold=false;replies.splice(0).forEach(resolve=>resolve());await popup('Error');await click('#adminSystemPopupOk');assert.equal(await h.run(`document.getElementById('promotionDiscount').value`),'25');assert.equal(await h.run(`document.getElementById('btnSavePromotion').disabled`),false);
    fail=false;await click('#btnSavePromotion');await idle();assert.equal(data.promotions[0].discount_percent,25);const saved=writes.filter(w=>w.route==='/api/admin/promotions/1').at(-1).body;assert.equal(saved.starts_at,'2026-12-10T09:00:00+08:00');assert.deepEqual(saved.product_ids,[1,2]);
    await open('editPromotion');await input('#promotionTitle','Discard this draft');await key('Escape');await popup('Discard changes?');assert.equal(await h.run(`document.querySelectorAll('#adminSystemPopup [data-portal-detail-close],#adminSystemPopup hr').length`),0);await click('#adminSystemPopupCancel');await click('#modalAddPromotion [data-portal-detail-close]');await popup('Discard changes?');await click('#adminSystemPopupOk');await idle();
    await open('editAnnouncement');await input('#announcementMessage','Updated notice');assert.equal(await h.run(`document.getElementById('btnSaveAnnouncement').disabled`),false);await input('#announcementMessage',data.announcements[0].message);assert.equal(await h.run(`document.getElementById('btnSaveAnnouncement').disabled`),true);await input('#announcementEnabled',true);await click('#announcementEnabled');await click('#btnSaveAnnouncement');await idle();assert.equal(data.announcements[0].is_enabled,false);
    await open('addPromotion');const beforeInvalid=writes.length;await click('#btnSavePromotion');await popup('Validation Error');assert.equal(writes.length,beforeInvalid);await click('#adminSystemPopupOk');await input('#promotionTitle','New campaign');await click('#btnSavePromotion');await idle();assert(data.promotions.some(p=>p.id===100));
    await open('addAnnouncement');await input('#announcementTitle','New notice');await input('#announcementMessage','An FMRC update.');await click('#btnSaveAnnouncement');await idle();assert(data.announcements.some(p=>p.id===100));
    await open('theme');await click('#themePresetsGrid [data-primary="#3b82f6"]');assert.equal(await h.run(`document.getElementById('btnSaveThemeModal').disabled`),false);await key('Escape');await popup('Discard changes?');await click('#adminSystemPopupOk');await idle();
    await open('theme');assert.equal(await h.run(`document.getElementById('btnSaveThemeModal').disabled`),true);await h.run(`document.querySelector('#themePresetsGrid [data-primary="#10b981"]').focus()`);await key('Enter');assert.equal(await h.run(`document.querySelector('#themePresetsGrid [data-primary="#10b981"]').getAttribute('aria-pressed')`),'true');
    fail=true;await click('#btnSaveThemeModal');await popup('Not Saved');await click('#adminSystemPopupOk');assert.equal(await h.run(`document.getElementById('themePrimaryColor').value`),'#10b981');fail=false;await click('#btnSaveThemeModal');await idle();assert.equal(data.settings.announcement_theme_primary,'#10b981');
    holdSettings=true;await open('theme');await input('#themeEyebrowLabel','Keep these edits');data.settings.promo_spotlight_eyebrow='A different server label';holdSettings=false;settingReplies.splice(0).forEach(resolve=>resolve());await h.pause(100);assert.equal(await h.run(`document.getElementById('themeEyebrowLabel').value`),'Keep these edits','Late reads preserve typed drafts');await key('Escape');await popup('Discard changes?');await click('#adminSystemPopupOk');await idle();
    await click('[data-archive-promotion="1"]');await popup('Archive Selected');assert.equal(await h.run(`document.querySelectorAll('#adminSystemPopup [data-portal-detail-close],#adminSystemPopup hr').length`),0);await click('#adminSystemPopupCancel');
    hold=true;await click('[data-archive-promotion="1"]');await popup('Archive Selected');await click('#adminSystemPopupOk');await h.until(`document.getElementById('adminSystemPopupCancel').disabled`);await key('Escape');assert.equal(await h.run(`document.getElementById('adminSystemPopup').classList.contains('show')`),true);hold=false;replies.splice(0).forEach(resolve=>resolve());await idle();assert(!data.promotions.some(p=>p.id===1));
    fail=true;await click('[data-archive-promotion="2"]');await popup('Archive Selected');await click('#adminSystemPopupOk');await h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupMessage')?.textContent.includes('could not be saved or archived')`);await click('#adminSystemPopupOk');assert(data.promotions.some(p=>p.id===2),'A failed archive retains the record');fail=false;
    await click('[data-admin-bulk-enter="promotions"]');await click('[data-admin-bulk-row="promotions"][value="2"]');await click('[data-admin-bulk-row="promotions"][value="3"]');await click('[data-admin-bulk-tools="promotions"] [data-admin-bulk-action="archive"]');await popup('Archive Selected');await click('#adminSystemPopupOk');await idle();assert(!data.promotions.some(p=>[2,3].includes(p.id)));
    await click('[data-archive-announcement="1"]');await popup('Archive Selected');await click('#adminSystemPopupOk');await idle();assert(!data.announcements.some(p=>p.id===1));
    assert.deepEqual(await h.run('fixtureErrors'),[]);
  }
  console.log('Promotions desktop/mobile previews:',h.artifacts);
});
