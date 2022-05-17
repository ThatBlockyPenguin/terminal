import { Application } from 'https://deno.land/x/abc@v1.3.3/mod.ts';
import { routes } from './routes.ts';

const app = new Application();
const port = 8080;

app.static('/assets', 'assets');

for(const key in routes)
  app.get(`/${key}`, routes[key]);

app.start({ port });
console.log(`Server Online! http://localhost:${port}/`);