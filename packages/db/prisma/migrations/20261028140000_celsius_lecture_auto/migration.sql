-- Celsius : retour en lecture « serveur d'abord, Mac en secours » (readTarget auto).
-- Le 28 octobre, le proxy norvégien a levé le blocage par pays, mais Celsius demande alors un contrôle anti-robot au
-- serveur. En « server » seul, Celsius ne se lisait plus du tout ; en « auto », un contrôle anti-robot bascule la lecture
-- sur le Mac (essai serveur chaque semaine), comme pour Sportaza.
UPDATE "BookmakerSite" SET "readTarget" = 'auto' WHERE "key" = 'celsius' AND "readTarget" = 'server';
