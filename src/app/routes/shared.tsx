import type { ReactElement } from 'react';
import { Navigate, Route } from 'react-router-dom';
import { AccountScreen } from '../../screens/account/AccountScreen';
import { HelpScreen } from '../../screens/account/HelpScreen';
import { helpPath, newRequestPath, requestsPath, suggestionsPath } from '../../screens/account/paths';
import { HelpArticleScreen } from '../../screens/help/HelpArticleScreen';
import { HelpCategoryScreen } from '../../screens/help/HelpCategoryScreen';
import { MyRequestScreen } from '../../screens/requests/MyRequestScreen';
import { MyRequestsScreen } from '../../screens/requests/MyRequestsScreen';
import { NewRequestScreen } from '../../screens/requests/NewRequestScreen';
import { AccountLegal } from '../../screens/legal/LegalPages';
import { BookingThreadRedirect } from '../../screens/messages/BookingThreadRedirect';
import { ConversationScreen } from '../../screens/messages/ConversationScreen';
import { TeamNoticesScreen } from '../../screens/notices/TeamNoticesScreen';
import { messagesPath } from '../../screens/messages/paths';
import { NotFound } from '../../screens/public/NotFound';
import { SuggestionsScreen } from '../../screens/suggestions/SuggestionsScreen';
import { homeOf, isStaff, NAV, type Role } from '../roles';

/**
 * A role's routes live under its base (`/c/*`, `/s/*`, `/admin/*`, `/suport/*`) in a file of their own, so the
 * paths inside are relative to it. The screens keep using absolute paths everywhere else.
 */
export function rel(role: Role, path: string): string {
  const base = `${NAV[role].base}/`;
  if (!path.startsWith(base)) throw new Error(`${path} is not under ${base}`);
  return path.slice(base.length);
}

/**
 * Every role: its navigation screens, Cont with the legal documents and (clients and shops, never the
 * team: isStaff) Ajutor și contact and Sugestii, and a 404 inside the shell.
 */
export function commonRoutes(role: Role, screens: Record<string, ReactElement>) {
  const nav = NAV[role];
  return (
    <>
      <Route index element={<Navigate to={homeOf(role)} replace />} />
      {nav.main.map((item) => (
        <Route key={item.path} path={rel(role, item.path)} element={screens[item.path]} />
      ))}
      <Route path={rel(role, nav.account.path)} element={<AccountScreen role={role} />} />
      <Route path={`${rel(role, nav.account.path)}/legal/:doc`} element={<AccountLegal role={role} />} />
      {!isStaff(role) && <Route path={rel(role, helpPath(role))} element={<HelpScreen role={role} />} />}
      {!isStaff(role) && <Route path={rel(role, suggestionsPath(role))} element={<SuggestionsScreen role={role} />} />}
      {/* A4: the Help Center's categories and articles, under Ajutor și contact (the agent's are in SupportApp). */}
      {!isStaff(role) && <Route path={`${rel(role, helpPath(role))}/categorie/:slug`} element={<HelpCategoryScreen role={role} />} />}
      {!isStaff(role) && <Route path={`${rel(role, helpPath(role))}/articol/:slug`} element={<HelpArticleScreen role={role} />} />}
      {/* A3a: Cont → Ajutor și contact → Solicitările mele. */}
      {!isStaff(role) && <Route path={rel(role, requestsPath(role))} element={<MyRequestsScreen role={role} />} />}
      {!isStaff(role) && <Route path={rel(role, newRequestPath(role))} element={<NewRequestScreen role={role} />} />}
      {!isStaff(role) && <Route path={`${rel(role, requestsPath(role))}/:requestId`} element={<MyRequestScreen role={role} />} />}
      <Route path="*" element={<NotFound inShell />} />
    </>
  );
}

/** A conversation and the way in from a booking card (T11), for the client and the shop. */
export function messageRoutes(side: 'client' | 'shop') {
  const base = rel(side, messagesPath(side));
  return (
    <>
      <Route path={`${base}/echipa`} element={<TeamNoticesScreen />} />
      <Route path={`${base}/programare/:bookingId`} element={<BookingThreadRedirect />} />
      <Route path={`${base}/:threadId`} element={<ConversationScreen />} />
    </>
  );
}
