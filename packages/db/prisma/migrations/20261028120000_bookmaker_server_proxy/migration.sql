-- Lecture des bookmakers par le serveur avec proxy résidentiel norvégien (plus besoin du Mac).
-- Celsius : readTarget "mac" → "server"
-- Sportaza : isActive false → true (était en pause après un captcha)
-- Bet Portal : isActive false → true (était en pause, site ne répondait pas)
UPDATE "BookmakerSite" SET "readTarget" = 'server' WHERE "key" = 'celsius';
UPDATE "BookmakerSite" SET "isActive" = true WHERE "key" IN ('sportaza', 'betportal');
