export const fields = {
  name: '姓名', company: '公司', phone: '电话', chat: '微信 / WhatsApp / LINE', email: '邮箱',
  province: '省份', country: '国家', product: '咨询产品线', notes: '特殊需求', sales: '指定销售',
};

const company = /有限公司|集团|\b(?:co\.?,?\s*ltd|ltd|inc|llc|gmbh|corporation|limited)\b/i;
const province = /北京(?:市)?|上海(?:市)?|天津(?:市)?|重庆(?:市)?|内蒙古|广西|西藏|宁夏|新疆|(?:河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海)省/;
const country = /(?:^|[,，])\s*(China|United States|USA|United Kingdom|UK|Germany|France|Italy|India|Japan|Russia|Indonesia|Malaysia|Vietnam|Thailand|Saudi Arabia|United Arab Emirates|UAE|Singapore|Australia|Canada|Brazil|Mexico|South Africa|中国|美国|英国|德国|印度|俄罗斯)\s*$/i;
const email = /[a-z0-9.!#$%&'*+/=?^_{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;

export function extract(text) {
  const result = {};
  const names = new Set();
  function candidate(key, item) {
    const values = new Set(result[key]?.split(' / ') ?? []);
    values.add(item);
    result[key] = [...values].join(' / ');
  }
  for (const line of text.normalize('NFKC').split(/\r?\n/)
    .map(line => line.trim().replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '')).filter(Boolean)) {
    for (const address of line.match(email) ?? []) candidate('email', address);
    const explicitName = line.match(/^(?:姓名|name)\s*:\s*(.+)$/i);
    if (explicitName) result.name ??= explicitName[1];
    if (company.test(line)) result.company ??= line;
    if (!company.test(line) && /地址|省|市|区|县|路|街|号/.test(line)) {
      const match = line.match(province);
      if (match) result.province ??= match[0];
    }
    const region = line.match(country);
    if (region) result.country ??= region[1];
    const contact = line.match(/^(微信(?:号)?|WeChat|WhatsApp|LINE)(?:\s*:\s*|\s+)(.+)$/i);
    if (contact) candidate('chat', contact[1] + ' ' + contact[2]);
    const numbers = line.replace(email, '').split(/(?:\bfax\b|传真|邮编|postal code|postcode)/i)[0];
    for (const [, number] of numbers.matchAll(/(?:^|[^\w@])(\+?\d[\d ()-]{5,23}\d)(?![\w@])/g)) {
      const length = number.replace(/\D/g, '').length;
      if (length >= 7 && length <= 15) candidate('phone', number);
    }
    if (!region && !company.test(line) &&
        /^[\u3400-\u9fff]{2,4}$|^[A-Z][\p{L}'’-]+ [A-Z][\p{L}'’-]+$/u.test(line) &&
        !/经理|总监|工程师|销售|董事|科技|机械|公司|集团|中国|Manager|Director|Sales|Engineer/i.test(line)) {
      names.add(line);
    }
  }
  if (names.size === 1) result.name ??= [...names][0];
  return result;
}

export function missingFields(data) {
  const overseas = data.type === '海外';
  const keys = overseas ? ['name', 'country', 'email', 'product'] : ['name', 'phone', 'province', 'product'];
  const missing = keys.filter(key => !data[key]);
  if (overseas && !data.phone && !data.chat) missing.push('phone');
  if (overseas && !data.confirmed) missing.push('confirmed');
  return missing;
}
