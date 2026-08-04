/* The dashboard's sections, in nav order.
 *
 * One list drives the navigation, the routing and the placeholder copy, so
 * a section cannot appear in the nav while nothing renders for it. `views`
 * names the exported JSON each section reads, which keeps the trail from a
 * screen back to a SQL view (and from there to a source file) visible in
 * the code rather than only in the docs. */

export interface Section {
  id: string;
  label: string;
  /** phase 2 runbook session that builds this section's content */
  session: number;
  /** architecture doc section 9 metric numbers */
  metrics: number[];
  views: string[];
}

export const SECTIONS: Section[] = [
  {
    id: "footfall",
    label: "Footfall and sales",
    session: 4,
    metrics: [1, 2, 7, 10],
    views: [
      "vw_footfall_daily",
      "vw_footfall_sales_conversion",
      "vw_event_roi",
      "vw_avg_transaction_value",
    ],
  },
  {
    id: "leasing",
    label: "Leasing",
    session: 5,
    metrics: [3, 4],
    views: ["vw_tenant_turnover_rent", "vw_tenant_sales_per_sqm", "vw_tenant_compliance"],
  },
  {
    id: "online",
    label: "Online",
    session: 6,
    metrics: [5, 6],
    views: ["vw_ticket_channel_mix", "vw_web_channel_conversion"],
  },
  {
    id: "recurring",
    label: "Membership and equestrian",
    session: 7,
    metrics: [8, 9, 11, 12],
    views: [
      "vw_membership_active_churn",
      "vw_revenue_summary",
      "vw_lesson_utilization",
      "vw_stable_occupancy",
    ],
  },
  {
    id: "quality",
    label: "Data quality",
    session: 8,
    metrics: [],
    views: ["dq_summary"],
  },
];
