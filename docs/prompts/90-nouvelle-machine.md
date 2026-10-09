# Nouvelle machine ou nouvel équipier (à exécuter en autonomie)

Contexte : le projet existe déjà sur GitHub et tourne sur Railway. Cette machine n'a encore rien. Lis `CLAUDE.md` puis fais ce qui suit.

1. Si le dépôt n'est pas encore cloné ici : demande le jeton GitHub (commence par `ghp_`), exporte-le en `GH_TOKEN`, puis `gh repo clone <compte>/linkaffipro-platform .` (le nom du compte est dans `CLAUDE.md`, section Commandes ; sinon demande-le).
2. Demande le jeton Railway. Crée `.claude/settings.local.json` avec `{"env": {"GH_TOKEN": "...", "RAILWAY_API_TOKEN": "..."}}` et `.env.local` avec les mêmes variables. Vérifie qu'ils sont ignorés par git. Les clés de l'API Link Affi se récupèrent ensuite depuis les variables Railway du service `worker` (étape 4) ; sinon demande-les à l'utilisateur.
3. Outils : `node` 22+, `pnpm` (corepack), `gh`, `railway` ; installe ce qui manque sans `sudo` (voir `docs/prompts/00-phase-0-setup.md`, section 1). `gh auth setup-git`, `gh auth status`, `railway whoami`.
4. `railway link` vers le projet `linkaffipro` (environnement `production`), puis récupère les variables nécessaires au développement local dans `.env.local` (`railway variables --service web --json` et `--service worker`), sans jamais les afficher.
5. `pnpm install`, `pnpm db:generate`, `pnpm build`, `pnpm test`. Tout doit être vert.
6. Explique à l'utilisateur, en 5 lignes, que cette machine est prête et comment lancer une phase (`Lis CLAUDE.md puis docs/prompts/<fichier> et exécute…`). Rappelle que les deux machines se synchronisent par GitHub : avant de commencer un travail, `git pull` ; après, `git push`.
