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
const heroConnectionText = $('#heroConnectionText');
const heroStatus = $('.hero-status');
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
const templateNameInput = $('#templateName');
const saveTemplateButton = $('#saveTemplate');
const updateTemplateButton = $('#updateTemplate');
const deleteTemplateButton = $('#deleteTemplate');
const templateStatus = $('#templateStatus');
const templateListLeft = $('#templateListLeft');
const templateListRight = $('#templateListRight');
const selectedTemplateBadge = $('#selectedTemplateBadge');
const templateCountLeft = $('#templateCountLeft');
const templateCountRight = $('#templateCountRight');
const aiApiUrlInput = $('#aiApiUrl');
const aiApiKeyInput = $('#aiApiKey');
const aiModelInput = $('#aiModel');
const aiSystemPromptInput = $('#aiSystemPrompt');
const aiSettingsStatus = $('#aiSettingsStatus');
const toggleAiApiKeyButton = $('#toggleAiApiKey');
const aiWriteButton = $('#aiWriteButton');
const aiComposerPanel = $('#aiComposerPanel');
const aiBriefInput = $('#aiBrief');
const generateAiContentButton = $('#generateAiContent');
const closeAiPanelButton = $('#closeAiPanel');
const aiContentStatus = $('#aiContentStatus');

const TEMPLATE_DB_NAME = 'fbGroupPosterDatabase';
const TEMPLATE_DB_VERSION = 1;
const TEMPLATE_STORE = 'postTemplates';

let preparedImages = [];
let pollTimer = null;
let templateCache = [];
let selectedTemplateId = localStorage.getItem('fbGroupPoster.lastTemplateId') || '';

extensionIdInput.value = localStorage.getItem('fbGroupPoster.extensionId') || '';
postTextInput.value = localStorage.getItem('fbGroupPoster.postText') || '';
groupLinksInput.value = localStorage.getItem('fbGroupPoster.groupLinks') || '';
autoSubmitInput.checked = localStorage.getItem('fbGroupPoster.autoSubmit') !== 'false';
delayBeforePostInput.value = localStorage.getItem('fbGroupPoster.delayBeforePost') || '5';
delayAfterPostInput.value = localStorage.getItem('fbGroupPoster.delayAfterPost') || '8';
advancedSettings.open = localStorage.getItem('fbGroupPoster.advancedOpen') === 'true';
aiApiUrlInput.value = localStorage.getItem('fbGroupPoster.aiApiUrl') || 'https://console.flatkey.ai/v1/chat/completions';
aiApiKeyInput.value = localStorage.getItem('fbGroupPoster.aiApiKey') || '';
aiModelInput.value = localStorage.getItem('fbGroupPoster.aiModel') || 'gpt-5.4-mini';
aiSystemPromptInput.value = localStorage.getItem('fbGroupPoster.aiSystemPrompt') || aiSystemPromptInput.value;
aiBriefInput.value = localStorage.getItem('fbGroupPoster.aiBrief') || '';

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
  localStorage.setItem('fbGroupPoster.aiApiUrl', aiApiUrlInput.value.trim());
  localStorage.setItem('fbGroupPoster.aiApiKey', aiApiKeyInput.value.trim());
  localStorage.setItem('fbGroupPoster.aiModel', aiModelInput.value.trim());
  localStorage.setItem('fbGroupPoster.aiSystemPrompt', aiSystemPromptInput.value);
  localStorage.setItem('fbGroupPoster.aiBrief', aiBriefInput.value);
}

function setOperationStatus(message) {
  operationStatus.textContent = message;
}

function setConnectionDisplay(message, connected = false) {
  connectionStatus.textContent = message;
  heroConnectionText.textContent = connected ? 'Extension đã kết nối' : 'Chưa kết nối extension';
  heroStatus.classList.toggle('connected', connected);
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
        resolve({ id: createTemplateId(), name: file.name, type: mime, dataUrl });
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
  imageInput.value = '';
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
      id: createTemplateId(),
      name: image.name || 'image.jpg',
      type: image.type || 'image/jpeg',
      dataUrl: image.dataUrl
    })),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
}

function formatTemplateDate(timestamp) {
  if (!timestamp) return 'Chưa có thời gian';
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(timestamp));
  } catch {
    return 'Vừa cập nhật';
  }
}

function templateInitial(name) {
  return String(name || 'M').trim().charAt(0) || 'M';
}

function createTemplateCard(template) {
  const images = Array.isArray(template.images) ? template.images.filter((image) => image?.dataUrl) : [];
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `template-item${template.id === selectedTemplateId ? ' active' : ''}`;
  button.dataset.templateId = template.id;
  button.setAttribute('aria-label', `Dùng mẫu ${template.name}`);

  const top = document.createElement('div');
  top.className = 'template-item-top';

  const avatar = document.createElement('span');
  avatar.className = 'template-avatar';
  avatar.textContent = templateInitial(template.name);

  const titleWrap = document.createElement('span');
  titleWrap.className = 'template-title-wrap';

  const title = document.createElement('span');
  title.className = 'template-title';
  title.textContent = template.name;

  const date = document.createElement('span');
  date.className = 'template-date';
  date.textContent = formatTemplateDate(template.updatedAt || template.createdAt);

  titleWrap.append(title, date);
  top.append(avatar, titleWrap);

  const copy = document.createElement('span');
  copy.className = `template-copy${String(template.text || '').trim() ? '' : ' empty-copy'}`;
  copy.textContent = String(template.text || '').trim() || 'Mẫu chỉ có hình ảnh.';

  button.append(top, copy);

  if (images.length) {
    const thumbs = document.createElement('span');
    thumbs.className = 'template-thumbs';
    for (const image of images.slice(0, 3)) {
      const thumb = document.createElement('img');
      thumb.className = 'template-thumb';
      thumb.alt = '';
      thumb.loading = 'lazy';
      thumb.src = image.dataUrl;
      thumbs.appendChild(thumb);
    }
    if (images.length > 3) {
      const more = document.createElement('span');
      more.className = 'template-more';
      more.textContent = `+${images.length - 3}`;
      thumbs.appendChild(more);
    }
    button.appendChild(thumbs);
  }

  const meta = document.createElement('span');
  meta.className = 'template-meta';

  const statistics = document.createElement('span');
  statistics.textContent = `${String(template.text || '').length} ký tự · ${images.length} ảnh`;

  const use = document.createElement('span');
  use.className = 'template-use';
  use.textContent = template.id === selectedTemplateId ? 'Đã chọn' : 'Bấm để dùng';

  meta.append(statistics, use);
  button.appendChild(meta);
  button.addEventListener('click', () => loadSelectedTemplate(template.id));
  return button;
}

function renderTemplateColumn(container, templates, emptyText) {
  container.innerHTML = '';
  if (!templates.length) {
    const empty = document.createElement('div');
    empty.className = 'template-empty';
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  templates.forEach((template) => fragment.appendChild(createTemplateCard(template)));
  container.appendChild(fragment);
}

function renderTemplateLists() {
  const leftTemplates = templateCache.filter((_, index) => index % 2 === 0);
  const rightTemplates = templateCache.filter((_, index) => index % 2 === 1);
  templateCountLeft.textContent = `${leftTemplates.length} mẫu`;
  templateCountRight.textContent = `${rightTemplates.length} mẫu`;
  renderTemplateColumn(templateListLeft, leftTemplates, 'Chưa có mẫu bên trái. Soạn bài ở giữa rồi bấm “Lưu mẫu mới”.');
  renderTemplateColumn(templateListRight, rightTemplates, templateCache.length < 2 ? 'Mẫu thứ hai sẽ xuất hiện ở bên phải.' : 'Chưa có mẫu bên phải.');
}

async function refreshTemplates(preferredId = '') {
  try {
    templateCache = (await getAllTemplates())
      .filter((item) => item && item.id && item.name)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    const requestedId = preferredId || selectedTemplateId || localStorage.getItem('fbGroupPoster.lastTemplateId') || '';
    selectedTemplateId = templateCache.some((item) => item.id === requestedId) ? requestedId : '';
    renderTemplateLists();
    updateSelectedTemplateName();
  } catch (error) {
    templateStatus.textContent = `Không đọc được mẫu: ${error.message}`;
  }
}

function selectedTemplateFromCache() {
  return templateCache.find((item) => item.id === selectedTemplateId) || null;
}

function updateSelectedTemplateName() {
  const selected = selectedTemplateFromCache();
  if (!selected) {
    selectedTemplateBadge.textContent = 'Chưa chọn mẫu';
    templateStatus.textContent = templateCache.length ? 'Bấm vào một thẻ mẫu ở hai bên để sử dụng.' : 'Chưa có mẫu bài viết nào.';
    return;
  }
  templateNameInput.value = selected.name;
  selectedTemplateBadge.textContent = selected.name;
  const imageCount = Array.isArray(selected.images) ? selected.images.length : 0;
  templateStatus.textContent = `Đang chọn “${selected.name}” · ${selected.text?.length || 0} ký tự · ${imageCount} ảnh.`;
  localStorage.setItem('fbGroupPoster.lastTemplateId', selected.id);
}

async function saveNewTemplate() {
  saveTemplateButton.disabled = true;
  try {
    const template = currentTemplatePayload();
    await putTemplate(template);
    selectedTemplateId = template.id;
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
    templateStatus.textContent = 'Hãy bấm chọn mẫu cần cập nhật ở cột bên trái hoặc bên phải.';
    return;
  }

  updateTemplateButton.disabled = true;
  try {
    const template = currentTemplatePayload(selected);
    await putTemplate(template);
    selectedTemplateId = template.id;
    await refreshTemplates(template.id);
    templateStatus.textContent = `Đã cập nhật mẫu “${template.name}”.`;
  } catch (error) {
    templateStatus.textContent = `Không cập nhật được mẫu: ${error.message}`;
  } finally {
    updateTemplateButton.disabled = false;
  }
}

async function loadSelectedTemplate(id = selectedTemplateId) {
  if (!id) {
    templateStatus.textContent = 'Hãy bấm chọn mẫu cần sử dụng.';
    return;
  }

  selectedTemplateId = id;
  renderTemplateLists();
  updateSelectedTemplateName();

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
    templateStatus.textContent = `Đã nạp mẫu “${template.name}” với ${preparedImages.length} ảnh.`;
    setOperationStatus(`Đang sử dụng mẫu “${template.name}”.`);
  } catch (error) {
    templateStatus.textContent = `Không tải được mẫu: ${error.message}`;
  }
}

async function deleteSelectedTemplate() {
  const selected = selectedTemplateFromCache();
  if (!selected) {
    templateStatus.textContent = 'Hãy bấm chọn mẫu cần xóa.';
    return;
  }
  if (!window.confirm(`Xóa mẫu “${selected.name}”?`)) return;

  deleteTemplateButton.disabled = true;
  try {
    await removeTemplate(selected.id);
    localStorage.removeItem('fbGroupPoster.lastTemplateId');
    selectedTemplateId = '';
    templateNameInput.value = '';
    await refreshTemplates();
    templateStatus.textContent = `Đã xóa mẫu “${selected.name}”.`;
  } catch (error) {
    templateStatus.textContent = `Không xóa được mẫu: ${error.message}`;
  } finally {
    deleteTemplateButton.disabled = false;
  }
}

function normalizeAiApiUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) throw new Error('Chưa nhập API URL.');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('API URL không hợp lệ.');
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error('API URL phải dùng HTTP hoặc HTTPS.');
  return url.toString();
}

function extractAiContent(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const text = content
      .map((item) => typeof item === 'string' ? item : item?.text || item?.content || '')
      .filter(Boolean)
      .join('\n')
      .trim();
    if (text) return text;
  }
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  throw new Error('API không trả về nội dung trong choices[0].message.content.');
}

function aiErrorMessage(data, response) {
  return data?.error?.message || data?.message || `API trả về lỗi HTTP ${response.status}.`;
}

function setAiPanelOpen(open) {
  aiComposerPanel.hidden = !open;
  aiWriteButton.classList.toggle('active', open);
  if (open) {
    if (!aiBriefInput.value.trim() && postTextInput.value.trim()) {
      aiBriefInput.value = postTextInput.value.trim();
      saveForm();
    }
    requestAnimationFrame(() => aiBriefInput.focus());
  }
}

async function generateAiContent() {
  const brief = aiBriefInput.value.trim();
  const apiKey = aiApiKeyInput.value.trim();
  const model = aiModelInput.value.trim();
  const systemPrompt = aiSystemPromptInput.value.trim();

  if (!brief) {
    aiContentStatus.textContent = 'Hãy nhập yêu cầu để AI viết bài.';
    aiBriefInput.focus();
    return;
  }
  if (!apiKey) {
    aiContentStatus.textContent = 'Chưa nhập API key trong Cài đặt nâng cao.';
    advancedSettings.open = true;
    aiApiKeyInput.focus();
    return;
  }
  if (!model) {
    aiContentStatus.textContent = 'Chưa nhập tên model AI.';
    advancedSettings.open = true;
    aiModelInput.focus();
    return;
  }

  let apiUrl;
  try {
    apiUrl = normalizeAiApiUrl(aiApiUrlInput.value);
  } catch (error) {
    aiContentStatus.textContent = error.message;
    advancedSettings.open = true;
    aiApiUrlInput.focus();
    return;
  }

  saveForm();
  generateAiContentButton.disabled = true;
  aiWriteButton.disabled = true;
  aiContentStatus.textContent = 'AI đang viết content...';

  try {
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: brief });

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model, messages })
    });

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(`API trả về dữ liệu không phải JSON (HTTP ${response.status}).`);
    }

    if (!response.ok) throw new Error(aiErrorMessage(data, response));

    const generated = extractAiContent(data).replace(/\r\n?/g, '\n');
    postTextInput.value = generated;
    updateCounters();
    saveForm();
    aiContentStatus.textContent = `Đã tạo ${generated.length} ký tự bằng model ${model}.`;
    setOperationStatus('AI đã cập nhật nội dung bài đăng.');
  } catch (error) {
    const message = error instanceof TypeError
      ? 'Không gọi được API. Hãy kiểm tra kết nối, API URL hoặc quyền CORS của máy chủ.'
      : error.message;
    aiContentStatus.textContent = `Lỗi AI: ${message}`;
  } finally {
    generateAiContentButton.disabled = false;
    aiWriteButton.disabled = false;
  }
}

async function checkExtension() {
  saveForm();
  setConnectionDisplay('Đang kiểm tra...', false);
  try {
    const response = await sendToExtension({ type: 'PING' });
    setConnectionDisplay(`Đã kết nối extension v${response.version}.`, true);
    return true;
  } catch (error) {
    setConnectionDisplay(`Không kết nối được: ${error.message}`, false);
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
extensionIdInput.addEventListener('input', () => {
  saveForm();
  setConnectionDisplay('Extension ID đã thay đổi, hãy kiểm tra lại.', false);
});
autoSubmitInput.addEventListener('change', saveForm);
delayBeforePostInput.addEventListener('input', saveForm);
delayAfterPostInput.addEventListener('input', saveForm);
aiApiUrlInput.addEventListener('input', saveForm);
aiApiKeyInput.addEventListener('input', saveForm);
aiModelInput.addEventListener('input', saveForm);
aiSystemPromptInput.addEventListener('input', saveForm);
aiBriefInput.addEventListener('input', saveForm);
toggleAiApiKeyButton.addEventListener('click', () => {
  const reveal = aiApiKeyInput.type === 'password';
  aiApiKeyInput.type = reveal ? 'text' : 'password';
  toggleAiApiKeyButton.textContent = reveal ? 'Ẩn key' : 'Hiện key';
});
aiWriteButton.addEventListener('click', () => setAiPanelOpen(aiComposerPanel.hidden));
closeAiPanelButton.addEventListener('click', () => setAiPanelOpen(false));
generateAiContentButton.addEventListener('click', generateAiContent);
advancedSettings.addEventListener('toggle', () => {
  localStorage.setItem('fbGroupPoster.advancedOpen', String(advancedSettings.open));
});
imageInput.addEventListener('change', prepareSelectedImages);
checkExtensionButton.addEventListener('click', checkExtension);
startButton.addEventListener('click', startQueue);
stopButton.addEventListener('click', stopQueue);
saveTemplateButton.addEventListener('click', saveNewTemplate);
updateTemplateButton.addEventListener('click', updateSelectedTemplate);
deleteTemplateButton.addEventListener('click', deleteSelectedTemplate);

updateCounters();
refreshTemplates();
startPolling();
