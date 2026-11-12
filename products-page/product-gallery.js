/* Lazy product gallery. Review media continues to use the existing shared lightbox. */
(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  window.FMRCProductGallery = {
    create(host, {apiBase, expand}) {
      if (!host) return null;
      let items = [], index = 0, product = null, request = null, generation = 0;
      host.classList.add('product-gallery');
      host.setAttribute('role','region'); host.setAttribute('aria-label','Product photos and videos');
      host.innerHTML = '<div class="product-gallery-stage"></div><div class="product-gallery-toolbar"><div class="product-gallery-controls"><button type="button" class="product-gallery-prev" aria-label="Previous product media">←</button><span class="product-gallery-count" aria-live="polite"></span><button type="button" class="product-gallery-next" aria-label="Next product media">→</button></div><button type="button" class="product-gallery-expand">View fullscreen ↗</button></div><div class="product-gallery-thumbs" aria-label="Choose a product photo or video"></div><p class="product-gallery-status" aria-live="polite"></p><button type="button" class="product-gallery-retry" hidden>Retry gallery</button>';
      const stage = host.querySelector('.product-gallery-stage'), thumbs = host.querySelector('.product-gallery-thumbs');
      const status = host.querySelector('.product-gallery-status'), retry = host.querySelector('.product-gallery-retry');
      const pause = () => stage.querySelector('video')?.pause();
      const fullscreen = () => { const item = items[index]; if (!item) return; pause(); expand({src:item.url, type:item.type, title:`${product.name} · ${index + 1} of ${items.length}`,
        gallery:items.length > 1 ? {previous:()=>{select(index - 1);fullscreen();},next:()=>{select(index + 1);fullscreen();}} : null}); };
      const render = () => {
        pause(); stage.replaceChildren();
        const item = items[index];
        host.querySelector('.product-gallery-toolbar').hidden = !item;
        host.querySelector('.product-gallery-prev').disabled = items.length < 2;
        host.querySelector('.product-gallery-next').disabled = items.length < 2;
        host.querySelector('.product-gallery-count').textContent = item ? `${index + 1} / ${items.length}` : '0 / 0';
        if (item) {
          const element = document.createElement(item.type === 'video' ? 'video' : 'img');
          element.src = item.url;
          if (item.type === 'video') { element.controls = true; element.playsInline = true; element.preload = 'metadata'; element.setAttribute('aria-label',`${product.name} video ${index + 1}`); }
          else { element.alt = `${product.name} — photo ${index + 1}`; element.decoding = 'async'; element.tabIndex = 0; element.setAttribute('role','button'); element.setAttribute('aria-label',`View ${product.name} photo ${index + 1} fullscreen`); element.addEventListener('click', fullscreen); element.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();fullscreen();}}); }
          element.addEventListener('error', () => { if (!stage.contains(element)) return; status.textContent = item.type === 'video' ? 'This video could not play. Try another item or open it fullscreen.' : 'This photo could not load. Try another item or reload the gallery.'; retry.hidden = false; });
          stage.append(element);
        } else { const empty = document.createElement('p'); empty.className='product-gallery-status'; empty.textContent = 'No product photos available yet.'; stage.append(empty); }
        thumbs.innerHTML = items.map((media, position) => `<button type="button" class="product-gallery-thumb" data-index="${position}" aria-label="${media.type === 'video' ? 'Video' : 'Photo'} ${position + 1} of ${items.length}" aria-pressed="${position === index}">${media.type === 'video' ? '<span aria-hidden="true">▶</span><small>VIDEO</small>' : `<img src="${escape(media.thumbnail_url || media.url)}" alt="" loading="lazy" decoding="async">`}</button>`).join('');
        thumbs.hidden = items.length < 2;
      };
      const select = position => { if (!items.length) return; index = (position + items.length) % items.length; status.textContent=''; render(); };
      host.querySelector('.product-gallery-prev').addEventListener('click', () => select(index - 1));
      host.querySelector('.product-gallery-next').addEventListener('click', () => select(index + 1));
      host.querySelector('.product-gallery-expand').addEventListener('click', fullscreen);
      thumbs.addEventListener('click', event => { const button=event.target.closest('[data-index]'); if (!button) return; const position=Number(button.dataset.index); select(position); thumbs.querySelector(`[data-index="${position}"]`)?.focus({preventScroll:true}); });
      host.addEventListener('keydown', event => {
        if (document.querySelector('#imageLightboxModal.show-modal')) return;
        if (event.target.closest('video') || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key) || items.length < 2) return;
        event.preventDefault(); const position=event.key==='Home'?0:event.key==='End'?items.length-1:index+(event.key==='ArrowLeft'?-1:1);
        select(position); thumbs.querySelector(`[data-index="${index}"]`)?.focus({preventScroll:true});
      });
      const fetchGallery = async () => {
        request?.abort(); request = new AbortController(); const current=++generation;
        status.textContent='Loading product gallery…'; retry.hidden=true; host.setAttribute('aria-busy','true');
        try {
          const response=await fetch(`${apiBase}/products/${product.id}/media`,{signal:request.signal,headers:{Accept:'application/json'},cache:'no-store'});
          if(!response.ok)throw Error('Gallery unavailable'); const payload=await response.json();
          if(current!==generation)return;
          if(!Array.isArray(payload.data?.media))throw Error('Gallery unavailable');
          items=payload.data.media.filter(item=>item.url && ['image','video'].includes(item.type));
          index=Math.max(0,items.findIndex(item=>String(item.id)===String(payload.data.cover))); render(); status.textContent='';
        } catch(error) {
          if(error.name==='AbortError'||current!==generation)return;
          status.textContent='The gallery could not load. Your product details are still available.'; retry.hidden=false;
        } finally { if(current===generation)host.setAttribute('aria-busy','false'); }
      };
      retry.addEventListener('click',fetchGallery);
      const hide=()=>{generation++;request?.abort();pause();host.setAttribute('aria-busy','false');};
      const modal=host.closest('.modal-overlay');
      if(modal)new MutationObserver(()=>{if(!modal.classList.contains('show-modal'))hide();}).observe(modal,{attributes:true,attributeFilter:['class']});
      return {pause,hide,show(value){hide();product=value;index=0;status.textContent='';retry.hidden=true;
        let url=value.image_data;
        if(url){const parsed=new URL(url,location.href);if(parsed.pathname.includes('/product-media/'))parsed.searchParams.delete('thumbnail');if(parsed.pathname.match(/\/api\/products\/\d+\/image$/))parsed.searchParams.set('full','1');url=parsed.href;}
        items=url?[{type:'image',name:value.name,url,thumbnail_url:value.image_data}]:[];render();void fetchGallery();
      }};
    },
  };
})();
