/* Shared by Admin and Staff. Uploading a file never changes a published product. */
(() => {
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const size = bytes => bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : '';
  window.FMRCProductMediaEditor = {
    create(root, {apiBase, token, onChange = () => {}}) {
      if (!root) return null;
      let items = [], cover = null, revision = 0, generation = 0;
      const requests = new Set();
      root.classList.add('product-media-editor');
      root.innerHTML = `<div class="pme-heading"><div><h3>Product photos and videos</h3><p>Choose a cover photo and arrange the gallery customers will see.</p></div><span class="pme-count"></span></div>
        <label class="pme-upload"><span aria-hidden="true">＋</span><strong>Add photos or videos</strong><span>Choose files or drop them here</span><input type="file" multiple accept=".jpg,.jpeg,.png,.webp,.gif,.mp4" aria-label="Add product photos or videos"></label>
        <p class="pme-help">Up to 10 items, including 2 MP4 videos. Photos: 5 MB each. Videos: 50 MB each. Use H.264 MP4 for best playback.</p>
        <p class="pme-error" role="alert" hidden></p><ol class="pme-list" aria-label="Product gallery order"></ol>
        <p class="pme-empty">No media yet. Add photos to show the product from different angles.</p>
        <p class="pme-footnote">Drag items to reorder, or use the move buttons. Gallery changes appear online only after you save the product.</p>`;
      const list = root.querySelector('.pme-list'), input = root.querySelector('input'), error = root.querySelector('.pme-error');
      const dialog = document.createElement('dialog');
      dialog.className = 'pme-preview';
      dialog.innerHTML = '<button type="button" class="pme-preview-close" aria-label="Close media preview">Close preview ×</button><div class="pme-preview-media"></div><p></p>';
      document.body.append(dialog);
      const closePreview = () => dialog.close();
      dialog.querySelector('button').addEventListener('click', closePreview);
      dialog.addEventListener('close', () => { dialog.querySelector('video')?.pause(); dialog.querySelector('.pme-preview-media').replaceChildren(); });
      const showError = (message = '') => { error.textContent = message; error.hidden = !message; };
      const discard = uploadToken => fetch(`${apiBase}/admin/products/media-uploads/${uploadToken}`, {method:'DELETE', headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}, keepalive:true}).catch(() => {});
      const snapshot = () => ({items:items.map(item => item.key), cover});
      const render = (focusKey, focusAction) => {
        const focused = list.contains(document.activeElement) ? document.activeElement.closest('[data-key]') : null;
        if (!focusKey && focused) { focusKey = focused.dataset.key; focusAction = document.activeElement.dataset.action; }
        root.querySelector('.pme-count').textContent = `${items.length} / 10 items`;
        root.querySelector('.pme-empty').hidden = !!items.length;
        list.innerHTML = items.map((item, index) => `<li class="pme-item" data-key="${escape(item.key)}" draggable="true">
          <button type="button" class="pme-media" data-action="preview" aria-label="Preview ${escape(item.name)}">${item.type === 'video' ? '<span class="pme-play" aria-hidden="true">▶</span><span>MP4 video</span>' : `<img src="${escape(item.thumbnail_url || item.url)}" alt="${escape(item.name)}" loading="lazy" decoding="async">`}</button>
          <div class="pme-item-body"><div class="pme-item-title"><span title="${escape(item.name)}">${escape(item.name)}</span>${cover === item.key ? '<span class="pme-cover-badge">Cover</span>' : ''}</div>
          <small>${item.type === 'video' ? 'Video' : 'Photo'}${item.size ? ' · ' + size(item.size) : ''}</small>
          ${item.status === 'uploading' ? `<div class="pme-progress"><progress max="100" value="${item.progress || 0}" aria-label="Uploading ${escape(item.name)}"></progress><span>Uploading…</span></div>` : ''}
          ${item.status === 'error' ? `<p class="pme-item-error">${escape(item.error)}</p><button type="button" data-action="retry">Retry upload</button>` : ''}
          <div class="pme-actions"><button type="button" data-action="earlier" ${index === 0 ? 'disabled' : ''} aria-label="Move ${escape(item.name)} earlier">←</button><button type="button" data-action="later" ${index === items.length - 1 ? 'disabled' : ''} aria-label="Move ${escape(item.name)} later">→</button>
          ${item.type === 'image' ? `<button type="button" data-action="cover" aria-pressed="${cover === item.key}">${cover === item.key ? 'Cover photo' : 'Set cover'}</button>` : ''}<button type="button" data-action="remove" aria-label="Remove ${escape(item.name)}">Remove</button></div></div></li>`).join('');
        if (focusKey) {
          const card = list.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
          const control = card?.querySelector(`[data-action="${focusAction}"]`);
          (control && !control.disabled ? control : card?.querySelector('[data-action="preview"]'))?.focus({preventScroll:true});
        } else if (focusAction) input.focus({preventScroll:true});
        onChange();
      };
      const upload = item => {
        item.status = 'uploading'; item.progress = 0; item.error = '';
        const current = generation, xhr = new XMLHttpRequest();
        item.request = xhr; requests.add(xhr);
        xhr.open('POST', `${apiBase}/admin/products/media-uploads`);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`); xhr.setRequestHeader('Accept','application/json');
        xhr.timeout = 180000;
        xhr.upload.onprogress = event => {
          if (!event.lengthComputable || current !== generation) return;
          item.progress = Math.round(event.loaded / event.total * 100);
          const progress = list.querySelector(`[data-key="${CSS.escape(item.key)}"] progress`);
          if (progress) progress.value = item.progress;
        };
        const finish = () => { requests.delete(xhr); delete item.request; };
        xhr.onload = () => {
          finish();
          let payload; try { payload = JSON.parse(xhr.responseText); } catch { payload = {}; }
          if (current !== generation || !items.includes(item)) { if (payload.data?.token) void discard(payload.data.token); return; }
          if (xhr.status >= 200 && xhr.status < 300 && payload.data?.token) {
            item.token = payload.data.token; item.status = 'ready';
          } else {
            item.status = 'error'; item.error = Object.values(payload.errors || {})[0]?.[0] || payload.message || 'Upload failed. Please try again.';
          }
          render();
        };
        xhr.onerror = xhr.ontimeout = () => { finish(); if (current !== generation || !items.includes(item)) return; item.status = 'error'; item.error = 'Connection lost. Retry this upload.'; render(); };
        xhr.onabort = finish;
        const data = new FormData(); data.append('file', item.file); xhr.send(data);
      };
      const addFiles = files => {
        const messages = [];
        for (const file of files) {
          const video = /\.mp4$/i.test(file.name), image = /\.(jpe?g|png|webp|gif)$/i.test(file.name);
          if (!video && !image) { messages.push(`${file.name}: choose a photo or MP4 video.`); continue; }
          if (file.size > (video ? 50 : 5) * 1024 * 1024) { messages.push(`${file.name}: ${video ? '50' : '5'} MB limit exceeded.`); continue; }
          if (items.length >= 10) { messages.push('The gallery can contain up to 10 items.'); break; }
          if (video && items.filter(item => item.type === 'video').length >= 2) { messages.push('The gallery can contain up to two videos.'); continue; }
          const item = {key:crypto.randomUUID(), name:file.name, type:video?'video':'image', size:file.size, file, url:URL.createObjectURL(file)};
          items.push(item); if (!cover && image) cover = item.key;
          upload(item);
        }
        input.value = ''; showError([...new Set(messages)].join(' ')); render();
      };
      input.addEventListener('change', () => addFiles([...input.files]));
      let dragKey = null;
      list.addEventListener('dragstart', event => { dragKey = event.target.closest('[data-key]')?.dataset.key; if (dragKey) event.dataTransfer.setData('text/plain', dragKey); });
      root.addEventListener('dragover', event => { event.preventDefault(); });
      root.addEventListener('drop', event => {
        event.preventDefault();
        if (event.dataTransfer.files.length) { addFiles([...event.dataTransfer.files]); return; }
        const target = event.target.closest('[data-key]')?.dataset.key;
        const from = items.findIndex(item => item.key === dragKey), to = items.findIndex(item => item.key === target);
        if (from >= 0 && to >= 0 && from !== to) { items.splice(to, 0, items.splice(from, 1)[0]); render(); }
        dragKey = null;
      });
      list.addEventListener('click', event => {
        const button = event.target.closest('[data-action]'); if (!button) return;
        const key = button.closest('[data-key]').dataset.key, index = items.findIndex(item => item.key === key), item = items[index];
        if (!item) return;
        const action = button.dataset.action;
        if (action === 'preview') {
          const media = document.createElement(item.type === 'video' ? 'video' : 'img'); media.src = item.url;
          if (item.type === 'video') { media.controls = true; media.playsInline = true; media.preload = 'metadata'; } else media.alt = item.name;
          dialog.querySelector('.pme-preview-media').replaceChildren(media); dialog.querySelector('p').textContent = item.name; dialog.showModal(); return;
        }
        if (action === 'retry') { upload(item); render(); return; }
        if (action === 'cover') cover = key;
        if (action === 'earlier' && index > 0) items.splice(index - 1, 0, items.splice(index, 1)[0]);
        if (action === 'later' && index < items.length - 1) items.splice(index + 1, 0, items.splice(index, 1)[0]);
        if (action === 'remove') {
          items.splice(index, 1); item.request?.abort();
          if (item.token) void discard(item.token); if (item.file) URL.revokeObjectURL(item.url);
          if (cover === key) cover = items.find(item => item.type === 'image')?.key || null;
        }
        showError(); render(action === 'remove' ? items[Math.min(index, items.length - 1)]?.key : key, action === 'remove' ? 'preview' : action);
      });
      const reset = (product = null) => {
        generation++; requests.forEach(xhr => xhr.abort()); requests.clear();
        if (dialog.open) dialog.close();
        for (const item of items) { if (item.token) void discard(item.token); if (item.file) URL.revokeObjectURL(item.url); }
        const media = Array.isArray(product?.media) ? product.media : product?.image_data ? [{id:'legacy', legacy:true, type:'image', name:'Current product photo', url:product.image_data}] : [];
        items = media.map(item => ({...item, key:String(item.id), status:'ready'}));
        cover = product?.cover != null ? String(product.cover) : items.find(item => item.type === 'image')?.key || null;
        revision = Number(product?.media_revision) || 0; showError(); render();
      };
      reset();
      return {
        reset, snapshot,
        setSaving(value) { root.inert = value; },
        get busy() { return items.some(item => item.status === 'uploading'); },
        payload() {
          if (items.some(item => item.status !== 'ready')) { showError('Finish or retry the uploads before saving this product.'); throw new Error(error.textContent); }
          if (items.length && !items.some(item => item.key === cover && item.type === 'image')) { showError('Add and select a cover photo before saving a video gallery.'); throw new Error(error.textContent); }
          return {media:items.map(item => item.token ? {token:item.token} : item.legacy ? {legacy:true} : {id:Number(item.id)}), cover:cover == null ? null : (items.find(item => item.key === cover)?.token || cover), media_revision:revision};
        },
      };
    },
  };
})();
