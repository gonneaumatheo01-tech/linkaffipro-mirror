import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AUTOMATION_TEMPLATES, findTemplate } from "@/lib/automations/templates";
import { requireUser } from "@/lib/session";
import { createRuleAction } from "../actions";
import { RuleForm } from "../rule-form";

export const metadata: Metadata = { title: "Nouvelle automatisation" };

export default async function NewAutomationPage({ searchParams }: PageProps<"/automations/new">) {
  await requireUser();
  const sp = await searchParams;
  const tpl = findTemplate(typeof sp.template === "string" ? sp.template : undefined);
  return (
    <>
      <PageHeader title="Nouvelle automatisation" description={tpl ? `Modèle : ${tpl.name}` : "Partez d'un modèle ou d'une règle vide."} />
      <Flash ok={sp.ok} error={sp.error} />
      {!tpl ? (
        <Card className="mb-6">
          <CardContent className="grid gap-3 pt-6 md:grid-cols-2">
            {AUTOMATION_TEMPLATES.map((t) => (
              <div key={t.key} className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div>
                  <div className="font-medium">{t.name}</div>
                  <div className="text-sm text-muted-foreground">{t.description}</div>
                </div>
                <Button size="sm" variant="outline" render={<Link href={`/automations/new?template=${t.key}`} />}>Utiliser</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
      <RuleForm values={{ name: tpl?.name ?? "", trigger: tpl?.trigger ?? "JOINED", conditions: tpl?.conditions ?? {}, actions: tpl?.actions ?? [], oncePerMember: true }} action={createRuleAction} submitLabel="Créer la règle (inactive)" />
    </>
  );
}
