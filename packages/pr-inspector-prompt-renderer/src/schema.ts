export interface SchemaError { path: string; message: string }
type Schema = Record<string, unknown>;
const isObject=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==="object"&&!Array.isArray(value);
function same(a:unknown,b:unknown):boolean{return JSON.stringify(a)===JSON.stringify(b)}
function resolveRef(root:Schema,ref:string):Schema|undefined{
  if(!ref.startsWith("#/")) return undefined;
  let current:unknown=root;
  for(const raw of ref.slice(2).split("/")){const key=raw.replaceAll("~1","/").replaceAll("~0","~");if(!isObject(current)||!(key in current))return undefined;current=current[key];}
  return isObject(current)?current:undefined;
}
function typeOk(value:unknown,type:string):boolean{
  if(type==="null")return value===null;
  if(type==="array")return Array.isArray(value);
  if(type==="object")return isObject(value);
  if(type==="integer")return Number.isInteger(value);
  return typeof value===type;
}
export function validateSchema(root:Schema,value:unknown):SchemaError[]{
  const collect=(schema:Schema,current:unknown,path:string):SchemaError[]=>{
    const errors:SchemaError[]=[];
    const push=(message:string,target=path)=>errors.push({path:target,message});
    if(typeof schema.$ref==="string"){
      const resolved=resolveRef(root,schema.$ref);
      if(!resolved){push(`unresolved schema reference ${schema.$ref}`);return errors;}
      return collect(resolved,current,path);
    }
    if(Array.isArray(schema.anyOf)){
      const branches=schema.anyOf.filter(isObject);
      if(!branches.some((branch)=>collect(branch,current,path).length===0))push("must satisfy at least one anyOf branch");
      return errors;
    }
    if("const" in schema&&!same(current,schema.const))push(`must equal ${JSON.stringify(schema.const)}`);
    if(Array.isArray(schema.enum)&&!schema.enum.some((candidate)=>same(current,candidate)))push("must be an allowed enum value");
    const types=typeof schema.type==="string"?[schema.type]:Array.isArray(schema.type)?schema.type.filter((x):x is string=>typeof x==="string"):[];
    if(types.length&&!types.some((type)=>typeOk(current,type))){push(`must be ${types.join(" or ")}`);return errors;}
    if(typeof current==="string"){
      if(typeof schema.minLength==="number"&&current.length<schema.minLength)push(`must have length >= ${schema.minLength}`);
      if(typeof schema.maxLength==="number"&&current.length>schema.maxLength)push(`must have length <= ${schema.maxLength}`);
      if(typeof schema.pattern==="string"&&!new RegExp(schema.pattern).test(current))push(`must match ${schema.pattern}`);
    }
    if(typeof current==="number"){
      if(typeof schema.minimum==="number"&&current<schema.minimum)push(`must be >= ${schema.minimum}`);
      if(typeof schema.maximum==="number"&&current>schema.maximum)push(`must be <= ${schema.maximum}`);
    }
    if(Array.isArray(current)){
      if(typeof schema.minItems==="number"&&current.length<schema.minItems)push(`must contain at least ${schema.minItems} item(s)`);
      if(schema.uniqueItems===true){const seen=new Set<string>();for(const [index,item] of current.entries()){const key=JSON.stringify(item);if(seen.has(key))push("must be unique",`${path}/${index}`);seen.add(key);}}
      if(isObject(schema.items))current.forEach((item,index)=>errors.push(...collect(schema.items as Schema,item,`${path}/${index}`)));
    }
    if(isObject(current)){
      const properties=isObject(schema.properties)?schema.properties:{};
      if(Array.isArray(schema.required))for(const key of schema.required)if(typeof key==="string"&&!(key in current))push("is required",`${path}/${key}`);
      for(const [key,item] of Object.entries(current)){
        const child=properties[key];
        if(isObject(child))errors.push(...collect(child,item,`${path}/${key}`));
        else if(schema.additionalProperties===false)push("is not allowed",`${path}/${key}`);
        else if(isObject(schema.additionalProperties))errors.push(...collect(schema.additionalProperties as Schema,item,`${path}/${key}`));
      }
    }
    return errors;
  };
  return collect(root,value,"$");
}
