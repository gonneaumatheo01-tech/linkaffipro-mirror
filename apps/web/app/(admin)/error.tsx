"use client";

import { ErrorPage } from "@/components/admin/error-page";

export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorPage {...props} title="Le tableau de bord n'a pas pu s'afficher." />;
}
