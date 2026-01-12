export const LEGAL_ENTITY_NAME = "GEO-MAX";
export const SUPPORT_EMAIL = "support@geo-max.tech";
export const SITE_URL =
  (import.meta.env.SITE_URL && String(import.meta.env.SITE_URL).trim().length > 0)
    ? String(import.meta.env.SITE_URL).trim()
    : "https://geo-max.tech";
