import { extract, fields, missingFields } from './rules.js';
import { getRecord, listRecords, putRecord } from './storage.js';
import { photoArchive, workbook } from './export.js';

const $ = id => document.getElementById(id);
const form = $('card');
const status = $('status');
const inputs = {};
let active;
let photo;
let previewUrl;
let working = false;
let saving = false;
let offlineReady = false;
let exportToken = 0;

const installButton = $('install-app');
const installHelp = $('install-help');
let installPrompt;

if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
  installHelp.hidden = true;
}
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  installButton.hidden = false;
});
installButton.onclick = async () => {
  const prompt = installPrompt;
  if (!prompt) return;
  installPrompt = undefined;
  installButton.hidden = true;
  try {
    await prompt.prompt();
  } catch (error) {
    console.error(error);
    installHelp.hidden = false;
  }
};
window.addEventListener('appinstalled', () => {
  installPrompt = undefined;
  installButton.hidden = true;
  installHelp.hidden = true;
});

for (const [key, name] of Object.entries(fields)) {
  const label = document.createElement('label');
  label.htmlFor = 'field-' + key;
  label.append(name);
  const input = document.createElement(key === 'notes' ? 'textarea' : 'input');
  input.id = label.htmlFor;
  input.name = key;
  if (key === 'email') input.inputMode = 'email';
  if (key === 'phone') input.inputMode = 'tel';
  if (key === 'notes') label.className = 'wide';
  label.append(input);
  $('fields').append(label);
  inputs[key] = input;
}

function formData() {
  const type = form.elements.type.value;
  const data = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value.trim()]));
  data[type === '海外' ? 'province' : 'country'] = '';
  return { ...data, type, confirmed: type === '海外' && $('confirmed').checked };
}

function updateForm() {
  const data = formData();
  const abroad = data.type === '海外';
  inputs.province.parentElement.hidden = abroad;
  inputs.country.parentElement.hidden = !abroad;
  $('verify').hidden = !abroad;
  const missing = missingFields(data);
  for (const [key, input] of Object.entries(inputs)) input.toggleAttribute('data-missing', missing.includes(key));
  $('missing').textContent = missing.length ? '待补：' + missing.map(key => key === 'confirmed'
    ? '二次确认联系方式' : key === 'phone' && abroad ? '电话或 WhatsApp / LINE' : fields[key]).join('、') : '';
}

function setPhoto(file) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  photo = file;
  previewUrl = file ? URL.createObjectURL(file) : undefined;
  const preview = $('preview');
  if (previewUrl) preview.src = previewUrl;
  else preview.removeAttribute('src');
  preview.hidden = !previewUrl;
  $('retry').hidden = !file;
  $('photo-actions').hidden = !file;
  const download = $('download-photo');
  const share = $('share-photo');
  const help = $('photo-help');
  share.hidden = true;
  share.onclick = null;
  help.hidden = !file;
  if (!file) {
    download.removeAttribute('href');
    return;
  }
  const name = active?.photo === file ? active.photoName : photoFilename(file, '名片-' + Date.now());
  download.href = previewUrl;
  download.download = name;
  const original = new File([file], name, { type: file.type });
  const shareData = { files: [original] };
  const canShare = typeof navigator.share === 'function' && navigator.canShare?.(shareData);
  share.hidden = !canShare;
  help.textContent = canShare ? '在系统面板中选择「存储图像」或相册。' : '下载后可从文件管理器将原照移到相册。';
  share.onclick = async () => {
    try {
      await navigator.share(shareData);
    } catch (error) {
      if (error.name !== 'AbortError' && photo === file) {
        help.textContent = '可下载原照，再从文件管理器移到相册。';
      }
    }
  };
}

function setBusy() {
  $('save').disabled = working || saving;
  $('clear').disabled = working || saving;
  $('retry').disabled = working || saving;
  $('camera').disabled = working || saving;
  $('album').disabled = working || saving;
}

async function recognize() {
  if (!photo || working || saving) return;
  if (!offlineReady) {
    status.textContent = '照片已选中。离线资源准备好后可点「重新识别」，也可以手填。';
    return;
  }
  let worker;
  working = true;
  setBusy();
  status.textContent = '正在加载本机识别模型…';
  try {
    // Decode and resize only the OCR input. Store and export the original File unchanged.
    const preview = $('preview');
    await preview.decode();
    const ratio = Math.min(1, 2000 / Math.max(preview.naturalWidth, preview.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(preview.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(preview.naturalHeight * ratio));
    canvas.getContext('2d').drawImage(preview, 0, 0, canvas.width, canvas.height);
    const languages = form.elements.type.value === '海外' ? ['eng', 'chi_sim'] : ['chi_sim', 'eng'];
    worker = await globalThis.Tesseract.createWorker(languages, 1, {
      workerPath: new URL('./vendor/worker.min.js', import.meta.url).href,
      corePath: new URL('./vendor/core', import.meta.url).href,
      langPath: new URL('./vendor/lang', import.meta.url).href,
      workerBlobURL: false,
      cacheMethod: 'none',
      errorHandler: error => console.error(error),
      logger(message) {
        if (message.status === 'recognizing text') status.textContent = '正在离线识别…';
      },
    });
    await worker.setParameters({ tessedit_pageseg_mode: '11' });
    const { data } = await worker.recognize(canvas);
    let filled = 0;
    for (const [key, value] of Object.entries(extract(data.text))) {
      if (!inputs[key].value.trim()) {
        inputs[key].value = value;
        filled++;
        if (['phone', 'chat', 'email'].includes(key)) $('confirmed').checked = false;
      }
    }
    updateForm();
    status.textContent = filled ? '已预填 ' + filled + ' 项，请核对原照和联系方式。' : '没有新的可预填字段，可对照原照手填。';
  } catch (error) {
    console.error(error);
    status.textContent = '识别失败。可以重拍、换一张照片或手填，当前原照仍可保存。';
  } finally {
    try {
      if (worker) await worker.terminate();
    } finally {
      working = false;
      setBusy();
    }
  }
}

function reset(record) {
  active = record;
  form.reset();
  form.elements.type.value = record?.type ?? '国内';
  for (const [key, input] of Object.entries(inputs)) input.value = record?.[key] ?? '';
  $('confirmed').checked = Boolean(record?.confirmed);
  setPhoto(record?.photo);
  updateForm();
}

function discardAllowed() {
  if (working || saving) return false;
  const data = formData();
  const changed = Object.keys(fields).some(key => data[key] !== (active?.[key] ?? '')) ||
    photo !== active?.photo || data.type !== (active?.type ?? '国内') || data.confirmed !== Boolean(active?.confirmed);
  return !changed || window.confirm('放弃当前未保存的编辑？');
}

function refreshExports() {
  exportToken++;
  $('export-status').replaceChildren();
}

async function refreshList() {
  const records = await listRecords();
  $('count').textContent = '· ' + records.length + ' 条';
  $('records').replaceChildren(...records.map(record => {
    const row = document.createElement('li');
    const description = document.createElement('span');
    description.textContent = [record.name || '未填姓名', record.company, record.type, record.draft ? '待补' : '完成']
      .filter(Boolean).join(' · ');
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = record.photoName ? '查看原照和资料' : '查看资料';
    open.onclick = async () => {
      open.disabled = true;
      try {
        const loaded = await getRecord(record.id);
        if (!loaded || !discardAllowed()) return;
        reset(loaded);
        status.textContent = '已载入记录，可以修改后再次保存。';
        window.scrollTo(0, 0);
      } catch (error) {
        console.error(error);
        status.textContent = '无法打开这条本机记录。';
      } finally {
        open.disabled = false;
      }
    };
    row.append(description, open);
    return row;
  }));
}

function photoFilename(file, id) {
  if (!file) return '';
  const ext = file.name?.match(/\.[a-z0-9]{1,8}$/i)?.[0];
  const mimeExtension = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
    'image/heic': '.heic', 'image/heif': '.heif' }[file.type];
  return id + (ext || mimeExtension || '.img');
}

async function save() {
  if (saving) return;
  saving = true;
  setBusy();
  const data = formData();
  const id = active?.id ?? crypto.randomUUID();
  try {
    const photoName = photo && active?.photo === photo ? active.photoName : photoFilename(photo, id);
    await putRecord({ ...data, id, photo, photoName,
      draft: missingFields(data).length > 0, updated: new Date().toISOString(),
      createdLocal: active?.createdLocal ?? new Date().toLocaleString('zh-CN', { hour12: false }) });
    reset();
    refreshExports();
    status.textContent = '已保存到这台设备。';
  } catch (error) {
    console.error(error);
    status.textContent = '保存失败，当前表单和照片已保留，请检查设备存储后重试。';
  } finally {
    saving = false;
    setBusy();
  }
  refreshList().catch(() => { $('count').textContent = '· 暂时无法读取记录'; });
}

let downloadUrl;
async function prepareExport(kind) {
  refreshExports();
  const token = exportToken;
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  const feedback = $('export-status');
  feedback.textContent = '正在生成…';
  try {
    const records = await listRecords(kind === 'photos');
    if (!records.length) throw new Error('暂无已保存的记录。');
    if (kind === 'photos' && !records.some(row => row.photo)) throw new Error('已保存的记录中没有照片。');
    const blob = kind === 'excel' ? workbook(records) : await photoArchive(records);
    if (token !== exportToken) return;
    downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = kind === 'excel' ? '展会客户.xlsx' : '名片原照.zip';
    link.textContent = '下载 ' + link.download;
    feedback.replaceChildren(link);
  } catch (error) {
    if (token === exportToken) feedback.textContent = '无法导出：' + error.message;
  }
}

for (const choice of [$('camera'), $('album')]) {
  choice.onchange = () => {
    const file = choice.files[0];
    choice.value = '';
    if (!file || working || saving) return;
    if (photo && !window.confirm('替换当前照片？表单字段会保留，请根据新照片核对。')) return;
    setPhoto(file);
    recognize();
  };
}
form.addEventListener('input', event => {
  if (['phone', 'chat', 'email'].includes(event.target.name)) $('confirmed').checked = false;
  updateForm();
});
form.onsubmit = event => {
  event.preventDefault();
  const data = formData();
  if (!photo && !Object.keys(fields).some(key => data[key])) {
    window.alert('请先拍摄名片或填写客户信息。');
    return;
  }
  const draft = missingFields(data).length > 0;
  $('confirmTitle').textContent = draft ? '保存为待补记录？' : '确认保存登记？';
  $('confirmText').textContent = draft ? $('missing').textContent : '请确认客户资料与照片对应。';
  $('confirmButton').textContent = draft ? '保存待补' : '确认保存';
  $('confirmation').returnValue = '';
  $('confirmation').showModal();
};
$('confirmation').onclose = () => {
  if ($('confirmation').returnValue === 'save') save();
};
$('retry').onclick = recognize;
$('clear').onclick = () => {
  if (discardAllowed()) {
    reset();
    status.textContent = '可以拍摄下一张名片或直接手填。';
    window.scrollTo(0, 0);
  }
};
$('excel').onclick = () => prepareExport('excel');
$('photos').onclick = () => prepareExport('photos');

async function prepareOffline() {
  $('prepare').hidden = true;
  $('offline').textContent = '正在准备离线资源，首次需要联网…';
  try {
    if (!navigator.serviceWorker) throw new Error('请使用 HTTPS 地址打开。');
    const registration = await navigator.serviceWorker.register('./sw.js');
    const worker = registration.installing ?? registration.waiting ?? registration.active;
    if (!worker) throw new Error('未找到离线服务。');
    await new Promise((resolve, reject) => {
      function check() {
        if (worker.state === 'activated' && navigator.serviceWorker.controller?.state === 'activated') {
          worker.removeEventListener('statechange', check);
          navigator.serviceWorker.removeEventListener('controllerchange', check);
          resolve();
        } else if (worker.state === 'redundant') {
          worker.removeEventListener('statechange', check);
          navigator.serviceWorker.removeEventListener('controllerchange', check);
          reject(new Error('资源下载失败，请联网重试。'));
        }
      }
      worker.addEventListener('statechange', check);
      navigator.serviceWorker.addEventListener('controllerchange', check);
      check();
    });
    offlineReady = true;
    $('offline').textContent = '离线已就绪。拍照、识别、保存和导出均可断网使用。';
  } catch (error) {
    $('offline').textContent = '离线资源尚未就绪。' + error.message;
    $('prepare').hidden = false;
  }
}
$('prepare').onclick = prepareOffline;
updateForm();
refreshList().catch(() => { $('count').textContent = '· 暂时无法读取记录'; });
prepareOffline();
