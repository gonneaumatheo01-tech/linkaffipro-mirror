/** Capture d'écran (phase 23 : coupon du bookmaker). Interface seulement en phase 19. */
export type ScreenshotRequest = { url: string; selector?: string; width?: number; height?: number };
export type ScreenshotResult = { ok: boolean; bytes?: Uint8Array; costCents: number; error?: string };
export type ScreenshotProvider = { name: string; capture(req: ScreenshotRequest): Promise<ScreenshotResult> };
