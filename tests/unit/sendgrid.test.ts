import { describe, it, expect, vi, afterEach } from 'vitest'
import { SendGridEmailProvider, parseFromAddress } from '@/lib/delivery/email/sendgrid'

afterEach(() => vi.restoreAllMocks())

describe('parseFromAddress', () => {
  it('splits "Name <email>" into name + email', () => {
    expect(parseFromAddress('Just A Second <gifts@justasecond.co.il>')).toEqual({
      name: 'Just A Second',
      email: 'gifts@justasecond.co.il',
    })
  })
  it('accepts a bare address', () => {
    expect(parseFromAddress('gifts@justasecond.co.il')).toEqual({ email: 'gifts@justasecond.co.il' })
  })
})

describe('SendGridEmailProvider', () => {
  it('POSTs SendGrid v3 mail/send shape and returns the message id header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 202, headers: { 'x-message-id': 'msg_123' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const provider = new SendGridEmailProvider('SG.key', 'Just A Second <gifts@justasecond.co.il>')
    const res = await provider.send({
      to: 'yael@example.com',
      subject: 'קיבלת שובר מתנה',
      html: '<p>hi</p>',
      text: 'hi',
      attachments: [{ filename: 'card.pdf', content: Buffer.from('pdf'), contentType: 'application/pdf' }],
    })

    expect(res).toEqual({ providerMessageId: 'msg_123', provider: 'sendgrid' })
    const [url, opts] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.sendgrid.com/v3/mail/send')
    expect((opts as RequestInit).headers).toMatchObject({ Authorization: 'Bearer SG.key' })
    const body = JSON.parse((opts as RequestInit).body as string)
    expect(body.personalizations[0].to[0].email).toBe('yael@example.com')
    expect(body.from).toEqual({ name: 'Just A Second', email: 'gifts@justasecond.co.il' })
    // text/plain must precede text/html.
    expect(body.content[0].type).toBe('text/plain')
    expect(body.content[1].type).toBe('text/html')
    expect(body.attachments[0]).toMatchObject({ filename: 'card.pdf', type: 'application/pdf', disposition: 'attachment' })
    expect(body.attachments[0].content).toBe(Buffer.from('pdf').toString('base64'))
  })

  it('throws with status + detail on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"errors":[{"message":"bad"}]}', { status: 401 })))
    const provider = new SendGridEmailProvider('SG.bad', 'gifts@justasecond.co.il')
    await expect(
      provider.send({ to: 'a@b.com', subject: 's', html: '<p>x</p>', text: 'x' }),
    ).rejects.toThrow(/SendGrid send failed \(401\)/)
  })
})
