import type { ApiActor } from "./auth-guard";
import { SourceContentError } from "../../../src/application/services/source-content.service";
import type { ContentPersonalService } from "../../../src/application/services/content-personal.service";
import type { SaveContentQueryRequest,UpdateContentAnnotationRequest } from "../../../packages/contracts/src/source-content";
const routes=[
  {method:"GET",path:/^\/v1\/content-saved-queries$/,action:"queries",write:false,personal:true},
  {method:"POST",path:/^\/v1\/content-saved-queries$/,action:"createQuery",write:true,personal:true},
  {method:"PATCH",path:/^\/v1\/content-saved-queries\/([^/]+)$/,action:"updateQuery",write:true,personal:true},
  {method:"DELETE",path:/^\/v1\/content-saved-queries\/([^/]+)$/,action:"deleteQuery",write:true,personal:true},
  {method:"GET",path:/^\/v1\/content-annotations$/,action:"annotations",write:false,personal:true},
  {method:"GET",path:/^\/v1\/content\/([^/]+)\/annotation$/,action:"annotation",write:false,personal:true},
  {method:"PUT",path:/^\/v1\/content\/([^/]+)\/annotation$/,action:"saveAnnotation",write:true,personal:true},
  {method:"DELETE",path:/^\/v1\/content\/([^/]+)\/annotation$/,action:"deleteAnnotation",write:true,personal:true},
] as const;
export function matchContentPersonalRoute(method:string,path:string){return routes.find(route=>route.method===method&&route.path.test(path));}
export async function handleContentPersonalRoute(input:{method:string;url:URL;body?:unknown;actor:ApiActor|null;requestId:string;service?:ContentPersonalService}){
  const {requestId,actor,service}=input,route=matchContentPersonalRoute(input.method,input.url.pathname),fail=(statusCode:number,error:string)=>({statusCode,body:{ok:false,requestId,error,errorCode:statusCode===409?"personal_conflict":statusCode===404?"personal_not_found":statusCode===401?"unauthorized":"invalid_personal_request"}});
  if(!route)return fail(404,"Route not found");if(actor?.type!=="session")return fail(401,"A user session is required for personal content");if(!service)return {statusCode:503,body:{ok:false,requestId,error:"Personal content storage is unavailable",errorCode:"content_personal_unavailable"}};
  const userId=actor.userId,id=route.path.exec(input.url.pathname)?.[1]??"",params=input.url.searchParams;
  try{
    if(route.action==="queries")return {statusCode:200,body:{ok:true,requestId,...await service.listQueries(userId,{limit:params.has("limit")?Number(params.get("limit")):undefined,cursor:params.get("cursor")??undefined})}};
    if(route.action==="createQuery"||route.action==="updateQuery")return {statusCode:route.action==="createQuery"?201:200,body:{ok:true,requestId,savedQuery:await service.saveQuery(userId,input.body as SaveContentQueryRequest,route.action==="updateQuery"?id:undefined)}};
    if(route.action==="deleteQuery")return {statusCode:200,body:{ok:true,requestId,...await service.deleteQuery(userId,id,input.body as {expectedRevision?:number})}};
    if(route.action==="annotation")return {statusCode:200,body:{ok:true,requestId,annotation:await service.getAnnotation(userId,id)}};
    if(route.action==="saveAnnotation")return {statusCode:200,body:{ok:true,requestId,annotation:await service.saveAnnotation(userId,id,input.body as UpdateContentAnnotationRequest)}};
    if(route.action==="deleteAnnotation")return {statusCode:200,body:{ok:true,requestId,...await service.deleteAnnotation(userId,id,input.body as {expectedRevision?:number})}};
    if(params.has("favorite")&&!["true","false"].includes(params.get("favorite")!))throw new SourceContentError("favorite must be true or false");
    return {statusCode:200,body:{ok:true,requestId,...await service.listAnnotations(userId,{limit:params.has("limit")?Number(params.get("limit")):undefined,cursor:params.get("cursor")??undefined,favorite:params.has("favorite")?params.get("favorite")==="true":undefined})}};
  }catch(error){if(error instanceof SourceContentError)return fail(error.status,error.message);throw error;}
}
