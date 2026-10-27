/**
 * Phase 31 — dépendances des fonctions de l'équipe Prospection appelées par le site (changement de statut, note,
 * ajout d'un canal à la main). Construites à la demande, jamais au chargement : une page qui lit n'ouvre aucune
 * connexion Redis. Aucun messager : le site n'envoie rien à personne (et l'équipe ne contacte jamais un canal).
 */
import type { AgentsEnqueue, ProspectionDeps, ProspectionEnqueue } from "@linkaffipro/agents";
import { prisma, type PrismaClient } from "@linkaffipro/db";
import { createAgentsEnqueue, createProspectionEnqueue } from "@linkaffipro/queue";

export function buildProspectionDeps(): ProspectionDeps {
  return {
    prisma: prisma as unknown as PrismaClient,
    now: () => new Date(),
    enqueue: createAgentsEnqueue() as unknown as AgentsEnqueue,
    prospection: { enqueue: createProspectionEnqueue() as unknown as ProspectionEnqueue },
  };
}
