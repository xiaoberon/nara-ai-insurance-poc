import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compareModes } from './services/evaluationService';

compareModes(5).then((result)=>{
  const path=resolve(process.cwd(),'evaluation-results.json');
  writeFileSync(path,JSON.stringify(result,null,2),'utf8');
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}).catch((error)=>{console.error(error);process.exitCode=1;});
