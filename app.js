'use strict';

const $ = (selector) => document.querySelector(selector);
const extensionIdInput = $('#extensionId');
const postTextInput = $('#postText');
const imageInput = $('#imageInput');
const groupLinksInput = $('#groupLinks');
const autoSubmitInput = $('#autoSubmit');
const delayBeforePostInput = $('#delayBeforePost');
const delayAfterPostInput = $('#delayAfterPost');
const checkExtensionButton = $('#checkExtension');
const startButton = $('#startButton');
const stopButton = $('#stopButton');
const connectionStatus = $('#connectionStatus');
const operationStatus = $('#operationStatus');
const imagePreview = $('#imagePreview');
const charCount = $('#charCount');
const groupCount = $('#groupCount');
const queueBadge = $('#queueBadge');
const progressText = $('#progressText');
const progressBar = $('#progressBar');
const currentGroup = $('#currentGroup');
const resultList = $('#resultList');
const advancedSettings = $('#advancedSettings');
const templateSelect = $('#templateSelect');
const templateNameInput = $('#templateName');
const saveTemplateButton = $('#saveTemplate');
const updateTemplateButton = $('#updateTemplate');
const loadTemplateButton = $('#loadTemplate');
const deleteTemplateButton = $('#deleteTemplate');
const templateStatus = $('#templateStatus');
const templateCount = $('#templateCount');

const TEMPLATE_DB_NAME = 'fbGroupPosterDatabase';
const TEMPLATE_DB_VERSION = 1;
const TEMPLATE_STORE = 'postTemplates';

let preparedImages = [];
let pollTimer = null;
let templateCache = [];

extensionIdInput.value = localStorage.getItem('fbGroupPoster.extensionId') || '';
postTextInput.value = localStorage.getItem('fbGroupPoster.postText') || '';
groupLinksInput.value = localStorage.getItem('fbGroupPoster.groupLinks') || '';
autoSubmitInput.checked = localStorage.getItem('fbGroupPoster.autoSubmit') !== 'false';
delayBeforePostInput.value = localStorage.getItem('fbGroupPoster.delayBeforePost') || '5';
delayAfterPostInput.value = localStorage.getItem('fbGroupPoster.delayAfterPost') || '8';
advancedSettings.open = localStorage.getItem('fbGroupPoster.advancedOpen') === 'true';

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeGroupUrl(raw) {
  try {
    const url = new URL(raw.trim());
    if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/^\/groups\/([^/?#]+)/i);
    if (!match) return null;
    return `https://www.facebook.com/groups/${match[1]}`;
  } catch {
    return null;
  }
}

function getGroups() {
  return [...new Set(
    groupLinksInput.value
      .split(/\r?\n/)
      .map(normalizeGroupUrl)
      .filter(Boolean)
  )];
}

function updateCounters() {
  charCount.textContent = String(postTextInput.value.length);
  groupCount.textContent = String(getGroups().length);
}

function saveForm() {
  localStorage.setItem('fbGroupPoster.extensionId', extensionIdInput.value.trim());
  localStorage.setItem('fbGroupPoster.postText', postTextInput.value);
  localStorage.setItem('fbGroupPoster.groupLinks', groupLinksInput.value);
  localStorage.setItem('fbGroupPoster.autoSubmit', String(autoSubmitInput.checked));
  localStorage.setItem('fbGroupPoster.delayBeforePost', String(clamp(delayBeforePostInput.value, 2, 60, 5)));
  localStorage.setItem('fbGroupPoster.delayAfterPost', String(clamp(delayAfterPostInput.value, 3, 120, 8)));
}

function setOperationStatus(message) {
  operationStatus.textContent = message;
}

function sendToExtension(message) {
  const extensionId = extensionIdInput.value.trim();
  if (!extensionId) return Promise.reject(new Error('Chưa nhập Extension ID.'));
  if (!window.chrome?.runtime?.sendMessage) {
    return Promise.reject(new Error('Trang này cần mở bằng Google Chrome/Edge có cài extension.'));
  }

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(extensionId, message, (response) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) return reject(new Error(lastError.message));
      if (!response?.ok) return reject(new Error(response?.error || 'Extension không phản hồi.'));
      resolve(response);
    });
  });
}

function fileToCompressedDataUrl(file, maxSide = 2048, quality = 0.88) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Không đọc được ảnh ${file.name}`));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(`Ảnh ${file.name} không hợp lệ`));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.drawImage(img, 0, 0, width, height);
        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const dataUrl = canvas.toDataURL(mime, mime === 'image/png' ? undefined : quality);
        resolve({ name: file.name, type: mime, dataUrl });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function renderPreparedImages() {
  imagePreview.innerHTML = '';
  for (const image of preparedImages) {
    const item = document.createElement('div');
    item.className = 'preview-item';

    const preview = document.createElement('img');
    preview.alt = image.name || 'Ảnh bài viết';
    preview.src = image.dataUrl;

    const label = document.createElement('span');
    label.textContent = image.name || 'Ảnh bài viết';

    item.append(preview, label);
    imagePreview.appendChild(item);
  }
}

async function prepareSelectedImages() {
  const files = [...imageInput.files];
  preparedImages = [];
  imagePreview.innerHTML = '';

  if (!files.length) {
    setOperationStatus('Đã xóa ảnh đang chọn.');
    return;
  }

  setOperationStatus(`Đang xử lý ${files.length} ảnh...`);
  try {
    preparedImages = await Promise.all(files.map((file) => fileToCompressedDataUrl(file)));
    renderPreparedImages();
    setOperationStatus(`Đã chuẩn bị ${preparedImages.length} ảnh.`);
  } catch (error) {
    preparedImages = [];
    imagePreview.innerHTML = '';
    setOperationStatus(error.message);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function openTemplateDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(TEMPLATE_DB_NAME, TEMPLATE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TEMPLATE_STORE)) {
        db.createObjectStore(TEMPLATE_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Không mở được kho mẫu bài viết.'));
  });
}

async function templateStoreRequest(mode, action) {
  const db = await openTemplateDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(TEMPLATE_STORE, mode);
      const store = transaction.objectStore(TEMPLATE_STORE);
      const request = action(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Không xử lý được mẫu bài viết.'));
      transaction.onabort = () => reject(transaction.error || new Error('Giao dịch lưu mẫu đã bị hủy.'));
    });
  } finally {
    db.close();
  }
}

function getAllTemplates() {
  return templateStoreRequest('readonly', (store) => store.getAll());
}

function getTemplate(id) {
  return templateStoreRequest('readonly', (store) => store.get(id));
}

function putTemplate(template) {
  return templateStoreRequest('readwrite', (store) => store.put(template));
}

function removeTemplate(id) {
  return templateStoreRequest('readwrite', (store) => store.delete(id));
}

function createTemplateId() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function currentTemplatePayload(existing = null) {
  const name = templateNameInput.value.trim();
  if (!name) throw new Error('Hãy nhập tên mẫu.');

  const text = postTextInput.value.replace(/\r\n?/g, '\n');
  if (!text.trim() && !preparedImages.length) {
    throw new Error('Mẫu cần có nội dung hoặc ít nhất một ảnh.');
  }

  const now = Date.now();
  return {
    id: existing?.id || createTemplateId(),
    name,
    text,
    images: preparedImages.map((image) => ({
      name: image.name || 'image.jpg',
      type: image.type || 'image/jpeg',
      dataUrl: image.dataUrl
    })),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
}

async function refreshTemplates(preferredId = '') {
  try {
    templateCache = (await getAllTemplates())
      .filter((item) => item && item.id && item.name)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    const previousValue = preferredId || templateSelect.value || localStorage.getItem('fbGroupPoster.lastTemplateId') || '';
    templateSelect.innerHTML = '<option value="">Chọn một mẫu bài viết</option>';

    for (const template of templateCache) {
      const option = document.createElement('option');
      option.value = template.id;
      const imageCount = Array.isArray(template.images) ? template.images.length : 0;
      option.textContent = `${template.name}${imageCount ? ` · ${imageCount} ảnh` : ''}`;
      templateSelect.appendChild(option);
    }

    if (templateCache.some((item) => item.id === previousValue)) {
      templateSelect.value = previousValue;
    }

    templateCount.textContent = `${templateCache.length} mẫu`;
    updateSelectedTemplateName();
  } catch (error) {
    templateStatus.textContent = `Không đọc được mẫu: ${error.message}`;
  }
}

function selectedTemplateFromCache() {
  return templateCache.find((item) => item.id === templateSelect.value) || null;
}

function updateSelectedTemplateName() {
  const selected = selectedTemplateFromCache();
  if (!selected) {
    templateStatus.textContent = templateCache.length ? 'Chọn một mẫu để dùng, cập nhật hoặc xóa.' : 'Chưa có mẫu bài viết nào.';
    return;
  }
  templateNameInput.value = selected.name;
  const imageCount = Array.isArray(selected.images) ? selected.images.length : 0;
  templateStatus.textContent = `Đã chọn “${selected.name}” · ${selected.text?.length || 0} ký tự · ${imageCount} ảnh.`;
  localStorage.setItem('fbGroupPoster.lastTemplateId', selected.id);
}

async function saveNewTemplate() {
  saveTemplateButton.disabled = true;
  try {
    const template = currentTemplatePayload();
    await putTemplate(template);
    await refreshTemplates(template.id);
    templateStatus.textContent = `Đã lưu mẫu mới “${template.name}”.`;
  } catch (error) {
    templateStatus.textContent = `Không lưu được mẫu: ${error.message}`;
  } finally {
    saveTemplateButton.disabled = false;
  }
}

async function updateSelectedTemplate() {
  const selected = selectedTemplateFromCache();
  if (!selected) {
    templateStatus.textContent = 'Hãy chọn mẫu cần cập nhật.';
    return;
  }

  updateTemplateButton.disabled = true;
  try {
    const template = currentTemplatePayload(selected);
    await putTemplate(template);
    await refreshTemplates(template.id);
    templateStatus.textContent = `Đã cập nhật mẫu “${template.name}”.`;
  } catch (error) {
    templateStatus.textContent = `Không cập nhật được mẫu: ${error.message}`;
  } finally {
    updateTemplateButton.disabled = false;
  }
}

async function loadSelectedTemplate() {
  const id = templateSelect.value;
  if (!id) {
    templateStatus.textContent = 'Hãy chọn mẫu cần sử dụng.';
    return;
  }

  loadTemplateButton.disabled = true;
  try {
    const template = await getTemplate(id);
    if (!template) throw new Error('Không tìm thấy mẫu đã chọn.');

    postTextInput.value = String(template.text || '');
    preparedImages = Array.isArray(template.images)
      ? template.images.filter((image) => image?.dataUrl).map((image) => ({ ...image }))
      : [];
    imageInput.value = '';
    renderPreparedImages();
    templateNameInput.value = template.name;
    updateCounters();
    saveForm();
    templateStatus.textContent = `Đã tải mẫu “${template.name}” với ${preparedImages.length} ảnh.`;
    setOperationStatus(`Đang sử dụng mẫu “${template.name}”.`);
  } catch (error) {
    templateStatus.textContent = `Không tải được mẫu: ${error.message}`;
  } finally {
    loadTemplateButton.disabled = false;
  }
}

async function deleteSelectedTemplate() {
  const selected = selectedTemplateFromCache();
  if (!selected) {
    templateStatus.textContent = 'Hãy chọn mẫu cần xóa.';
    return;
  }
  if (!window.confirm(`Xóa mẫu “${selected.name}”?`)) return;

  deleteTemplateButton.disabled = true;
  try {
    await removeTemplate(selected.id);
    localStorage.removeItem('fbGroupPoster.lastTemplateId');
    templateSelect.value = '';
    templateNameInput.value = '';
    await refreshTemplates();
    templateStatus.textContent = `Đã xóa mẫu “${selected.name}”.`;
  } catch (error) {
    templateStatus.textContent = `Không xóa được mẫu: ${error.message}`;
  } finally {
    deleteTemplateButton.disabled = false;
  }
}

async function checkExtension() {
  saveForm();
  connectionStatus.textContent = 'Đang kiểm tra...';
  try {
    const response = await sendToExtension({ type: 'PING' });
    connectionStatus.textContent = `Đã kết nối extension v${response.version}.`;
    return true;
  } catch (error) {
    connectionStatus.textContent = `Không kết nối được: ${error.message}`;
    advancedSettings.open = true;
    return false;
  }
}

async function startQueue() {
  saveForm();
  const text = postTextInput.value.replace(/\r\n?/g, '\n');
  const groups = getGroups();

  if (!text.trim() && !preparedImages.length) {
    setOperationStatus('Cần nhập nội dung hoặc chọn ít nhất một ảnh.');
    return;
  }
  if (!groups.length) {
    setOperationStatus('Danh sách chưa có link nhóm Facebook hợp lệ.');
    return;
  }
  if (!(await checkExtension())) {
    setOperationStatus('Không thể bắt đầu vì chưa kết nối được extension.');
    return;
  }

  startButton.disabled = true;
  setOperationStatus('Đang gửi hàng đợi sang extension...');
  try {
    await sendToExtension({
      type: 'START_QUEUE',
      payload: {
        text,
        images: preparedImages,
        groups,
        options: {
          autoSubmit: autoSubmitInput.checked,
          delayBeforePostMs: clamp(delayBeforePostInput.value, 2, 60, 5) * 1000,
          delayAfterPostMs: clamp(delayAfterPostInput.value, 3, 120, 8) * 1000,
          continueOnError: true
        }
      }
    });
    setOperationStatus(`Đã bắt đầu đăng trên ${groups.length} nhóm.`);
    startPolling();
  } catch (error) {
    setOperationStatus(`Không thể bắt đầu: ${error.message}`);
  } finally {
    startButton.disabled = false;
  }
}

async function stopQueue() {
  try {
    await sendToExtension({ type: 'STOP_QUEUE' });
    setOperationStatus('Đã dừng hàng đợi.');
    await refreshStatus();
  } catch (error) {
    setOperationStatus(`Không thể dừng: ${error.message}`);
  }
}

function renderStatus(status) {
  const total = status.total || 0;
  const completed = status.completed || 0;
  const percent = total ? Math.min(100, Math.round((completed / total) * 100)) : 0;

  const labels = {
    idle: 'Chưa chạy', running: 'Đang chạy', stopped: 'Đã dừng', completed: 'Hoàn thành', error: 'Có lỗi'
  };
  queueBadge.textContent = labels[status.state] || status.state || 'Chưa chạy';
  progressText.textContent = `${completed} / ${total} nhóm`;
  progressBar.style.width = `${percent}%`;
  currentGroup.textContent = status.currentUrl ? `Nhóm hiện tại: ${status.currentUrl}` : '';
  resultList.innerHTML = (status.results || []).slice().reverse().map((item) => {
    const cls = item.status === 'posted' ? 'ok' : item.status === 'skipped' ? 'skip' : 'error';
    const label = item.status === 'posted' ? 'Đã đăng' : item.status === 'skipped' ? 'Bỏ qua' : 'Lỗi';
    const detail = item.detail ? `<small>${escapeHtml(item.detail)}</small>` : '';
    return `<div class="result-item"><span class="${cls}">${label}</span><div><span>${escapeHtml(item.url)}</span>${detail}</div></div>`;
  }).join('');
}

async function refreshStatus() {
  try {
    const response = await sendToExtension({ type: 'GET_STATUS' });
    renderStatus(response.status);
  } catch {
    // Giữ nguyên trạng thái khi extension tạm thời không phản hồi.
  }
}

function startPolling() {
  clearInterval(pollTimer);
  refreshStatus();
  pollTimer = setInterval(refreshStatus, 1800);
}

postTextInput.addEventListener('input', () => { updateCounters(); saveForm(); });
groupLinksInput.addEventListener('input', () => { updateCounters(); saveForm(); });
extensionIdInput.addEventListener('input', saveForm);
autoSubmitInput.addEventListener('change', saveForm);
delayBeforePostInput.addEventListener('input', saveForm);
delayAfterPostInput.addEventListener('input', saveForm);
advancedSettings.addEventListener('toggle', () => {
  localStorage.setItem('fbGroupPoster.advancedOpen', String(advancedSettings.open));
});
imageInput.addEventListener('change', prepareSelectedImages);
checkExtensionButton.addEventListener('click', checkExtension);
startButton.addEventListener('click', startQueue);
stopButton.addEventListener('click', stopQueue);
templateSelect.addEventListener('change', () => {
  if (!templateSelect.value) templateNameInput.value = '';
  updateSelectedTemplateName();
});
saveTemplateButton.addEventListener('click', saveNewTemplate);
updateTemplateButton.addEventListener('click', updateSelectedTemplate);
loadTemplateButton.addEventListener('click', loadSelectedTemplate);
deleteTemplateButton.addEventListener('click', deleteSelectedTemplate);

updateCounters();
refreshTemplates();
startPolling();
