import { PageHeader } from "./page-header";
import { Card, CardContent } from "@/components/ui/card";

export function SoonPage({ title, description, items }: { title: string; description: string; items: string[] }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card>
        <CardContent>
          <p className="mb-3 text-body font-semibold">Bientôt disponible :</p>
          <ul className="list-disc space-y-1 pl-5 text-body text-muted-foreground">
            {items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
