/**
 * OXESpace — Integration demo seeder.
 *
 * How to run:
 *   1. Open OXESpace (npm run dev) with at least one workspace.
 *   2. Open DevTools (Ctrl+Shift+I) → Console.
 *   3. Paste this entire file and press Enter.
 *   4. Open the Integration panel — the "Payment Flow" group will be there
 *      with five members across FED / BFF / SRV / API / AUT roles, a
 *      blocker and last-intent on two of them, and three handoffs (one
 *      addressed to you, one already saved into history).
 *
 * Re-running is safe — it appends a fresh group each time (no state hold).
 */
(async () => {
  const api = window.oxe?.integration
  if (!api) {
    console.error('window.oxe.integration not available — is the preload up?')
    return
  }

  const workspaces = await window.oxe.workspace.list()
  if (workspaces.length === 0) {
    console.error('No workspaces open — create one first.')
    return
  }
  const ws = workspaces[0]
  console.log(`[seed] using workspace: ${ws.name} (${ws.rootPath})`)

  const group = await api.createGroup({
    name: 'Payment Flow',
    goal: 'Connect FED checkout to the new payment gateway via BFF',
    activeWorkspaceId: ws.id
  })
  console.log(`[seed] created group: ${group.name} (${group.id})`)

  const memberSpecs = [
    { role: 'fed',  alias: 'web-checkout',       blockers: null,                                       lastIntent: 'Add Pix QR component on /checkout/confirm' },
    { role: 'bff',  alias: 'checkout-bff',       blockers: 'Waiting on /pay endpoint contract',        lastIntent: 'Stub /pay then call SRV when contract lands' },
    { role: 'srv',  alias: 'payments-svc',       blockers: null,                                       lastIntent: 'Expose POST /pay with idempotency-key' },
    { role: 'api',  alias: 'gateway-api',        blockers: null,                                       lastIntent: 'Forward /pay → payments-svc with auth header' },
    { role: 'aut',  alias: 'auth-svc',           blockers: 'Token rotation pending Ops review',        lastIntent: 'Issue scoped tokens for payments scope' }
  ]

  const created = []
  for (const spec of memberSpecs) {
    const updatedGroup = await api.addMember({
      groupId: group.id,
      workspaceId: ws.id,
      role: spec.role,
      alias: spec.alias,
      rootPath: ws.rootPath
    })
    const justAdded = updatedGroup.members[updatedGroup.members.length - 1]
    if (spec.blockers || spec.lastIntent) {
      await api.updateMember({
        memberId: justAdded.id,
        blockers: spec.blockers,
        lastIntent: spec.lastIntent
      })
    }
    created.push(justAdded)
    console.log(`[seed] +member ${spec.role}/${spec.alias}`)
  }

  const [fed, bff, srv, , aut] = created

  await api.createHandoff({
    groupId: group.id,
    fromMemberId: fed.id,
    toMemberId: bff.id,
    title: 'Need /pay payload shape',
    content: [
      'FED needs the request payload for the /pay BFF endpoint.',
      '',
      'Suggested shape:',
      '```ts',
      'POST /pay',
      '{ amount: number, currency: "BRL"|"USD", method: "pix"|"card", idempotencyKey: string }',
      '→ { paymentId: string, status: "pending"|"approved"|"declined" }',
      '```',
      '',
      'Confirm or push back if SRV requires different naming.'
    ].join('\n')
  })

  await api.createHandoff({
    groupId: group.id,
    fromMemberId: bff.id,
    toMemberId: srv.id,
    title: 'Idempotency-key strategy',
    content: 'Will pass the FED-generated UUID through as Idempotency-Key header. Reject duplicates with 409. OK?'
  })

  const savedHandoff = await api.createHandoff({
    groupId: group.id,
    fromMemberId: srv.id,
    toMemberId: aut.id,
    title: 'Scope name for payments',
    content: 'Going with scope `payments:write`. Issue tokens via /oauth/token with audience=payments-svc.'
  })
  await api.updateHandoff({ handoffId: savedHandoff.id, status: 'saved' })

  console.log('[seed] done — open the Integration panel to see "Payment Flow".')
  console.log('[seed] group id:', group.id)
})()
