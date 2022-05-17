import { HandlerFunc } from 'https://deno.land/x/abc@v1.3.3/mod.ts';
import { Sono } from 'https://deno.land/x/sono@v1.1/mod.ts';
import { getRenderer } from './renderer.ts';

const sono = new Sono();

export const routes: RouteMap = {
  '': getRenderer('index', { doesNotHaveOwnCss: true, title: 'BlockyPenguin Terminal', js: [ '@terminal' ] }),
  ws: c => {
    console.log(c.request.r);
    console.log(c.request.w);
    sono.connect({
      conn: c.request.conn,
      bufWriter: c.request.w,
      bufReader: c.request.r,
      headers: c.request.headers
    }, () => {
      console.log('connection');
    })
  }
};

interface RouteMap {
  [x: string]: HandlerFunc
}