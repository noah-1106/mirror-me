const sensitiveKeywords = [
  '自杀',
  '自残',
  '去死',
  '杀人',
  '强奸',
  '性侵犯',
  '毒品',
  '卖淫',
];

const allowedSituationKeywords = [
  '学校', '同学', '老师', '朋友', '爸妈', '父母', '家庭', '作业', '考试',
  '比赛', '选拔', '兴趣', '爱好', '运动', '音乐', '画画', '读书', '游戏',
  '周末', '假期', '生日', '礼物', '帮助', '分享', '道歉', '原谅',
];

export function checkSensitiveContent(text: string): { ok: boolean; reason?: string } {
  const lower = text.toLowerCase();
  for (const kw of sensitiveKeywords) {
    if (lower.includes(kw)) {
      return { ok: false, reason: '检测到敏感内容，建议去和信任的大人聊聊。' };
    }
  }
  return { ok: true };
}

export function checkSituationWhitelist(situation: {
  title: string;
  description: string;
  choices: { text: string }[];
}): { ok: boolean; reason?: string } {
  const allText = [
    situation.title,
    situation.description,
    ...situation.choices.map((c) => c.text),
  ].join('');

  const hasAllowed = allowedSituationKeywords.some((kw) => allText.includes(kw));
  if (!hasAllowed) {
    return { ok: false, reason: '情境内容未通过白名单校验。' };
  }

  const sensitive = checkSensitiveContent(allText);
  if (!sensitive.ok) return sensitive;

  return { ok: true };
}

export function sanitizeReason(reason: string): string {
  // 只保留统计用信息，不返回原文
  return reason.slice(0, 200);
}
