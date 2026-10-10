"use client";

import { ErrorPage } from "@/components/admin/error-page";

export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorPage {...props} title="La page des liens n'a pas pu s'afficher." />;
}
