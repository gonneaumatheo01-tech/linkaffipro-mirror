import type { Metadata } from "next";
import { SoonPage } from "@/components/admin/soon";
export const metadata: Metadata = { title: "Pubs" };
export default function Page() {
  return <SoonPage title="Pubs" description="Coûts et rentabilité par pub." items={["En cours de construction (phase 2)."]} />;
}
