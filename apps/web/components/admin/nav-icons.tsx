import {
  BarChart3,
  Bot,
  CircleHelp,
  House,
  Link2,
  Megaphone,
  MessageSquare,
  Radio,
  ScrollText,
  Send,
  Settings,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { NavIcon } from "./nav-logic";

/**
 * Icônes lucide du menu, par nom (voir `NavIcon` dans nav-logic.ts) : partagées par la barre de menu
 * (`Sidebar`) et la barre du bas du téléphone (`BottomNav`).
 */
export const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  BarChart3,
  Bot,
  CircleHelp,
  House,
  Link2,
  Megaphone,
  MessageSquare,
  Radio,
  ScrollText,
  Send,
  Settings,
  Users,
  Zap,
};
