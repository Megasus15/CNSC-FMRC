(() => {
  'use strict';
  document.addEventListener('DOMContentLoaded',()=>{
    const get=id=>document.getElementById(id);if(!get('policyEditorForm'))return;
    const api=(window.APP_API_BASE_URL||(['localhost','127.0.0.1'].includes(location.hostname)&&location.port!=='8000'?location.protocol+'//'+location.hostname+':8000/api':location.origin+'/api')).replace(/\/$/,'');
    const fields={title:get('policyDraftTitle'),terms_text:get('policyDraftTerms'),refund_text:get('policyDraftRefund')};
    let record=null,busy=false,loaded=false,baseline='';
    const read=()=>Object.fromEntries(Object.entries(fields).map(([key,field])=>[key,field.value]));
    const changed=()=>!!record&&JSON.stringify(read())!==baseline;
    const canEdit=()=>loaded&&record?.can_edit;
    window.AdminWebsiteDraft?.register({isDirty:()=>!!canEdit()&&changed(),busy:()=>busy&&!!record?.can_edit});
    const sync=()=>{
      get('policyEditorFields').disabled=!canEdit()||busy;
      get('policyDraftSave').disabled=!canEdit()||busy||!changed();
      get('policyDraftDiscard').disabled=!canEdit()||busy||!changed();
      get('policyApproval').disabled=!canEdit()||busy;
      const published=record?.published;const same=published&&Object.keys(fields).every(key=>published[key]===fields[key].value);
      const savedDraft=!!record?.draft && record.has_saved_draft!==false;
      get('policyPublish').disabled=!canEdit()||busy||changed()||!record?.draft||!get('policyApproval').checked||same;
      get('policyEditorForm').setAttribute('aria-busy',String(busy));
      get('policySettingsRefresh').disabled=busy;get('policySettingsRetry').disabled=busy;
      get('policySaveStatus').textContent=busy?(loaded?'Updating policy settings…':'Loading policy settings…'):!loaded?'Settings are unavailable. Retry before editing.':changed()?'You have unsaved draft changes.':'No unsaved changes.';
      const hint=get('policyPublishHint');
      if(hint)hint.textContent=!loaded?'':busy?'Please wait…':changed()?'Save your changes before publishing.':same?'The published policy is up to date.':!get('policyApproval').checked?'Review both policies and confirm FMRC approval to publish.':!savedDraft?'Ready to publish. The reviewed draft will be saved with this publication.':'Ready to publish.';
      get('policyPreviewTerms').textContent=fields.terms_text.value;get('policyPreviewRefund').textContent=fields.refund_text.value;
    };
    const apply=data=>{
      record=data;loaded=true;get('policyDraftEditor').hidden=!data.can_edit;get('policySaveBar').hidden=!data.can_edit;
      const draft=data.draft||data.published||{title:'',terms_text:'',refund_text:''};
      Object.keys(fields).forEach(key=>{fields[key].value=draft[key];});baseline=JSON.stringify(read());get('policyApproval').checked=false;
      get('policyPublishedTitle').textContent=data.published?.title||'No published policies';
      get('policyPublishedMessage').textContent=data.published?'Customers review and accept this version at checkout.':data.can_edit?'Review and save the draft below, then publish the approved version to make both policies available to customers.':'An Admin has not published the Transaction Terms and Refund Policy yet.';
      get('policyPublishedDocuments').hidden=!data.published;
      get('policyPublishedTerms').textContent=data.published?.terms_text||'';get('policyPublishedRefund').textContent=data.published?.refund_text||'';
      get('policyPublishedLink').hidden=!data.published;
      get('policyPublishedTermsLink').hidden=!data.published;
      if(data.published)get('policyPublishedLink').href='/products-page/refund-policy.html?version='+encodeURIComponent(data.published.version)+'#refund-policy';
      if(data.published)get('policyPublishedTermsLink').href='/products-page/transaction-terms.html?version='+encodeURIComponent(data.published.version)+'#transaction-terms';
      sync();
    };
    const showError=text=>{get('policySettingsError').hidden=false;get('policySettingsErrorText').textContent=text;};
    const request=async(path,options={})=>{
      const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20000);
      try {
        const response=await fetch(api+'/admin/commerce-policy'+path,{...options,signal:controller.signal,headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+window.AdminSession?.getToken()}});
        const json=await response.json().catch(()=>({}));
        if(response.status===401)throw Error('Your session has expired. Sign in again to continue.');
        if(response.status===403)throw Error('Your account does not have permission to manage these settings.');
        if(!response.ok)throw Error(Object.values(json.errors||{}).flat()[0]||json.message||'Policy settings could not be saved. Please retry.');
        if(!json.data || typeof json.data.can_edit!=='boolean')throw Error('Policy settings could not be loaded. Please retry.');
        return json.data;
      } catch(failure) {
        if(failure.name==='AbortError')throw Error('The request timed out. Refresh to check the latest settings before trying again.');
        throw failure;
      } finally {clearTimeout(timeout);}
    };
    const load=async()=>{
      busy=true;loaded=false;sync();get('policySettingsError').hidden=true;
      try{apply(await request(''));}
      catch(failure){
        loaded=false;showError(failure.message||'The policy could not be loaded. Retry before editing.');
        get('policyPublishedTitle').textContent='Policy unavailable';
        get('policyPublishedMessage').textContent='Published policy settings are unavailable. Please try again.';
        get('policyPublishedDocuments').hidden=true;
        get('policyPublishedTerms').textContent='';get('policyPublishedRefund').textContent='';get('policyPublishedLink').hidden=true;get('policyPublishedTermsLink').hidden=true;
      }finally{busy=false;sync();}
    };
    const save=async(publish)=>{busy=true;sync();get('policySettingsError').hidden=true;try{apply(await request(publish?'/publish':'/draft',{method:publish?'POST':'PUT',body:JSON.stringify({expected_revision:record.revision,...(publish?{approved:true,...(record.has_saved_draft===false?{initial_draft:read()}:{})}:read())})}));window.showAdminSuccessNotification?.(publish?'Approved transaction terms and refund policy published.':'Policy draft saved.',{title:'Saved!'});}catch(error){showError(error.message);}finally{busy=false;sync();}};
    get('policyEditorForm').addEventListener('input',sync);get('policyApproval').addEventListener('change',sync);
    get('policyEditorForm').addEventListener('submit',event=>{event.preventDefault();if(!canEdit()||busy||!changed()||!get('policyEditorForm').reportValidity())return;window.showAdminConfirmPopup('Save this wording as a policy draft for FMRC review?',{title:'Save Policy Draft',confirmText:'Save draft',onConfirm:()=>save(false)});});
    get('policyPublish').addEventListener('click',()=>{if(get('policyPublish').disabled)return;window.showAdminConfirmPopup('Publish the FMRC-approved transaction terms and refund policy? Customers must accept this new version before placing an order.',{title:'Publish Approved Policy',confirmText:'Publish',onConfirm:()=>save(true)});});
    get('policyDraftDiscard').addEventListener('click',()=>{if(!busy&&record)apply(record);});
    const refresh=()=>{if(busy)return;if(changed())window.showAdminConfirmPopup('Discard unsaved wording and load the latest policy draft?',{title:'Refresh Policy',confirmText:'Load latest',onConfirm:load});else void load();};
    get('policySettingsRefresh').addEventListener('click',refresh);get('policySettingsRetry').addEventListener('click',refresh);
    void(window.AdminWebsiteLoading?window.AdminWebsiteLoading.during(load):load());
  });
})();
