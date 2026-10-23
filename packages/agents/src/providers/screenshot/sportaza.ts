/**
 * Sportaza (premier bookmaker partenaire, phase 23). Le vrai site n'est pas joignable depuis les tests : les sélecteurs
 * ci-dessous sont PRUDENTS et À CONFIRMER EN PRODUCTION (plusieurs possibilités par étape, de la plus précise à la
 * plus générale). Ils se corrigent sans redéploiement dans `AgentTeamConfig.settings.sports.bookmakers.sportaza`
 * (voir `adapters.ts`) ; la page locale des tests (`fixtures/bookmaker`) utilise les mêmes sélecteurs.
 */
import type { BookmakerConfig } from "./adapter";

export const SPORTAZA_CONFIG: BookmakerConfig = {
  key: "sportaza",
  label: "Sportaza",
  baseUrl: "https://sportaza.com/fr/sports",
  loginUrl: null,
  searchUrl: null,
  allowedHosts: ["sportaza.com"],
  stepTimeoutMs: 12_000,
  selectors: {
    cookieAccept: "#onetrust-accept-btn-handler, button[data-testid=cookie-accept], button:has-text('Tout accepter'), button:has-text('Accepter'), button:has-text('Accept all')",
    loggedInMarker: "[data-testid=user-balance], [class*=balance i], [class*=user-menu i], [aria-label*=profil i]",
    loginOpen: "[data-testid=login-button], a[href*='login'], button:has-text('Connexion'), button:has-text('Se connecter'), button:has-text('Log in')",
    loginUser: "input[name=email], input[type=email], input[name=login], input[name=username], input[autocomplete=username]",
    loginPassword: "input[type=password]",
    loginSubmit: "form button[type=submit], button:has-text('Se connecter'), button:has-text('Connexion'), button:has-text('Log in')",
    loginError: "[role=alert], [class*=error i][class*=login i], [data-testid=login-error]",
    searchOpen: "[data-testid=search-button], button[aria-label*=recherch i], button[aria-label*=search i], [class*=search-toggle i]",
    searchInput: "input[type=search], input[name*=search i], input[placeholder*=recherch i], input[placeholder*=search i]",
    searchResult: "[data-testid=search-result] a, [class*=search-result i] a, [class*=searchResult i] a, a[class*=event-link i]",
    marketTab: "[role=tab], [class*=market-tab i], [class*=market-group i] button, [class*=marketGroup i] button",
    marketBlock: "[data-testid=market], [class*=market-block i], [class*=marketBlock i], section[class*=market i]",
    marketTitle: "[data-testid=market-title], [class*=market-title i], [class*=marketTitle i], header, h3, h4",
    selectionRow: "[data-testid=selection], [class*=selection-row i], [class*=outcome-row i], [class*=market-row i], li, tr",
    selectionOdds: "[data-testid=odds], [class*=odds-value i], [class*=price i], [class*=coefficient i]",
    sportsbookFrame: "",
  },
};
