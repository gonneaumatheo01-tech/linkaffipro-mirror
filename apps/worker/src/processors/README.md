Un fichier par file BullMQ. Chaque fichier exporte `processXxx(job)` et `repeatableXxx` (tâches périodiques).
Propriétaires : approvals → chantier A ; scheduler et telegram-send → chantier C ; sync-linkaffi → chantier D ; stats → chantier E.
Ne pas modifier `index.ts` ni `queues.ts` : ils sont déjà branchés.
