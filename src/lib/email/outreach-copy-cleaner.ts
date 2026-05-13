/**
 * 外联邮件确定性清理器
 *
 * 清除 AI 生成邮件中遗留的占位符和证据引用标签，保证发出的邮件干净可读。
 * 纯函数，无副作用，可独立单测。
 */

// ============ 签名占位符 ============

/** 匹配完整三行签名块（含可选的 Best regards 前缀） */
const SIGNATURE_BLOCK_RE =
  /(?:Best regards,?\s*\n)?\[Your Name\]\s*\n\[Your Position\]\s*\n\[Your Contact Information\]/gi;

/** 单个 token 正则 */
const YOUR_NAME_RE = /\[Your Name\]/gi;
const YOUR_POSITION_RE = /\s*\[Your Position\]\s*/gi;
const YOUR_CONTACT_RE = /\[Your Contact Information\]/gi;

/** {{SENDER_SIGNATURE}} 占位符 */
const SENDER_SIGNATURE_RE = /\{\{SENDER_SIGNATURE\}\}/g;

// ============ 证据引用标签 ============

/** 匹配 [D1], [E10], [C2] 等（含前导可选空格） */
const EVIDENCE_LABEL_RE = /\s*\[(?:D|E|C)\d+\]/g;

/** 清理后紧贴修复：字母+标点+大写字母（缺少空格） */
const PUNCT_NO_SPACE_RE = /([a-z])([.,])([A-Z])/g;

// ============ 辅助 ============

function getSignatureName(signature: string): string {
  const lines = signature.split('\n').filter(l => l.trim());
  // 跳过 "Best regards," 前缀行
  const nameIdx = lines.findIndex(l => !l.match(/^Best regards/i));
  return nameIdx >= 0 ? lines[nameIdx] : lines[0] || '';
}

function getSignatureEmail(signature: string): string {
  const lines = signature.split('\n').filter(l => l.trim());
  // 最后一行通常是邮箱或联系方式
  return lines[lines.length - 1] || '';
}

// ============ 导出 ============

/**
 * 清理邮件 subject
 * - 移除证据引用标签 [D1]、[E1] 等
 * - 替换 {{SENDER_SIGNATURE}}（极少出现在 subject，兜底）
 */
export function cleanOutreachSubject(subject: string): string {
  let s = subject;
  s = s.replace(SENDER_SIGNATURE_RE, '');
  s = s.replace(YOUR_NAME_RE, '');
  s = s.replace(YOUR_POSITION_RE, ' ');
  s = s.replace(YOUR_CONTACT_RE, '');
  s = s.replace(EVIDENCE_LABEL_RE, '');
  s = s.replace(PUNCT_NO_SPACE_RE, '$1$2 $3');
  return s.replace(/\s{2,}/g, ' ').trim();
}

/**
 * 清理邮件 body
 * - 替换签名占位符（三行块优先，单 token fallback）
 * - 替换 {{SENDER_SIGNATURE}}
 * - 移除证据引用标签
 * - 修复紧贴标点
 */
export function cleanOutreachBody(body: string, signature: string): string {
  let text = body;

  // a) 三行签名块整体替换
  SIGNATURE_BLOCK_RE.lastIndex = 0;
  if (SIGNATURE_BLOCK_RE.test(text)) {
    SIGNATURE_BLOCK_RE.lastIndex = 0;
    text = text.replace(SIGNATURE_BLOCK_RE, signature);
  } else {
    // b) 单个 token fallback
    const name = getSignatureName(signature);
    const email = getSignatureEmail(signature);

    text = text.replace(YOUR_NAME_RE, name);
    text = text.replace(YOUR_POSITION_RE, '\n');
    text = text.replace(YOUR_CONTACT_RE, email);
  }

  // c) {{SENDER_SIGNATURE}} 替换
  text = text.replace(SENDER_SIGNATURE_RE, signature);

  // d) 证据引用标签清理
  text = text.replace(EVIDENCE_LABEL_RE, '');

  // e) 紧贴修复
  text = text.replace(PUNCT_NO_SPACE_RE, '$1$2 $3');

  // 清理多余空行（最多保留一个）
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}
