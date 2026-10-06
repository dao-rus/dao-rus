import type { Signal, SignalType, SignalVisibility } from "./signals";
import type { InterfaceTextKey, InterfaceTextValues } from "./interface-texts";

// Presentation hints only. Catalogue keys, enablement and catalogue order stay authoritative.
export const signalPresentationDefaults = [
  { key: "need", name: "? Нужно", group: "needs", description: "То, чего вам сейчас не хватает и с чем могла бы помочь сеть.", example: "фотограф" },
  { key: "search", name: "Ищу", group: "needs", description: "Конкретный человек, вещь, информация, возможность или контакт, которые вы пытаетесь найти.", example: "налоговый юрист" },
  { key: "can", name: "! Могу", group: "resources", description: "То, что вы сейчас готовы сделать или предложить другим.", example: "ремонт электроники" },
  { key: "have", name: "+ Есть", group: "resources", description: "Ресурсы, вещи, доступы, время или возможности, которыми вы располагаете.", example: "помещение" },
  { key: "know", name: "Знаю", group: "skills", description: "Области, в которых у вас есть знания, опыт или понимание.", example: "история Византии" },
  { key: "skill", name: "Умею", group: "skills", description: "Навыки и действия, которые вы умеете выполнять.", example: "ремонт электроники" },
  { key: "want", name: "♥ Хочу", group: "intentions", description: "То, к чему вы стремитесь, даже если пока ещё не начали это делать.", example: "фотография" },
  { key: "doing", name: "▶ Делаю", group: "intentions", description: "Проекты, дела и направления, которыми вы реально занимаетесь сейчас.", example: "образовательный проект" },
  { key: "idea", name: "Идея", group: "intentions", description: "Мысли и замыслы, которые вам кажутся интересными, даже если вы пока не знаете, как их воплотить.", example: "домашняя мастерская" },
  { key: "dating", name: "Знакомства", group: "connections", description: "Люди и формы общения, которые вы хотели бы найти: дружба, компания, совместные занятия, отношения.", example: "компания для прогулок" },
] as const;
export const signalGroupDefaults = [
  ["needs", "Потребности и поиск"], ["resources", "Возможности и ресурсы"],
  ["skills", "Компетенции"], ["intentions", "Намерения и деятельность"],
  ["connections", "Человеческие связи"], ["other", "Другие сигналы"],
] as const;

export function signalTypePresentation(type: SignalType, texts: InterfaceTextValues) {
  const hint = signalPresentationDefaults.find((entry) => entry.key === type.key);
  const read = (key: string) => texts[key as InterfaceTextKey];
  // Keep the four existing editable names and CTAs compatible with admin overrides.
  const name = read(`exchange.tab_${type.key}`) || read(`signal.${type.key}.name`) || type.displayName;
  return { name, group: hint?.group ?? "other",
    description: read(`signal.${type.key}.description`) || texts["signal.description_generic"],
    example: read(`signal.${type.key}.example`),
    placeholder: read(`signal.${type.key}.placeholder`) || texts["signal.label_placeholder"],
    cta: read(`exchange.add_${type.key}`) || texts["signal.create"],
  };
}
export function groupSignalTypes(types: SignalType[], texts: InterfaceTextValues) {
  return signalGroupDefaults.map(([key]) => ({ key, name: texts[`signal.group_${key}`],
    types: types.filter((type) => signalTypePresentation(type, texts).group === key),
  })).filter((group) => group.types.length);
}
export function selectSignalType(types: SignalType[], key?: string): SignalType | undefined {
  return types.find((type) => type.key === key) || types.find((type) => type.key === "need") || types[0];
}
export function signalVisibilityOptions(typeKey: string): SignalVisibility[] {
  if (typeKey === "dating") return ["private", "match_only", "circle"];
  return ["members", "public", "match_only", "private", "circle",
    ...(typeKey === "need" || typeKey === "have" ? ["network_blind" as const] : [])];
}
export function groupProfileSignals(signals: Signal[], types: SignalType[]) {
  const visibleTypes = [...types, ...Array.from(new Set(signals.map((signal) => signal.typeKey)))
    .filter((key) => !types.some((type) => type.key === key))
    .map((key) => ({ key, displayName: key, enabled: false }))];
  return visibleTypes.map((type) => ({ type, signals: signals.filter((signal) => signal.typeKey === type.key) }))
    .filter((group) => group.signals.length);
}
