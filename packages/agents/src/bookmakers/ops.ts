/**
 * Phase 35, chantier D — fonctions des autres chantiers utilisées par Kevin, la santé et le site, en un seul endroit
 * (les tests les remplacent par `vi.mock("./ops")`) :
 * - chantier A (transport et Mac) : `enqueueReadJob`, `macAlive`, `readMacHeartbeat` ;
 * - chantier B (apprendre un site) : `learnSite` ;
 * - chantier C (lire et parier) : `readEvents`, `readMarkets`, `readOddsTwice`.
 */
export { enqueueReadJob, macAlive, macHeartbeatFresh, readMacHeartbeat } from "./jobs";
export { learnSite } from "./learn";
export { readEvents, readMarkets, readOddsTwice } from "./read";
