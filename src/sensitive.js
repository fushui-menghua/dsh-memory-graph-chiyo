/**
 * sensitive.js —— 写记忆前的敏感内容过滤
 *
 * 为什么放在写入层而不是展示层：
 *   记忆一旦落盘就会被反复召回、跨会话共享；路径、QQ 号、凭据写进去，
 *   等于永久留在系统里。所以在写入前就拦住，而不是等输出时再打码。
 *
 * 默认拦：QQ号、本机盘符路径、URL 里的账号密码、token/密码赋值、32位以上十六进制串。
 * 想放行可以用 allow: ['qq'] / allow: ['path'] 单独开。
 */
export const SENSITIVE_PATTERNS = {
  qq: /(?:^|[^\d])\d{5,12}(?:[^\d]|$)/,
  path: /[A-Za-z]:[\\/]|(?:^|\s)\/(?:home|Users|etc|var|root)\//,
  credential: /(?:token|密码|密钥|password|secret|api[_-]?key|authorization|bearer|credential)\s*[:=：是为]/i,
  hexToken: /\b[0-9a-f]{32,}\b/i,
  urlCredential: /\/\/[^/\s:@]+:[^/\s@]+@/,
};

const LABELS = {
  qq: 'QQ号/长数字',
  path: '本机路径',
  credential: '凭据赋值',
  hexToken: '令牌串',
  urlCredential: 'URL 内账号密码',
};

/** 扫描一段文本，返回命中类型 */
export function scanSensitive(text, { allow = [] } = {}) {
  const s = String(text ?? '');
  const hits = [];
  for (const [key, re] of Object.entries(SENSITIVE_PATTERNS)) {
    if (allow.includes(key)) continue;
    if (re.test(s)) hits.push({ type: key, label: LABELS[key] });
  }
  return hits;
}

/** 写入前调用：命中就抛错（附带命中类型，方便调用方决定怎么改） */
export function assertNotSensitive(text, { allow = [] } = {}) {
  const hits = scanSensitive(text, { allow });
  if (hits.length) {
    const err = new Error(`记忆里含敏感内容：${hits.map((h) => h.label).join('、')}`);
    err.code = 'SENSITIVE_CONTENT';
    err.hits = hits;
    throw err;
  }
  return true;
}
