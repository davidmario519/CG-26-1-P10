// 새떼 설치물 허브 서버
// - 정적 파일(index.html/fly.html/셰이더/p5 등)과 WebSocket을 같은 포트로 서빙
//   → 터널(HTTPS/WSS) 하나로 메인 스크린과 폰을 모두 붙일 수 있다.
// - 폰('phone')은 자기 비행 상태(c=중심, v=방향, hue)를 보내고,
//   서버가 모든 메인 스크린('screen')에 flock 단위로 중계한다.
//
// 실행:  npm install ws  →  node server.js   (기본 http://localhost:8080)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.frag': 'text/plain; charset=utf-8',
  '.vert': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

// ── 정적 파일 서버 ──
const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(ROOT)) {           // 경로 탈출 방지
    res.writeHead(403); res.end('forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store'   // 개발 중: 폰이 항상 최신 파일을 받도록
    });
    res.end(data);
  });
});

// ── WebSocket 허브 ──
const wss = new WebSocketServer({ server });
const clients = new Map();   // ws -> { id, role, hue, lastState }
let nextId = 1;

function broadcastToScreens(obj) {
  const s = JSON.stringify(obj);
  for (const [ws, c] of clients) {
    if (c.role === 'screen' && ws.readyState === ws.OPEN) ws.send(s);
  }
}

wss.on('connection', (ws) => {
  const info = { id: nextId++, role: null, hue: 0, lastState: null };
  clients.set(ws, info);

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    if (msg.type === 'hello') {
      info.role = msg.role === 'screen' ? 'screen' : 'phone';
      if (typeof msg.hue === 'number') info.hue = msg.hue;

      // 새 스크린에게 현재 접속 중인 폰들의 마지막 상태를 즉시 전달(roster)
      if (info.role === 'screen') {
        for (const [, c] of clients) {
          if (c.role === 'phone' && c.lastState) {
            ws.send(JSON.stringify({ type: 'flock', id: c.id, hue: c.hue, ...c.lastState }));
          }
        }
      }
      console.log(`[+] #${info.id} ${info.role} (screens=${count('screen')}, phones=${count('phone')})`);

    } else if (msg.type === 'state' && info.role === 'phone') {
      if (typeof msg.hue === 'number') info.hue = msg.hue;
      info.lastState = { c: msg.c, v: msg.v };
      broadcastToScreens({ type: 'flock', id: info.id, hue: info.hue, c: msg.c, v: msg.v });
    }
  });

  ws.on('close', () => {
    if (info.role === 'phone') broadcastToScreens({ type: 'leave', id: info.id });
    clients.delete(ws);
    console.log(`[-] #${info.id} ${info.role || '?'} left (screens=${count('screen')}, phones=${count('phone')})`);
  });

  ws.on('error', () => {});
});

function count(role) {
  let n = 0;
  for (const [, c] of clients) if (c.role === role) n++;
  return n;
}

server.listen(PORT, () => {
  console.log(`flock hub: http + ws on http://localhost:${PORT}`);
  console.log(`  메인 스크린:  http://localhost:${PORT}/`);
  console.log(`  폰(QR 대상):  http://localhost:${PORT}/fly.html`);
});
