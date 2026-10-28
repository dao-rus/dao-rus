export function receptionProfileText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= max && !/[\u0000-\u001f\u007f]/u.test(text)
    && !/(?:^|\s)(?:или|либо)(?:\s|$)/iu.test(text) ? text : null;
}

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
  return unique.length === 1 && !/(?:^|\s)(?:или|либо)(?:\s|$)/iu.test(unique[0]!) ? unique[0] : null;
}

function age(text: string): number | null {
  if (/(?:мне\s+|возраст\s*[:—-]?\s*)\d{1,3}\s+или\s+\d{1,3}/iu.test(text)) return null;
  const values = [
    ...text.matchAll(/(?:возраст\s*[:—-]?\s*)(\d{1,3})(?=\s*(?:лет|года|год)?(?:\D|$))/giu),
    ...text.matchAll(/(?:мне\s+|^|\s)(\d{1,3})\s*(?:лет|года|год)/giu),
  ]
    .map((match) => Number(match[1])).filter((value) => value >= 1 && value <= 120);
  return [...new Set(values)].length === 1 ? values[0] : null;
}

function positional(text: string): ReceptionProfileDraft | null {
  const parts = text.split(",").map((part) => part.trim());
  if (parts.length !== 3 || parts.some((part) => !part || /[\n\r]/u.test(part))) return null;
  const ageMatch = parts[0].match(/^(\d{1,3})\s*(?:лет|года|год)?$/iu);
  const city = parts[1].replace(/\s+/gu, " ");
  const occupation = parts[2].replace(/\s+/gu, " ");
  if (!ageMatch || !city || !occupation || !/\p{L}/u.test(city) || !/\p{L}/u.test(occupation)) return null;
  const parsedAge = Number(ageMatch[1]);
  if (parsedAge < 1 || parsedAge > 120) return null;
  return { age: parsedAge, city, occupation, education: null, familyStatus: null };
}

export function extractReceptionProfile(text: string): ReceptionProfileDraft | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const positionalResult = positional(text.trim());
  const result: ReceptionProfileDraft = {
    age: age(text),
    city: one(text, [/(?:живу|проживаю)\s+в\s+([^,.;!?\n]+)/giu, /город\s*[:—-]\s*([^,.;!?\n]+)/giu]),
    occupation: one(text, [/(?:работаю|занимаюсь)\s+([^,.;!?\n]+)/giu, /(?:род\s+занятий|профессия)\s*[:—-]\s*([^,.;!?\n]+)/giu]),
    education: one(text, [/образование\s*[:—-]\s*([^.;!?\n]+)/giu]),
    familyStatus: one(text, [/семейное\s+положение\s*[:—-]\s*([^.;!?\n]+)/giu,
      /(женат|замужем|холост|холоста|разведён|разведена|вдовец|вдова)/giu]),
  };
  if (positionalResult) Object.assign(result, positionalResult);
  // Validate independently before inserting the draft: one invalid value must
  // not make the database reject all the other extracted fields.
  result.city = receptionProfileText(result.city, 200);
  result.occupation = receptionProfileText(result.occupation, 1000);
  result.education = receptionProfileText(result.education, 500);
  result.familyStatus = receptionProfileText(result.familyStatus, 120);
  return Object.values(result).some((value) => value !== null) ? result : null;
}
