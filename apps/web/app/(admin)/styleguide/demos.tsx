"use client";

import { useState } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { SidePanel, SidePanelClose } from "@/components/admin/side-panel";
import { Stepper } from "@/components/admin/stepper";
import { StatusPill } from "@/components/admin/status-pill";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Démonstrations interactives de la page /styleguide (aucune donnée, aucune action serveur). */

const WIZARD = [
  {
    key: "general",
    title: "Nom et univers",
    help: "Donnez un nom clair à la campagne et choisissez l'univers.",
  },
  { key: "offers", title: "Offres", help: "Choisissez la ou les offres Link Affi à promouvoir." },
  {
    key: "channels",
    title: "Canaux",
    help: "Cochez les canaux Telegram alimentés par cette campagne.",
  },
  { key: "ads", title: "Pubs", help: "Une pub = un lien d'entrée ; vérifiez le récapitulatif." },
];

export function StepperDemo() {
  const [step, setStep] = useState(1);
  return (
    <div className="space-y-4">
      <Stepper steps={WIZARD} current={step} onStepClick={setStep} />
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
        >
          Précédent
        </Button>
        <Button
          disabled={step === WIZARD.length - 1}
          onClick={() => setStep((s) => Math.min(WIZARD.length - 1, s + 1))}
        >
          Suivant
        </Button>
      </div>
    </div>
  );
}

export function ConfirmDemos() {
  const [result, setResult] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ConfirmDialog
          title="Supprimer ce message ?"
          description="Le message sera retiré du canal Telegram. Les membres ne le verront plus ; les chiffres déjà collectés restent."
          confirmLabel="Supprimer"
          destructive
          onConfirm={() => setResult("Message supprimé (démonstration).")}
          trigger={
            <Button variant="destructive">
              <Trash2 aria-hidden />
              Supprimer
            </Button>
          }
        />
        <ConfirmDialog
          title="Relancer la synchronisation ?"
          description="Les données Link Affi seront relues ; cela prend quelques minutes."
          confirmLabel="Relancer"
          onConfirm={async () => {
            await new Promise((r) => setTimeout(r, 600));
            setResult("Synchronisation relancée (démonstration).");
          }}
          trigger={<Button variant="outline">Relancer la synchronisation</Button>}
        />
      </div>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
          setResult(`Formulaire envoyé avec intent=${submitter?.value ?? "?"} (démonstration).`);
        }}
      >
        <Button type="submit" name="intent" value="draft" variant="outline">
          Enregistrer en brouillon
        </Button>
        <ConfirmSubmit
          name="intent"
          value="now"
          message="Le message va partir maintenant à 1 240 membres, sans possibilité de le rappeler."
        >
          Envoyer maintenant
        </ConfirmSubmit>
      </form>
      <p role="status" className="min-h-5 text-note text-muted-foreground">
        {result}
      </p>
    </div>
  );
}

export function SidePanelDemo() {
  return (
    <SidePanel
      title="Léa M."
      description="Membre depuis le 3 octobre · venue de la pub « Casino octobre #2 »"
      trigger={<Button variant="outline">Ouvrir un volet de détail</Button>}
      footer={
        <>
          <SidePanelClose />
          <Button>Écrire à ce membre</Button>
        </>
      }
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3">
        <dt className="text-muted-foreground">Statut</dt>
        <dd>
          <StatusPill tone="success">Accepté</StatusPill>
        </dd>
        <dt className="text-muted-foreground">Premier dépôt</dt>
        <dd className="tabular-nums">50,00 €</dd>
        <dt className="text-muted-foreground">Revenu net</dt>
        <dd className="tabular-nums">132,40 €</dd>
        <dt className="text-muted-foreground">Identifiant de suivi</dt>
        <dd className="font-mono text-note">tg-8f2k-91</dd>
      </dl>
    </SidePanel>
  );
}

export function DialogDemo() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline">Ouvrir une boîte de dialogue</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvelle catégorie</DialogTitle>
          <DialogDescription>
            Une catégorie regroupe des messages pour comparer leurs résultats.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="sg-dialog-name">Nom</Label>
          <Input id="sg-dialog-name" placeholder="Ex. Bonus du week-end" />
        </div>
        <DialogFooter showCloseButton>
          <Button>Créer la catégorie</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MenuDemo() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="icon" aria-label="Plus d'actions">
            <MoreHorizontal aria-hidden />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Message</DropdownMenuLabel>
          <DropdownMenuItem>
            <Pencil aria-hidden />
            Modifier
          </DropdownMenuItem>
          <DropdownMenuItem>Dupliquer</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <Trash2 aria-hidden />
          Supprimer
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const UNIVERSE_ITEMS = [
  { value: "CASINO", label: "Casino" },
  { value: "SPORTS", label: "Paris sportifs" },
  { value: "DATING", label: "Rencontres" },
];

export function SelectDemo() {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="sg-select">Univers</Label>
      <Select items={UNIVERSE_ITEMS} defaultValue="CASINO">
        <SelectTrigger id="sg-select" className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {UNIVERSE_ITEMS.map((it) => (
            <SelectItem key={it.value} value={it.value}>
              {it.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function CheckboxDemo() {
  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-body">
        <Checkbox defaultChecked />
        Épingler le message dans le canal
      </label>
      <label className="flex items-center gap-2 text-body">
        <Checkbox />
        Envoyer sans notification
      </label>
    </div>
  );
}

/** Texte d'un message : toujours `RichTextEditor` (jamais une simple zone de texte), libellé relié. */
export function RichTextDemo() {
  const [text, setText] = useState("Bonjour ! Ce <b>week-end</b>…");
  return (
    <div className="space-y-1.5">
      <Label htmlFor="sg-text">Texte</Label>
      <RichTextEditor
        id="sg-text"
        label="Texte"
        name="text"
        value={text}
        onChange={setText}
        rows={4}
        warnUnresolved={false}
      />
    </div>
  );
}
