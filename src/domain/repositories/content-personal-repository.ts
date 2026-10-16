import type { ContentSavedQueryView,ContentAnnotationView } from "../../../packages/contracts/src/source-content";
export interface PersonalPageQuery {limit:number;cursor?:string;favorite?:boolean}
export interface ContentPersonalRepository {
  getQuery(userId:string,id:string):Promise<ContentSavedQueryView|null>;
  listQueries(userId:string,query:PersonalPageQuery):Promise<{queries:ContentSavedQueryView[];nextCursor:string|null}>;
  saveQuery(userId:string,view:ContentSavedQueryView,expectedRevision:number):Promise<ContentSavedQueryView|null>;
  deleteQuery(userId:string,id:string,expectedRevision:number):Promise<boolean>;
  getAnnotation(userId:string,contentId:string):Promise<ContentAnnotationView|null>;
  listAnnotations(userId:string,query:PersonalPageQuery):Promise<{annotations:ContentAnnotationView[];nextCursor:string|null}>;
  saveAnnotation(userId:string,view:ContentAnnotationView,expectedRevision:number):Promise<ContentAnnotationView|null>;
  deleteAnnotation(userId:string,contentId:string,expectedRevision:number):Promise<boolean>;
}
