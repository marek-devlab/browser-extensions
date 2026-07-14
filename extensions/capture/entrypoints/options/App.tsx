import { Settings } from '../editor/Settings';

// Options page (options.html). WXT wires the browser's "Extension options" menu
// item to this entrypoint. It renders the SHARED <Settings/> component — the same
// one the Studio "Настройки" tab uses — so persistence is real and there is one
// source of truth (design capture.md §2.12).
//
// DESIGN NOTE (IMPLEMENTATION.md): the design's preferred shape is a SINGLE
// surface — options → editor.html#/settings — to avoid a second entry point
// (design §1.1, §2). This scaffold keeps a thin options entrypoint (the house
// convention, cf. extensions/blur) that mounts the same component; consolidating
// to the deep-link is a one-line manifest change (options_ui.page).
export function App() {
  return (
    <div className="studio">
      <header className="studio-head">
        <h1>
          <span className="rec-dot" aria-hidden="true" /> Capture Studio — настройки
        </h1>
      </header>
      <main className="studio-body">
        <Settings />
      </main>
    </div>
  );
}
