import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { Flash } from "@/components/admin/flash";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
      <PageHeader
        title="Nouvelle automatisation"
        description={
          tpl
            ? `Modèle : ${tpl.name}. Adaptez les textes, puis créez la règle.`
            : "Partez d'un modèle prêt à l'emploi, ou remplissez la règle vide ci-dessous."
        }
        help="La règle est créée inactive : rien ne part vers les membres tant que vous ne l'activez pas."
      >
        <Button variant="outline" className="max-md:h-10" render={<Link href="/automations" />}>
          ← Automatisations
        </Button>
      </PageHeader>
      <Flash ok={sp.ok} error={sp.error} />
      {!tpl ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Modèles</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {AUTOMATION_TEMPLATES.map((t) => (
              <div
                key={t.key}
                className="flex items-start justify-between gap-3 rounded-md border p-3"
              >
                <div>
                  <div className="font-medium">{t.name}</div>
                  <div className="text-sm text-muted-foreground">{t.description}</div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="max-md:h-10"
                  render={<Link href={`/automations/new?template=${t.key}`} />}
                  aria-label={`Utiliser le modèle ${t.name}`}
                >
                  Utiliser
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
      <RuleForm
        values={{
          name: tpl?.name ?? "",
          trigger: tpl?.trigger ?? "JOINED",
          conditions: tpl?.conditions ?? {},
          actions: tpl?.actions ?? [],
          oncePerMember: true,
        }}
        action={createRuleAction}
        submitLabel="Créer la règle (inactive)"
      />
    </>
  );
}
