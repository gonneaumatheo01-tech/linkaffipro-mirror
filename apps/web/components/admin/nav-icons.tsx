import {
  BarChart3,
  BookOpen,
  House,
  Megaphone,
  MessageSquare,
  PanelTop,
  Radio,
  Settings,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { NavIcon } from "./nav-logic";

/**
 * Icônes lucide du menu, par nom (voir `NavIcon` dans nav-logic.ts) : partagées par la barre de menu
 * (`Sidebar`) et la barre du bas du téléphone (`BottomNav`).
 */
export const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  BarChart3,
  BookOpen,
  House,
  Megaphone,
  MessageSquare,
  PanelTop,
  Radio,
  Settings,
  UserRound,
  Users,
};
