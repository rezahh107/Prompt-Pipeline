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
  const errors:SchemaError[]=[];
  const visit=(schema:Schema,current:unknown,path:string):void=>{
    if(typeof schema.$ref==="string"){const resolved=resolveRef(root,schema.$ref);if(!resolved){errors.push({path,message:`unresolved schema reference ${schema.$ref}`});return;}visit(resolved,current,path);return;}
    if("const" in schema&&!same(current,schema.const))errors.push({path,message:`must equal ${JSON.stringify(schema.const)}`});
    if(Array.isArray(schema.enum)&&!schema.enum.some((candidate)=>same(current,candidate)))errors.push({path,message:"must be an allowed enum value"});
    const types=typeof schema.type==="string"?[schema.type]:Array.isArray(schema.type)?schema.type.filter((x):x is string=>typeof x==="string"):[];
    if(types.length&&!types.some((type)=>typeOk(current,type))){errors.push({path,message:`must be ${types.join(" or ")}`});return;}
    if(typeof current==="string"){
      if(typeof schema.minLength==="number"&&current.length<schema.minLength)errors.push({path,message:`must have length >= ${schema.minLength}`});
      if(typeof schema.pattern==="string"&&!new RegExp(schema.pattern).test(current))errors.push({path,message:`must match ${schema.pattern}`});
    }
    if(typeof current==="number"){
      if(typeof schema.minimum==="number"&&current<schema.minimum)errors.push({path,message:`must be >= ${schema.minimum}`});
      if(typeof schema.maximum==="number"&&current>schema.maximum)errors.push({path,message:`must be <= ${schema.maximum}`});
    }
    if(Array.isArray(current)){
      if(typeof schema.minItems==="number"&&current.length<schema.minItems)errors.push({path,message:`must contain at least ${schema.minItems} item(s)`});
      if(schema.uniqueItems===true){const seen=new Set<string>();for(const [index,item] of current.entries()){const key=JSON.stringify(item);if(seen.has(key))errors.push({path:`${path}/${index}`,message:"must be unique"});seen.add(key);}}
      if(isObject(schema.items))current.forEach((item,index)=>visit(schema.items as Schema,item,`${path}/${index}`));
    }
    if(isObject(current)){
      const properties=isObject(schema.properties)?schema.properties:{};
      if(Array.isArray(schema.required))for(const key of schema.required)if(typeof key==="string"&&!(key in current))errors.push({path:`${path}/${key}`,message:"is required"});
      for(const [key,item] of Object.entries(current)){
        const child=properties[key];
        if(isObject(child))visit(child,item,`${path}/${key}`);
        else if(schema.additionalProperties===false)errors.push({path:`${path}/${key}`,message:"is not allowed"});
        else if(isObject(schema.additionalProperties))visit(schema.additionalProperties as Schema,item,`${path}/${key}`);
      }
    }
  };
  visit(root,value,"$");
  return errors;
}
