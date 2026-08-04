/* Phase 2 session 9: the trust panel.
 *
 * The argument this whole project rests on is that the data quality
 * problems are the point, not an embarrassment to be tidied away before
 * the demo. That argument is only credible if the dashboard says so where
 * a reader can check it, so this page carries two things that most
 * dashboards carry neither of: the pipeline's own check results, and a
 * census of every deliberate imperfection in the source files with what
 * was done about each one.
 *
 * The ordering is deliberate. The census comes first and the green checks
 * come second, because a page that opens with a wall of passes invites
 * exactly the wrong conclusion: that the data arrived clean. It did not.
 * The checks pass because the mess was handled.
 */

import { useMemo } from "react";
import { formatNumber } from "../lib/format";
import {
  census,
  censusTotal,
  groupChecks,
  type CensusInput,
  type DqCheck,
} from "../lib/quality";
import type { Meta } from "../lib/data";

export function Quality({
  checks,
  data,
  meta,
}: {
  checks: DqCheck[];
  data: CensusInput;
  meta: Meta;
}) {
  const groups = useMemo(() => groupChecks(checks), [checks]);
  const items = useMemo(() => census(data), [data]);

  const passed = checks.filter((c) => c.status === "pass").length;
  const failed = checks.length - passed;
  const flaggedRows = censusTotal(items);
  const openQuestions = items.filter((i) => i.openQuestion);

  return (
    <>
      <section className="card">
        <h2 className="card__title">What is wrong with this data</h2>
        <p className="card__note">
          Every source feeding this warehouse is imperfect, in the specific ways real SME sources
          are imperfect. None of it was cleaned away before it reached the charts. Each row below
          is counted from the same exports the dashboard is drawn from, so if the pipeline ever
          started quietly dropping the difficult rows, these numbers would fall and the omission
          would show up here.
        </p>

        <div className="tiles">
          <div className="tile tile--hero">
            <span className="tile__label">Flagged records carried through</span>
            <span className="tile__value tile__value--hero">{formatNumber(flaggedRows)}</span>
            <span className="tile__meta">
              across {formatNumber(items.length)} distinct source problems, none dropped
            </span>
          </div>
          <div className="tile">
            <span className="tile__label">Quality checks</span>
            <span className="tile__value" data-direction={failed > 0 ? "down" : undefined}>
              {formatNumber(passed)} / {formatNumber(checks.length)}
            </span>
            <span className="tile__meta">
              {failed === 0 ? "all passing, which is not the same as clean" : `${failed} failing`}
            </span>
          </div>
          <div className="tile">
            <span className="tile__label">Open questions for the client</span>
            <span className="tile__value">{formatNumber(openQuestions.length)}</span>
            <span className="tile__meta">
              things the pipeline can detect but cannot decide on its own
            </span>
          </div>
        </div>

        <ol className="census">
          {items.map((item) => (
            <li className="census__item" key={item.id}>
              <div className="census__head">
                <span className="census__count">
                  {formatNumber(item.count)}
                  <span className="census__unit"> {item.unit}</span>
                </span>
                {item.openQuestion ? (
                  <span className="census__tag">Open question</span>
                ) : null}
              </div>
              <p className="census__problem">{item.problem}</p>
              <p className="census__handling">{item.handling}</p>
              <p className="census__where">Visible in: {item.visibleIn}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="card">
        <h2 className="card__title">Pipeline checks</h2>
        <p className="card__note">
          Written to <code>dq.check_results</code> on every run by a hand-built checks module, not
          a framework. These assert that the warehouse is internally consistent. They do not, and
          cannot, assert that the source data was correct: a tenant who under-reports sales every
          month passes every check on this page, which is why the leasing section goes looking for
          that separately.
        </p>

        {groups.map((group) => (
          <div className="checkgroup" key={group.check_type}>
            <div className="checkgroup__head">
              <h3 className="checkgroup__title">{group.label}</h3>
              <span
                className="checkgroup__score"
                data-status={group.failed > 0 ? "fail" : "pass"}
              >
                {formatNumber(group.passed)} of {formatNumber(group.checks.length)} passing
              </span>
            </div>
            <p className="checkgroup__note">{group.description}</p>
            <ul className="checklist">
              {group.checks.map((check) => (
                <li className="checklist__item" key={check.check_name}>
                  <span
                    className="checklist__dot"
                    data-status={check.status === "pass" ? "pass" : "fail"}
                    aria-hidden="true"
                  />
                  <span className="checklist__name">
                    {check.check_name.replace(/_/g, " ")}
                    <span className="checklist__table">
                      {check.schema_name}
                      {check.table_name ? `.${check.table_name}` : ""}
                    </span>
                  </span>
                  {/* Status is never colour alone: the word is present for
                      a screen reader and for anyone the dot fails. */}
                  <span className="checklist__status" data-status={check.status}>
                    {check.status === "pass" ? "pass" : check.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="card">
        <h2 className="card__title">What this dashboard cannot tell you</h2>
        <p className="card__note">
          The limits are stated next to the metrics they affect as well as here, because a
          caveat nobody reads is a caveat nobody honoured.
        </p>
        <ul className="limits">
          <li>
            <strong>Rent collected.</strong> There is no payments or receivables feed among the
            nine sources, so metric 3 reports what the leases contractually owe and stops there.
            No collection rate was invented to fill the other half. Closing this needs a source,
            not a chart.
          </li>
          <li>
            <strong>Who a walk-in visitor is.</strong> Only online customers exist in
            dim_customer. Somebody who pays cash at the gate is genuinely anonymous, so
            footfall-to-sales conversion divides by a count of entries and not by a count of
            people, and one visit can touch several venues.
          </li>
          <li>
            <strong>Instructor performance.</strong> Each level is taught by exactly one
            instructor, so the two are perfectly confounded and no chart here can separate a weak
            coach from a level with less demand.
          </li>
          <li>
            <strong>Media spend.</strong> The online section can show that a channel's conversion
            has collapsed. It cannot say what that channel costs, because no spend data enters
            this warehouse.
          </li>
          <li>
            <strong>Anything after {meta.date_range.end}.</strong> This is a fixed synthetic
            dataset exported to static JSON, not a live connection. The final month of the range
            is partial and is marked wherever that changes how a figure reads.
          </li>
        </ul>
      </section>
    </>
  );
}
