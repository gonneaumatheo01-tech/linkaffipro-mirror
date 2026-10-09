import type { Metadata } from "next";
import { SoonPage } from "@/components/admin/soon";
export const metadata: Metadata = { title: "Envois" };
export default function Page() {
  return <SoonPage title="Envois" description="Envois groupés ciblés." items={["En cours de construction (phase 2)."]} />;
}
