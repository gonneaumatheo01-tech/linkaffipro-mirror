import { PageSkeleton } from "@/components/admin/page-skeleton";

/** Squelette affiché pendant le chargement de la section Mon compte. */
export default function Loading() {
  return <PageSkeleton rows={4} />;
}
