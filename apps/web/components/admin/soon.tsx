import { PageHeader } from "./page-header";
import { Card, CardContent } from "@/components/ui/card";

export function SoonPage({ title, description, items }: { title: string; description: string; items: string[] }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card>
        <CardContent className="pt-6">
          <p className="mb-3 text-sm font-medium">Prévu pour la phase 1 :</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
