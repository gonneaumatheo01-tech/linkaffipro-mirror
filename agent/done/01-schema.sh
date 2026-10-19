#!/usr/bin/env bash
set -eu
cd "$(git rev-parse --show-toplevel)"

python3 - <<'PY'
from pathlib import Path

p = Path("packages/db/prisma/schema.prisma")
s = p.read_text(encoding="utf-8")
changed = False

if "userbotAccounts  TelegramUserAccount[]" not in s:
    old = "model Bot {\n"
    assert s.count(old) == 1, "modele Bot introuvable ou ambigu"
    s = s.replace(old, "model Bot {\n  userbotAccounts  TelegramUserAccount[]\n", 1)
    changed = True

if "botId            String?   @unique" not in s:
    anchor = "  @@index([status])\n  @@index([isActive])\n}\n"
    assert s.count(anchor) == 1, "ancre TelegramUserAccount introuvable ou ambigue"
    bloc = (
        "  /// Bot fantome qui porte les conversations de ce compte. L'API bot n'est pas utilisee :\n"
        "  /// la reception et l'envoi passent par la session MTProto tenue par apps/userbot.\n"
        "  botId            String?   @unique\n"
        "  bot              Bot?      @relation(fields: [botId], references: [id], onDelete: SetNull)\n"
        "\n"
    )
    s = s.replace(anchor, bloc + anchor, 1)
    changed = True

if changed:
    p.write_text(s, encoding="utf-8")
    print("schema.prisma mis a jour")
else:
    print("schema.prisma deja a jour")
PY

echo "--- validation du schema ---"
pnpm --filter @linkaffipro/db exec prisma validate

DIR=""
for d in packages/db/prisma/migrations/*_phase18_2b_compte_lie_bot; do
  if [ -e "$d" ]; then DIR="$d"; fi
done

if [ -n "$DIR" ]; then
  echo "migration deja presente : $DIR"
else
  TS=$(date +%Y%m%d%H%M%S)
  DIR="packages/db/prisma/migrations/${TS}_phase18_2b_compte_lie_bot"
  mkdir -p "$DIR"
  cat > "$DIR/migration.sql" <<'SQL'
-- Phase 18 etape 2b : bot fantome portant les conversations d'un compte Telegram reel.
-- L'API bot n'est pas utilisee pour ces conversations : reception et envoi passent par MTProto.
ALTER TABLE "TelegramUserAccount" ADD COLUMN "botId" TEXT;
CREATE UNIQUE INDEX "TelegramUserAccount_botId_key" ON "TelegramUserAccount"("botId");
ALTER TABLE "TelegramUserAccount" ADD CONSTRAINT "TelegramUserAccount_botId_fkey"
  FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
SQL
  echo "migration ecrite : $DIR"
fi

echo "--- application (jamais de remise a zero) ---"
pnpm --filter @linkaffipro/db exec prisma migrate deploy

echo "--- client Prisma ---"
pnpm --filter @linkaffipro/db exec prisma generate

echo "--- typecheck ---"
pnpm typecheck

echo "MIGRATION OK"
