import { PageSkeleton } from "@/components/admin/page-skeleton";

/** Squelette affiché pendant le calcul des chiffres des conversations. */
export default function Loading() {
  return <PageSkeleton rows={6} />;
}
