// Shared defaults and helpers. Loaded as a classic script by the service worker
// (importScripts), the popup (<script>) and the isolated content script.
/* exported VoiceNoteDuckerShared */
var VoiceNoteDuckerShared = (() => {
  const MAX_DUCK_LEVEL = 0.5;

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    duckLevel: 0.1, // 0..MAX_DUCK_LEVEL, applied as an absolute volume cap
    voiceSites: Object.freeze(['web.whatsapp.com', 'web.telegram.org', 'app.slack.com', 'discord.com']),
  });

  // "https://Web.WhatsApp.com/foo" -> "web.whatsapp.com". Returns "" if invalid.
  function normalizeSite(input) {
    let site = String(input || '').trim().toLowerCase();
    if (!site) return '';
    if (site.includes('://')) {
      try {
        site = new URL(site).hostname;
      } catch {
        return '';
      }
    }
    site = site.replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/^\*\./, '').replace(/\.$/, '');
    return /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(site) ? site : '';
  }

  // A site matches itself and any of its subdomains.
  function isVoiceHost(hostname, sites) {
    const host = String(hostname || '').toLowerCase();
    if (!host) return false;
    return sites.some((site) => host === site || host.endsWith('.' + site));
  }

  // Never trust stored values blindly: clamp the level and clean the site list.
  function sanitizeSettings(raw = {}) {
    const level = Number(raw.duckLevel);
    const sites = Array.isArray(raw.voiceSites) ? raw.voiceSites : DEFAULT_SETTINGS.voiceSites;
    return {
      enabled: raw.enabled !== false,
      duckLevel: Number.isFinite(level)
        ? Math.min(MAX_DUCK_LEVEL, Math.max(0, level))
        : DEFAULT_SETTINGS.duckLevel,
      voiceSites: [...new Set(sites.map(normalizeSite).filter(Boolean))],
    };
  }

  return { DEFAULT_SETTINGS, MAX_DUCK_LEVEL, normalizeSite, isVoiceHost, sanitizeSettings };
})();
