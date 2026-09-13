import type { ToolContext, ToolEntry } from './tool-registry'
import { projectIdentity } from '../services/memory/memory-project.service'
import type { DocumentationStep } from '../../../shared/types/documentation'
import type { ScreenshotOptions, PreviewRequest } from '../services/documentation/preview-automation'

export async function handleDocumentation(descriptor: {name:string;properties:Record<string,unknown>;required:string[]}, value: unknown, ctx: ToolContext): ReturnType<ToolEntry['handler']> {
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Arguments must be an object')
      const args = value as Record<string,unknown>
      if (Object.keys(args).some(k => !(k in descriptor.properties)) || descriptor.required.some(k => args[k] === undefined)) throw new Error('Invalid documentation arguments')
      const execution = ctx.executions?.authenticate(ctx.executionId,ctx.executionToken,ctx.workspaceId)
      if (!execution || !ctx.workspaceServ.get(execution.workspaceId)?.panes.some(p=>p.id===execution.paneId)) throw new Error('Live workspace execution required')
      if (!ctx.documentation) throw new Error('Documentation service unavailable')
      const verify = (): void => { ctx.executions!.authenticate(ctx.executionId,ctx.executionToken,ctx.workspaceId) }
      const service = await ctx.documentation()
      const project = await projectIdentity(execution.cwd)
      verify()
      const string = (name:string):string => { const v=args[name]; if(typeof v!=='string'||!v.trim()||v.length>2000) throw new Error(`Invalid ${name}`);return v }
      let result:unknown
      switch(descriptor.name) {
        case 'oxespace_documentation_create':result=service.documents.create(project,args.title,args.key);break
        case 'oxespace_documentation_list':result=service.documents.list(project);break
        case 'oxespace_documentation_get': {const id=string('jobId');result={job:service.documents.get(project,id),operations:service.documents.operations(project,id),history:service.documents.history(project,id)};break}
        case 'oxespace_documentation_checkpoint':result=service.documents.checkpoint(project,string('jobId'),args.revision as number,args.steps as DocumentationStep[],args.notes);break
        case 'oxespace_documentation_capture': {
          const options={mode:args.mode,selector:args.selector,redact:args.redact,highlight:args.highlight} as ScreenshotOptions
          if(options.mode && !['viewport','element'].includes(options.mode)) throw new Error('Invalid capture mode')
          result=await service.documents.capture(project,string('jobId'),args.revision as number,string('stepId'),string('key'),options,()=>service.preview.capture(execution.workspaceId,options,verify));break
        }
        case 'oxespace_documentation_image': {
          // Recheck opt-in before returning stored pixels to a cloud-connected agent.
          await service.preview.assertAccess(execution.workspaceId,verify)
          const data=await service.documents.image(project,string('jobId'),string('artifactId'));verify()
          return {content:[{type:'image',mimeType:'image/png',data:data.toString('base64')}]}
        }
        case 'oxespace_documentation_export':result=await service.documents.export(project,string('jobId'),args.revision as number,string('key'));break
        case 'oxespace_preview_interact': {
          if(!['inspect','click','fill','navigate','wait','scroll'].includes(string('action'))) throw new Error('Invalid preview action')
          result=await service.preview.run(execution.workspaceId,args as unknown as PreviewRequest,verify);break
        }
      }
      return {content:[{type:'text',text:JSON.stringify({schemaVersion:1,status:'ok',data:result})}]}
    } catch(error) {
      // Never include fill values, page errors, tokens or stack traces.
      const message = error instanceof Error && /^(Invalid |Live workspace|Documentation |Revision conflict|Request key conflict|Open this workspace|User declined|Preview |Inspect the current|Another documentation|Operation in progress)/.test(error.message) ? error.message : 'Documentation action failed. Verify scope, permission, preview and request parameters.'
      return {isError:true,content:[{type:'text',text:JSON.stringify({schemaVersion:1,status:'error',error:{code:'DOCUMENTATION_ACTION_FAILED',message}})}]}
    }
}
