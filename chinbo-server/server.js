const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DB_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'db.json');

const defaultConfig = {
  settings: { masterPassword: '' },
  groups: [
    {
      id: 'group_default',
      name: 'Grupo 1',
      buttons: [
        { id: 'btn_1', type: 'simple', label: 'Hola 👋', text: 'Hola, ¿cómo estás?' },
        { id: 'btn_2', type: 'flip', label: 'Tarjeta', front: 'Frente', back: 'Dorso' },
        { id: 'btn_3', type: 'revin', label: 'Revin', values: ['✅', '⏳', '❌'] }
      ]
    }
  ]
};

const defaultDb = {
  globalTokens: {
    masterToken: process.env.MASTER_TOKEN || 'master-dev-token',
    opToken: process.env.OP_TOKEN || 'operator-dev-token'
  },
  offices: {
    'Oficina Central': {
      config: defaultConfig,
      pcs: {
        pc_001: { name: 'PC 1', lastSeen: 0, online: false }
      },
      tokens: {
        masterToken: process.env.MASTER_TOKEN || 'master-dev-token',
        opToken: process.env.OP_TOKEN || 'operator-dev-token'
      }
    }
  }
};

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

function atomicWriteJson(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function readDb() {
  if (!fs.existsSync(DB_PATH)) {
    atomicWriteJson(DB_PATH, defaultDb);
    return structuredClone(defaultDb);
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    return {
      globalTokens: parsed.globalTokens || defaultDb.globalTokens,
      offices: parsed.offices || {}
    };
  } catch (error) {
    console.error('DB corrupta. Usando default.', error);
    atomicWriteJson(DB_PATH, defaultDb);
    return structuredClone(defaultDb);
  }
}

let db = readDb();

function persistDb() {
  atomicWriteJson(DB_PATH, db);
}

function ensureOffice(office) {
  if (!db.offices[office]) {
    db.offices[office] = {
      config: structuredClone(defaultConfig),
      pcs: {},
      tokens: {
        masterToken: db.globalTokens.masterToken,
        opToken: db.globalTokens.opToken
      }
    };
  }
  return db.offices[office];
}

function getOfficeOpToken(office) {
  return db.offices[office]?.tokens?.opToken || db.globalTokens.opToken;
}

function getOfficeMasterToken(office) {
  return db.offices[office]?.tokens?.masterToken || db.globalTokens.masterToken;
}

function buildMasterSnapshot() {
  const offices = Object.entries(db.offices).map(([officeName, officeData]) => {
    const pcs = Object.entries(officeData.pcs || {}).map(([pcId, pc]) => ({
      pcId,
      ...pc
    }));
    return {
      office: officeName,
      config: officeData.config,
      tokens: officeData.tokens,
      pcs
    };
  });

  const pcsOnline = offices.reduce((acc, office) => {
    return acc + office.pcs.filter((pc) => pc.online).length;
  }, 0);

  return { offices, pcsOnline };
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/operator/:office/:pcId', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'operator.html'));
});

app.get('/master', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'master.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const masterSockets = new Set();
const operatorSocketMap = new Map(); // socket.id -> { office, pcId }

function emitMasterSnapshot() {
  const snapshot = buildMasterSnapshot();
  for (const socketId of masterSockets) {
    io.to(socketId).emit('master:snapshot', snapshot);
  }
}

function setPcStatus(office, pcId, online) {
  const officeData = ensureOffice(office);
  if (!officeData.pcs[pcId]) {
    officeData.pcs[pcId] = { name: pcId, lastSeen: 0, online: false };
  }
  officeData.pcs[pcId].online = online;
  officeData.pcs[pcId].lastSeen = Date.now();
  persistDb();
  io.to('master-room').emit('master:pcStatus', {
    office,
    pcId,
    online,
    lastSeen: officeData.pcs[pcId].lastSeen
  });
}

io.on('connection', (socket) => {
  socket.on('master:hello', ({ token }) => {
    const valid = Object.keys(db.offices).some((office) => getOfficeMasterToken(office) === token) || token === db.globalTokens.masterToken;
    if (!valid) {
      socket.emit('master:ack', { ok: false, error: 'Token master inválido' });
      socket.disconnect();
      return;
    }

    socket.join('master-room');
    masterSockets.add(socket.id);
    socket.data.role = 'master';
    socket.emit('master:ack', { ok: true });
    socket.emit('master:snapshot', buildMasterSnapshot());
  });

  socket.on('master:list', () => {
    if (socket.data.role !== 'master') return;
    socket.emit('master:snapshot', buildMasterSnapshot());
  });

  socket.on('master:createOffice', ({ office }) => {
    if (socket.data.role !== 'master' || !office) return;
    ensureOffice(office);
    persistDb();
    emitMasterSnapshot();
    socket.emit('master:ack', { ok: true });
  });

  socket.on('master:updateConfig', ({ office, config }) => {
    if (socket.data.role !== 'master') return;
    if (!office || !config || !Array.isArray(config.groups)) {
      socket.emit('master:ack', { ok: false, error: 'Payload inválido' });
      return;
    }

    const officeData = ensureOffice(office);
    officeData.config = config;
    persistDb();

    io.to(`office:${office}`).emit('operator:config', { office, config, pcId: null });
    emitMasterSnapshot();
    socket.emit('master:ack', { ok: true });
  });

  socket.on('master:updatePcMeta', ({ office, pcId, patch }) => {
    if (socket.data.role !== 'master') return;
    if (!office || !pcId || typeof patch !== 'object') {
      socket.emit('master:ack', { ok: false, error: 'Payload inválido' });
      return;
    }

    const officeData = ensureOffice(office);
    officeData.pcs[pcId] = {
      name: pcId,
      lastSeen: Date.now(),
      online: false,
      ...officeData.pcs[pcId],
      ...patch
    };

    persistDb();
    emitMasterSnapshot();
    socket.emit('master:ack', { ok: true });
  });

  socket.on('operator:hello', ({ office, pcId, meta, token }) => {
    if (!office || !pcId) {
      socket.emit('operator:notify', { type: 'error', message: 'office/pcId requeridos' });
      socket.disconnect();
      return;
    }

    ensureOffice(office);
    const expectedToken = getOfficeOpToken(office);
    if (token !== expectedToken && token !== db.globalTokens.opToken) {
      socket.emit('operator:notify', { type: 'error', message: 'Token operador inválido' });
      socket.disconnect();
      return;
    }

    const officeData = ensureOffice(office);
    officeData.pcs[pcId] = {
      name: pcId,
      lastSeen: Date.now(),
      online: true,
      ...officeData.pcs[pcId],
      ...(meta || {})
    };
    persistDb();

    socket.data.role = 'operator';
    socket.data.office = office;
    socket.data.pcId = pcId;
    socket.join(`office:${office}`);
    operatorSocketMap.set(socket.id, { office, pcId });

    socket.emit('operator:config', { office, pcId, config: officeData.config });
    io.to('master-room').emit('master:pcStatus', {
      office,
      pcId,
      online: true,
      lastSeen: officeData.pcs[pcId].lastSeen
    });
    emitMasterSnapshot();
  });

  socket.on('operator:ping', () => {
    if (socket.data.role !== 'operator') return;
    const { office, pcId } = socket.data;
    const officeData = ensureOffice(office);
    if (!officeData.pcs[pcId]) return;

    officeData.pcs[pcId].lastSeen = Date.now();
    officeData.pcs[pcId].online = true;
    persistDb();

    io.to('master-room').emit('master:pcStatus', {
      office,
      pcId,
      online: true,
      lastSeen: officeData.pcs[pcId].lastSeen
    });
  });

  socket.on('disconnect', () => {
    if (socket.data.role === 'master') {
      masterSockets.delete(socket.id);
      return;
    }

    if (socket.data.role === 'operator') {
      const { office, pcId } = socket.data;
      const officeData = ensureOffice(office);
      if (officeData.pcs[pcId]) {
        officeData.pcs[pcId].online = false;
        officeData.pcs[pcId].lastSeen = Date.now();
        persistDb();
      }
      operatorSocketMap.delete(socket.id);
      io.to('master-room').emit('master:pcStatus', {
        office,
        pcId,
        online: false,
        lastSeen: officeData.pcs[pcId]?.lastSeen || Date.now()
      });
      emitMasterSnapshot();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Chinbo server escuchando en http://localhost:${PORT}`);
});
