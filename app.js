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
const imagePreview = $('#imagePreview');
const charCount = $('#charCount');
const groupCount = $('#groupCount');
const queueBadge = $('#queueBadge');
const progressText = $('#progressText');
const progressBar = $('#progressBar');
const currentGroup = $('#currentGroup');
const resultList = $('#resultList');

let preparedImages = [];
let pollTimer = null;

extensionIdInput.value = localStorage.getItem('fbGroupPoster.extensionId') || '';
postTextInput.value = localStorage.getItem('fbGroupPoster.postText') || '';
groupLinksInput.value = localStorage.getItem('fbGroupPoster.groupLinks') || '';
autoSubmitInput.checked = localStorage.getItem('fbGroupPoster.autoSubmit') !== 'false';
delayBeforePostInput.value = localStorage.getItem('fbGroupPoster.delayBeforePost') || '5';
delayAfterPostInput.value = localStorage.getItem('fbGroupPoster.delayAfterPost') || '8';

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

async function prepareSelectedImages() {
  const files = [...imageInput.files];
  preparedImages = [];
  imagePreview.innerHTML = '';

  for (const file of files) {
    const item = document.createElement('div');
    item.className = 'preview-item';
    item.innerHTML = `<span>${escapeHtml(file.name)}</span>`;
    const preview = document.createElement('img');
    preview.alt = file.name;
    preview.src = URL.createObjectURL(file);
    item.prepend(preview);
    imagePreview.appendChild(item);
  }

  if (!files.length) return;
  connectionStatus.textContent = `Đang xử lý ${files.length} ảnh...`;
  try {
    preparedImages = await Promise.all(files.map((file) => fileToCompressedDataUrl(file)));
    connectionStatus.textContent = `Đã chuẩn bị ${preparedImages.length} ảnh.`;
  } catch (error) {
    preparedImages = [];
    connectionStatus.textContent = error.message;
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

async function checkExtension() {
  saveForm();
  connectionStatus.textContent = 'Đang kiểm tra...';
  try {
    const response = await sendToExtension({ type: 'PING' });
    connectionStatus.textContent = `Đã kết nối extension v${response.version}.`;
    return true;
  } catch (error) {
    connectionStatus.textContent = `Không kết nối được: ${error.message}`;
    return false;
  }
}

async function startQueue() {
  saveForm();
  const text = postTextInput.value.replace(/\r\n?/g, '\n');
  const groups = getGroups();

  if (!text.trim() && !preparedImages.length) {
    connectionStatus.textContent = 'Cần nhập nội dung hoặc chọn ít nhất một ảnh.';
    return;
  }
  if (!groups.length) {
    connectionStatus.textContent = 'Danh sách chưa có link nhóm Facebook hợp lệ.';
    return;
  }
  if (!(await checkExtension())) return;

  startButton.disabled = true;
  connectionStatus.textContent = 'Đang gửi hàng đợi sang extension...';
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
    connectionStatus.textContent = `Đã bắt đầu đăng trên ${groups.length} nhóm.`;
    startPolling();
  } catch (error) {
    connectionStatus.textContent = `Không thể bắt đầu: ${error.message}`;
  } finally {
    startButton.disabled = false;
  }
}

async function stopQueue() {
  try {
    await sendToExtension({ type: 'STOP_QUEUE' });
    connectionStatus.textContent = 'Đã dừng hàng đợi.';
    await refreshStatus();
  } catch (error) {
    connectionStatus.textContent = `Không thể dừng: ${error.message}`;
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
imageInput.addEventListener('change', prepareSelectedImages);
checkExtensionButton.addEventListener('click', checkExtension);
startButton.addEventListener('click', startQueue);
stopButton.addEventListener('click', stopQueue);

updateCounters();
startPolling();
