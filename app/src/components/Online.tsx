/* Phase 2 session 7: the booking website.
 *
 * Metrics 5 and 6. Two questions a GM asks about the same website: how
 * much of the business it takes, and whether the money spent driving
 * traffic to it is working.
 *
 * The second one is the reason this section earns its place. The finding
 * underneath it is invisible on every volume report anyone runs: a
 * channel holding its session share while its conversion falls by two
 * thirds looks perfectly healthy right up until someone divides one
 * number by the other. That is not a hypothetical about paid media. It is
 * what the chart below shows.
 */

import { useMemo } from "react";
import { formatCurrency, formatNumber, formatPercent } from "../lib/format";
import type { DateRange } from "../lib/months";
import {
  attributionLoss,
  channelSeries,
  groupChannelMix,
  isDecaying,
  type ChannelConversion,
  type ChannelConversionMonth,
  type TicketChannelMix,
} from "../lib/online";
import { ChannelMixChart } from "./charts/ChannelMixChart";
import { ChannelTrendChart } from "./charts/ChannelTrendChart";

export function Online({
  mix,
  conversion,
  monthly,
  range,
  currency,
}: {
  mix: TicketChannelMix[];
  conversion: ChannelConversion[];
  monthly: ChannelConversionMonth[];
  range: DateRange | null;
  currency: string;
}) {
  const groups = useMemo(() => groupChannelMix(mix), [mix]);
  const series = useMemo(() => channelSeries(monthly, range), [monthly, range]);
  const loss = useMemo(() => attributionLoss(conversion), [conversion]);

  const decaying = series.filter(isDecaying);
  const onlineUnits = groups.reduce((total, g) => total + g.onlineQty, 0);
  const allUnits = groups.reduce((total, g) => total + g.totalQty, 0);
  const onlineValue = groups.reduce((total, g) => total + g.onlineAmount, 0);
  const bestChannel = [...series].sort((a, b) => (b.overallPct ?? 0) - (a.overallPct ?? 0))[0];

  return (
    <>
      <section className="card">
        <h2 className="card__title">Online versus walk-in</h2>
        <p className="card__note">
          Metric 5. Units sold through the booking website against units rung up at the till,
          grouped by venue and category. Whole history: this view has no date column, so the
          season filter above does not apply to it.
        </p>

        <div className="tiles">
          <div className="tile tile--hero">
            <span className="tile__label">Sold online</span>
            <span className="tile__value tile__value--hero">
              {formatPercent(allUnits > 0 ? (onlineUnits / allUnits) * 100 : null)}
            </span>
            <span className="tile__meta">
              {formatNumber(onlineUnits)} of {formatNumber(allUnits)} units
            </span>
          </div>
          <div className="tile">
            <span className="tile__label">Online booking value</span>
            <span className="tile__value">{formatCurrency(onlineValue, currency)}</span>
            <span className="tile__meta">cancellations excluded</span>
          </div>
          <div className="tile">
            <span className="tile__label">Product groups sold both ways</span>
            <span className="tile__value">
              {formatNumber(groups.filter((g) => g.onlineQty > 0 && g.walkInQty > 0).length)} of{" "}
              {formatNumber(groups.length)}
            </span>
            <span className="tile__meta">
              the rest are one channel only, like the Farm kiosk and gym memberships
            </span>
          </div>
        </div>

        <ChannelMixChart groups={groups} currency={currency} />
      </section>

      <section className="card">
        <h2 className="card__title">Conversion by channel</h2>
        <p className="card__note">
          Metric 6. Bookings per 100 sessions, by acquisition channel, month by month. The
          headline rate for each channel is the whole selected range; the chart is where the
          direction shows.
        </p>

        <div className="tiles">
          {series.map((s) => (
            <div className="tile" key={s.channel_name}>
              <span className="tile__label">{s.channel_name.replace(/_/g, " ")}</span>
              <span
                className="tile__value"
                data-direction={
                  s.changePct === null || Math.abs(s.changePct) < 5
                    ? undefined
                    : s.changePct > 0
                      ? "up"
                      : "down"
                }
              >
                {formatPercent(s.overallPct, 1)}
              </span>
              <span className="tile__meta">
                {s.changePct === null
                  ? `${formatNumber(s.totalSessions)} sessions`
                  : `${s.changePct > 0 ? "+" : ""}${formatPercent(s.changePct, 0)} first three months to last`}
              </span>
            </div>
          ))}
        </div>

        <ChannelTrendChart series={series} />

        {decaying.map((channel) => (
          <div className="finding" key={channel.channel_name}>
            <h3 className="finding__title">
              {channel.channel_name.replace(/_/g, " ")} is being paid for twice
            </h3>
            <p className="finding__body">
              Conversion has fallen from {formatPercent(channel.firstPct, 1)} to{" "}
              {formatPercent(channel.lastPct, 1)}, a drop of{" "}
              {formatPercent(Math.abs(channel.changePct as number), 0)}, while every other channel
              on this chart has gone the other way.{" "}
              {bestChannel && bestChannel.channel_name !== channel.channel_name ? (
                <>
                  Over the same range {bestChannel.channel_name.replace(/_/g, " ")} converts at{" "}
                  {formatPercent(bestChannel.overallPct, 1)} against this channel's{" "}
                  {formatPercent(channel.overallPct, 1)}.{" "}
                </>
              ) : null}
              Session volume has not fallen with it: this channel still delivers{" "}
              {formatNumber(channel.totalSessions)} sessions over the range, so it looks like it is
              working on any report that counts traffic. The spend is buying the same number of
              visits and steadily fewer bookings, which is the shape of an audience that has been
              over-targeted or creative that has gone stale. Nothing here says how much the media
              costs, because no spend data enters this warehouse. It says where to point the
              question.
            </p>
          </div>
        ))}

        {loss.bookings > 0 ? (
          <p className="chart__note chart__note--caveat">
            {formatNumber(loss.bookings)} bookings worth{" "}
            {formatCurrency(loss.amount, currency)} ({formatPercent(loss.sharePct)} of all
            bookings) arrived with no channel attached and are excluded from every rate above.
            They are not lost revenue, they are unattributed revenue: the booking happened and the
            money is real, but the referrer was not captured. They are held in their own bucket
            rather than dropped or spread across the named channels, because splitting them
            proportionally would quietly inflate exactly the channel this section is warning about.
          </p>
        ) : null}
      </section>
    </>
  );
}
