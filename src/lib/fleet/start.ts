import type { FleetCapability } from './permissions';
import { hasFeature, type FleetPlanSummary } from './plans';
import type { FleetOverview } from './types';

export type StartStepKey = 'vehicle' | 'members' | 'budget';

export interface StartStep {
  key: StartStepKey;
  done: boolean;
  /** The page of the space the step opens, and the filter it opens with. */
  link: { section: 'vehicule' | 'membri' | 'rapoarte'; filter?: string };
}

/**
 * The first steps of a company's fleet space (Eduard, 21 Nov 2026: Panou of an empty fleet no longer
 * repeats Vehicule): adding the first vehicle, inviting a driver or a colleague, setting the monthly
 * budget. Only the steps the member may do and the plan has; the ones done are ticked by the data
 * itself (a vehicle exists, another member exists, the budget is set). A driver has none.
 */
export function startSteps(
  data: Pick<FleetOverview, 'vehicles' | 'members' | 'me' | 'company'>,
  can: (capability: FleetCapability) => boolean,
  plan: Pick<FleetPlanSummary, 'features'> | null,
): StartStep[] {
  const steps: StartStep[] = [];
  if (can('vehicles.manage')) steps.push({ key: 'vehicle', done: data.vehicles.length > 0, link: { section: 'vehicule', filter: 'nou' } });
  if (can('members.manage')) steps.push({ key: 'members', done: data.members.some((m) => m.id !== data.me.member_id), link: { section: 'membri' } });
  // The budget is set on the Rapoarte page: it needs the right to set it and to open that page.
  if (can('budget.manage') && can('reports.view') && hasFeature(plan, 'budget') && hasFeature(plan, 'reports')) {
    steps.push({ key: 'budget', done: data.company.budget.monthly !== null, link: { section: 'rapoarte', filter: 'budget' } });
  }
  return steps;
}
