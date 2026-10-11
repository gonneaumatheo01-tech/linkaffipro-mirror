import type { Metadata } from "next";
import {
  AUTOMATION_TEMPLATE_DEFS,
  isAutomationTemplateKey,
  linearToGraph,
  templateGraph,
} from "@linkaffipro/core";
import { Flash } from "@/components/admin/flash";
import { PageHeader } from "@/components/admin/page-header";
import { RuleEditor } from "@/components/automations/editor/rule-editor";
import { CARD_DEFS } from "@/lib/automations/cards";
import { graphToDraft } from "@/lib/automations/flow";
import { loadEditorOptions, loadNames } from "@/lib/automations/queries";
import { requireUser } from "@/lib/session";
import { saveRuleAction, testRuleOnMeAction } from "../actions";

export const metadata: Metadata = { title: "Nouvelle relance sur mesure" };

/**
 * Création d'une relance sur mesure dans l'éditeur à branches. `?template=<carte>` : part du parcours d'une carte prête
 * à l'emploi (pour l'enrichir) ; sinon, départ → un message à écrire.
 */
export default async function NewAutomationPage({
  searchParams,
}: PageProps<"/members/automations/new">) {
  await requireUser();
  const sp = await searchParams;
  const key = isAutomationTemplateKey(sp.template) ? sp.template : null;
  const [options, names] = await Promise.all([loadEditorOptions(), loadNames()]);
  const initial = key
    ? {
        name: CARD_DEFS[key].ruleName,
        trigger: AUTOMATION_TEMPLATE_DEFS[key].trigger,
        conditions: { ...AUTOMATION_TEMPLATE_DEFS[key].conditions },
        oncePerMember: true,
        draft: graphToDraft(
          templateGraph(key, {
            message: CARD_DEFS[key].defaults.message,
            hours: CARD_DEFS[key].defaults.hours,
          }),
        ),
        templateKey: key,
      }
    : {
        name: "",
        trigger: "JOINED",
        conditions: {},
        oncePerMember: true,
        draft: graphToDraft(linearToGraph([{ type: "send_message", text: "" }])),
        templateKey: null,
      };
  return (
    <>
      <PageHeader
        backHref="/members/automations"
        backLabel="Relances automatiques"
        title="Nouvelle relance sur mesure"
        // Sur téléphone, l'éditeur affiche lui-même « À utiliser sur ordinateur » : la consigne n'est pas répétée ici.
        description={
          <span className="max-md:hidden">
            Glissez des blocs depuis la bibliothèque, reliez-les, puis réglez chacun dans le panneau
            de droite.
          </span>
        }
        help="La relance est créée désactivée : rien ne part vers les membres tant que vous ne l'activez pas."
      />
      <Flash ok={sp.ok} error={sp.error} />
      <RuleEditor
        ruleId={null}
        initial={initial}
        options={options}
        names={names}
        pendingLinear={0}
        saveAction={saveRuleAction}
        testAction={testRuleOnMeAction}
      />
    </>
  );
}
