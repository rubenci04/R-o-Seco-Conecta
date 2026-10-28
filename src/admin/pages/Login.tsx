import { LockKeyhole } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuth } from '../auth'
import { Field, Notice, TextInput } from '../ui'

export function LoginPage() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión.')
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-background p-4">
      <Card className="w-full max-w-sm space-y-4">
        <div className="flex items-center gap-3">
          <img src="/brand/logo-mark-v2.png" alt="" className="h-10 w-auto" width={50} height={40} />
          <div>
            <h1 className="font-display text-xl font-extrabold leading-tight">Acceso al panel</h1>
            <p className="text-sm text-muted-foreground">Solo para el equipo de Río Seco Conecta.</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Correo electrónico" htmlFor="email">
            <TextInput id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Contraseña" htmlFor="password">
            <TextInput id="password" type="password" autoComplete="current-password" required minLength={1} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" className="w-full" disabled={busy}>
            <LockKeyhole className="size-4" aria-hidden />
            {busy ? 'Ingresando…' : 'Ingresar'}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          ¿Perdiste el acceso? Un administrador puede restablecerlo (ver «Recuperación de acceso» en la documentación del proyecto).{' '}
          <Link to="/" className="font-semibold text-accent underline">
            Volver a la aplicación
          </Link>
        </p>
      </Card>
    </div>
  )
}
