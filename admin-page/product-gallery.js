/* Shared Admin/Staff editor. Uploaded drafts are never public before save. */
window.createProductGalleryEditor = ({ root, api, token, getCover, replaceCover, onBusy }) => {
  if (!root) return null;
  let productId, items = [], busy = false, generation = 0, upload = null, saving = false;
  let progress = '', error = '', replaceIndex = null;
  const urls = new Set(), draftTokens = new Set();
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const message = payload => Object.values(payload?.errors || {})[0]?.[0] || payload?.message || 'The upload failed. Please try again.';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const endpoint = (id = productId) => `${api}/admin/products/${id}/media-uploads`;
  const discard = (receipt, id = productId) => fetch(`${endpoint(id)}/${receipt}`, { method: 'DELETE', headers }).catch(() => {});
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp,video/mp4,video/webm';
  input.hidden = true;
  root.after(input);
  function setBusy(value) { busy = value; onBusy?.(value); }
  function render() {
    root.querySelectorAll('video').forEach(video => video.pause());
    const cover = getCover();
    const slots = [{type:'image', url:cover, cover:true}, ...items];
    while (slots.length < 5) slots.push(null);
    root.innerHTML = `<div class="product-gallery-heading"><h3>Product gallery</h3><span>${(cover ? 1 : 0) + items.length} / 5 items</span></div>
      <p class="field-hint">Your cover appears on the product card and first in Product Details. Add up to four more images or one short video.</p>
      <p class="field-hint">JPG, PNG or WebP · up to 10 MB each. MP4 or WebM · up to 30 MB and 30 seconds. One video per product.</p>
      <ol class="product-gallery-slots">${slots.map((item, index) => `<li class="product-gallery-slot">
        <div class="product-gallery-number">${index + 1}<span>${item?.cover ? 'Cover image' : item ? item.type === 'video' ? `Video · ${Number(item.duration_seconds || 0).toFixed(1)}s` : 'Product image' : 'Empty slot'}</span></div>
        <div class="product-gallery-preview">${item?.url ? item.type === 'video' ? `<video src="${esc(item.url)}" controls playsinline preload="metadata"></video>` : `<img src="${esc(item.url)}" alt="${index === 0 ? 'Product cover' : `Gallery image ${index + 1}`}" decoding="async">` : '<span>No media</span>'}</div>
        <div class="product-gallery-tools">${item ? `<button type="button" data-gallery-action="replace" data-index="${index}" ${busy || saving ? 'disabled' : ''}>Replace<span class="admin-loading-sr-only"> item ${index + 1}</span></button>${index ? `<button type="button" data-gallery-action="remove" data-index="${index}" ${busy || saving ? 'disabled' : ''}>Remove<span class="admin-loading-sr-only"> item ${index + 1}</span></button>` : ''}` : `<button type="button" data-gallery-action="add" ${busy || saving || !cover ? 'disabled' : ''}>Add media<span class="admin-loading-sr-only"> to gallery</span></button>`}</div>
        ${index > 0 && item ? `<div class="product-gallery-tools product-gallery-move"><button type="button" data-gallery-action="earlier" data-index="${index}" aria-label="Move item ${index + 1} earlier" ${index === 1 || busy || saving ? 'disabled' : ''}>← Earlier</button><button type="button" data-gallery-action="later" data-index="${index}" aria-label="Move item ${index + 1} later" ${index === items.length || busy || saving ? 'disabled' : ''}>Later →</button></div>` : ''}
      </li>`).join('')}</ol>
      <p class="product-gallery-status${error ? ' is-error' : ''}" role="${error ? 'alert' : 'status'}">${esc(error || progress || (!cover ? 'Choose a cover image before adding gallery media.' : 'Changes are published when you select Update Product.'))}</p>`;
  }
  function release(item) {
    if (item?.url && urls.has(item.url)) { URL.revokeObjectURL(item.url); urls.delete(item.url); }
  }
  const metadata = (file, url) => new Promise((resolve, reject) => {
    const media = document.createElement(file.type.startsWith('video/') ? 'video' : 'img');
    const video = media.tagName === 'VIDEO';
    const timeout = setTimeout(() => finish(new Error('This file could not be read. Choose another file.')), 15000);
    const finish = failure => {
      clearTimeout(timeout);
      media.onload = media.onloadedmetadata = media.onerror = null;
      if (video) { media.pause(); media.removeAttribute('src'); media.load(); }
      failure ? reject(failure) : resolve();
    };
    if (video) {
      media.preload = 'metadata';
      media.onloadedmetadata = () => finish(!Number.isFinite(media.duration) || media.duration <= 0 || media.duration > 30 ? new Error('The video must be readable and 30 seconds or shorter.') : null);
    } else media.onload = () => finish(media.naturalWidth ? null : new Error('This image could not be read.'));
    media.onerror = () => finish(new Error('This file could not be read. Export it as JPG, PNG, WebP, MP4, or WebM.'));
    media.src = url;
  });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file || busy || saving) return;
    const currentGeneration = generation, id = productId, index = replaceIndex;
    const isVideo = file.type.startsWith('video/');
    let objectUrl, completed = false;
    error = ''; progress = 'Checking media…'; setBusy(true); render();
    try {
      if (!['image/jpeg','image/png','image/webp','video/mp4','video/webm'].includes(file.type)) throw Error('Choose a JPG, PNG, WebP, MP4, or WebM file.');
      if (file.size > (isVideo ? 30 : 10) * 1024 * 1024) throw Error(isVideo ? 'The video must be 30 MB or smaller.' : 'Each image must be 10 MB or smaller.');
      if (!getCover()) throw Error('Choose a cover image before adding gallery media.');
      if (index === null && items.length >= 4) throw Error('The gallery already has five items, including the cover.');
      if (isVideo && items.some((item, i) => item.type === 'video' && i !== index)) throw Error('Only one short video can be added to a product.');
      objectUrl = URL.createObjectURL(file); urls.add(objectUrl);
      await metadata(file, objectUrl);
      if (generation !== currentGeneration) return;
      const result = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest(); upload = xhr;
        xhr.open('POST', endpoint(id));
        Object.entries(headers).forEach(([key,value]) => xhr.setRequestHeader(key,value));
        xhr.timeout = 120000;
        xhr.upload.onprogress = event => {
          if (generation !== currentGeneration) return;
          progress = event.lengthComputable ? `Uploading media… ${Math.round(event.loaded / event.total * 100)}%` : 'Uploading media…';
          const status = root.querySelector('.product-gallery-status'); if (status) status.textContent = progress;
        };
        xhr.onload = () => {
          let payload; try { payload = JSON.parse(xhr.responseText); } catch { payload = {}; }
          xhr.status >= 200 && xhr.status < 300 ? resolve(payload.data) : reject(Error(message(payload)));
        };
        xhr.onerror = xhr.ontimeout = () => reject(Error('Connection lost. Your saved gallery has not changed. Try the upload again.'));
        xhr.onabort = () => reject(Error('Upload cancelled.'));
        const form = new FormData(); form.append('file',file); xhr.send(form);
      });
      if (generation !== currentGeneration) { void discard(result.upload_token,id); return; }
      draftTokens.add(result.upload_token);
      const item = { ...result, url: objectUrl };
      if (index === null) items.push(item);
      else {
        const previous = items[index]; release(previous);
        if (previous.upload_token) { draftTokens.delete(previous.upload_token); void discard(previous.upload_token,id); }
        items[index] = item;
      }
      completed = true;
      progress = 'Media added to your draft. Select Update Product to publish.';
    } catch (failure) {
      if (generation === currentGeneration) error = failure.message;
    } finally {
      if (objectUrl && !completed) { URL.revokeObjectURL(objectUrl); urls.delete(objectUrl); }
      if (generation === currentGeneration) { upload = null; setBusy(false); render(); }
    }
  });
  root.addEventListener('click', event => {
    const button = event.target.closest('[data-gallery-action]');
    if (!button || busy || saving) return;
    const action = button.dataset.galleryAction, index = Number(button.dataset.index) - 1;
    error = ''; progress = '';
    if (action === 'replace' && index === -1) { replaceCover(); return; }
    if (action === 'add' || action === 'replace') {
      replaceIndex = action === 'add' ? null : index;
      input.click(); return;
    }
    if (action === 'remove') {
      const [item] = items.splice(index,1); release(item);
      if (item.upload_token) { draftTokens.delete(item.upload_token); void discard(item.upload_token); }
    } else {
      const other = index + (action === 'earlier' ? -1 : 1);
      if (other >= 0 && other < items.length) [items[index],items[other]] = [items[other],items[index]];
    }
    render();
    const moved = action === 'earlier' ? index : action === 'later' ? index + 2 : Math.min(index + 1,items.length);
    root.querySelector(`[data-index="${moved}"]:not(:disabled)`)?.focus();
  });
  function close(published = false) {
    generation++; upload?.abort(); upload = null;
    if (!published) for (const receipt of draftTokens) void discard(receipt);
    draftTokens.clear();
    for (const url of urls) URL.revokeObjectURL(url);
    urls.clear(); items = []; saving = false; setBusy(false);
    root.querySelectorAll('video').forEach(video => video.pause());
  }
  return {
    load(product) {
      close(); productId = product.id;
      items = (product.media || []).filter(item => item.id !== 'cover').map(item => ({...item}));
      error = ''; progress = ''; render();
      if (product.is_blocked) {
        const loaded = generation;
        items.forEach(async item => {
          try {
            const response = await fetch(`${api}/admin/products/${productId}/media/${item.id}`, {headers});
            if (!response.ok) return;
            const blob = await response.blob();
            if (loaded !== generation || !items.includes(item)) return;
            item.url = URL.createObjectURL(blob); urls.add(item.url); render();
          } catch {}
        });
      }
    },
    render,
    destroy() { close(); input.remove(); },
    snapshot: () => items.map(item => item.upload_token ? {upload_token:item.upload_token} : {id:item.id}),
    isBusy: () => busy,
    setSaving(value) { saving = value; render(); },
    close,
  };
};
