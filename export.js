import { zipSync, strToU8 } from './vendor/fflate.js';
import { fields } from './rules.js';

const sheetNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const officeRelationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageRelationships = 'http://schemas.openxmlformats.org/package/2006/relationships';
const contentNamespace = 'http://schemas.openxmlformats.org/package/2006/content-types';
const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
const relationship = (type, target) =>
  '<Relationships xmlns="' + packageRelationships + '"><Relationship Id="rId1" Type="' +
  officeRelationships + '/' + type + '" Target="' + target + '"/></Relationships>';

function xmlText(value) {
  return String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#13;');
}

export function workbook(records) {
  const rows = [
    ['登记编号', '登记时间', '客户类型', '状态', '联系方式已核对', '原照文件名', ...Object.values(fields)],
    ...records.map(record => [record.id, record.createdLocal, record.type, record.draft ? '待补' : '完成',
      record.type === '海外' ? (record.confirmed ? '是' : '否') : '', record.photoName,
      ...Object.keys(fields).map(key => record[key])]),
  ];
  const sheetData = rows.map((row, index) => '<row r="' + (index + 1) + '">' +
    row.map((value, column) => '<c r="' + String.fromCharCode(65 + column) + (index + 1) +
      '" t="inlineStr"><is><t xml:space="preserve">' + xmlText(value) + '</t></is></c>').join('') + '</row>').join('');
  const parts = {
    '[Content_Types].xml': '<Types xmlns="' + contentNamespace + '">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': relationship('officeDocument', 'xl/workbook.xml'),
    'xl/_rels/workbook.xml.rels': relationship('worksheet', 'worksheets/sheet1.xml'),
    'xl/workbook.xml': '<workbook xmlns="' + sheetNamespace + '" xmlns:r="' + officeRelationships +
      '"><sheets><sheet name="客户登记" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/worksheets/sheet1.xml': '<worksheet xmlns="' + sheetNamespace + '"><sheetData>' + sheetData + '</sheetData></worksheet>',
  };
  const entries = Object.fromEntries(Object.entries(parts).map(([path, contents]) => [path, strToU8(xmlHeader + contents)]));
  return new Blob([zipSync(entries)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export async function photoArchive(records) {
  const entries = {};
  for (const row of records) {
    if (row.photo) entries[row.photoName] = new Uint8Array(await row.photo.arrayBuffer());
  }
  return new Blob([zipSync(entries, { level: 0 })], { type: 'application/zip' });
}
