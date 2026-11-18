# Diagram tools

The `.drawio` files in `../source` are the editable diagrams; open them in [diagrams.net](https://app.diagrams.net) to change them by hand.

The PNGs next to this folder are exported **offline** with a small renderer for the shapes these diagrams use (boxes, tables, ellipses, actors, diamonds, crow's-foot and UML arrowheads), drawn by headless Chrome:

```
npm install --no-save puppeteer-core@23.11.1   # uses your installed Chrome, downloads no browser
node diagrams.mjs ../source ..
```

`diagrams.mjs` expects Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe`; change `executablePath` on another machine.

`generate_flow.py` and `generate_er_usecase_class.py` produced the current flow chart, ER and use-case sources (the class diagram was patched in place). Re-running them overwrites hand edits to those files, so after editing in diagrams.net just re-export instead.
