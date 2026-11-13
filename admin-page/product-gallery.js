/* Shared Admin/Staff editor. Uploaded drafts are never public before save. */
window.createProductGalleryEditor = ({ root, api, token, getCover, replaceCover, onBusy }) => {
  if (!root) return null;
  let productId, items = [], busy = false, generation = 0, upload = null, saving = false;
  let progress = '', error = '', replaceIndex = null;
  const urls = new Set(), draftTokens = new Set();
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const message = payload => Object.values(payload?.errors || {})[0]?.[0] || payload?.message || 'The upload failed. Please try again.';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icons = {
    add: '<path d="M12 5v14M5 12h14"/>',
    replace: '<path d="M20 4v5h-5M4 20v-5h5M4.9 9a7.5 7.5 0 0 1 12.4-4.3L20 9M4 15l2.7 4.3A7.5 7.5 0 0 0 19.1 15"/>',
    remove: '<path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/>',
    earlier: '<path d="m12 5-7 7 7 7M5 12h14"/>',
    later: '<path d="m12 5 7 7-7 7M5 12h14"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${icons[name]}</svg>`;
  const actionButton = (action, index, label, disabled = false) => `<button type="button" class="btn-admin btn-secondary gallery-icon-button" data-gallery-action="${action}" data-index="${index}" aria-label="${label}" title="${label}" ${busy || saving || disabled ? 'disabled' : ''}>${icon(action)}</button>`;
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
      <p class="field-hint">Cover first, then up to four photos or clips. One video per product.</p>
      <p class="field-hint product-gallery-guidance">Photos: JPG, PNG, WebP · 10 MB max.<br>Video: MP4, WebM · 30 MB · 30 seconds max.</p>
      <ol class="product-gallery-slots">${slots.map((item, index) => `<li class="product-gallery-slot">
        <div class="product-gallery-number"><b>${index + 1}</b><span>${item?.cover ? 'Cover image' : item ? item.type === 'video' ? `Video · ${Number(item.duration_seconds || 0).toFixed(1)}s` : 'Product image' : 'Empty slot'}</span></div>
        <div class="product-gallery-preview">${item?.url ? item.type === 'video' ? `<video src="${esc(item.url)}" controls playsinline preload="metadata"></video>` : `<img src="${esc(item.url)}" alt="${index === 0 ? 'Product cover' : `Gallery image ${index + 1}`}" decoding="async">` : `<span class="product-gallery-empty">${icon('image')}<span>${index ? 'Add a photo or video' : 'Choose a cover'}</span></span>`}</div>
        <div class="product-gallery-tools" role="group" aria-label="Slot ${index + 1} controls"><span class="product-gallery-tool-pair">${item ? actionButton('replace', index, index ? `Replace item ${index + 1}` : 'Replace cover image') : actionButton('add', index, 'Add media to gallery', !cover)}${index && item ? actionButton('remove', index, `Remove item ${index + 1}`) : ''}</span>${index && item ? `<span class="product-gallery-tool-pair">${actionButton('earlier', index, `Move item ${index + 1} earlier`, index === 1)}${actionButton('later', index, `Move item ${index + 1} later`, index === items.length)}</span>` : index === 0 ? '<span class="product-gallery-cover-note">Card cover · fixed first</span>' : ''}</div>
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
      window.showAdminPopup?.(progress, { title: 'Media ready', type: 'success' });
    } catch (failure) {
      if (generation === currentGeneration) {
        error = failure.message;
        window.showAdminPopup?.(error, { title: 'Upload unsuccessful', type: 'error', onOk: () => root.querySelector('[data-gallery-action]:not(:disabled)')?.focus() });
      }
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
