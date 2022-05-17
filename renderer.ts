import { Context } from 'https://deno.land/x/abc@v1.3.3/mod.ts';
import { renderFileToString } from 'https://deno.land/x/dejs@0.10.3/mod.ts';

export function getRenderer(name: string, data: Record<string, unknown>, alsoDo?: (c: Context) => void) {
  console.log('Creating renderer for ' + name);
  return async (c: Context) => {
    console.log('Rendering ' + name);
    if(alsoDo !== undefined) alsoDo(c);
    return renderFileToString(`./views/${name}.dejs`, { data: Object.assign({}, data, { thisName: name }) });
  }
}