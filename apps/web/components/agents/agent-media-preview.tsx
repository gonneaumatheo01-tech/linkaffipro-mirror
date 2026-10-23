import { cn } from "@/components/ui/cn";

/**
 * Aperçu d'un média des agents (image ou vidéo), servi par la route protégée `/api/agents/media/<id>` (session
 * requise, cache privé). Une vidéo ne se charge qu'au clic sur lecture (`preload="metadata"`), sans son au départ.
 */
export function AgentMediaPreview({
  id,
  mimeType,
  label,
  className,
}: {
  id: string;
  mimeType: string;
  /** Description lue par les lecteurs d'écran (« Vidéo produite le 23 oct. »). */
  label: string;
  className?: string;
}) {
  const src = `/api/agents/media/${id}`;
  const box = cn("aspect-[9/16] w-full rounded-lg border border-border bg-muted object-cover", className);
  if (mimeType.startsWith("video/"))
    return (
      <video src={src} controls muted playsInline preload="metadata" aria-label={label} className={box}>
        <track kind="captions" />
      </video>
    );
  // Notre propre route protégée : pas d'optimisation next/image nécessaire.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={label} loading="lazy" className={box} />;
}
