import { PageSkeleton } from "@/components/admin/page-skeleton";

/** Squelette affiché pendant le chargement d'une conversation. */
export default function Loading() {
  return <PageSkeleton rows={6} />;
}
