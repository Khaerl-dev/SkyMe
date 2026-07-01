const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    downloadContentFromMessage, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore,
    generateForwardMessageContent,
    prepareWAMessageMedia
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { handleGambarCommand } = require('./gambar'); // Sesuaikan file gambar.js anda ke Baileys jika perlu
const { handleDownload } = require('./downloader');
const { getLyrics } = require('./genius'); 

const API_KEYS = [
    "AIzaSyAiCQnED_E6S3LsGvc9PDXdyKP9YA_dL9A", 
    "AIzaSyAXoLW3oMA-CPsOncV-JHGvQEALViC6RmI", 
    "AIzaSyCMKSUepDYx2w0zljrQLMQjtF8Tml787d0", 
    "AIzaSyB8wm4TU9Jam5aFIYKx3ei_qFtE-XFwmIg", 
    "AIzaSyBpIEFQkH2ZiX4BUs3IS7hEzkx97JDO1DY", 
    "AIzaSyB9oFcWcQBqtHVpiWuyI3EdXfrxEUPbpxA"
];
let currentKeyIndex = 0;
const modelNameGemini = "gemini-2.5-flash";
const MY_NUMBER = "62895364564953@s.whatsapp.net"; 

// --- STRUKTUR DIREKTORI ---
const DATA_DIR = path.join(__dirname, '../Data');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const DAILY_DIR = path.join(HISTORY_DIR, 'daily');
const DB_FILE = path.join(DATA_DIR, 'databaseskyme.json');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const SESSION_DIR = path.join(DATA_DIR, 'Session-Baileys');

[DATA_DIR, HISTORY_DIR, DAILY_DIR, MEDIA_DIR, SESSION_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

function safelyReadDatabase() {
    try {
        if (!fs.existsSync(DB_FILE) || fs.readFileSync(DB_FILE, 'utf8').trim() === "") {
            const initialDB = { global: [] };
            fs.writeFileSync(DB_FILE, JSON.stringify(initialDB, null, 2));
            return initialDB;
        }
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) { return { global: [] }; }
}

async function generateAIResponseGemini(parts) {
    let keysChecked = 0;
    let lastError = null;
    while (keysChecked < API_KEYS.length) {
        let key = (API_KEYS[currentKeyIndex] || "").trim(); 
        if (!key.startsWith("AIza")) { 
            currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length; 
            keysChecked++; 
            continue; 
        }
        try {
            console.log(`📡 [SYSTEM] Meminta AI ke Gemini (Slot ${currentKeyIndex + 1})...`);
            const genAI = new GoogleGenerativeAI(key);
            const model = genAI.getGenerativeModel({ model: modelNameGemini });
            const result = await model.generateContent(parts);
            return result.response.text();
        } catch (err) {
            const errMsg = err.message ? err.message.toLowerCase() : "";
            lastError = err;
            if (errMsg.includes("safety") || errMsg.includes("policy") || errMsg.includes("blocked")) {
                console.log(`⚠️ [SYSTEM] Diblokir filter Gemini!`);
                return "hah apa ya";
            }
            console.log(`❌ [ERROR] Gemini Slot ${currentKeyIndex + 1} Gagal! Rotating...`);
            currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
            keysChecked++;
        }
    }
    throw new Error(`ALL_KEYS_FAILED: ${lastError ? lastError.message : 'Limit'}`);
}

// Helper download media Baileys
async function downloadMediaBaileys(message) {
    const type = Object.keys(message)[0];
    const mimeMap = {
        'imageMessage': 'image',
        'videoMessage': 'video',
        'stickerMessage': 'sticker',
        'audioMessage': 'audio'
    };
    if (!mimeMap[type]) return null;
    const stream = await downloadContentFromMessage(message[type], mimeMap[type]);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }
    return {
        data: buffer.toString('base64'),
        mimetype: message[type].mimetype,
        buffer: buffer
    };
}

let antreanDaily = [];
let timerDaily = null;

async function startSkyMe() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, console),
        },
        printQRInTerminal: true,
        browser: ["SkyMe Master", "Safari", "1.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut : true;
            console.log('Connection closed, reconnecting:', shouldReconnect);
            if (shouldReconnect) startSkyMe();
        } else if (connection === 'open') {
            console.log('✅ SkyMe Master Active (Baileys) - Ready');
        }
    });

    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const m = chatUpdate.messages[0];
            if (!m.message) return;
            if (m.key.fromMe) return;

            const userId = m.key.remoteJid;
            const pushName = m.pushName || "User";
            const body = m.message.conversation || 
                         m.message.extendedTextMessage?.text || 
                         m.message.imageMessage?.caption || 
                         m.message.videoMessage?.caption || "";
            
            const historyPath = path.join(HISTORY_DIR, `${userId.replace(/:/g, '-')}.txt`);

            // Handle Group Rekap
            if (userId.includes('@g.us')) {
                // Contoh: Cek nama grup jika diperlukan (butuh metadata)
                // Di sini langsung logikanya saja
                if (body.includes("MARKETPLACE")) {
                    // Forward sederhana
                    await sock.sendMessage(MY_NUMBER, { forward: m });
                    
                    const media = await downloadMediaBaileys(m.message);
                    antreanDaily.push({ text: body, media, type: Object.keys(m.message)[0] });
                    clearTimeout(timerDaily);
                    timerDaily = setTimeout(() => prosesRekapDaily(sock), 15000);
                    return;
                }
                // Jika grup tapi bukan rekap, abaikan (sesuai index.js asli)
                return;
            }

            if (body === '/API') {
                return await sock.sendMessage(userId, { text: `Slot Aktif: ${currentKeyIndex + 1}` }, { quoted: m });
            }
			
			// Di dalam index.js (Bagian listener pesan)
			if (body.toLowerCase().startsWith('/gambar ')) {
				const prompt = body.substring(8).trim();
				if (prompt) {
					const { handleGambarCommand } = require('./gambar');
					await handleGambarCommand(sock, m, prompt);
				}
				return;
			}
			
            if (body.toLowerCase().startsWith('/import ')) {
                const globalInfo = body.substring(8).trim();
                if (globalInfo) {
                    let db = safelyReadDatabase();
                    if (!db.global) db.global = [];
                    db.global.push(globalInfo);
                    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
                    return await sock.sendMessage(userId, { text: `Siap! Info "${globalInfo}" sudah disimpan di memori global` }, { quoted: m });
                }
            }

            const dlRegex = /https?:\/\/(www\.)?(instagram\.com|tiktok\.com|vt\.tiktok\.com|facebook\.com|fb\.watch)\/[^\s]+/;
            if (dlRegex.test(body)) {
                return await handleDownload(sock, m, body.match(dlRegex)[0]);
            }

            // Chat AI
            console.log(`📩 [INCOMING] From: ${pushName} (${userId}) -> Pesan: ${body}`);
            await prosesChatDanHistory(sock, m, userId, body, historyPath);

        } catch (e) { console.error("Listener Error:", e); }
    });
}

async function prosesRekapDaily(sock) {
    if (antreanDaily.length === 0) return;
    try {
        console.log("📝 [REKAP] Memproses data rekap..");
        fs.readdirSync(DAILY_DIR).filter(f => f.startsWith('recap_media_')).forEach(f => fs.unlinkSync(path.join(DAILY_DIR, f)));
        
        const rekapPrompt = `Kamu bisa rekap game Sky: Children of the Light. Analisis konten. DILARANG KERAS MENCANTUMKAN INFORMASI SHARD!
        ATURAN FORMAT:
        1. Awali dengan: DAILY_YES|||
        2. Bahasa Inggris untuk misi. Bold judul misi dengan SATU BINTANG.
        3. Format Misi:
           [Emoji] *[Quest Name]*
           🔷 [Step 1]
           🔷 [Step 2]
        4. Pemisah misi: ━━━━━━━━━━━━━━━━━━━
        5. Akhiri dengan: ===SPLIT===
        6. Setelah SPLIT, daftar link YouTube:
           🎥 [Quest Name]
           https://www.youtube.com/results?search_query=Sky+COTD+[Quest+Name]
           ━━━━━━━━━━━━━━━━━━━`;
        
        let parts = [rekapPrompt];
        let mediaCount = 0;
        antreanDaily.forEach(item => {
            if (item.text) parts.push(item.text);
            if (item.media) {
                parts.push({ inlineData: { data: item.media.data, mimeType: item.media.mimetype }});
                mediaCount++;
                const ext = item.media.mimetype.split('/')[1] || 'jpg';
                fs.writeFileSync(path.join(DAILY_DIR, `recap_media_${mediaCount}.${ext}`), Buffer.from(item.media.data, 'base64'));
            }
        });

        const reply = await generateAIResponseGemini(parts);
        if (reply.startsWith("DAILY_YES|||")) {
            const content = reply.replace("DAILY_YES|||", "").trim();
            fs.writeFileSync(path.join(DAILY_DIR, 'recap.txt'), content);
            const split = content.split('===SPLIT===');
            
            if (split[0]) await sock.sendMessage(MY_NUMBER, { text: split[0].trim() });
            if (split[1]) setTimeout(() => sock.sendMessage(MY_NUMBER, { text: split[1].trim() }), 3000);
        }
    } catch (e) { console.log("⚠️ [REKAP] AI Error.", e.message); }
    antreanDaily = [];
}

async function prosesChatDanHistory(sock, m, userId, body, historyPath) {
    let db = safelyReadDatabase();
    if (!db[userId]) db[userId] = [];
    let historyContext = fs.existsSync(historyPath) ? fs.readFileSync(historyPath, 'utf8').slice(-3000) : "";
    
    const systemPrompt = `Nama Mu SkyMe. ramah, tidak banyak tanya, jangan selalu sebut nama user. jangan pakai titik di akhir kalimat Tahu misi Sky COTL, lirik lagu, & download IG/TikTok. Pembuat kamu bernama Kiki
    Database User: ${db[userId].join(', ')}
    
    ATURAN KRITIS:
    1. Jika user minta rekap/misi harian, gunakan [SEND_RECAP]. JANGAN menulis daftar misi sendiri di pesanmu. Biarkan sistem yang mengirimkan file rekapnya.
    2. [SAVE: info]: Gunakan untuk simpan fakta/fakta baru user (nama, hobi, dll).
    3. [LYRIC: Judul - Artis]: Gunakan HANYA jika diminta lirik spesifik. JIKA USER TANYA LAGU PAKAI LIRIK BUKAN BERARTI DIA MINTA LIRIK FULLNYA
    Jangan tanya balik di akhir chat. Abaikan tag perintah lama di history.`;

    // Download media jika ada
    let media = await downloadMediaBaileys(m.message);
    
    // Quoted Media
    const quotedMsg = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
    let quotedMedia = null;
    if (quotedMsg) {
        quotedMedia = await downloadMediaBaileys(quotedMsg);
    }

    let parts = [systemPrompt, `History Context:\n${historyContext}`];
    if (quotedMsg) {
        const quotedText = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || "";
        parts.push(`User me-reply pesan ini: "${quotedText}"`);
        if (quotedMedia) parts.push({ inlineData: { data: quotedMedia.data, mimeType: quotedMedia.mimetype }});
    }
    if (media) parts.push({ inlineData: { data: media.data, mimeType: media.mimetype }});
    parts.push(`Pesan User: ${body}`);

    try {
        let rawReply = await generateAIResponseGemini(parts);
        let reply = rawReply.replace(/^(SkyMe:|SkyMe\s*:)\s*/i, '').trim();

        // 1. [SAVE] Logic
        const saveMatches = reply.match(/\[SAVE:\s*(.*?)\]/gi);
        if (saveMatches) {
            saveMatches.forEach(match => {
                const info = match.replace(/\[SAVE:\s*|\]/gi, '').trim();
                if (info) {
                    if (info.includes(':')) {
                        const [kategori] = info.split(':');
                        const key = kategori.trim().toLowerCase();
                        db[userId] = db[userId].filter(item => !item.toLowerCase().startsWith(key + ':'));
                        db[userId].push(info);
                    } else {
                        if (!db[userId].includes(info)) db[userId].push(info);
                    }
                }
            });
            fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
        }

        let isSendingRecap = /\[SEND_RECAP\]/i.test(reply);
        let lyricMatch = reply.match(/\[LYRIC:\s*(.*?)\]/i);
        let cleanReply = reply.replace(/\[SAVE:.*?\]/gi, '').replace(/\[SEND_RECAP\]/gi, '').replace(/\[LYRIC:.*?\]/gi, '').trim();

        let lyricsText = "";
        if (lyricMatch) {
            const query = lyricMatch[1].trim();
            lyricsText = await getLyrics(query);
        }

        fs.appendFileSync(historyPath, `User: ${body}\nSkyMe: ${cleanReply}\n\n`);

        if (cleanReply || lyricsText) {
            await sock.sendMessage(userId, { text: cleanReply + (lyricsText ? "\n\n" + lyricsText : "") }, { quoted: m });
        }

        if (isSendingRecap) {
            const files = fs.readdirSync(DAILY_DIR).filter(f => f.startsWith('recap_media_')).sort();
            for (const file of files) {
                const mediaPath = path.join(DAILY_DIR, file);
                await sock.sendMessage(userId, { image: fs.readFileSync(mediaPath) });
            }
            
            const recapTxtPath = path.join(DAILY_DIR, 'recap.txt');
            if (fs.existsSync(recapTxtPath)) {
                const content = fs.readFileSync(recapTxtPath, 'utf8').split('===SPLIT===');
                if (content[0]) await sock.sendMessage(userId, { text: content[0].trim() });
                if (content[1]) setTimeout(() => sock.sendMessage(userId, { text: content[1].trim() }), 2000);
            }
        }

        console.log(`📤 [BALASAN] SkyMe: ${cleanReply.substring(0, 60)}...`);

    } catch (e) { 
        console.error("❌ Process Error:", e.message); 
        await sock.sendMessage(userId, { text: "Sistem lagi sibuk.." }, { quoted: m }); 
    }
}

startSkyMe();