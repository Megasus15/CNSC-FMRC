(() => {
  'use strict';
  document.addEventListener('DOMContentLoaded',async()=>{
    const root=document.getElementById('policyDocument');if(!root)return;
    const api=(window.APP_API_BASE_URL||(['localhost','127.0.0.1'].includes(location.hostname)&&location.port!=='8000'?location.protocol+'//'+location.hostname+':8000/api':location.origin+'/api')).replace(/\/$/,'');
    const version=new URLSearchParams(location.search).get('version');
    const status=document.getElementById('policyPageStatus');
    const render=(target,text)=>{
      target.replaceChildren();
      for(const paragraph of String(text).split(/\n\s*\n/)){
        const parts=paragraph.trim().split('\n');if(!parts[0])continue;
        const section=document.createElement('section');section.className='policy-document-section';
        if(parts.length>1){const title=document.createElement('h3');title.textContent=parts.shift();section.append(title);}
        const body=document.createElement('p');body.textContent=parts.join('\n');section.append(body);target.append(section);
      }
    };
    const load=async()=>{
      document.getElementById('policyPageRetry').hidden=true;
      status.textContent='Loading the published policy…';root.setAttribute('aria-busy','true');
      try{
        const response=await fetch(api+'/commerce/policy'+(version?'/'+encodeURIComponent(version):''),{headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)});
        const json=await response.json();if(!response.ok)throw Error();
        if(!json.data){status.textContent='The transaction terms and refund policy have not been published yet. Please contact FMRC for assistance before ordering.';return;}
        const policy=json.data;
        document.getElementById('policyPageTitle').textContent=policy.title;
        document.getElementById('policyPageVersion').textContent='Policy version '+policy.version;
        status.textContent='Published '+new Date(policy.published_at.replace(' ','T')+(policy.published_at.includes('T')?'':'Z')).toLocaleDateString('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'long',day:'numeric'})+'.';
        render(document.getElementById('policyTermsText'),policy.terms_text);render(document.getElementById('policyRefundText'),policy.refund_text);
        document.getElementById('policySections').hidden=false;
        if(location.hash)document.querySelector(location.hash==='\u0023transaction-terms'?'#transaction-terms':'#refund-policy')?.scrollIntoView({block:'start'});
      }catch{status.textContent='The policy could not be loaded. Please try again or contact FMRC for assistance.';document.getElementById('policyPageRetry').hidden=false;}
      finally{root.setAttribute('aria-busy','false');}
    };
    document.getElementById('policyPageRetry').addEventListener('click',load);await load();
  });
})();
