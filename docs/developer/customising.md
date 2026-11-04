# Customising Tolle

From the easiest change to the most involved. The first four need no programming.

| I want to… | Where | Code? |
|---|---|---|
| [Hide parts of the app](#switch-features-on-and-off) | Settings → Features | No |
| [Change how the AI writes](#change-the-ais-instructions) | Settings → AI instructions | No |
| [Add or fix a study site](#add-a-study-site) | Settings → Sources | No |
| [Change colours and fonts](#change-colours-and-fonts) | `tolle/app/web/css/theme.css` | Edit a text file |
| [Rename and rebrand it](#rename-and-rebrand) | `brand.js`, icons, a few names | Edit text files |
| [Add a new screen or feature](#add-a-feature) | copy `features/_template` | Python and JavaScript |
| [Add an AI provider](#add-an-ai-provider) | `core/ai/providers.py` | Python |

After changing files, restart Tolle. To ship your changes to other people, see [building and releasing](building.md).

## Switch features on and off

An administrator can hide any part of Tolle (Calling, the reading tracker, the study builder…) in **Settings → Features**. A hidden feature disappears from the menu and the home screen for everyone, and its part of the server stops answering. Nothing is deleted, so you can switch it back on later.

To remove a feature from your own build entirely, take its id out of `ENABLED` in `tolle/app/server/features/__init__.py`. Or, without editing code, start the server with a list of the features you want:

```bash
TOLLE_FEATURES=library,research,insights tolle-server serve
```

## Change the AI's instructions

Everything that shapes how the AI writes can be edited in **Settings → AI instructions** (administrators only): the ground rules, what each study depth means, each study type's sections, and how the calling guide behaves. Each text has a **Reset** button, and updates to Tolle never overwrite your wording.

Your changes are saved in `instructions.json` in the [data folder](README.md#where-data-lives), so you can also copy that file between installations.

For a feature's own instructions, see `prompts.py` in its folder: each one is registered with `instructions.register(key, label, default, help, group)` and read with `instructions.text(key)`.

## Add a study site

**Settings → Sources → Add source.** Give it a name and a web address pattern such as `https://example.com/commentary/{book_slug}/{chapter}.html`, then press **Test**. The placeholders are listed on that screen and in the [study sites manual](../manual/study-sites.md).

To change the sites everyone starts with, edit `DEFAULT_SOURCES` in `tolle/app/server/core/settings.py`.

## Change colours and fonts

All colours and fonts are in **`tolle/app/web/css/theme.css`**, as named colours at the top of the file:

```css
:root {
  --brand: #0f766e;      /* you and your actions: buttons, your notes, the selected menu item */
  --ai: #7c3aed;         /* anything the AI wrote – keep it clearly different from --brand */
  --bg: #f6f7f9;         /* page background */
  …
}
```

The dark-mode colours follow in the same file. Change a value, save and reload the page.

To use a different font, put the `.woff2` file in `tolle/app/web/fonts/` and change the `@font-face` rule and `--font` at the top of `theme.css`.

## Rename and rebrand

1. **Name and motto**: `tolle/app/web/core/brand.js`.
2. **Icons**: replace `tolle/app/web/icons/icon-192.png` and `icon-512.png` (web app), `packaging/desktop/build/icon.png` (desktop app, 1024×1024), and `mobile/assets/icon.png`, then run `npm run icons` in `mobile/`.
3. **Window and installer names**: `productName` in `packaging/desktop/package.json`, `appName` in `mobile/capacitor.config.json`, and `name` in `tolle/config.yaml` (Home Assistant).
4. **App ids** (only before you first publish – they can't change afterwards): `appId` in `packaging/desktop/package.json` and `mobile/capacitor.config.json`, `applicationId` in `mobile/android/app/build.gradle`, and the bundle id in Xcode.
5. **Where it downloads updates from**: the `shotgn16/Tolle` addresses in `packaging/desktop/src/main.js` and `packaging/desktop/package.json` (`publish`), `packaging/install/install.sh` and `install.ps1`, and `repository.yaml`.

## Add a feature

A feature is one folder on the server and one on the web side. The `_template` feature is a working example: a small prayer list with a database table, two routes, a setting and an AI job.

1. **Copy the folders:**
   ```bash
   cp -r tolle/app/server/features/_template tolle/app/server/features/prayer
   cp -r tolle/app/web/features/_template    tolle/app/web/features/prayer
   ```
2. **Give it an id.** In `server/features/prayer/__init__.py` set `FEATURE_ID = "prayer"`, and in `web/features/prayer/index.js` set `id: 'prayer'`.
3. **Switch it on.** Add `"prayer"` to `ENABLED` in `server/features/__init__.py`. Then in `web/features/index.js` add `import prayer from './prayer/index.js';` and add `prayer` to the list at the bottom.
4. **Restart Tolle.** "Prayer list" appears in the menu under *Reflect*, with its own screen, data and **Write a prayer** AI button.

Then make it your own.

**On the server** (`server/features/<id>/__init__.py`), a feature can bring:

| Part | What it is |
|---|---|
| `schema` | SQL for its tables, run at start-up. Put personal text in columns ending `_enc` and store it with `enc()` / read it with `dec()`, so it's encrypted. |
| `router` | its web routes (a FastAPI `APIRouter`). Add `Depends(current_user)` to every route that touches someone's data. |
| `jobs` | AI tasks: `{"kind": (prepare, finish)}`. `prepare` builds the messages for the AI and `finish` saves the answer. The job system handles waiting, progress, every AI provider and on-device AI. |
| `settings` | default values for its per-user settings |
| `ticks` | functions called once a minute (reminders, syncing) |
| `summary` | numbers for the home screen |
| `delete_user` | removes its data when an account is deleted |

**On the web side** (`web/features/<id>/index.js`), a feature can bring menu entries (`nav`), screens (`routes`), home-screen tiles (`tiles`), home-screen widgets (`dashboard`), settings tabs (`settingsTabs`) and background work (`onStart`).

Use the shared building blocks in `web/core/ui.js` (`h()` to build elements, `field()`, `noteCard()`, `aiControls()`, `runWithProgress()`…) and `web/core/api.js` (`get`, `post`, `runJob`). Copying a similar existing feature is often the quickest start. For example, `insights` is a simple "ask the AI, save the answer" feature.

Keep two rules so Tolle stays trustworthy:

- **Anything the AI wrote is shown in purple** (`note ai`, `ai-btn`, `chip ai`), and the person's own content never is.
- **Personal data is encrypted** (`_enc` columns, `enc()`/`dec()`).

Add a test for your feature in `tests/`. The existing tests show how to sign in and call routes.

## Add an AI provider

In `tolle/app/server/core/ai/providers.py`:

1. Write `myprovider_models(cfg)`, returning `[{"id", "thinking", "vision"}]`, and `myprovider_chat(cfg, model, messages, images, thinking, temperature)`, returning `{"text", "thinking"}`.
2. Add it to `PROVIDERS`, `list_models()` and `_chat_once()`.
3. Add its settings (API key, address) to `DEFAULTS` in `core/settings.py`. Add key names to `SECRET_KEYS` there, so they're never sent back to the browser.
4. Add its fields to `PFIELDS` in `web/core/views/settings.js`.

Repetition protection, retries and job progress work for the new provider automatically.
