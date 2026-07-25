import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { serverEnv, isSupabaseConfigured } from '@/lib/env'
import { findDemoUserByEmail, findDemoUserById, DEMO_PASSWORD, type AppUser } from './users'
import { supabaseCurrentUser, supabaseSignIn, supabaseSignOut } from './supabase-auth'

const COOKIE = 'gcs_session'
const MAX_AGE = 60 * 60 * 8 // 8h

interface SessionPayload {
  sub: string
  exp: number
}

function sign(payload: string): string {
  return createHmac('sha256', serverEnv().AUTH_SECRET).update(payload).digest('base64url')
}

function encode(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${sign(body)}`
}

function decode(token: string): SessionPayload | null {
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = sign(body)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

export interface LoginResult {
  ok: boolean
  message?: string
  user?: AppUser
}

/**
 * Sign in. Uses Supabase Auth when configured (production), else the demo
 * credential path below (offline dev + tests).
 */
export async function login(email: string, password: string): Promise<LoginResult> {
  if (isSupabaseConfigured()) {
    const res = await supabaseSignIn(email, password)
    return { ok: res.ok, message: res.message }
  }
  return demoLogin(email, password)
}

/** Demo credential check + signed session cookie (offline/dev only). */
async function demoLogin(email: string, password: string): Promise<LoginResult> {
  const user = findDemoUserByEmail(email)
  // Trim to tolerate accidental trailing whitespace/newlines in the env var or
  // the typed value (common when pasting a password into a Vercel env field).
  const expectedPassword = (serverEnv().AUTH_DEMO_PASSWORD || DEMO_PASSWORD).trim()
  if (!user || password.trim() !== expectedPassword) return { ok: false, message: 'פרטי התחברות שגויים' }
  if (!user.active) return { ok: false, message: 'החשבון מושבת' }
  const token = encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + MAX_AGE })
  cookies().set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  })
  return { ok: true, user }
}

export async function logout(): Promise<void> {
  if (isSupabaseConfigured()) {
    await supabaseSignOut()
    return
  }
  cookies().delete(COOKIE)
}

/** Resolve the current authenticated user (Supabase session or demo cookie). */
// Wrapped in React `cache()` so the layout, the page, and any server action in
// the SAME request share one auth resolution instead of each re-hitting Supabase
// (the layout's requireRole + a page's requireRole would otherwise double the
// auth round-trips on every navigation).
export const getCurrentUser = cache(async (): Promise<AppUser | null> => {
  if (isSupabaseConfigured()) return supabaseCurrentUser()
  const token = cookies().get(COOKIE)?.value
  if (!token) return null
  const payload = decode(token)
  if (!payload) return null
  const user = findDemoUserById(payload.sub)
  // Deactivated mid-session -> treated as logged out.
  if (!user || !user.active) return null
  return user
})
