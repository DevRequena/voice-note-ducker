# Store listing texts

Copy each block into the matching field of the Chrome Web Store and Edge Add-ons dashboards.

## Name

Voice Note Ducker

## Short description (max 132 characters, taken from the manifest)

- EN: Lowers the music in your other tabs while a voice note plays, then brings it back. 100% local, no data collected.
- ES: Baja la música de tus otras pestañas mientras suena una nota de voz y la recupera al terminar. 100 % local, sin recoger datos.

## Detailed description: English

Listening to voice notes with music playing in another tab? Voice Note Ducker lowers the music
automatically while the voice note plays, and brings it back to the exact same volume when it ends.

HOW IT WORKS
• Play a voice note on WhatsApp Web, Telegram, Slack or Discord.
• The music and videos in your other tabs fade down (YouTube, Spotify Web, any audio or video).
• When the voice note ends or you pause it, everything fades back to the exact volume it had.

DETAILS THAT MATTER
• Several voice notes in a row: the music stays low the whole time, with no jumps in between.
• Notification sounds are ignored, so only real voice notes lower the music.
• If you change a player's volume by hand while it's lowered, your choice is respected.
• Choose how low the music goes (0–50%) and which sites count as voice note sites.
• Closing the voice note tab brings your music back.

PRIVATE BY DESIGN
• 100% local: no account, no analytics, no network requests.
• Your settings stay in your browser.

Limitations: desktop apps (WhatsApp Desktop, Spotify app) are outside the browser and can't be
controlled. Some protected players may not allow volume changes.

## Descripción detallada: español

¿Escuchas notas de voz con música sonando en otra pestaña? Voice Note Ducker baja la música
automáticamente mientras suena la nota de voz y la devuelve exactamente al mismo volumen al terminar.

CÓMO FUNCIONA
• Reproduce una nota de voz en WhatsApp Web, Telegram, Slack o Discord.
• La música y los vídeos de tus otras pestañas bajan suavemente (YouTube, Spotify Web, cualquier audio o vídeo).
• Cuando la nota termina o la pausas, todo vuelve suavemente a su volumen exacto.

DETALLES QUE IMPORTAN
• Varias notas seguidas: la música se queda baja todo el rato, sin subidas entre una y otra.
• Ignora los sonidos de aviso: solo las notas de voz de verdad bajan la música.
• Si cambias a mano el volumen de un reproductor mientras está bajado, se respeta tu cambio.
• Elige cuánto baja la música (0–50 %) y qué webs cuentan como webs de notas de voz.
• Si cierras la pestaña de la nota de voz, tu música vuelve.

PRIVADA DE VERDAD
• 100 % local: sin cuentas, sin estadísticas y sin conexiones a internet.
• Tus ajustes se quedan en tu navegador.

Limitaciones: las aplicaciones de escritorio (WhatsApp Desktop, la app de Spotify) quedan fuera del
navegador y no se pueden controlar. Algunos reproductores protegidos pueden no permitir cambiar el
volumen.

## Developer

- **Developer / publisher name:** DevCesar
- **Website:** https://devrequena.github.io/voice-note-ducker/
- **Support URL:** https://github.com/DevRequena/voice-note-ducker/issues
- **Developer profile:** https://www.linkedin.com/in/devrequena-developer/

## Category

Productivity / Productividad

## Privacy tab (Chrome Web Store)

- **Single purpose:** Lowers the volume of media in other tabs while a voice note plays, and restores it when the voice note ends.
- **`storage` justification:** Saves the user's settings (on/off, music level, voice note sites) and which voice notes are currently playing.
- **Host permission / content scripts on all sites:** Music and voice notes can play on any website and in any frame. The content script must detect audio/video elements on every page to lower and restore their volume. No page content is read or sent anywhere.
- **Remote code:** No, I am not using remote code.
- **Data usage:** collects none of the listed data types. Check all three certifications.
- **Privacy policy URL:** https://devrequena.github.io/voice-note-ducker/privacy-policy

## Images (store/images/)

| File | Use |
| --- | --- |
| `en-1-how-1280x800.png`, `en-2-settings-1280x800.png` | Screenshots, English listing |
| `es-1-how-1280x800.png`, `es-2-settings-1280x800.png` | Screenshots, Spanish listing |
| `en-promo-440x280.png` / `es-promo-440x280.png` | Small promo tile |
| `logo-300x300.png` | Edge store logo |
| `../../icons/icon128.png` | Chrome store icon |

To regenerate the screenshots, serve the project root (`python3 -m http.server 8765`) and open
`http://127.0.0.1:8765/store/mockups/shot.html?scene=how|settings|tile&lang=en|es` at 1280×800
(440×280 for `tile`).
