import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '../../app/AppShell';
import { TemplateDemo } from './TemplateDemos';

/**
 * The page templates (Eduard, 14 Nov 2026) inside the client's shell, with sample data: the sidebar
 * on a laptop, the tab bar on a phone, exactly as a real screen. Test builds only; nothing is read
 * or saved.
 */
export function TemplatesApp() {
  return (
    <Routes>
      <Route element={<AppShell role="client" />}>
        <Route path=":sablon" element={<TemplateDemo />} />
        <Route index element={<Navigate to="lista" replace />} />
      </Route>
    </Routes>
  );
}
