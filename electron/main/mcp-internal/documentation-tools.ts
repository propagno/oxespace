import type { ToolEntry } from './tool-registry'

const text = { type: 'string' }, revision = { type: 'integer', minimum: 0 }
const descriptors: {name:string;description:string;properties:Record<string,unknown>;required:string[]}[] = [
  {name:'oxespace_documentation_create',description:'Create manual (idempotent key).',properties:{key:text,title:text},required:['key','title']},
  {name:'oxespace_documentation_list',description:'List manuals.',properties:{},required:[]},
  {name:'oxespace_documentation_get',description:'Read manual/history/status.',properties:{jobId:text},required:['jobId']},
  {name:'oxespace_documentation_checkpoint',description:'Checkpoint at revision; verified needs evidence.',properties:{jobId:text,revision,steps:{type:'array',maxItems:100,items:{type:'object',properties:{id:text,title:text,instruction:text,state:{enum:['pending','captured','verified']},artifactId:text,evidence:text},required:['id','title','instruction','state'],additionalProperties:false}},notes:text},required:['jobId','revision','steps']},
  {name:'oxespace_documentation_capture',description:'Capture opted-in viewport/element. Redact and review private data. Reuse key.',properties:{jobId:text,revision,stepId:text,key:text,mode:{enum:['viewport','element']},selector:text,redact:{type:'array',items:text,maxItems:30},highlight:{type:'array',items:text,maxItems:30}},required:['jobId','revision','stepId','key']},
  {name:'oxespace_documentation_image',description:'Send screenshot to agent vendor (opt-in required).',properties:{jobId:text,artifactId:text},required:['jobId','artifactId']},
  {name:'oxespace_documentation_export',description:'Export local Markdown/HTML/JSON with review warnings.',properties:{jobId:text,revision,key:text},required:['jobId','revision','key']},
  {name:'oxespace_preview_interact',description:'Inspect preview. Actions need consent and expectedUrl. Scroll before capture. Verify results.',properties:{action:{enum:['inspect','click','fill','navigate','wait','scroll']},expectedUrl:text,selector:text,text,url:text},required:['action']}
]
export const DOCUMENTATION_TOOLS: ToolEntry[] = descriptors.map(d => ({
  descriptor:{name:d.name,description:d.description,inputSchema:{type:'object',properties:d.properties,required:d.required,additionalProperties:false}},requiresWorkspace:true,
  handler: async (value, ctx) => {
    const {handleDocumentation} = await import('./documentation-handler')
    return handleDocumentation(d, value, ctx)
  }
}))
