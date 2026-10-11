import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@/components/ui/cn"

const INPUT_CLASS =
  "h-9 w-full min-w-0 rounded-lg border border-muted-foreground/75 bg-surface px-3 py-1 text-base text-foreground transition-colors outline-none file:mr-3 file:inline-flex file:h-7 file:cursor-pointer file:items-center file:rounded-md file:border file:border-input file:bg-secondary file:px-3 file:text-body file:font-medium file:text-secondary-foreground file:transition-colors hover:file:bg-[color-mix(in_oklab,var(--secondary),var(--foreground)_6%)] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-brand/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-danger aria-invalid:ring-3 aria-invalid:ring-danger/15 max-md:h-10 max-md:file:h-8 md:text-body"

/** Champ de fichier : tout le champ ouvre le sélecteur, le bouton du navigateur est collé au bord gauche. */
const FILE_INPUT_CLASS = "cursor-pointer py-0.5 pl-1 max-md:pl-1.5"

/**
 * Classes d'un champ selon son type (fonction pure, testée) : le bouton « Choisir un fichier » du navigateur
 * (`file:`) prend l'allure d'un bouton secondaire (fond gris clair, bordure fine, 28 px, 32 px sur téléphone) au
 * lieu d'un simple texte gras ; aucun écran n'a à le restyler.
 */
function inputClassName(type?: string, className?: string): string {
  return cn(INPUT_CLASS, type === "file" && FILE_INPUT_CLASS, className)
}

/**
 * Champ de saisie : 36 px (40 px sur téléphone), fond blanc, bordure gris moyen (contraste 3:1 sur blanc et sur le
 * fond des pages, WCAG 1.4.11), anneau orange foncé au focus.
 * Texte 16 px sur téléphone (évite le zoom automatique d'iOS), 14 px sur ordinateur.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={inputClassName(type, className)}
      {...props}
    />
  )
}

export { Input, inputClassName }
