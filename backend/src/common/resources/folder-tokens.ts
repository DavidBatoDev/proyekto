/**
 * Icon and accent tokens a resource folder may carry, shared by project
 * resources and team resources.
 *
 * Short tokens rather than hex or component names: the web maps them onto
 * lucide icons and the Tailwind palette, so the database only guards shape and
 * length (`^[a-z0-9-]{1,32}$`). Adding an icon is a deploy, not a migration.
 *
 * These lists were duplicated between the project DTO and the web resources
 * page before team resources existed. This module is the backend's single
 * source; `project.dto.ts` re-exports it under its original names so no
 * existing consumer had to change.
 */
export const RESOURCE_FOLDER_ICONS = [
  'folder',
  'code',
  'terminal',
  'bot',
  'package',
  'database',
  'globe',
  'server',
  'cpu',
  'layers',
  'braces',
  'rocket',
  'wrench',
  'briefcase',
  'building',
  'palette',
  'gauge',
  'sparkles',
  'file-text',
  'box',
] as const;

export const RESOURCE_FOLDER_COLORS = [
  'white',
  'slate',
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'blue',
  'violet',
  'pink',
] as const;

export type ResourceFolderIcon = (typeof RESOURCE_FOLDER_ICONS)[number];
export type ResourceFolderColor = (typeof RESOURCE_FOLDER_COLORS)[number];
