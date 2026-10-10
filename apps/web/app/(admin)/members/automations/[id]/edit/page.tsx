import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { parseActions, parseConditions } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/session";
import { updateRuleAction } from "../../actions";
import { RuleForm } from "../../rule-form";

export const metadata: Metadata = { title: "Modifier l'automatisation" };

export default async function EditAutomationPage({
  params,
  searchParams,
}: PageProps<"/members/automations/[id]/edit">) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const rule = await prisma.automationRule.findUnique({ where: { id } });
  if (!rule) notFound();
  let conditions = {};
  let actions: ReturnType<typeof parseActions> = [];
  try {
    conditions = parseConditions(rule.conditions);
    actions = parseActions(rule.actions);
  } catch {
    /* formulaire vide si JSON invalide */
  }
  return (
    <>
      <PageHeader
        title={`Modifier : ${rule.name}`}
        description="Les modifications s'appliquent aux prochaines exécutions ; celles déjà en cours continuent avec l'ancienne version."
        help="Après modification, refaites un « Tester sur moi » depuis la page de la règle."
      >
        <Button
          variant="outline"
          className="max-md:h-10"
          render={<Link href={`/members/automations/${rule.id}`} />}
        >
          ← Retour à la règle
        </Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      <RuleForm
        values={{
          ruleId: rule.id,
          name: rule.name,
          trigger: rule.trigger,
          conditions,
          actions,
          oncePerMember: rule.oncePerMember,
        }}
        action={updateRuleAction}
        submitLabel="Enregistrer"
      />
    </>
  );
}
