export async function changeInWorkingTree(workspaceId: string, path: string): Promise<boolean> {
  try {
    const gitApi = window.oxe?.git as unknown as Record<string, ((input: unknown) => Promise<unknown>)> | undefined
    if (gitApi?.getStatus) {
      const status = (await gitApi.getStatus({ workspaceId, rootPath: '' })) as { files?: Array<{ path: string }> } | null
      if (status && Array.isArray(status.files)) {
        if (status.files.some((f) => f.path === path || f.path.endsWith('/' + path) || path.endsWith('/' + f.path))) {
          return true
        }
      }
    }
  } catch {
    /* fallback false */
  }
  return false
}

export async function liveContainer(name: string): Promise<{ image: string; ports: string; folder: string } | null> {
  try {
    const res = await window.oxe?.oxePod?.call?.('containers.list', {})
    if (res?.ok && Array.isArray(res.value?.containers)) {
      const container = res.value.containers.find((c) => c.name === name || c.name === `/${name}` || c.name.endsWith(name))
      if (container) {
        let ports = ''
        if (Array.isArray(container.ports) && container.ports.length > 0) {
          ports = container.ports
            .map((p) => (p.hostPort ? `${p.hostPort}→${p.containerPort}` : `${p.containerPort}`))
            .join(', ')
        }
        let folder = container.labels?.['com.docker.compose.project.working_dir'] || ''
        if (!folder) {
          const inspectRes = await window.oxe?.oxePod?.call?.('containers.inspect', { id: container.id })
          if (inspectRes?.ok) {
            folder = inspectRes.value.workingDir || inspectRes.value.mounts?.[0]?.source || ''
          }
        }
        return {
          image: container.image,
          ports,
          folder
        }
      }
    }
  } catch {
    /* fallback null */
  }
  return null
}
