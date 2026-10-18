import { PageSkeleton } from "@/components/admin/page-skeleton";

/** Squelette affiché pendant le chargement de la boîte de réception des conversations. */
export default function Loading() {
  return <PageSkeleton rows={8} />;
}
