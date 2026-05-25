import { describe, expect, test } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { IntegrationService } from '../../electron/main/services/integration.service'
import { WorkspaceService } from '../../electron/main/services/workspace.service'

describe('IntegrationService', () => {
  test('creates group, members, context and handoffs', () => {
    const db = openInMemoryDatabase()
    const workspaceService = new WorkspaceService(db)
    const service = new IntegrationService(db)
    const workspace = workspaceService.create({
      rootPath: process.cwd(),
      layoutPreset: 1,
      autoStart: false
    })

    const group = service.createGroup({
      name: 'Feature Pagamento',
      goal: 'Integrar SRV/BFF/FED',
      activeWorkspaceId: workspace.id
    })
    const withMember = service.addMember({
      groupId: group.id,
      workspaceId: workspace.id,
      paneId: workspace.panes[0]?.id ?? null,
      role: 'srv',
      alias: 'SRV',
      rootPath: process.cwd()
    })

    expect(withMember.members).toHaveLength(1)
    expect(withMember.members[0]).toEqual(expect.objectContaining({ role: 'srv', alias: 'SRV' }))

    const context = service.buildContext(group.id, withMember.members[0].id)
    expect(context.text).toContain('Feature Pagamento')
    expect(context.text).toContain('srv/SRV')

    const handoff = service.createHandoff({
      groupId: group.id,
      fromMemberId: withMember.members[0].id,
      toMemberId: withMember.members[0].id,
      title: 'srv -> srv',
      content: 'Validate integration contract.'
    })
    expect(handoff.content).toContain('Validate')
    expect(service.listHandoffs(group.id)).toHaveLength(1)

    const saved = service.updateHandoff({ handoffId: handoff.id, status: 'saved' })
    expect(saved.status).toBe('saved')
    expect(service.listHandoffs(group.id)[0].status).toBe('saved')

    service.deleteGroup(group.id)
    expect(service.listGroups()).toHaveLength(0)

    db.close()
  })
})
