import { BusFront } from 'lucide-react'
import { EmptyState } from '@/components/shared/States'
import { ExternalLink } from '@/components/shared/ExternalLink'
import { LINKS } from '@/config/links'

/**
 * La fuente no registra viajes directos para este tramo. No se inventan servicios ni combinaciones:
 * puede requerir un transbordo (por ejemplo, en Concepción o Monteros).
 */
export function NoSchedules({ localityName, referenceUrl }: { localityName: string; referenceUrl?: string }) {
  return (
    <EmptyState icon={BusFront} title={`Sin servicio directo entre Río Seco y ${localityName}`}>
      <p>
        Los horarios que tenemos no incluyen viajes directos para este recorrido. Puede requerir combinar con otro colectivo, por ejemplo en
        Concepción o Monteros. No mostramos combinaciones que no estén confirmadas.
      </p>
      <p className="mt-3">
        Podés consultar la fuente original:
        <br />
        <ExternalLink href={referenceUrl ?? LINKS.transport.reference} className="mt-1 font-semibold text-accent underline underline-offset-2">
          Ver horarios en Colectivos Tucumán
        </ExternalLink>
      </p>
    </EmptyState>
  )
}
