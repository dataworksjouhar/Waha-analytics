/* Stands in for a section whose charts are not built yet.
 *
 * It names the runbook session that will build it, the metrics it will
 * answer and the exported views it will read, so the shell is honest about
 * what is finished rather than showing an empty panel that could be read as
 * "no data". Sessions 4 to 8 replace these one at a time. */

import type { Section } from "../sections";

export function SectionPlaceholder({ section }: { section: Section }) {
  return (
    <div className="card">
      <h2 className="card__title">{section.label}</h2>
      <p className="card__note">
        {section.metrics.length > 0
          ? `Architecture doc metrics ${section.metrics.join(", ")}.`
          : "Pipeline data quality results."}{" "}
        Built in Phase 2 session {section.session}.
      </p>
      <div className="placeholder">
        Reads{" "}
        {section.views.map((view, i) => (
          <span key={view}>
            {i > 0 ? ", " : ""}
            <code>{view}.json</code>
          </span>
        ))}
      </div>
    </div>
  );
}
