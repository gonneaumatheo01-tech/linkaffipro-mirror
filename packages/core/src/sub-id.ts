import { shortId } from "./short-id";

/** Longueur du sub-ID transmis à Link Affi (base62, sans point : voir docs/LINKAFFI-SUBID.md). */
export const SUB_ID_LENGTH = 12;
const SUB_ID_RE = /^[0-9A-Za-z]{12}$/;

export function newSubId(): string {
  return shortId(SUB_ID_LENGTH);
}

export function isSubId(value: unknown): value is string {
  return typeof value === "string" && SUB_ID_RE.test(value);
}

/** Remplace les placeholders d'un modèle d'URL : {subid}, {click_id}, {member_id}, {post_id}. */
export function fillUrlTemplate(template: string, vars: { subid?: string; click_id?: string; member_id?: string; post_id?: string }): string {
  return template.replace(/\{(subid|click_id|member_id|post_id)\}/g, (_m, k: keyof typeof vars) => encodeURIComponent(vars[k] ?? ""));
}
