import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@linkaffipro/db";
import { Flash } from "@/components/admin/flash";
import { PageHeader } from "@/components/admin/page-header";
import { RuleEditor } from "@/components/automations/editor/rule-editor";
import { ruleToDraft } from "@/lib/automations/flow";
import { loadEditorOptions, loadNames } from "@/lib/automations/queries";
import { requireUser } from "@/lib/session";
import { saveRuleAction, testRuleOnMeAction } from "../../actions";

export const metadata: Metadata = { title: "Modifier la relance" };

/** Modification d'une relance dans l'éditeur à branches (une relance à liste s'ouvre en branche unique). */
export default async function EditAutomationPage({
  params,
  searchParams,
}: PageProps<"/members/automations/[id]/edit">) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const rule = await prisma.automationRule.findUnique({ where: { id } });
  if (!rule) notFound();
  const linear = rule.graph === null;
  const [options, names, pendingLinear] = await Promise.all([
    loadEditorOptions(),
    loadNames(),
    linear
      ? prisma.automationRun.count({ where: { ruleId: id, status: "PENDING" } })
      : Promise.resolve(0),
  ]);
  const { draft, readError } = ruleToDraft(rule);
  const conditions =
    rule.conditions && typeof rule.conditions === "object" && !Array.isArray(rule.conditions)
      ? (rule.conditions as Record<string, unknown>)
      : {};
  return (
    <>
      <PageHeader
        backHref={`/members/automations/${rule.id}`}
        backLabel="Retour à la relance"
        title={`Modifier : ${rule.name}`}
        description="Les membres déjà en route continuent au même bloc s'il existe encore."
        help={
          rule.isActive
            ? "Cette relance est activée : vos modifications s'appliquent dès l'enregistrement."
            : "Après modification, refaites « Tester sur moi »."
        }
      />
      <Flash ok={sp.ok} error={sp.error} />
      <RuleEditor
        ruleId={rule.id}
        initial={{
          name: rule.name,
          trigger: rule.trigger,
          conditions,
          oncePerMember: rule.oncePerMember,
          draft,
          templateKey: rule.templateKey,
        }}
        readError={readError}
        options={options}
        names={names}
        pendingLinear={pendingLinear}
        saveAction={saveRuleAction}
        testAction={testRuleOnMeAction}
      />
    </>
  );
}
