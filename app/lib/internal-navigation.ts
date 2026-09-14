type RouterLike = {
  push: (href: string) => void;
  replace: (href: string) => void;
};

let router: RouterLike | null = null;

const FULL_NAV_PREFIXES = [
  "/parts-print",
  "/schedule/print",
  "/inspection/print",
];

function asString(value: string | URL) {
  return typeof value === "string" ? value : value.toString();
}

function internalHref(value: string | URL) {
  const raw = asString(value);
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//")) return null;
  if (FULL_NAV_PREFIXES.some((prefix) => raw === prefix || raw.startsWith(`${prefix}?`) || raw.startsWith(`${prefix}/`))) {
    return null;
  }
  return raw;
}

export function registerInternalNavigationRouter(nextRouter: RouterLike | null) {
  router = nextRouter;
}

export const appLocation = {
  assign(value: string | URL) {
    const href = internalHref(value);
    if (href && router) {
      router.push(href);
      return;
    }
    window.location.assign(asString(value));
  },
  replace(value: string | URL) {
    const href = internalHref(value);
    if (href && router) {
      router.replace(href);
      return;
    }
    window.location.replace(asString(value));
  },
  reload() {
    window.location.reload();
  },
  get pathname() {
    return window.location.pathname;
  },
  get search() {
    return window.location.search;
  },
  get href() {
    return window.location.href;
  },
  set href(value: string) {
    // tel:, blob:, external URLs and other intentional full navigations stay native.
    window.location.href = value;
  },
};
