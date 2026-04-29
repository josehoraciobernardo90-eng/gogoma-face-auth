const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http'); // Nativo
const https = require('https'); // Nativo

// Redirecionar erros para um arquivo físico para que eu possa analisar autonomamente
const logPath = path.join(__dirname, 'sentinel_debug.log');
const logStream = fs.createWriteStream(logPath, { flags: 'a' });
console.log = (d) => { logStream.write(`[${new Date().toISOString()}] LOG: ${d}\n`); process.stdout.write(d + '\n'); };
console.error = (d) => { logStream.write(`[${new Date().toISOString()}] ERROR: ${d}\n`); process.stderr.write(d + '\n'); };

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '100mb' })); // Aumentado para suportar fotos em alta resolução

// Diretorios de Dados
const DATA_DIR = path.join(__dirname, 'data');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const CAPTURES_DIR = path.join(DATA_DIR, 'captures');

// Garantir diretorios de forma robusta
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CAPTURES_DIR)) fs.mkdirSync(CAPTURES_DIR, { recursive: true });

const ensureFile = (file, defaultData) => {
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(defaultData));
};

ensureFile(LOGS_FILE, []);
ensureFile(USERS_FILE, []);
ensureFile(CONFIG_FILE, { cameraIp: "192.168.1.5", isArmed: false, isPanic: false });

// --- Rotas ---

app.get('/api/users', (req, res) => {
    const data = JSON.parse(fs.readFileSync(USERS_FILE));
    res.json(data);
});

app.post('/api/users/register', (req, res) => {
    const { name, descriptors } = req.body;
    try {
        const users = JSON.parse(fs.readFileSync(USERS_FILE));
        users.push({ 
            id: Date.now().toString(),
            name, 
            descriptors,
            registeredAt: new Date().toISOString() 
        });
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
        console.log(`[Gogoma] Novo utilizador: ${name}`);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/config', (req, res) => {
    const data = JSON.parse(fs.readFileSync(CONFIG_FILE));
    res.json(data);
});

app.post('/api/config', (req, res) => {
    const { cameraIp, isArmed, isPanic } = req.body;
    try {
        const config = JSON.parse(fs.readFileSync(CONFIG_FILE));
        
        // Bloqueio de Pânico Automático se estiver desarmado (Manual ignorado)
        if (isPanic === true && isArmed === undefined && config.isArmed === false && !req.body.manual) {
            console.log("[SENTINEL] Tentativa de pânico automático bloqueada (Sistema Desarmado)");
            return res.json({ success: false, message: "Bloqueado: Sistema Desarmado" });
        }

        if (cameraIp !== undefined) config.cameraIp = cameraIp;
        if (isArmed !== undefined) config.isArmed = isArmed;
        if (isPanic !== undefined) config.isPanic = isPanic;

        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        console.log(`[Gogoma] Configuração atualizada: Armed=${config.isArmed}, Panic=${config.isPanic}`);
        res.json({ success: true, config });
    } catch (error) {
        console.error(`[Gogoma] ERRO ao salvar config: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/logs', (req, res) => {
    const data = JSON.parse(fs.readFileSync(LOGS_FILE));
    res.json(data);
});

app.post('/api/logs', (req, res) => {
    const { label, image, timestamp, isRecognized } = req.body;
    try {
        const logs = JSON.parse(fs.readFileSync(LOGS_FILE));
        
        // Salvar imagem física no disco
        const filename = `capture_${Date.now()}.jpg`;
        const filepath = path.join(CAPTURES_DIR, filename);
        const base64Data = image.replace(/^data:image\/jpeg;base64,/, "");
        fs.writeFileSync(filepath, base64Data, 'base64');

        const newEntry = {
            id: Date.now().toString(),
            label,
            imageUrl: `/api/captures/${filename}`,
            timestamp,
            isRecognized
        };
        
        logs.unshift(newEntry);
        fs.writeFileSync(LOGS_FILE, JSON.stringify(logs.slice(0, 100), null, 2));
        
        console.log(`[Gogoma] Captura salva localmente: ${label}`);
        res.json({ success: true });
    } catch (error) {
        console.error("Erro ao salvar log local:", error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/logs', (req, res) => {
    try {
        fs.writeFileSync(LOGS_FILE, JSON.stringify([]));
        console.log("[Gogoma] Histórico de logs locais limpo.");
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Servir as fotos salvas
app.use('/api/captures', express.static(CAPTURES_DIR));

// --- ROTA DE VIDEO PROXY (TECNOLOGIA DE PONTA) ---
app.get('/api/video-proxy', (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send("URL da câmera ausente");

    console.log(`[Proxy] Iniciando túnel de vídeo para: ${targetUrl}`);
    
    const client = targetUrl.startsWith('https') ? https : http;

    const request = client.get(targetUrl, (remoteRes) => {
        // Repassa os cabeçalhos de vídeo (MJPEG)
        res.writeHead(remoteRes.statusCode, remoteRes.headers);
        remoteRes.pipe(res);
    });

    request.on('error', (e) => {
        console.error(`[Proxy Error] Falha ao conectar na câmera: ${e.message}`);
        res.status(500).send("Câmera Offline ou Inacessível");
    });
});

const PORT = 3001;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`=======================================================`);
    console.log(`[Gogoma Sentinel] SERVIDOR ATIVO EM http://127.0.0.1:3001`);
    console.log(`=======================================================`);
});
