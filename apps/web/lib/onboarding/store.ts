/** Lecture et écriture de l'état de la visite guidée d'un utilisateur (`Setting` `onboarding.<userId>`). */
import { prisma, toJsonValue } from "@linkaffipro/db";
import { onboardingKey, parseOnboarding, type OnboardingState } from "./state";

export async function loadOnboarding(userId: string): Promise<OnboardingState> {
  const row = await prisma.setting.findUnique({ where: { key: onboardingKey(userId) } });
  return parseOnboarding(row?.value);
}

export async function saveOnboarding(userId: string, state: OnboardingState): Promise<void> {
  const key = onboardingKey(userId);
  const value = toJsonValue(state);
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** Lit l'état, applique `change`, enregistre ; renvoie le nouvel état. */
export async function updateOnboarding(
  userId: string,
  change: (state: OnboardingState) => OnboardingState,
): Promise<OnboardingState> {
  const next = change(await loadOnboarding(userId));
  await saveOnboarding(userId, next);
  return next;
}
