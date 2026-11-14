const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {browserFixture, chrome} = require('./helpers/website-browser.cjs');

test('Inventory form, rules, letterhead and archive dialogs preserve workflows in both portals', {skip: !chrome, timeout: 240000}, async t => {
  const seed = () => [
    {id:1,item_name:'Pencil',category:'Consumable Materials',unit:'pcs',on_hand:5,initial_on_hand:20,status:'Low Stock',description:'Graphite pencils for drafting and workshop use.',remarks:'Check stock before the next workshop.',variants:[]},
    {id:2,item_name:'Assorted fittings',category:'Consumable Materials',unit:null,on_hand:0,status:'Good',has_variants:true,variants:Array.from({length:6},(_,i)=>({id:101+i,name:`Fitting ${i+1}`,unit:i%2?'box':'pcs',on_hand:i,initial_on_hand:20,description:'Workshop fitting',remarks:''}))},
    {id:3,item_name:'Cable ties',category:'Consumable Materials',unit:'pack',on_hand:20,status:'Good',variants:[]},
    ...Array.from({length:24},(_,i)=>({id:i+10,item_name:`Workshop supply ${i+1}`,category:i%2?'Office Supplies':'Inventory Tools',unit:'pcs',on_hand:12,status:'Good',variants:[]})),
  ];
  let items=seed(),rules,settings,failSave=false,failRules=false,failSettings=false,failArchive=false,failAdjust=false;
  let holdRules=false,holdSettings=false,holdArchive=false;
  const ruleReplies=[],settingReplies=[],archiveReplies=[],writes=[];
  const font=process.env.FMRC_BROWSER_POPPINS;
  const setup=`{
    const oldFetch=window.fetch;window.fetch=(input,init)=>oldFetch(typeof input==='string'?input.replace(/^http:\\/\\/(?:localhost|127\\.0\\.0\\.1):8000\\/api/,window.APP_API_BASE_URL):input,init);
    ${font?`const s=document.createElement('style');s.textContent=${JSON.stringify(`@font-face{font-family:Poppins;src:url(data:font/ttf;base64,${fs.readFileSync(font).toString('base64')}) format('truetype');font-weight:400;font-display:swap}`)};document.head.append(s);`:''}
  }`;
  const h=await browserFixture(t,async({req,route,json})=>{
    if(route==='/api/admin/inventory/stock-rules'){
      if(req.method==='PUT'){
        let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);writes.push({route,body});
        if(failRules){json({message:'The stock rules could not be saved.'},503);return true;}
        rules=body;json({data:rules});return true;
      }
      const snapshot={...rules,items_index:structuredClone(items)};
      if(holdRules)await new Promise(resolve=>ruleReplies.push(resolve));
      json({data:snapshot});return true;
    }
    if(route==='/api/site-settings'){json({data:settings});return true;}
    if(route==='/api/admin/site-settings'&&req.method==='PUT'){
      let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);writes.push({route,body});
      if(holdSettings)await new Promise(resolve=>settingReplies.push(resolve));
      if(failSettings){json({message:'Letterhead save interrupted. Try again.'},503);return true;}
      settings={...settings,...body};json({data:settings});return true;
    }
    if(route==='/api/admin/inventory/archive-bulk'){
      let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);writes.push({route,body});
      if(holdArchive)await new Promise(resolve=>archiveReplies.push(resolve));
      if(failArchive){json({message:'The selected items could not be archived.'},503);return true;}
      items=items.filter(item=>!body.ids.includes(item.id));
      json({archived_ids:body.ids,archived_count:body.ids.length,skipped_ids:[]});return true;
    }
    if(/^\/api\/admin\/inventory\/\d+\/adjust$/.test(route)&&req.method==='POST'){
      let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);writes.push({route,body,method:req.method});
      if(failAdjust){json({message:'The stock adjustment could not be saved.'},503);return true;}
      const item=items.find(value=>value.id===Number(route.split('/')[4]));
      const target=body.variant_id?item.variants.find(value=>value.id===body.variant_id):item;
      if(target.on_hand+body.adjust_amount<0){json({message:'The deduction exceeds the available stock.'},422);return true;}
      target.on_hand+=body.adjust_amount;json({data:item});return true;
    }
    if(route==='/api/admin/inventory'&&req.method==='GET'){json({data:items,summary:{total_items:items.length,good:25,low_stock:1}});return true;}
    if((route==='/api/admin/inventory'&&req.method==='POST')||(/^\/api\/admin\/inventory\/\d+$/.test(route)&&req.method==='PUT')){
      let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);writes.push({route,body,method:req.method});
      if(failSave){json({message:'The item could not be saved.'},503);return true;}
      const id=req.method==='POST'?1000:Number(route.split('/').at(-1));
      const previous=items.find(item=>item.id===id);
      const variants=body.variants.map((variant,index)=>({...previous?.variants[index],...variant,id:previous?.variants[index]?.id??500+index}));
      const item={...previous,...body,variants,id,status:'Good'};
      items=req.method==='POST'?[...items,item]:items.map(value=>value.id===id?item:value);json({data:item});return true;
    }
    return false;
  },{setup});
  t.after(()=>[...ruleReplies,...settingReplies,...archiveReplies].forEach(resolve=>resolve()));
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  const click=async selector=>{await h.until(`document.querySelector(${JSON.stringify(selector)})`);return h.run(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'center',behavior:'instant'});n.focus({preventScroll:true});n.click();})()`);};
  const input=(selector,value)=>h.run(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const change=(selector,value)=>h.run(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const key=async key=>{const virtual={Escape:27,Tab:9,PageDown:34,Enter:13,' ':32}[key],code=key===' '?'Space':key;await h.send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:virtual,...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});await h.send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:virtual});};
  const viewport=async(width,height=900,scale=1)=>{await h.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:scale,mobile:false});await h.pause(60);};
  const idle=()=>h.until(`document.body.style.position!=='fixed'&&!document.querySelector('.modal-overlay.show,.admin-system-popup.show')`);
  const finishAnimations=()=>h.run(`Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);
  const wait=async condition=>{for(let i=0;i<150;i++){if(condition())return;await h.pause(20);}throw Error('Held request did not arrive');};
  const popup=title=>h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent===${JSON.stringify(title)}`);
  const roots={add:'#modalAddInventoryItem',edit:'#modalAddInventoryItem',adjust:'#modalDeductInventoryItem',rules:'#modalStockRules',letterhead:'#reportLetterheadModal',archive:'#adminSystemPopup'};
  const open=async kind=>{
    if(kind==='edit'){await click('[data-inv-view="2"]');await h.until(`document.querySelector('#modalViewInventoryItem.show')`);await click('#btnEditFromViewInv');}
    else await click({add:'#btnOpenAddItem',adjust:'[data-inv-deduct="1"]',rules:'#btnOpenStockRules',letterhead:'#reportLetterheadBtn',archive:'[data-inv-archive="1"]'}[kind]);
    await h.until(`document.querySelector('${roots[kind]}.show')&&document.body.style.position==='fixed'`);
    if(kind==='letterhead')await h.until(`document.querySelector('[data-letterhead-key="university"]')`);
    await finishAnimations();
  };
  const close=async kind=>{await click(kind==='archive'?'#adminSystemPopupCancel':kind==='letterhead'?'#reportLetterheadCloseIcon':`${roots[kind]} [data-portal-detail-close]`);await idle();};
  const searchFits=selector=>h.run(`(()=>{const n=document.querySelector(${JSON.stringify(selector)}),s=getComputedStyle(n),icon=n.parentElement.querySelector('svg'),canvas=document.createElement('canvas'),context=canvas.getContext('2d');context.font=s.font;const text=context.measureText(n.placeholder).width,available=n.getBoundingClientRect().width-parseFloat(s.borderLeftWidth)-parseFloat(s.borderRightWidth)-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),iconRight=icon?.getBoundingClientRect().right,textLeft=n.getBoundingClientRect().left+parseFloat(s.paddingLeft);return {fits:!!icon&&text<available&&iconRight<textLeft,text,available,iconRight,textLeft,placeholder:n.placeholder,font:s.font,padding:s.paddingLeft+' / '+s.paddingRight};})()`);
  const geometry=selector=>h.run(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}),c=r.querySelector('.portal-detail-dialog__card'),b=r.querySelector('.portal-detail-dialog__body'),rect=n=>{const q=n.getBoundingClientRect();return{top:q.top,bottom:q.bottom,left:q.left,right:q.right};};return{card:rect(c),head:rect(r.querySelector('header')),body:rect(b),foot:rect(r.querySelector('footer')),overflow:b.scrollWidth>b.clientWidth+1||c.scrollHeight>c.clientHeight+1||r.scrollHeight>r.clientHeight+1,locked:getComputedStyle(document.documentElement).overflowY==='hidden',inert:document.querySelector('.dashboard-container').inert,buttons:[...r.querySelectorAll('footer button')].map(n=>({height:n.getBoundingClientRect().height,fits:n.scrollWidth<=n.clientWidth+1})),radius:getComputedStyle(c).borderRadius};})()`);
  for(const role of ['admin','staff']){
    items=seed();rules={global:{mode:'fixed',threshold:5},categories:{},items:{},variants:{}};settings={report_letterhead_university:'Sample University'};
    await viewport(1440);await h.go(`/${role}-page/inventory.html`);await h.until(`document.querySelector('[data-inv-view="1"]')&&!document.querySelector('.admin-global-page-skeleton')`);
    if(font)await h.run('document.fonts.ready');
    const otherStyle=await h.run(`getComputedStyle(document.querySelector('#reportPreviewModal .modal-card')).borderRadius`);
    for(const theme of ['light','dark'])for(const width of [320,390,768,1024,1440]){
      await viewport(width);await h.run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      const search=await searchFits('#inventorySearchInput');assert(search.fits,`${width}: Inventory search ${JSON.stringify(search)}`);
      for(const kind of Object.keys(roots)){
        await open(kind);const g=await geometry(roots[kind]);
        const originalY=await h.run(`Math.abs(parseFloat(document.body.style.top))`);
        assert(g.card.left>=0&&g.card.right<=width&&g.card.top>=0&&g.card.bottom<=900,`${role} ${kind} ${theme} ${width}: frame fits`);
        assert(!g.overflow&&g.locked&&g.inert&&g.radius==='12px',`${role} ${kind} ${theme} ${width}: ${JSON.stringify(g)}`);
        assert(g.head.bottom<=g.body.top+1&&g.foot.top>=g.body.bottom-1,'Only the body scrolls');
        assert(g.buttons.every(button=>button.height>=44&&button.fits),'Footer controls remain readable');
        const fixed={head:g.head.top,foot:g.foot.top};await h.run(`document.querySelector('${roots[kind]} .portal-detail-dialog__body').scrollTop=1000`);const after=await geometry(roots[kind]);
        assert.equal(after.head.top,fixed.head);assert.equal(after.foot.top,fixed.foot);
        if(kind==='rules'){
          assert.equal(await h.run(`[...document.querySelectorAll('#modalStockRules .stock-rule-list')].every(n=>getComputedStyle(n).overflowY==='visible')`),true);
          assert.equal(await h.run(`document.getElementById('stockRuleGuideToggle').getAttribute('aria-expanded')`),'false');
          assert.equal(await h.run(`document.getElementById('stockRuleGuide').getClientRects().length`),0,'Guide starts collapsed');
          const search=await searchFits('#stockRuleSearch');assert(search.fits,`${width}: Rules search ${JSON.stringify(search)}`);
        }
        if(kind==='letterhead'){
          assert.equal(await h.run(`document.getElementById('reportLetterheadError').getClientRects().length`),0,'No empty red error strip');
          const fields=await h.run(`[...document.querySelectorAll('#reportLetterheadFields .report-letterhead-grid')].map(grid=>[...grid.querySelectorAll('input')].map(n=>({top:n.getBoundingClientRect().top,height:n.getBoundingClientRect().height,width:n.getBoundingClientRect().width})))`);
          for(const group of fields){assert(group.every(field=>Math.abs(field.height-44)<1),'Letterhead inputs have a uniform height');if(width>=640)for(let i=0;i+1<group.length;i+=2){assert(Math.abs(group[i].top-group[i+1].top)<1,'Letterhead pairs align despite helper text');assert(Math.abs(group[i].width-group[i+1].width)<1,'Paired fields have equal widths');}}
          if([390,1440].includes(width)&&theme==='light'){
            for(const section of ['Issuing unit','Signatories']){await h.run(`[...document.querySelectorAll('#reportLetterheadFields fieldset')].find(n=>n.querySelector('legend').textContent.includes('${section}')).scrollIntoView({block:'center'})`);await h.shot(`inventory-${role}-letterhead-${section.replace(' ','-')}-${width}`);}
          }
        }
        if(kind==='archive')assert.equal(await h.run(`document.querySelectorAll('#adminSystemPopup hr,#adminSystemPopup [data-portal-detail-close]').length`),0,'Archive has no X button or separator rules');
        if(kind==='adjust')assert.equal(await h.run(`[...document.querySelectorAll('#modalDeductInventoryItem .mode-toggle-btn')].every(n=>n.scrollWidth<=n.clientWidth+1&&n.getBoundingClientRect().height>=44)`),true,'Stock mode controls fit');
        await h.run(`document.querySelector('${roots[kind]}').click()`);
        assert.equal(await h.run(`document.querySelector('${roots[kind]}').classList.contains('show')`),true,'Backdrop does not dismiss the dialog');
        if(theme==='light'&&[390,1440].includes(width)||theme==='dark'&&width===390){await h.run(`document.querySelector('${roots[kind]} .portal-detail-dialog__body').scrollTop=0`);await h.shot(`inventory-${role}-${kind}-${theme}-${width}`);}
        await close(kind);
        const restoredY=await h.run('scrollY');
        assert(Math.abs(restoredY-originalY)<2,`${role} ${kind} ${width}: page position ${originalY} -> ${restoredY}`);
        const opener={add:'#btnOpenAddItem',edit:'[data-inv-view="2"]',adjust:'[data-inv-deduct="1"]',rules:'#btnOpenStockRules',letterhead:'#reportLetterheadBtn',archive:'[data-inv-archive="1"]'}[kind];
        assert.equal(await h.run(`document.activeElement===document.querySelector(${JSON.stringify(opener)})`),true,'Focus returns to the originating control');
      }
    }
    for(const [width,height,scale]of [[852,393,1],[720,450,2]]){
      await viewport(width,height,scale);
      for(const kind of Object.keys(roots)){await open(kind);const g=await geometry(roots[kind]);assert(!g.overflow&&g.card.bottom<=height&&g.body.bottom>g.body.top+20,`${kind}: short/zoom viewport fits`);await close(kind);}
    }
    await viewport(1440);await h.run(`document.documentElement.dataset.theme='light'`);
    await click('#btnOpenAddItem');await h.until(`document.body.style.position==='fixed'`);
    await click('#btnAddVariant');assert.equal(await h.run(`document.querySelectorAll('#invVariantList .inv-variant-card').length`),1);
    await h.run(`document.querySelector('#invVariantList [data-variant-remove] svg').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
    assert.equal(await h.run(`document.querySelectorAll('#invVariantList .inv-variant-card').length`),0,'The remove icon remains clickable');
    await input('#invFormItemName','Unsaved item');await key('Escape');await popup('Discard changes?');
    assert.equal(await h.run(`document.body.style.position`),'fixed');await click('#adminSystemPopupCancel');assert.equal(await h.run(`document.getElementById('invFormItemName').value`),'Unsaved item');
    await click('#modalAddInventoryItem [data-portal-detail-close]');await popup('Discard changes?');await click('#adminSystemPopupOk');await idle();
    assert.equal(await h.run(`document.activeElement.id`),'btnOpenAddItem');
    await open('add');await input('#invFormItemName','New item');await input('#invFormOnHand','10');failSave=true;
    await click('#btnSaveInvForm');await popup('Save Failed');await click('#adminSystemPopupOk');assert.equal(await h.run(`document.getElementById('invFormItemName').value`),'New item');
    failSave=false;await click('#btnSaveInvForm');await idle();assert(items.some(item=>item.id===1000&&item.on_hand===10));
    await open('edit');assert.equal(await h.run(`[...document.querySelectorAll('#invVariantList [data-variant-on-hand]')].every(n=>n.disabled&&n.readOnly)`),true);
    await input('#invFormItemName','Updated fittings');await click('#btnSaveInvForm');await idle();assert.equal(items.find(item=>item.id===2).variants[1].on_hand,1);
    rules.global.threshold=8;await open('rules');await h.until(`document.getElementById('stockRuleGlobalThreshold').value==='8'`);
    await h.run(`document.getElementById('stockRuleGuideToggle').focus()`);await key('Enter');
    assert.equal(await h.run(`document.getElementById('stockRuleGuide').hidden`),false,'Keyboard expands the linked guide');
    await h.shot(`inventory-${role}-rules-guide-expanded`);await close('rules');
    holdRules=true;await open('rules');await wait(()=>ruleReplies.length>0);await input('#stockRuleGlobalThreshold','13');ruleReplies.splice(0).forEach(resolve=>resolve());holdRules=false;await h.pause(80);
    assert.equal(await h.run(`document.getElementById('stockRuleGlobalThreshold').value`),'13','A delayed read cannot overwrite the draft');
    assert.equal(await h.run(`document.getElementById('stockRuleGuide').hidden`),true,'Reopening collapses the guide');
    await click('#stockRuleGuideToggle');await click('#stockRuleGuideToggle');assert.equal(await h.run(`document.getElementById('stockRuleGlobalThreshold').value`),'13','Guide toggles preserve rule edits');
    const categoryRow='[data-rule-scope="category"][data-rule-key="Consumable Materials"]';
    const variantRow='[data-rule-scope="variant"][data-rule-key="2:101"]';
    await input(categoryRow+' [data-rule-threshold]','20');await change(categoryRow+' [data-rule-mode]','percent');
    await input(variantRow+' [data-rule-threshold]','2');
    await h.run(`document.querySelector('${variantRow} [data-rule-clear] svg').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
    assert.equal(await h.run(`document.querySelector('${variantRow} [data-rule-threshold]').value`),'','The clear icon restores inheritance');
    assert.match(await h.run(`document.querySelector('${variantRow} .stock-rule-chip--inherited').textContent`),/category/);
    await input('#stockRuleSearch','Fitting 1');assert.equal(await h.run(`document.querySelectorAll('#stockRuleItemList [data-rule-scope]').length`),2);
    await input('#stockRuleSearch','');await change('#stockRuleCategoryFilter','Office Supplies');
    assert.equal(await h.run(`[...document.querySelectorAll('#stockRuleItemList .stock-rule-row-label')].every(n=>n.textContent.includes('Office Supplies'))`),true);
    await change('#stockRuleCategoryFilter','all');
    failRules=true;await click('#btnSaveStockRules');await popup('Save Failed');await click('#adminSystemPopupOk');assert.equal(await h.run(`document.getElementById('stockRuleGlobalThreshold').value`),'13');
    failRules=false;await click('#btnSaveStockRules');await idle();assert.equal(rules.global.threshold,13);assert.deepEqual(rules.categories['Consumable Materials'],{mode:'percent',threshold:20});assert.deepEqual(rules.variants,{});
    await open('letterhead');await input('[data-letterhead-key="university"]','Edited University');failSettings=true;await click('#reportLetterheadSaveBtn');await h.until(`!document.getElementById('reportLetterheadError').hidden`);
    assert.equal(await h.run(`document.querySelector('[data-letterhead-key="university"]').value`),'Edited University');
    failSettings=false;holdSettings=true;await click('#reportLetterheadSaveBtn');await wait(()=>settingReplies.length>0);await key('Escape');await click('#reportLetterheadCloseIcon');assert.equal(await h.run(`document.getElementById('reportLetterheadModal').classList.contains('show')`),true,'Saving blocks dismissal');
    holdSettings=false;settingReplies.splice(0).forEach(resolve=>resolve());await idle();assert.equal(settings.report_letterhead_university,'Edited University');
    await open('letterhead');assert.equal(await h.run(`document.querySelector('[data-letterhead-key="university"]').value`),'Edited University');
    const beforeRestore=writes.length;await click('#reportLetterheadResetBtn');await popup('Restore defaults');await click('#adminSystemPopupCancel');assert.equal(writes.length,beforeRestore);
    await click('#reportLetterheadResetBtn');await popup('Restore defaults');await click('#adminSystemPopupOk');await idle();assert.equal(settings.report_letterhead_university,'');
    await open('adjust');assert.equal(await h.run(`document.getElementById('deductTargetWrap').getClientRects().length`),0);
    await input('#deductAmountAdd','2');await input('#deductName','Stock Officer');await input('#deductPurpose','Workshop restock');await input('#deductRemarks','Recorded adjustment');
    failAdjust=true;await click('#btnSaveDeduct');await popup('Error');await click('#adminSystemPopupOk');assert.equal(await h.run(`document.getElementById('deductAmountAdd').value`),'2','Failed adjustments retain entries');
    failAdjust=false;await click('#btnSaveDeduct');await idle();assert.equal(items.find(item=>item.id===1).on_hand,7);
    await open('adjust');await h.run(`document.querySelector('#btnModeDeduct svg').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);assert.equal(await h.run(`document.getElementById('btnModeDeduct').getAttribute('aria-pressed')`),'true');
    await input('#deductAmountDeduct','3');await click('#btnSaveDeduct');await idle();assert.equal(items.find(item=>item.id===1).on_hand,4);
    assert.deepEqual(writes.filter(value=>value.route.endsWith('/1/adjust')).at(-1).body,{adjust_amount:-3,name:'',purpose:'',remarks:''});
    await click('[data-inv-deduct="2"]');await h.until(`document.querySelector('#modalDeductInventoryItem.show')`);await change('#deductTarget','variant:102');assert.equal(await h.run(`document.getElementById('deductOnHand').value`),'1');
    await input('#deductAmountAdd','4');await click('#btnSaveDeduct');await idle();assert.equal(items.find(item=>item.id===2).variants.find(value=>value.id===102).on_hand,5);
    assert.equal(writes.filter(value=>value.route.endsWith('/2/adjust')).at(-1).body.variant_id,102);
    await click('[data-inv-deduct="2"]');await h.until(`document.querySelector('#modalDeductInventoryItem.show')`);await change('#deductTarget','variant:102');await click('#btnModeDeduct');await input('#deductAmountDeduct','99');await click('#btnSaveDeduct');await popup('Error');await click('#adminSystemPopupOk');assert.equal(await h.run(`document.getElementById('deductAmountDeduct').value`),'99');await click('#btnCancelDeduct');await idle();
    const beforeArchive=writes.filter(value=>value.route.endsWith('archive-bulk')).length;
    await open('archive');await key('Escape');await idle();assert.equal(writes.filter(value=>value.route.endsWith('archive-bulk')).length,beforeArchive);
    failArchive=true;await open('archive');await click('#adminSystemPopupOk');await popup('Archive Failed');assert.equal(await h.run(`document.getElementById('adminSystemPopup').hasAttribute('data-portal-detail-dialog')`),true,'Errors retain the page opt-in');assert.equal(await h.run(`document.getElementById('adminSystemPopup').dataset.popupIcon`),'error','Archive icon resets for errors');await click('#adminSystemPopupOk');await idle();
    failArchive=false;holdArchive=true;await open('archive');await click('#adminSystemPopupOk');await wait(()=>archiveReplies.length>0);
    await key('Escape');await click('#adminSystemPopupCancel');assert.equal(await h.run(`document.getElementById('adminSystemPopup').classList.contains('show')`),true,'Pending archive cannot close');
    holdArchive=false;archiveReplies.splice(0).forEach(resolve=>resolve());await idle();assert(!items.some(item=>item.id===1));
    await click('[data-inv-selection-toggle="Consumable Materials"]');await click('[data-inv-select="2"]');await click('[data-inv-select="3"]');await click('[data-inv-archive-selected="Consumable Materials"]');await popup('Archive Selected Items');
    assert.match(await h.run(`document.getElementById('adminSystemPopupMessage').textContent`),/2 selected items/);await click('#adminSystemPopupOk');await idle();assert(!items.some(item=>[2,3].includes(item.id)));
    assert.equal(await h.run(`getComputedStyle(document.querySelector('#reportPreviewModal .modal-card')).borderRadius`),otherStyle);
    await h.run(`showAdminConfirmPopup('An unrelated confirmation.',{title:'Unrelated action'})`);await popup('Unrelated action');assert.equal(await h.run(`document.querySelectorAll('#adminSystemPopup hr').length`),0);await click('#adminSystemPopupCancel');
    assert.deepEqual(await h.run('fixtureErrors'),[]);
  }
  console.log('Inventory form screenshots:',h.artifacts);
});
