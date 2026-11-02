/* Published-policy acceptance stays independent of payment and shipping state. */
(() => {
  'use strict';
  document.addEventListener('DOMContentLoaded',()=>{
    const checkbox=document.getElementById('orderTerms'),status=document.getElementById('checkoutPolicyStatus');
    if(!checkbox||!status)return;
    const api=(window.APP_API_BASE_URL||(['localhost','127.0.0.1'].includes(location.hostname)&&location.port!=='8000'?location.protocol+'//'+location.hostname+':8000/api':location.origin+'/api')).replace(/\/$/,'');
    let policy=null,failed=false,pending=null,busy=false;
    const ready=()=>!!policy&&!failed&&!busy&&checkbox.checked;
    const paint=()=>{
      checkbox.disabled=!policy||busy||failed;
      window.FMRC_PAYMENT_METHODS?.setPolicyReady(ready());
      status.textContent=busy?'Loading order policies…':failed?'Order policies could not be loaded. Please try again.':!policy?'Ordering is temporarily unavailable while FMRC prepares its transaction terms and refund policy. Please contact FMRC for assistance.':checkbox.checked?'You have accepted the current transaction terms and refund policy.':'Review both policies, then select the checkbox to agree.';
      document.getElementById('checkoutPolicyRetry').hidden=!failed;
      for(const [id,page]of [['checkoutTermsLink','transaction-terms'],['checkoutRefundLink','refund-policy']]){
        const link=document.getElementById(id);link.href='/products-page/'+page+'.html'+(policy?'?version='+encodeURIComponent(policy.version):'')+'#'+page;
      }
    };
    const apply=data=>{if(policy?.version!==data?.version)checkbox.checked=false;policy=data;failed=false;paint();};
    const refresh=()=>{
      if(pending)return pending;
      busy=true;paint();
      const controller=new AbortController();const deadline=setTimeout(()=>controller.abort(),15000);
      pending=(async()=>{
        try{const response=await fetch(api+'/commerce/policy',{headers:{Accept:'application/json'},signal:controller.signal,cache:'no-store'});const json=await response.json();if(!response.ok||!Object.hasOwn(json,'data'))throw Error();apply(json.data);}
        catch{failed=true;}
        finally{clearTimeout(deadline);busy=false;pending=null;paint();}
        return ready();
      })();return pending;
    };
    window.FMRC_CHECKOUT_POLICY={refresh,version:()=>ready()?policy.version:null,reject:data=>{checkbox.checked=false;apply(data);paint();}};
    checkbox.addEventListener('change',paint);
    const checkout=document.getElementById('checkoutModal');
    if(checkout)new MutationObserver(()=>{if(!checkout.classList.contains('show-modal')){checkbox.checked=false;paint();}}).observe(checkout,{attributes:true,attributeFilter:['class']});
    document.getElementById('checkoutPolicyRetry').addEventListener('click',refresh);
    void refresh();
  });
})();
