import { AdvancedSection } from "@/components/admin/form-section";

/**
 * Aperçu des consignes envoyées à l'IA (`previewSystemPrompt` de packages/chat), replié : le texte exact du premier
 * message, d'après la version enregistrée de la persona. Le texte contient des termes techniques destinés à l'IA :
 * il est montré tel quel dans un bloc `<pre>` (non lu par le contrôle du vocabulaire), jamais reformulé.
 */
export function PromptPreview({ prompt, role }: { prompt: string; role: string }) {
  return (
    <AdvancedSection
      title={`Ce que ${role} reçoit comme consignes`}
      description="Le texte exact envoyé à l'IA pour un premier message, d'après la version enregistrée. Les règles de sécurité (se présenter comme assistante ou assistant, adultes seulement, honnêteté sur l'offre, jamais d'insistance) y sont toujours."
    >
      <pre
        tabIndex={0}
        aria-label="Consignes envoyées à l'IA"
        className="max-h-[32rem] overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-note whitespace-pre-wrap break-words text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {prompt}
      </pre>
    </AdvancedSection>
  );
}
