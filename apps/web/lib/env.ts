/** Accès centralisé aux variables d'environnement du site. */
export const env = {
  get appBaseUrl(): string {
    return (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  },
  get trackingHost(): string {
    return process.env.TRACKING_HOST ?? "go.goolink.eu";
  },
  get trackingBaseUrl(): string {
    return (process.env.TRACKING_BASE_URL ?? `https://${this.trackingHost}`).replace(/\/$/, "");
  },
};
