// The app registry: everything that differs between the apps sold from this site. The licensing core, handlers,
// emails and admin all take an app from here, so adding a third app is an entry in this file (plus pages), not new
// serverless functions (Vercel Hobby allows 12; api/[app]/*.js serves every app).
//
// Tessera's values are exactly what the code hard-coded before this registry existed (env names, the Redis
// namespace, URLs, the email look), so Tessera's behaviour and output did not change.
//
// Shared by every app, read straight from the environment: STRIPE_SECRET_KEY, STRIPE_API_VERSION, RESEND_API_KEY,
// SUPPORT_EMAIL, KV_REST_API_URL, KV_REST_API_TOKEN, CRON_SECRET, and the admin sign-in identity
// (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TESSERA_ADMIN_SESSION_SECRET, TESSERA_ADMIN_BASE_URL).

/**
 * @typedef {object} AppConfig
 * @property {string} slug URL segment: /api/<slug>/..., and the registry key
 * @property {string} name product name used in copy and emails
 * @property {string} productName what the buyer bought ("Tessera Pro", "Audio Switchboard")
 * @property {string} licensePrefix license string prefix, e.g. "TSR1-"
 * @property {string} product the `product` field inside a signed license
 * @property {string} urlScheme the app's activation URL scheme
 * @property {string} redisNamespace prepended to every Redis key of this app ("" would share keys with the others)
 * @property {{ productId: string, paymentLink: string, downloadUrl: string, webhookSecret: string, salesOpen: string,
 *   licenseKid: string, licensePrivateKey: string, revocationKid: string, revocationPrivateKey: string,
 *   resendFrom: string, adminSecret: string, adminEmails: string }} env names of the environment variables
 * @property {string} defaultFrom sender used when the `resendFrom` variable is unset ("" = the variable is required)
 * @property {{ home: string, buy: string, download: string, thanks: string, license: string, activate: string, support: string,
 *   terms: string, privacy: string, guide: string | null, admin: string }} pages site paths
 * @property {{ download: string, findLicense: string, guide: string | null, support: string, buy: string, activate: string, icon: string }} urls absolute URLs used in emails
 * @property {{ accent: string, linkDark: string, keyBg: string, keyBorder: string, keyBgDark: string, keyBorderDark: string, footerLinks: [string, "download" | "guide" | "support" | "findLicense"][] }} email email branding
 * @property {{ activateOpen: string, activateMenu: string, revokedKeepsWorking: string }} copy app-specific sentences used in emails
 */

/** @type {Record<string, AppConfig>} */
export const APPS = {
  tessera: {
    slug: "tessera",
    name: "Tessera",
    productName: "Tessera Pro",
    licensePrefix: "TSR1-",
    product: "tessera-pro",
    urlScheme: "tessera-direct",
    redisNamespace: "tessera:",
    env: {
      productId: "TESSERA_STRIPE_PRODUCT_ID",
      paymentLink: "TESSERA_PAYMENT_LINK_URL",
      downloadUrl: "TESSERA_DOWNLOAD_URL",
      webhookSecret: "STRIPE_WEBHOOK_SECRET",
      salesOpen: "VITE_TESSERA_SALES_OPEN",
      licenseKid: "TESSERA_LICENSE_KID",
      licensePrivateKey: "TESSERA_LICENSE_PRIVATE_KEY",
      revocationKid: "TESSERA_REVOCATION_KID",
      revocationPrivateKey: "TESSERA_REVOCATION_PRIVATE_KEY",
      resendFrom: "RESEND_FROM",
      adminSecret: "TESSERA_ADMIN_SECRET",
      adminEmails: "TESSERA_ADMIN_EMAILS",
    },
    defaultFrom: "",
    pages: {
      home: "/tessera", buy: "/tessera/buy", download: "/tessera/download", thanks: "/tessera/thanks", license: "/tessera/license",
      activate: "/tessera/activate", support: "/tessera/support", terms: "/tessera/terms", privacy: "/tessera/privacy",
      guide: "/tessera/guide", admin: "/tessera/admin",
    },
    urls: {
      download: "https://conorgriffin.com/tessera/download",
      findLicense: "https://conorgriffin.com/tessera/license",
      guide: "https://conorgriffin.com/tessera/guide",
      support: "https://conorgriffin.com/tessera/support",
      buy: "https://conorgriffin.com/tessera/buy",
      activate: "https://www.conorgriffin.com/tessera/activate",
      icon: "https://www.conorgriffin.com/tessera/email-icon.png",
    },
    email: {
      accent: "#5d52b4", linkDark: "#b3acf0", keyBg: "#f3f2fb", keyBorder: "#dcd8f3", keyBgDark: "#262842", keyBorderDark: "#3a3c5c",
      footerLinks: [["Download", "download"], ["Guide", "guide"], ["Support", "support"], ["Find my license", "findLicense"]],
    },
    copy: {
      activateOpen: "open Tessera, go to",
      activateMenu: "Settings › Purchases › Enter License…",
      revokedKeepsWorking: "Tessera keeps working as the free version, and everything you've saved stays where it is.",
    },
  },

  switchboard: {
    slug: "switchboard",
    name: "Audio Switchboard",
    productName: "Audio Switchboard",
    licensePrefix: "SWB1-",
    product: "switchboard-pro",
    urlScheme: "switchboard-direct",
    redisNamespace: "switchboard:",
    env: {
      productId: "SWITCHBOARD_STRIPE_PRODUCT_ID",
      paymentLink: "SWITCHBOARD_PAYMENT_LINK_URL",
      downloadUrl: "SWITCHBOARD_DOWNLOAD_URL",
      webhookSecret: "SWITCHBOARD_STRIPE_WEBHOOK_SECRET",
      salesOpen: "VITE_SWITCHBOARD_SALES_OPEN",
      licenseKid: "SWITCHBOARD_LICENSE_KID",
      licensePrivateKey: "SWITCHBOARD_LICENSE_PRIVATE_KEY",
      revocationKid: "SWITCHBOARD_REVOCATION_KID",
      revocationPrivateKey: "SWITCHBOARD_REVOCATION_PRIVATE_KEY",
      resendFrom: "SWITCHBOARD_RESEND_FROM",
      adminSecret: "SWITCHBOARD_ADMIN_SECRET",
      adminEmails: "SWITCHBOARD_ADMIN_EMAILS",
    },
    defaultFrom: "Audio Switchboard <switchboard@conorgriffin.com>",
    pages: {
      home: "/switchboard", buy: "/switchboard/buy", download: "/switchboard/download", thanks: "/switchboard/thanks",
      license: "/switchboard/license", activate: "/switchboard/activate", support: "/switchboard/support",
      terms: "/switchboard/terms", privacy: "/switchboard/privacy", guide: null,
      admin: "/tessera/admin", // one admin page for every app
    },
    urls: {
      download: "https://www.conorgriffin.com/switchboard/download",
      findLicense: "https://www.conorgriffin.com/switchboard/license",
      guide: null,
      support: "https://www.conorgriffin.com/switchboard/support",
      buy: "https://www.conorgriffin.com/switchboard/buy",
      activate: "https://www.conorgriffin.com/switchboard/activate",
      // TODO: public/switchboard/icon.png is the app icon from the landing page repo; replace it with a proper 256px email icon if wanted.
      icon: "https://www.conorgriffin.com/switchboard/icon.png",
    },
    email: {
      accent: "#5b45c9", linkDark: "#b4a3f5", keyBg: "#f3f1fc", keyBorder: "#dad5f4", keyBgDark: "#25243f", keyBorderDark: "#3b3a5e",
      footerLinks: [["Download", "download"], ["Support", "support"], ["Find my license", "findLicense"]],
    },
    copy: {
      activateOpen: "open Audio Switchboard, go to",
      activateMenu: "Settings › Purchase",
      revokedKeepsWorking: "Audio Switchboard keeps working, but Auto-Switch stays paused until it's unlocked again. Your rules and settings stay exactly as they are.",
    },
  },
};

export const DEFAULT_APP = APPS.tessera;

/** @returns {AppConfig[]} */
export const allApps = () => Object.values(APPS);

/** The registered app for a slug, or null. Own keys only, so "constructor" and friends are unknown. @param {unknown} slug */
export function getApp(slug) {
  return typeof slug === "string" && Object.hasOwn(APPS, slug) ? APPS[slug] : null;
}

/**
 * The app a request is for. The path decides: /api/<slug>/<route>. When the path is not an /api/ path (a rewrite such
 * as /switchboard/buy keeps its public URL), or Vercel hands over the dynamic segment unresolved, the `app` query
 * parameter is used (the rewrites in vercel.json set it, and Vercel adds dynamic segments as query parameters).
 * The path always wins over the query, so /api/tessera/x?app=switchboard is still Tessera.
 * Returns null for an unknown slug.
 * @param {Request} request
 * @returns {AppConfig | null}
 */
export function appFromRequest(request) {
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  const m = /^\/api\/([^/]+)\/[^/]+\/?$/.exec(url.pathname);
  if (m && m[1] !== "[app]") return getApp(m[1]); // a percent-encoded slug is simply unknown
  const q = url.searchParams.get("app");
  return q === null ? null : getApp(q);
}

/** True when the settings an app needs to issue licenses are present (used to skip apps that aren't launched yet). @param {AppConfig} app @param {Record<string, string | undefined>} env */
export function isConfigured(app, env) {
  return Boolean(env[app.env.productId] && env[app.env.licensePrivateKey]);
}
