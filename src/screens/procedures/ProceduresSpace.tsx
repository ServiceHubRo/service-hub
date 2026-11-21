import { useParams } from 'react-router-dom';
import { DetailFrame } from '../../components/ListDetailLayout';
import { EmbeddedProvider } from '../../lib/embedded';
import { LIST_DETAIL_QUERY, useMediaQuery } from '../../lib/useMediaQuery';
import { ProcedureScreen } from './ProcedureScreen';
import { ProceduresScreen } from './ProceduresScreen';
import type { ProcedureMode } from './paths';

/**
 * The procedures on a laptop (C9, Eduard, 21 Nov 2026): the library on the left, the chosen procedure on
 * the right; the address is the choice (`/proceduri/<id>`), so Back and a link keep working. On a phone, as
 * before: the library, and a procedure as a page of its own. The library and a procedure both render this.
 */
export function ProceduresSpace({ mode }: { mode: ProcedureMode }) {
  const wide = useMediaQuery(LIST_DETAIL_QUERY);
  const { procedureId } = useParams();
  if (!wide) return procedureId ? <ProcedureScreen mode={mode} /> : <ProceduresScreen mode={mode} />;
  return (
    <ProceduresScreen
      mode={mode}
      wide
      selectedId={procedureId}
      detail={
        procedureId && (
          <DetailFrame>
            <EmbeddedProvider value>
              <ProcedureScreen mode={mode} />
            </EmbeddedProvider>
          </DetailFrame>
        )
      }
    />
  );
}
