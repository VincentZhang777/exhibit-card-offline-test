import { extract, fields, missingFields } from './rules.js';
import { getRecord, listRecords, putRecord } from './storage.js';
import { photoArchive, workbook } from './export.js';

const $ = id => document.getElementById(id);
const form = $('card');
const status = $('status');
const ocrLanguage = $('ocr-language');
const modelAssets = ["./vendor/tesseract.min.js","./vendor/worker.min.js","./vendor/core/tesseract-core-lstm.wasm.js","./vendor/core/tesseract-core-simd-lstm.wasm.js","./vendor/lang/eng.traineddata.gz","./vendor/lang/chi_sim.traineddata.gz","./vendor/lang/rus.traineddata.gz","./vendor/lang/spa.traineddata.gz","./vendor/lang/ara.traineddata.gz","./vendor/lang/fra.traineddata.gz","./vendor/jsQR.js"];
const inputs = {};
let active;
let photo;
let previewUrl;
let previewLoaded;
let working = false;
let saving = false;
let offlineReady = false;
let exportToken = 0;
const productLines = ['破碎', '制砂', '沥青', '商混', '干混', '建废', '水洗', '泥处理'];
const productPreferenceKey = 'exhibit-card-last-product';
let defaultProduct = '';
try {
  const savedProduct = localStorage.getItem(productPreferenceKey);
  if (productLines.includes(savedProduct)) defaultProduct = savedProduct;
} catch (error) {
  console.warn('无法读取默认产品线', error);
}

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
  const multiline = key === 'notes' || key === 'chat';
  const input = document.createElement(key === 'product' ? 'select' : multiline ? 'textarea' : 'input');
  input.id = label.htmlFor;
  input.name = key;
  if (['name', 'company', 'notes'].includes(key)) input.dir = 'auto';
  if (key === 'email') input.inputMode = 'email';
  if (key === 'phone') input.inputMode = 'tel';
  if (multiline) label.className = 'wide';
  if (key === 'product') {
    input.add(new Option('不选择', ''));
    for (const line of productLines) input.add(new Option(line, line));
    input.value = defaultProduct;
    input.onchange = () => {
      if (input.value && !productLines.includes(input.value)) return;
      defaultProduct = input.value;
      try {
        localStorage.setItem(productPreferenceKey, defaultProduct);
      } catch (error) {
        console.warn('无法保存默认产品线', error);
      }
    };
  }
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
    ? '二次确认联系方式' : key === 'phone' && abroad ? '电话或' + fields.chat : fields[key]).join('、') : '';
}

function canShareFiles(shareData) {
  try {
    return typeof navigator.share === 'function' && navigator.canShare?.(shareData);
  } catch (error) {
    console.warn('无法使用系统文件分享', error);
    return false;
  }
}

function setPhoto(file) {
  $('ocr-result').hidden = true;
  $('ocr-result').open = false;
  $('ocr-text').textContent = '';
  const previousUrl = previewUrl;
  photo = file;
  previewUrl = file ? URL.createObjectURL(file) : undefined;
  const preview = $('preview');
  preview.onload = null;
  preview.onerror = null;
  previewLoaded = file ? loadPreview(preview, file, previewUrl) : undefined;
  if (!file) preview.removeAttribute('src');
  if (previousUrl) URL.revokeObjectURL(previousUrl);
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
  const canShare = canShareFiles(shareData);
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

function loadPreview(preview, file, url) {
  return new Promise(resolve => {
    function unavailable() {
      if (previewUrl === url) {
        preview.hidden = true;
        status.textContent = '无法显示这张照片。原照可以保存，也可以重拍或选择另一张照片。';
      }
      resolve(false);
    }
    preview.onload = () => resolve(true);
    preview.onerror = () => {
      const reader = new FileReader();
      reader.onload = () => {
        if (previewUrl !== url) {
          resolve(false);
          return;
        }
        preview.onerror = unavailable;
        preview.src = reader.result;
      };
      reader.onerror = unavailable;
      reader.readAsDataURL(file);
    };
    preview.src = url;
  });
}

function loadLibrary(path, name) {
  if (globalThis[name]) return Promise.resolve(globalThis[name]);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(path, import.meta.url).href;
    script.onload = () => {
      if (globalThis[name]) resolve(globalThis[name]);
      else reject(new Error('无法初始化 ' + name));
    };
    script.onerror = () => {
      script.remove();
      reject(new Error('无法加载 ' + name));
    };
    document.head.append(script);
  });
}

function setBusy() {
  $('save').disabled = working || saving;
  $('clear').disabled = working || saving;
  $('retry').disabled = working || saving;
  $('camera').disabled = working || saving;
  $('album').disabled = working || saving;
  ocrLanguage.disabled = working || saving;
}

async function recognize() {
  if (!photo || working || saving) return;
  const selectedPhoto = photo;
  if (!await previewLoaded || photo !== selectedPhoto || working || saving) return;
  if (!offlineReady) {
    status.textContent = '照片已显示。离线资源就绪后会自动识别，也可以先手填保存。';
    return;
  }
  let worker;
  let qrFilled = false;
  working = true;
  setBusy();
  $('ocr-result').hidden = true;
  status.textContent = '正在加载本机识别模型…';
  try {
    // Resize only the image used for recognition. Keep the original File for storage and export.
    const preview = $('preview');
    const ratio = Math.min(1, 2000 / Math.max(preview.naturalWidth, preview.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(preview.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(preview.naturalHeight * ratio));
    const context = canvas.getContext('2d');
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(preview, 0, 0, canvas.width, canvas.height);
    try {
      const scanQR = await loadLibrary('./vendor/jsQR.js', 'jsQR');
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const content = scanQR(pixels.data, pixels.width, pixels.height)?.data.replace(/\r\n?/g, '\n').trim();
      if (content) {
        const current = inputs.chat.value.trim();
        if (!('\n\n' + current + '\n\n').includes('\n\n' + content + '\n\n')) {
          inputs.chat.value = current ? current + '\n\n' + content : content;
          $('confirmed').checked = false;
          qrFilled = true;
          updateForm();
        }
      }
    } catch (error) {
      console.error('无法识别二维码', error);
    }
    const languages = ocrLanguage.value ? [ocrLanguage.value, 'eng']
      : form.elements.type.value === '海外' ? ['eng', 'chi_sim'] : ['chi_sim', 'eng'];
    const tesseract = await loadLibrary('./vendor/tesseract.min.js', 'Tesseract');
    worker = await tesseract.createWorker(languages, 1, {
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
    $('ocr-text').textContent = data.text.trim();
    $('ocr-result').hidden = !$('ocr-text').textContent;
    let filled = Number(qrFilled);
    for (const [key, value] of Object.entries(extract(data.text))) {
      if (!inputs[key].value.trim()) {
        inputs[key].value = value;
        filled++;
        if (['phone', 'chat', 'email'].includes(key)) $('confirmed').checked = false;
      }
    }
    updateForm();
    status.textContent = filled ? (qrFilled ? '已识别二维码。' : '') + '已预填 ' + filled + ' 项，请核对原照和联系方式。'
      : '没有新的可预填字段，可对照原照手填。';
  } catch (error) {
    console.error(error);
    status.textContent = (qrFilled ? '已填写二维码内容。' : '') + '文字识别失败，可以重拍或手填，当前原照仍可保存。';
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
  const language = ocrLanguage.value;
  form.reset();
  ocrLanguage.value = language;
  form.elements.type.value = record?.type ?? '国内';
  const legacyOption = inputs.product.querySelector('[data-legacy]');
  legacyOption?.remove();
  const product = record ? record.product ?? '' : defaultProduct;
  if (product && !productLines.includes(product)) {
    const option = new Option(product, product);
    option.setAttribute('data-legacy', '');
    inputs.product.add(option);
  }
  for (const [key, input] of Object.entries(inputs)) {
    input.value = key === 'product' ? product : record?.[key] ?? '';
  }
  $('confirmed').checked = Boolean(record?.confirmed);
  setPhoto(record?.photo);
  updateForm();
}

function discardAllowed() {
  if (working || saving) return false;
  const data = formData();
  const baseline = active ?? { product: defaultProduct };
  const changed = Object.keys(fields).some(key => data[key] !== (baseline[key] ?? '')) ||
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
    const { blob, skippedPhotos = 0 } = kind === 'excel'
      ? await workbook(records, getRecord) : { blob: await photoArchive(records) };
    if (token !== exportToken) return;
    downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = kind === 'excel' ? '展会客户.xlsx' : '名片原照.zip';
    link.textContent = '下载 ' + link.download;
    feedback.replaceChildren(link);
    if (kind === 'excel') {
      feedback.append('（' + records.length + ' 条记录）');
      const file = new File([blob], link.download, { type: blob.type });
      const shareData = { files: [file] };
      if (canShareFiles(shareData)) {
        const share = document.createElement('button');
        share.type = 'button';
        share.textContent = '用其他应用打开或存储到文件';
        share.onclick = async () => {
          try {
            await navigator.share(shareData);
          } catch (error) {
            if (error.name !== 'AbortError' && token === exportToken) {
              feedback.append(' 系统未能打开，请使用下载链接。');
            }
          }
        };
        feedback.append(' ', share);
      }
    }
    if (skippedPhotos) feedback.append('（' + skippedPhotos + ' 张照片无法嵌入，可另行导出原照 ZIP）');
  } catch (error) {
    if (token === exportToken) feedback.textContent = '无法导出：' + error.message;
  }
}

for (const choice of [$('camera'), $('album')]) {
  choice.onchange = () => {
    const file = choice.files[0];
    if (!file || working || saving) return;
    if (!photo || window.confirm('替换当前照片？表单字段会保留，请根据新照片核对。')) {
      setPhoto(file);
      recognize();
    }
    choice.value = '';
  };
}
form.addEventListener('input', event => {
  if (['phone', 'chat', 'email'].includes(event.target.name)) $('confirmed').checked = false;
  updateForm();
});
form.onsubmit = event => {
  event.preventDefault();
  const data = formData();
  if (!photo && !Object.keys(fields).some(key => key !== 'product' && data[key])) {
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

async function prepareModels() {
  let ready = 0;
  function showProgress() {
    $('offline').textContent = '正在下载离线识别资源（' + ready + '/' + modelAssets.length +
      '）。请保持联网，可先拍照、手填并保存。';
  }
  showProgress();
  for (let offset = 0; offset < modelAssets.length; offset += 3) {
    const batch = await Promise.allSettled(modelAssets.slice(offset, offset + 3).map(async path => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 90_000);
      try {
        const response = await fetch(path, { signal: controller.signal });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        response.body?.cancel().catch(() => {});
        ready++;
        showProgress();
      } finally {
        clearTimeout(timer);
      }
    }));
    if (batch.some(result => result.status === 'rejected')) {
      throw new Error('下载中断。请联网重试，已下载的资源会保留。');
    }
  }
}

async function prepareOffline() {
  $('prepare').hidden = true;
  $('offline').textContent = '正在准备离线资源，首次需要联网…';
  try {
    const serviceWorker = navigator.serviceWorker;
    if (!serviceWorker) throw new Error('请使用 HTTPS 地址打开。');
    await new Promise((resolve, reject) => {
      let worker;
      let finished = false;
      const timer = setTimeout(() => {
        $('offline').textContent = '正在连接离线服务。请保持联网，可先拍照、手填并保存。';
      }, 15_000);
      const deadline = setTimeout(() => finish(new Error('连接离线服务超时，请联网后重试。')), 120_000);
      function finish(error) {
        finished = true;
        clearTimeout(timer);
        clearTimeout(deadline);
        worker?.removeEventListener('statechange', check);
        serviceWorker.removeEventListener('controllerchange', check);
        if (error) reject(error);
        else resolve();
      }
      function check() {
        if (worker.state === 'activated' && serviceWorker.controller === worker) {
          finish();
        } else if (worker.state === 'redundant') {
          finish(new Error('页面资源下载失败，请联网重试。'));
        }
      }
      serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(registration => {
        if (finished) return;
        worker = registration.installing ?? registration.waiting ?? registration.active;
        if (!worker) {
          finish(new Error('未找到离线服务。'));
          return;
        }
        worker.addEventListener('statechange', check);
        serviceWorker.addEventListener('controllerchange', check);
        check();
      }, error => {
        if (!finished) finish(error);
      });
    });
    await prepareModels();
    offlineReady = true;
    $('offline').textContent = '离线已就绪。拍照、识别、保存和导出均可断网使用。';
    if (photo && photo !== active?.photo) recognize();
  } catch (error) {
    $('offline').textContent = '离线资源尚未就绪。' + error.message;
    $('prepare').hidden = false;
  }
}
$('prepare').onclick = prepareOffline;
updateForm();
refreshList().catch(() => { $('count').textContent = '· 暂时无法读取记录'; });
prepareOffline();
