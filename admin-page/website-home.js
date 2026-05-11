/* jshint esversion: 9 */
'use strict';

const API = 'http://127.0.0.1:8000/api';
const token = () => (window.AdminSession && window.AdminSession.getToken()) || localStorage.getItem('auth_token');

// ── State ───────────────────────────────────────────────────────────────────
let currentSettings = {};
let servicesData = [];
let svcImageData = null;     // base64 for current service modal image
let heroBgImageData = null;
let heroLogoImageData = null;
let visionImageData = null;
let missionImageData = null;
let aboutVideoData = null;   // base64 or null for video upload

// Crop state
let cropTarget = null;       // 'heroBg' | 'heroLogo'
let cropImgNaturalSrc = null;
let cropOffsetX = 0;
let cropOffsetY = 0;
let cropScale = 100;
let cropRotate = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadAllData();
  bindEvents();
});

async function loadAllData() {
  await Promise.all([loadSettings(), loadServices()]);
}

// ── API: Load settings ────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const res = await fetch(`${API}/site-settings`);
    const json = await res.json();
    currentSettings = json.data || {};
    populateForm();
  } catch {
    window.showAdminPopup('Failed to load site settings. Check your backend connection.');
  }
}

function populateForm() {
  const s = currentSettings;
  setText('heroTitle', s.hero_title || '');
  setVal('heroBgType', s.hero_bg_type || 'color');
  toggleBgType(s.hero_bg_type || 'color');
  document.getElementById('heroBgColor').value = s.hero_bg_color || '#8b1a1a';

  if (s.hero_bg_image) {
    setImgPreview('heroBgImgPreview', 'heroBgImgPlaceholder', s.hero_bg_image);
    heroBgImageData = s.hero_bg_image;
  }
  if (s.hero_logo_image) {
    setImgPreview('heroLogoPreview', 'heroLogoPlaceholder', s.hero_logo_image);
    heroLogoImageData = s.hero_logo_image;
  }
  if (s.vision_image) {
    setImgPreview('visionImgPreview', 'visionImgPlaceholder', s.vision_image);
    visionImageData = s.vision_image;
  }
  if (s.mission_image) {
    setImgPreview('missionImgPreview', 'missionImgPlaceholder', s.mission_image);
    missionImageData = s.mission_image;
  }

  setText('aboutHeading', s.about_heading || 'ABOUT US');
  setText('aboutText1', s.about_text_1 || '');
  setText('aboutText2', s.about_text_2 || '');
  // Restore saved video
  if (s.about_video_url) {
    aboutVideoData = s.about_video_url;
    restoreVideoPreview(s.about_video_url);
  }
  setText('visionHeading', s.vision_heading || 'OUR VISION');
  setText('visionText', s.vision_text || '');
  setText('missionHeading', s.mission_heading || 'OUR MISSION');
  setText('missionText', s.mission_text || '');
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

// ── API: Load services ────────────────────────────────────────────────────────
async function loadServices() {
  try {
    const res = await fetch(`${API}/services`);
    const json = await res.json();
    servicesData = json.data || [];
    renderServiceCards();
  } catch {
    document.getElementById('homeServicesGrid').innerHTML =
      '<p style="color:#9ca3af;text-align:center;padding:20px;grid-column:1/-1;">Failed to load services.</p>';
  }
}

function renderServiceCards() {
  const grid = document.getElementById('homeServicesGrid');
  if (!servicesData.length) {
    grid.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:20px;grid-column:1/-1;">No services yet. Add one!</p>';
    return;
  }
  grid.innerHTML = servicesData.map(s => `
    <div class="wm-service-card">
      <div class="card-img">
        ${s.image_data
          ? `<img src="${s.image_data}" alt="${s.title}" />`
          : `<span class="no-img"><i class="fa-regular fa-image"></i></span>`}
      </div>
      <div class="card-body">
        <div class="card-cat">${s.category}</div>
        <div class="card-title">${s.title}</div>
        <div class="card-desc">${s.description || ''}</div>
      </div>
      <div class="card-actions">
        <button class="btn-edit-sm" onclick="openEditService(${s.id})"><i class="fa-regular fa-pen-to-square"></i> Edit</button>
        <button class="btn-del-sm" onclick="deleteService(${s.id},'${escHtml(s.title)}')"><i class="fa-solid fa-trash"></i> Delete</button>
      </div>
    </div>
  `).join('');
}

function escHtml(str) {
  return (str || '').replace(/'/g, "\\'");
}

// ── Save All ──────────────────────────────────────────────────────────────────
function bindEvents() {
  document.getElementById('btnSaveAllHome').addEventListener('click', () => {
    window.showAdminConfirmPopup('Save all Home page changes to the live website?', {
      title: 'Save All Changes',
      confirmText: 'Save',
      onConfirm: doSaveAll,
    });
  });

  document.getElementById('heroBgType').addEventListener('change', function() {
    toggleBgType(this.value);
  });

  // Image file inputs
  setupImgInput('heroBgImgInput', 'heroBgImgPreview', 'heroBgImgPlaceholder', (b64) => {
    heroBgImageData = b64;
    openCropModal('heroBg');
  });
  setupImgInput('heroLogoInput', 'heroLogoPreview', 'heroLogoPlaceholder', (b64) => {
    heroLogoImageData = b64;
    openCropModal('heroLogo');
  });
  setupImgInput('visionImgInput', 'visionImgPreview', 'visionImgPlaceholder', (b64) => {
    visionImageData = b64;
  });
  setupImgInput('missionImgInput', 'missionImgPreview', 'missionImgPlaceholder', (b64) => {
    missionImageData = b64;
  });
  setupImgInput('svcImgInput', 'svcImgPreview', 'svcImgPlaceholder', (b64) => {
    svcImageData = b64;
  }, true); // requireSquare = true for service card images

  // Crop sliders
  document.getElementById('cropScale').addEventListener('input', function() {
    cropScale = Number(this.value);
    document.getElementById('cropScaleVal').textContent = cropScale + '%';
    applyCropTransform();
  });
  document.getElementById('cropRotate').addEventListener('input', function() {
    cropRotate = Number(this.value);
    document.getElementById('cropRotateVal').textContent = cropRotate + '°';
    applyCropTransform();
  });
  document.getElementById('btnApplyCrop').addEventListener('click', applyCropAndSave);

  // Service modal save
  document.getElementById('btnSaveService').addEventListener('click', saveService);

  // Add service
  document.getElementById('btnAddService').addEventListener('click', () => {
    openAddService();
  });

  // Chip input
  setupChipInput('svcFeaturesArea', 'svcFeaturesInput');

  // Crop drag
  const circle = document.getElementById('cropCircle');
  circle.addEventListener('mousedown', startDrag);
  window.addEventListener('mousemove', doDrag);
  window.addEventListener('mouseup', endDrag);
}

function toggleBgType(type) {
  document.getElementById('heroBgColorRow').style.display = type === 'color' ? 'flex' : 'none';
  document.getElementById('heroBgImageRow').style.display = type === 'image' ? 'block' : 'none';
}

async function doSaveAll() {
  const payload = {
    hero_title:       document.getElementById('heroTitle').value,
    hero_bg_type:     document.getElementById('heroBgType').value,
    hero_bg_color:    document.getElementById('heroBgColor').value,
    hero_bg_image:    heroBgImageData || '',
    hero_logo_image:  heroLogoImageData || '',
    about_heading:    document.getElementById('aboutHeading').value,
    about_text_1:     document.getElementById('aboutText1').value,
    about_text_2:     document.getElementById('aboutText2').value,
    about_video_url:  aboutVideoData || '',
    vision_heading:   document.getElementById('visionHeading').value,
    vision_text:      document.getElementById('visionText').value,
    vision_image:     visionImageData || '',
    mission_heading:  document.getElementById('missionHeading').value,
    mission_text:     document.getElementById('missionText').value,
    mission_image:    missionImageData || '',
  };

  try {
    const res = await fetch(`${API}/admin/site-settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token(),
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Save failed');
    window.showAdminPopup('Home page settings saved successfully!', { title: 'Saved!' });
    await loadSettings();
  } catch {
    window.showAdminPopup('Failed to save. Check your connection and try again.', { title: 'Error' });
  }
}

// ── Service CRUD ──────────────────────────────────────────────────────────────
function openAddService() {
  svcImageData = null;
  document.getElementById('serviceEditId').value = '';
  document.getElementById('serviceModalTitle').textContent = 'Add Service Card';
  clearServiceModal();
  document.getElementById('serviceModal').classList.add('show');
}

function openEditService(id) {
  const svc = servicesData.find(s => s.id === id);
  if (!svc) return;
  svcImageData = svc.image_data || null;
  document.getElementById('serviceEditId').value = id;
  document.getElementById('serviceModalTitle').textContent = 'Edit Service Card';

  document.getElementById('svcTitle').value = svc.title || '';
  document.getElementById('svcCategory').value = svc.category || 'Prototyping';
  document.getElementById('svcDesc').value = svc.description || '';

  // Image
  if (svc.image_data) {
    setImgPreview('svcImgPreview', 'svcImgPlaceholder', svc.image_data);
  } else {
    resetImgPreview('svcImgPreview', 'svcImgPlaceholder');
  }

  document.getElementById('serviceModal').classList.add('show');
}

function closeServiceModal() {
  document.getElementById('serviceModal').classList.remove('show');
}

function clearServiceModal() {
  document.getElementById('svcTitle').value = '';
  document.getElementById('svcCategory').value = 'Prototyping';
  document.getElementById('svcDesc').value = '';
  resetImgPreview('svcImgPreview', 'svcImgPlaceholder');
}

async function saveService() {
  const id = document.getElementById('serviceEditId').value;
  const title = document.getElementById('svcTitle').value.trim();
  const category = document.getElementById('svcCategory').value;
  if (!title) { window.showAdminPopup('Please enter a service title.'); return; }

  const payload = {
    title,
    category,
    description:       document.getElementById('svcDesc').value,
    image_data:        svcImageData || null,
    sort_order:        id ? (servicesData.find(s => s.id == id)?.sort_order || 0) : servicesData.length,
  };

  const action = id
    ? () => window.showAdminConfirmPopup(`Save changes to "${title}"?`, { title: 'Confirm Edit', confirmText: 'Save', onConfirm: () => doSaveService('PUT', id, payload) })
    : () => window.showAdminConfirmPopup(`Add "${title}" as a new service?`, { title: 'Confirm Add', confirmText: 'Add', onConfirm: () => doSaveService('POST', null, payload) });
  action();
}

async function doSaveService(method, id, payload) {
  const url = id ? `${API}/admin/services/${id}` : `${API}/admin/services`;
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token(), Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error();
    closeServiceModal();
    window.showAdminPopup('Service saved successfully!', { title: 'Saved!' });
    await loadServices();
  } catch {
    window.showAdminPopup('Failed to save service. Try again.', { title: 'Error' });
  }
}

function deleteService(id, name) {
  window.showAdminConfirmPopup(`Delete "${name}"? This will remove it from both the Home and Services pages.`, {
    title: 'Delete Service',
    confirmText: 'Delete',
    onConfirm: async () => {
      try {
        const res = await fetch(`${API}/admin/services/${id}`, {
          method: 'DELETE',
          headers: { Authorization: 'Bearer ' + token(), Accept: 'application/json' },
        });
        if (!res.ok) throw new Error();
        window.showAdminPopup('Service deleted.', { title: 'Deleted' });
        await loadServices();
      } catch {
        window.showAdminPopup('Failed to delete service.', { title: 'Error' });
      }
    },
  });
}

// ── Image helpers ─────────────────────────────────────────────────────────────
function setupImgInput(inputId, previewId, placeholderId, callback, requireSquare = false) {
  document.getElementById(inputId).addEventListener('change', function() {
    const file = this.files[0];
    if (!file) return;
    
    // For service card images, validate 1:1 aspect ratio
    if (requireSquare) {
      const img = new Image();
      const reader = new FileReader();
      reader.onload = e => {
        img.src = e.target.result;
        img.onload = () => {
          const width = img.naturalWidth || img.width;
          const height = img.naturalHeight || img.height;
          const aspectRatio = width / height;
          
          // Check if aspect ratio is 1:1 (allow small tolerance)
          if (Math.abs(aspectRatio - 1) > 0.01) {
            window.showAdminPopup?.(
              `Service card image must have a 1:1 aspect ratio (square). Current ratio: ${aspectRatio.toFixed(2)}:1\n\nImage dimensions: ${width} × ${height}px`,
              { title: 'Invalid Image Dimensions' }
            );
            this.value = '';
            return;
          }
          
          // Valid aspect ratio, proceed
          const b64 = e.target.result;
          setImgPreview(previewId, placeholderId, b64);
          callback(b64);
        };
      };
      reader.readAsDataURL(file);
    } else {
      // No aspect ratio requirement
      const reader = new FileReader();
      reader.onload = e => {
        const b64 = e.target.result;
        setImgPreview(previewId, placeholderId, b64);
        callback(b64);
      };
      reader.readAsDataURL(file);
    }
  });
}

// ── Video upload helpers ──────────────────────────────────────────────────────
function handleVideoUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    aboutVideoData = e.target.result;
    restoreVideoPreview(aboutVideoData, file.name);
  };
  reader.readAsDataURL(file);
}

function restoreVideoPreview(src, fileName) {
  const preview = document.getElementById('aboutVideoPreview');
  const placeholder = document.getElementById('aboutVideoPlaceholder');
  const removeBtn = document.getElementById('aboutVideoRemoveBtn');
  const fileNameEl = document.getElementById('aboutVideoFileName');
  if (preview) { preview.src = src; preview.style.display = 'block'; }
  if (placeholder) placeholder.classList.add('hidden');
  if (removeBtn) removeBtn.style.display = 'inline-flex';
  if (fileNameEl && fileName) { fileNameEl.textContent = fileName; fileNameEl.style.display = 'block'; }
}

function clearVideoUpload() {
  aboutVideoData = null;
  const preview = document.getElementById('aboutVideoPreview');
  const placeholder = document.getElementById('aboutVideoPlaceholder');
  const removeBtn = document.getElementById('aboutVideoRemoveBtn');
  const fileNameEl = document.getElementById('aboutVideoFileName');
  const input = document.getElementById('aboutVideoInput');
  if (preview) { preview.src = ''; preview.style.display = 'none'; }
  if (placeholder) placeholder.classList.remove('hidden');
  if (removeBtn) removeBtn.style.display = 'none';
  if (fileNameEl) { fileNameEl.textContent = ''; fileNameEl.style.display = 'none'; }
  if (input) input.value = '';
}

function setImgPreview(previewId, placeholderId, src) {
  const preview = document.getElementById(previewId);
  const placeholder = document.getElementById(placeholderId);
  const removeBtn = document.getElementById(previewId + 'RemoveBtn');
  if (preview) { preview.src = src; preview.classList.add('visible'); }
  if (placeholder) placeholder.classList.add('hidden');
  if (removeBtn) removeBtn.style.display = 'inline-flex';
}

function resetImgPreview(previewId, placeholderId) {
  const preview = document.getElementById(previewId);
  const placeholder = document.getElementById(placeholderId);
  const removeBtn = document.getElementById(previewId + 'RemoveBtn');
  if (preview) { preview.src = ''; preview.classList.remove('visible'); }
  if (placeholder) placeholder.classList.remove('hidden');
  if (removeBtn) removeBtn.style.display = 'none';
}

function clearImage(target) {
  if (target === 'heroBg') {
    heroBgImageData = null;
    resetImgPreview('heroBgImgPreview', 'heroBgImgPlaceholder');
  } else if (target === 'heroLogo') {
    heroLogoImageData = null;
    resetImgPreview('heroLogoPreview', 'heroLogoPlaceholder');
  } else if (target === 'vision') {
    visionImageData = null;
    resetImgPreview('visionImgPreview', 'visionImgPlaceholder');
  } else if (target === 'mission') {
    missionImageData = null;
    resetImgPreview('missionImgPreview', 'missionImgPlaceholder');
  } else if (target === 'svc') {
    svcImageData = null;
    resetImgPreview('svcImgPreview', 'svcImgPlaceholder');
  }
}

// ── Crop ──────────────────────────────────────────────────────────────────────
function openCropModal(target) {
  cropTarget = target;
  cropOffsetX = 0;
  cropOffsetY = 0;
  cropScale = 100;
  cropRotate = 0;
  document.getElementById('cropScale').value = 100;
  document.getElementById('cropScaleVal').textContent = '100%';
  document.getElementById('cropRotate').value = 0;
  document.getElementById('cropRotateVal').textContent = '0°';

  const src = target === 'heroBg' ? heroBgImageData : heroLogoImageData;
  const imgEl = document.getElementById('cropImg');
  imgEl.src = src;
  cropImgNaturalSrc = src;

  const title = target === 'heroLogo' ? 'Adjust Logo in Circle' : 'Adjust Background Image';
  document.getElementById('cropModalTitle').textContent = title;

  applyCropTransform();
  document.getElementById('cropModal').classList.add('show');
}

function closeCropModal() {
  document.getElementById('cropModal').classList.remove('show');
}

function applyCropTransform() {
  const imgEl = document.getElementById('cropImg');
  imgEl.style.transform = `translate(${cropOffsetX}px, ${cropOffsetY}px) scale(${cropScale / 100}) rotate(${cropRotate}deg)`;
}

function applyCropAndSave() {
  // Capture rendered circle area via canvas
  const circle = document.getElementById('cropCircle');
  const imgEl = document.getElementById('cropImg');
  const size = 220;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();

  const rect = circle.getBoundingClientRect();
  const imgRect = imgEl.getBoundingClientRect();
  const dx = imgRect.left - rect.left;
  const dy = imgRect.top - rect.top;
  const scale = cropScale / 100;

  const tmpImg = new Image();
  tmpImg.onload = () => {
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate((cropRotate * Math.PI) / 180);
    ctx.scale(scale, scale);
    ctx.drawImage(tmpImg, -tmpImg.width / 2 + (dx / scale), -tmpImg.height / 2 + (dy / scale));
    ctx.restore();
    const cropped = canvas.toDataURL('image/jpeg', 0.9);

    if (cropTarget === 'heroBg') {
      heroBgImageData = cropped;
      setImgPreview('heroBgImgPreview', 'heroBgImgPlaceholder', cropped);
    } else {
      heroLogoImageData = cropped;
      setImgPreview('heroLogoPreview', 'heroLogoPlaceholder', cropped);
    }
    closeCropModal();
  };
  tmpImg.src = cropImgNaturalSrc;
}

function startDrag(e) {
  isDragging = true;
  dragStartX = e.clientX - cropOffsetX;
  dragStartY = e.clientY - cropOffsetY;
  document.getElementById('cropCircle').classList.add('grabbing');
}

function doDrag(e) {
  if (!isDragging) return;
  cropOffsetX = e.clientX - dragStartX;
  cropOffsetY = e.clientY - dragStartY;
  applyCropTransform();
}

function endDrag() {
  isDragging = false;
  document.getElementById('cropCircle').classList.remove('grabbing');
}

// ── Chip input ────────────────────────────────────────────────────────────────
function setupChipInput(areaId, inputId) {
  const area = document.getElementById(areaId);
  const input = document.getElementById(inputId);
  if (!area || !input) return;
  area.addEventListener('click', () => input.focus());
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = input.value.trim();
      if (val) {
        addChip(areaId, inputId, val);
        input.value = '';
      }
    }
  });
}

function addChip(areaId, inputId, text) {
  const area = document.getElementById(areaId);
  const input = document.getElementById(inputId);
  const chip = document.createElement('span');
  chip.className = 'chip-tag-item';
  chip.dataset.value = text;
  chip.innerHTML = `${text}<button class="chip-remove" type="button">×</button>`;
  chip.querySelector('.chip-remove').addEventListener('click', () => chip.remove());
  area.insertBefore(chip, input);
}

function renderChips(areaId, inputId, arr) {
  const area = document.getElementById(areaId);
  const input = document.getElementById(inputId);
  Array.from(area.querySelectorAll('.chip-tag-item')).forEach(c => c.remove());
  arr.forEach(v => addChip(areaId, inputId, v));
}

function getChips(areaId) {
  return Array.from(document.getElementById(areaId).querySelectorAll('.chip-tag-item'))
    .map(c => c.dataset.value);
}
