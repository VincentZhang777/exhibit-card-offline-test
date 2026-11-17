import { zipSync, strToU8 } from './vendor/fflate.js';
import { fields } from './rules.js';

const sheetNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const officeRelationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageRelationships = 'http://schemas.openxmlformats.org/package/2006/relationships';
const contentNamespace = 'http://schemas.openxmlformats.org/package/2006/content-types';
const drawingNamespace = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const graphicsNamespace = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
const relationships = links => '<Relationships xmlns="' + packageRelationships + '">' +
  links.map(([type, target], index) => '<Relationship Id="rId' + (index + 1) + '" Type="' +
    officeRelationships + '/' + type + '" Target="' + target + '"/>').join('') + '</Relationships>';
const photoColumn = 6 + Object.keys(fields).length;
const photoPadding = 6;

function xmlText(value) {
  return String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#13;');
}

async function thumbnail(blob) {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('无法读取名片照片'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    try {
      const scale = Math.min(1, 1000 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const jpeg = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .82));
      if (!jpeg) throw new Error('无法生成名片缩略图');
      const fit = Math.min(216 / canvas.width, 140 / canvas.height);
      const width = Math.max(1, Math.round(canvas.width * fit));
      const height = Math.max(1, Math.round(canvas.height * fit));
      return { width, height, bytes: new Uint8Array(await jpeg.arrayBuffer()) };
    } finally {
      canvas.width = canvas.height = 0;
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

function photoAnchor({ row, width, height }, index) {
  const id = index + 1;
  const marker = (tag, x, y) => '<xdr:' + tag + '><xdr:col>' + photoColumn + '</xdr:col>' +
    '<xdr:colOff>' + x * 9525 + '</xdr:colOff><xdr:row>' + row + '</xdr:row><xdr:rowOff>' +
    y * 9525 + '</xdr:rowOff></xdr:' + tag + '>';
  return '<xdr:twoCellAnchor editAs="twoCell">' + marker('from', photoPadding, photoPadding) +
    marker('to', photoPadding + width, photoPadding + height) +
    '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="' + id + '" name="名片照片 ' + id + '"/>' +
    '<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>' +
    '<xdr:blipFill><a:blip r:embed="rId' + id + '"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
    '<xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>' +
    '<xdr:clientData/></xdr:twoCellAnchor>';
}

export async function workbook(records, getRecord) {
  const rows = [
    ['登记编号', '登记时间', '客户类型', '状态', '联系方式已核对', '原照文件名', ...Object.values(fields), '名片照片'],
    ...records.map(record => [record.id, record.createdLocal, record.type, record.draft ? '待补' : '完成',
      record.type === '海外' ? (record.confirmed ? '是' : '否') : '', record.photoName,
      ...Object.keys(fields).map(key => record[key])]),
  ];
  const photos = [];
  const rowHeights = new Map();
  let skippedPhotos = 0;
  for (const [index, record] of records.entries()) {
    const row = index + 1;
    if (!record.photoName) continue;
    try {
      // Load originals one at a time so a large export does not retain every full-size photo.
      const saved = await getRecord(record.id);
      if (!saved?.photo || saved.updated !== record.updated) throw new Error('原照缺失或记录已更新');
      const photo = await thumbnail(saved.photo);
      photos.push({ ...photo, row });
      rowHeights.set(row, (photo.height + 2 * photoPadding) * .75);
    } catch (error) {
      rows[row][photoColumn] = '无法嵌入';
      skippedPhotos++;
      console.warn('无法嵌入名片照片', error);
    }
  }
  const sheetData = rows.map((row, index) => '<row r="' + (index + 1) + '"' +
    (rowHeights.has(index) ? ' ht="' + rowHeights.get(index) + '" customHeight="1"' : '') + '>' +
    row.map((value, column) => '<c r="' + String.fromCharCode(65 + column) + (index + 1) +
      '" t="inlineStr"><is><t xml:space="preserve">' + xmlText(value) + '</t></is></c>').join('') + '</row>').join('');
  const drawingContent = photos.length ? '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
    '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : '';
  const parts = {
    '[Content_Types].xml': '<Types xmlns="' + contentNamespace + '">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      drawingContent + '</Types>',
    '_rels/.rels': relationships([['officeDocument', 'xl/workbook.xml']]),
    'xl/_rels/workbook.xml.rels': relationships([['worksheet', 'worksheets/sheet1.xml']]),
    'xl/workbook.xml': '<workbook xmlns="' + sheetNamespace + '" xmlns:r="' + officeRelationships +
      '"><sheets><sheet name="客户登记" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/worksheets/sheet1.xml': '<worksheet xmlns="' + sheetNamespace + '" xmlns:r="' + officeRelationships + '">' +
      '<cols><col min="' + (photoColumn + 1) + '" max="' + (photoColumn + 1) + '" width="33" customWidth="1"/></cols>' +
      '<sheetData>' + sheetData + '</sheetData>' + (photos.length ? '<drawing r:id="rId1"/>' : '') + '</worksheet>',
  };
  if (photos.length) {
    parts['xl/worksheets/_rels/sheet1.xml.rels'] = relationships([['drawing', '../drawings/drawing1.xml']]);
    parts['xl/drawings/drawing1.xml'] = '<xdr:wsDr xmlns:xdr="' + drawingNamespace + '" xmlns:a="' + graphicsNamespace +
      '" xmlns:r="' + officeRelationships + '">' + photos.map(photoAnchor).join('') + '</xdr:wsDr>';
    parts['xl/drawings/_rels/drawing1.xml.rels'] = relationships(
      photos.map((_, index) => ['image', '../media/card' + (index + 1) + '.jpeg']));
  }
  const entries = Object.fromEntries(Object.entries(parts).map(([path, contents]) => [path, strToU8(xmlHeader + contents)]));
  photos.forEach((photo, index) => { entries['xl/media/card' + (index + 1) + '.jpeg'] = [photo.bytes, { level: 0 }]; });
  const blob = new Blob([zipSync(entries)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return { blob, skippedPhotos };
}

export async function photoArchive(records) {
  const entries = {};
  for (const row of records) {
    if (row.photo) entries[row.photoName] = new Uint8Array(await row.photo.arrayBuffer());
  }
  return new Blob([zipSync(entries, { level: 0 })], { type: 'application/zip' });
}
