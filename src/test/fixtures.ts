/**
 * DATOS SINTÉTICOS — SOLO PARA PRUEBAS.
 * No representan horarios reales de ninguna empresa. Nunca importar fuera de archivos *.test.*.
 */
import type { Holiday, Service } from '@/domain/types'

export const TEST_HOLIDAYS: Holiday[] = [
  { date: '09-24', name: 'Feriado de prueba', scope: 'provincial', source: 'sintético' },
  { date: '2026-11-23', name: 'Feriado móvil de prueba', scope: 'nacional', source: 'sintético' },
]

export function makeService(overrides: Partial<Service> & { id: string; departure: string }): Service {
  return {
    companyId: 'empresa-prueba',
    localityId: 'concepcion',
    direction: 'from-rio-seco',
    originStopId: 'parada-a',
    destinationStopId: 'parada-b',
    serviceType: 'común',
    dayTypes: ['weekday'],
    precision: 'confirmed',
    source: { label: 'SINTÉTICO (pruebas)', url: 'https://example.com/', reuseAuthorized: true },
    lastVerified: '2026-01-01',
    exceptions: [],
    ...overrides,
  }
}

export const TEST_SERVICES: Service[] = [
  makeService({ id: 's1', departure: '06:00', arrival: '06:45' }),
  makeService({ id: 's2', departure: '12:30', arrival: '13:15' }),
  makeService({ id: 's3', departure: '18:00', arrival: '18:50', companyId: 'otra-empresa' }),
  makeService({ id: 's4', departure: '23:30', arrival: '00:20' }),
  makeService({ id: 's5', departure: '24:15', arrival: '25:00' }),
  makeService({ id: 's6', departure: '09:00', dayTypes: ['saturday', 'sunday', 'holiday'] }),
  makeService({ id: 's7', departure: '08:00', direction: 'to-rio-seco' }),
  makeService({ id: 's8', departure: '10:00', localityId: 'monteros' }),
]
