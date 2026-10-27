/**
 * Sticky A/B assignment: the same subject always gets the same variant of an experiment, with no
 * storage, by hashing (experiment, subject). Weights are relative. Pure (no Node APIs), since core
 * also runs in the browser.
 */
export interface Experiment<V extends string = string> {
  name: string;
  variants: { name: V; weight: number }[];
}

export function assignVariant<V extends string>(exp: Experiment<V>, subjectId: string): V {
  const total = exp.variants.reduce((s, v) => s + Math.max(0, v.weight), 0);
  if (total <= 0) return exp.variants[0].name;
  const point = (fnv1a(`${exp.name}:${subjectId}`) / 0x1_0000_0000) * total;
  let acc = 0;
  for (const v of exp.variants) {
    acc += Math.max(0, v.weight);
    if (point < acc) return v.name;
  }
  return exp.variants.at(-1)!.name;
}

/** 32-bit FNV-1a with a final avalanche, so similar ids spread evenly. */
function fnv1a(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
