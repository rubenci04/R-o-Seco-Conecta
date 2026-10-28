import { TriangleAlert } from 'lucide-react'
import { Component, type ReactNode } from 'react'
import { Card } from '@/components/ui/card'

/**
 * El mapa es opcional: si falla la carga del módulo cartográfico (p. ej. sin conexión en la primera visita)
 * o el propio mapa, la lista de lugares, las fichas y los teléfonos siguen funcionando.
 */
export class MapErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <Card role="alert" className="flex gap-3 border-warning/40 bg-warning-soft text-warning">
        <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div>
          <p className="font-bold">No se pudo cargar el mapa</p>
          <p className="text-sm">Revisá tu conexión y recargá la página. Mientras tanto, la lista de lugares de abajo, con direcciones y teléfonos, sigue disponible.</p>
        </div>
      </Card>
    )
  }
}
