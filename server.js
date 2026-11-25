const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, 'data', 'stories');
const PUBLIC_DIR = __dirname;
const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8'};

async function ensureStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  // The directory and initial JSON records are created automatically on first launch.
  const files = await fs.readdir(DATA_DIR);
  if (files.length === 0) {
    const examples = [
      {id:'welcome-1',text:'Сегодня незнакомый человек придержал мне дверь и пожелал хорошего дня. Вроде мелочь, а я вспоминаю это уже несколько часов.',tag:'Радость',date:Date.now()-3600000,likes:12},
      {id:'welcome-2',text:'Кажется, я слишком часто сравниваю свой путь с чужим. Хочу научиться замечать собственный прогресс.',tag:'Мысли',date:Date.now()-7200000,likes:8},
      {id:'welcome-3',text:'Если у тебя сейчас сложная неделя: пусть сегодня найдётся хотя бы одна спокойная минутка.',tag:'Поддержка',date:Date.now()-15000000,likes:21}
    ];
    for (const story of examples) await writeStory(story);
  }
}
async function writeStory(story) {
  const safeId = String(story.id).replace(/[^a-zA-Z0-9_-]/g, '');
  await fs.writeFile(path.join(DATA_DIR, safeId + '.json'), JSON.stringify(story, null, 2) + '\n', {flag:'w'});
}
async function readStories() {
  const files = (await fs.readdir(DATA_DIR)).filter(f => f.endsWith('.json'));
  const records = await Promise.all(files.map(async file => {
    try { return JSON.parse(await fs.readFile(path.join(DATA_DIR,file),'utf8')); }
    catch { return null; }
  }));
  return records.filter(Boolean).sort((a,b)=>b.date-a.date);
}
function send(res,status,data) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(data));
}
async function bodyJson(req) {
  let raw='';
  for await (const chunk of req) { raw+=chunk; if(raw.length>10000) throw new Error('Слишком большой запрос'); }
  return JSON.parse(raw || '{}');
}
const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method==='GET' && url.pathname==='/api/stories') return send(res,200,await readStories());
    if (req.method==='POST' && url.pathname==='/api/stories') {
      const body=await bodyJson(req);
      const text=String(body.text||'').trim();
      if (!text || text.length>500) return send(res,400,{error:'История должна содержать от 1 до 500 символов.'});
      const story={id:require('node:crypto').randomUUID(),text,tag:['Мысли','Радость','Поддержка'].includes(body.tag)?body.tag:'Мысли',date:Date.now(),likes:0};
      await writeStory(story);
      return send(res,201,story);
    }
    const likeMatch=url.pathname.match(/^\/api\/stories\/([a-zA-Z0-9_-]+)\/like$/);
    if (req.method==='POST' && likeMatch) {
      const file=path.join(DATA_DIR,likeMatch[1]+'.json');
      try {
        const story=JSON.parse(await fs.readFile(file,'utf8'));
        story.likes=(story.likes||0)+1;
        await writeStory(story);
        return send(res,200,story);
      } catch { return send(res,404,{error:'История не найдена.'}); }
    }
    if (req.method==='GET') {
      const requested=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
      const target=path.resolve(PUBLIC_DIR,requested);
      if (!target.startsWith(PUBLIC_DIR+path.sep) || path.basename(target)==='server.js') return send(res,404,{error:'Не найдено'});
      try {
        const content=await fs.readFile(target);
        res.writeHead(200,{'Content-Type':MIME[path.extname(target)]||'application/octet-stream'});
        return res.end(content);
      } catch { return send(res,404,{error:'Не найдено'}); }
    }
    send(res,404,{error:'Не найдено'});
  } catch (error) {
    send(res,400,{error:error.message==='Unexpected end of JSON input'?'Некорректный JSON':error.message});
  }
});
ensureStorage().then(()=>server.listen(PORT,()=>console.log('Whisper запущен: http://localhost:'+PORT)))
  .catch(error=>{console.error('Не удалось создать JSON-хранилище:',error);process.exit(1)});
