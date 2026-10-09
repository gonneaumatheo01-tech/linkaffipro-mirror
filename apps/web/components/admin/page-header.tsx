/**
 * En-tête de page : le seul `<h1>` de l'écran, une description (à quoi sert la page),
 * une ligne d'aide facultative (`help` : la première chose à faire) et les actions à droite.
 */
export function PageHeader({
  title,
  description,
  help,
  children,
}: {
  title: string;
  description?: string;
  help?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        {help ? <p className="mt-1 text-xs text-muted-foreground/90">{help}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}
