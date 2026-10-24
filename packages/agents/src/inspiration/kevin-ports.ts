/**
 * Phase 27, chantier C — seul point d'entrée de Kevin vers la lecture (chantier A) et l'analyse (chantier B). Les
 * fichiers de Kevin (`kevin*.ts`, `proposals.ts`, `apply.ts`, `boss/catalog-inspiration.ts`) n'importent les autres
 * chantiers que par ici : les tests remplacent ce module en entier (`vi.mock("./kevin-ports")`).
 */
export { analyzeReference } from "./analysis/analyze";
export { compareWithChannel } from "./analysis/compare";
export { buildStyleProfile } from "./style";
export { forwardedToReferencePost, type ForwardedMessage, type ForwardedOrigin } from "./sources/forwarded";
export { normalizeChannelUsername, isInviteLink } from "./sources/web-preview";
export { freeReaderAccounts, joinWithInviteOnce, prismaAccountHistoryReader, type AccountJoinReader } from "./sources/account";
export { storeReferencePosts } from "./store";
export { enqueueReferenceRead } from "./read";
