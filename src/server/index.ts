import { app } from './app';

const port=Number(process.env.PORT??3001);
const server=app.listen(port,()=>process.stdout.write(`Nara API listening on http://localhost:${port}\n`));
// A real 75/300-run evaluation intentionally lasts longer than a normal API request.
server.requestTimeout=0;
