# Repository Guidelines

## Project Structure

Oh3 is a static, single-player browser game built with HTML, CSS, and JavaScript. The root `index.html` is the entry page and contains game selection. Shared landing-page assets live in `assets/`. The level editor is under `editor/` (`index.html`, `js/`, and `styles/`). The Classic mode and its game modules, styles, and sound effects are under `game/classic/`. Keep new assets near the page or feature that uses them.

## Build, Run, and Develop

There is no build step or package manager configuration. From the repository root, run:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000/`. Use a local web server rather than opening HTML files directly, since the game uses JavaScript modules and root-relative asset paths. Edit the source files directly; no generated output is checked in.

## Coding Style

Match the existing style: use tabs for indentation, semicolons in JavaScript, and descriptive camelCase names for JavaScript functions and variables. Keep HTML IDs and CSS classes lowercase and hyphenated (for example, `level-number`). The game code uses ES modules; preserve its module imports and keep feature logic in the relevant directory. Avoid adding dependencies or introducing a build system for changes that fit the current static setup.

## Testing

No automated test framework, lint command, or coverage target is configured. For changes, serve the site locally and manually check the affected flow. At minimum, verify the landing page and navigation; for editor changes, try painting, saving, and playing a level; for game changes, play Classic and check relevant movement, collisions, and interactions. Check the browser console for errors.

## Commits and Pull Requests

Recent commits use short area prefixes such as `game:`, `editor:`, and `design:`, followed by an imperative summary (for example, `game: Add levels`). Follow that pattern and keep each commit focused. A pull request should describe the user-visible change and how it was checked; include screenshots for visual changes and link a related issue when available.
