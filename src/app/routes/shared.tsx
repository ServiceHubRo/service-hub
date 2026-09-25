import type { ReactElement } from 'react';
import { Navigate, Route } from 'react-router-dom';
import { AccountScreen } from '../../screens/account/AccountScreen';
import { HelpScreen } from '../../screens/account/HelpScreen';
import { helpPath } from '../../screens/account/paths';
import { AccountLegal } from '../../screens/legal/LegalPages';
import { BookingThreadRedirect } from '../../screens/messages/BookingThreadRedirect';
import { ConversationScreen } from '../../screens/messages/ConversationScreen';
import { messagesPath } from '../../screens/messages/paths';
import { NotFound } from '../../screens/public/NotFound';
import { homeOf, NAV, type Role } from '../roles';

/**
 * A role's routes live under its base (`/c/*`, `/s/*`, `/admin/*`) in a file of their own, so the
 * paths inside are relative to it. The screens keep using absolute paths everywhere else.
 */
export function rel(role: Role, path: string): string {
  const base = `${NAV[role].base}/`;
  if (!path.startsWith(base)) throw new Error(`${path} is not under ${base}`);
  return path.slice(base.length);
}

/**
 * Every role: its navigation screens, Cont with the legal documents and (clients and shops) Ajutor
 * și contact, and a 404 inside the shell.
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
      {role !== 'admin' && <Route path={rel(role, helpPath(role))} element={<HelpScreen role={role} />} />}
      <Route path="*" element={<NotFound inShell />} />
    </>
  );
}

/** A conversation and the way in from a booking card (T11), for the client and the shop. */
export function messageRoutes(side: 'client' | 'shop') {
  const base = rel(side, messagesPath(side));
  return (
    <>
      <Route path={`${base}/programare/:bookingId`} element={<BookingThreadRedirect />} />
      <Route path={`${base}/:threadId`} element={<ConversationScreen />} />
    </>
  );
}
