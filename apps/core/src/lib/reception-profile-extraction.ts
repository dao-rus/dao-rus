export type ReceptionProfileDraft = {
  age: number | null;
  city: string | null;
  occupation: string | null;
  education: string | null;
  familyStatus: string | null;
};

function one(text: string, patterns: RegExp[]): string | null {
  const values = patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[1]?.trim()).filter(Boolean));
  const unique = [...new Set(values.map((value) => value!.replace(/\s+/gu, " ")))];
  return unique.length === 1 ? unique[0] : null;
}

function age(text: string): number | null {
  if (/(?:мне\s+|возраст\s*[:—-]?\s*)\d{1,3}\s+или\s+\d{1,3}/iu.test(text)) return null;
  const values = [...text.matchAll(/(?:мне\s+|возраст\s*[:—-]?\s*|^|\s)(\d{1,3})\s*(?:лет|года|год)/giu)]
    .map((match) => Number(match[1])).filter((value) => value >= 1 && value <= 120);
  return [...new Set(values)].length === 1 ? values[0] : null;
}

export function extractReceptionProfile(text: string): ReceptionProfileDraft | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const result: ReceptionProfileDraft = {
    age: age(text),
    city: one(text, [/(?:живу|проживаю)\s+в\s+([^,.;!?\n]+)/giu, /(?:родом)\s+из\s+([^,.;!?\n]+)/giu, /город\s*[:—-]\s*([^,.;!?\n]+)/giu]),
    occupation: one(text, [/(?:работаю|занимаюсь)\s+([^,.;!?\n]+)/giu, /(?:род\s+занятий|профессия)\s*[:—-]\s*([^,.;!?\n]+)/giu]),
    education: one(text, [/образование\s*[:—-]\s*([^.;!?\n]+)/giu]),
    familyStatus: one(text, [/семейное\s+положение\s*[:—-]\s*([^.;!?\n]+)/giu,
      /(женат|замужем|холост|холоста|разведён|разведена|вдовец|вдова)/giu]),
  };
  return Object.values(result).some((value) => value !== null) ? result : null;
}
