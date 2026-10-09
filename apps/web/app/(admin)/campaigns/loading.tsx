import { PageSkeleton } from "@/components/admin/page-skeleton";

/** Squelette affiché pendant le chargement de la section Pubs. */
export default function Loading() {
  return <PageSkeleton rows={6} />;
}
