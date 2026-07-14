import { useState } from 'react';
import { Callout, MockBadge, CopyButton } from '@blur/ui';
import { mockAllResources, type AllResourcesRow } from '../../utils/mock-data';

// "All resources" — v2 stub screen (design §2.7).
//
// 🔴 This is the single biggest trap in v2: a table of "all media URLs on the
// page" + a "copy all" button = a media-link HARVESTER, i.e. a downloader without a
// download button. So it is designed as a table of ORIGIN, not extraction:
//   - the headline column is "Where on the page" (resource → element, the reverse
//     lookup no DevTools has, our unique axis);
//   - copying is PER-ROW ONLY. 🔴 No "copy all", no select-all, no checkboxes, no
//     multi-select. Zero bulk operations — that is the category boundary, not
//     stinginess (design §2.7, §13 №3);
//   - no time column, no weight-sum column, no "sort by weight" (that is `perf`).

export function App() {
  const [rows] = useState<AllResourcesRow[]>(() => mockAllResources());
  const [filter, setFilter] = useState('');
  const visible = rows.filter((r) => r.resource.toLowerCase().includes(filter.toLowerCase()));

  return (
    <main className="resources">
      <header>
        <h1>Page resources</h1>
        <input
          type="search"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter resources"
        />
      </header>

      <MockBadge />

      <table>
        <caption className="sr">
          Page resources by origin. Copy is per-row only — there is no bulk copy.
        </caption>
        <thead>
          <tr>
            <th scope="col">Resource</th>
            <th scope="col">Kind</th>
            <th scope="col">Initiator</th>
            <th scope="col">Where on the page</th>
            <th scope="col"><span className="sr">Copy</span></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.resource}>
              <td className="mono">{r.resource}</td>
              <td>{r.kind}</td>
              <td>{r.initiator}</td>
              <td>
                {r.location === null ? (
                  <span className="dim">not found on the page</span>
                ) : (
                  <button type="button" className="linkish">
                    {r.location.label}{r.location.count > 1 ? ` ${r.location.count}` : ''} ▸
                  </button>
                )}
              </td>
              {/* Per-row copy of ONE URL only — never a bulk operation. */}
              <td><CopyButton value={`https://cdn.example.com/…/${r.resource}`} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <Callout tone="info">
        “not found on the page” = the resource loaded, but its element was removed, or
        lives in a closed shadow root or a cross-origin iframe.
      </Callout>
    </main>
  );
}
