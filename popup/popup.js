// Popup: edits chrome.storage.sync; the service worker and content scripts
// pick changes up live through storage.onChanged.
const { DEFAULT_SETTINGS, normalizeSite, sanitizeSettings } = VoiceNoteDuckerShared;
const $ = (id) => document.getElementById(id);
const t = (key, ...subs) => chrome.i18n.getMessage(key, subs) || key;

const AUTHOR_NAME = 'DevCesar';
const AUTHOR_URL = 'https://www.linkedin.com/in/devrequena-developer/';
// Fill in your donation page (Ko-fi, Buy Me a Coffee, PayPal.me...). Empty hides the link.
const DONATION_URL = '';

let settings = sanitizeSettings(DEFAULT_SETTINGS);

function save(patch) {
  settings = sanitizeSettings({ ...settings, ...patch });
  render();
  return chrome.storage.sync.set(settings);
}

function showError(text) {
  $('error').textContent = text;
  $('error').hidden = !text;
}

function renderSites() {
  const list = $('sites');
  list.replaceChildren();
  for (const site of settings.voiceSites) {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = site;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = t('removeSite', site);
    remove.addEventListener('click', () =>
      save({ voiceSites: settings.voiceSites.filter((s) => s !== site) }),
    );
    item.append(name, remove);
    list.append(item);
  }
}

function render() {
  $('enabled').checked = settings.enabled;
  $('level').value = String(Math.round(settings.duckLevel * 100));
  $('levelValue').textContent = `${Math.round(settings.duckLevel * 100)}%`;
  renderSites();
}

function renderStatus(duckState) {
  const active = Boolean(duckState && duckState.applied);
  $('status').textContent = t(active ? 'statusActive' : 'statusIdle');
  $('status').classList.toggle('active', active);
}

$('enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }));

// Update the label while dragging, but only write on release (sync storage has write quotas).
$('level').addEventListener('input', (e) => {
  $('levelValue').textContent = `${e.target.value}%`;
});
$('level').addEventListener('change', (e) => save({ duckLevel: Number(e.target.value) / 100 }));

$('addForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const site = normalizeSite($('newSite').value);
  if (!site) {
    showError(t('siteError'));
    return;
  }
  showError('');
  $('newSite').value = '';
  if (!settings.voiceSites.includes(site)) save({ voiceSites: [...settings.voiceSites, site] });
});

$('reset').addEventListener('click', () => save({ voiceSites: [...DEFAULT_SETTINGS.voiceSites] }));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.duckState) renderStatus(changes.duckState.newValue);
});

function translate() {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  $('credit').textContent = t('madeBy', AUTHOR_NAME);
  $('credit').href = AUTHOR_URL;
  if (DONATION_URL) {
    $('donate').href = DONATION_URL;
    $('donate').hidden = false;
  }
}

(async () => {
  translate();
  settings = sanitizeSettings(await chrome.storage.sync.get(DEFAULT_SETTINGS));
  render();
  const { duckState } = await chrome.storage.session.get('duckState');
  renderStatus(duckState);
})();
