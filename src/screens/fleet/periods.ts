/**
 * The periods of Costuri and Rapoarte are the shop's Rapoarte periods (src/lib/shopReports.ts):
 * the same days in Bucharest, and the same comparison — this month's 1st to today against the same
 * days of last month, this year against last year to the same day.
 */
export {
  periodRange,
  previousRange,
  REPORT_PERIODS as COST_PERIODS,
  type ReportPeriod as CostPeriod,
} from '../../lib/shopReports';
