import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/page-header";
import { LandingPageForm } from "@/components/landing/landing-page-form";
import { env } from "@/lib/env";
import { emptyLandingForm } from "@/lib/landing/form";
import {
  channelsMissingLandingException,
  loadLandingAdChoices,
  loadLandingChannelChoices,
  otherPageNames,
} from "@/lib/landing/queries";
import { requireUser } from "@/lib/session";
import { saveLandingPageAction } from "../actions";

export const metadata: Metadata = { title: "Nouvelle page" };

/**
 * Nouvelle page d'atterrissage (phase 15) : le formulaire unique et l'aperçu téléphone en direct. `?channel=<id>`
 * présélectionne un canal. « Créer la page » crée aussi les liens Telegram des sources, puis ouvre la fiche.
 */
export default async function NewLandingPage({ searchParams }: PageProps<"/pages/new">) {
  await requireUser();
  const sp = await searchParams;
  const [channels, adGroups, takenNames] = await Promise.all([
    loadLandingChannelChoices(),
    loadLandingAdChoices(),
    otherPageNames(),
  ]);
  // Canaux dont une exception « pub » ne viserait pas les visiteurs de la page (ligne sous le choix du canal).
  const exceptionChannels = await channelsMissingLandingException(
    channels.map((c) => c.id),
    null,
  );
  const wanted = typeof sp.channel === "string" ? sp.channel : "";
  const channelId = channels.some((c) => c.id === wanted)
    ? wanted
    : channels.length === 1
      ? channels[0]!.id
      : "";
  return (
    <>
      <PageHeader
        title="Nouvelle page"
        backHref="/pages"
        backLabel="Pages"
        description="Remplissez, regardez l'aperçu, créez : le lien est prêt à coller dans vos pubs."
      />
      <LandingPageForm
        initial={emptyLandingForm(channelId)}
        saved={null}
        channels={channels}
        adGroups={adGroups}
        links={[]}
        trackingBase={env.trackingBaseUrl}
        takenNames={takenNames}
        landingExceptionChannels={exceptionChannels}
        action={saveLandingPageAction}
      />
    </>
  );
}
