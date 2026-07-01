const { SnapSaver } = require('snapsaver-downloader');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const MEDIA_DIR = path.resolve(__dirname, '../Data/media');

/**
 * Handle Download menggunakan Baileys
 * @param {import('@whiskeysockets/baileys').WASocket} sock 
 * @param {import('@whiskeysockets/baileys').proto.IWebMessageInfo} m 
 * @param {string} url 
 */
async function handleDownload(sock, m, url) {
    const remoteJid = m.key.remoteJid;
    
    // Fungsi pembantu untuk reply sederhana
    const reply = async (text) => {
        await sock.sendMessage(remoteJid, { text }, { quoted: m });
    };

    try {
        console.log(`📥 [SNAP-SAVER] Memproses link: ${url}`);
        const result = await SnapSaver(url);

        if (result.success && result.data.media && result.data.media.length > 0) {
            const mediaItem = result.data.media[0];
            const mediaUrl = mediaItem.url;
            
            // --- ANTI UNDEFINED (Menebak Sumber) ---
            let source = result.data.source;
            if (!source || source === "undefined") {
                if (url.includes('tiktok.com')) source = 'TikTok';
                else if (url.includes('instagram.com')) source = 'Instagram';
                else if (url.includes('facebook.com')) source = 'Facebook';
                else source = 'Internet';
            }

            // --- LOGIKA PAKSA MP4 & ANTI UNDEFINED TIPE ---
            let isVideo = true; 
            const libraryType = String(result.data.type).toLowerCase();
            if (libraryType === 'photo' || libraryType === 'image' || mediaUrl.includes('.jpg') || mediaUrl.includes('.png')) {
                isVideo = false;
            }
            if (mediaUrl.includes('.mp4') || mediaUrl.includes('video')) isVideo = true;

            const fileExt = isVideo ? '.mp4' : '.jpg';
            const fileName = `SKY_DL_${Date.now()}${fileExt}`;
            const filePath = path.join(MEDIA_DIR, fileName);

            console.log(`⏳ [SNAP-SAVER] Download dari ${source} sebagai ${fileExt}`);

            const response = await axios({
                url: mediaUrl,
                method: 'GET',
                responseType: 'stream',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
                }
            });

            const writer = fs.createWriteStream(filePath);
            response.data.pipe(writer);

            return new Promise((resolve) => {
                writer.on('finish', async () => {
                    try {
                        const stats = fs.statSync(filePath);
                        const fileSizeInMB = stats.size / (1024 * 1024);
                        
                        console.log(`✅ [SNAP-SAVER] Tersimpan: ${fileName} (${fileSizeInMB.toFixed(2)} MB)`);

                        if (fileSizeInMB > 16) {
                            await reply(`Video dari ${source} kegedean (${fileSizeInMB.toFixed(2)}MB). Ini linknya: ${mediaUrl}`);
                        } else {
                            await new Promise(r => setTimeout(r, 1500));
                            
                            // Kirim menggunakan Baileys socket
                            const content = isVideo ? { video: fs.readFileSync(filePath) } : { image: fs.readFileSync(filePath) };
                            
                            await sock.sendMessage(remoteJid, {
                                ...content,
                                caption: `Nih hasilnya dari ${source}`
                            }, { quoted: m });
                        }
                    } catch (sendErr) {
                        console.error("❌ [SEND ERROR]:", sendErr.message);
                        await reply(`Gagal kirim file dari ${source}, pake link aja ya: ${mediaUrl}`);
                    }
                    resolve(true);
                });
                writer.on('error', (err) => {
                    console.error("❌ [WRITE ERROR]:", err.message);
                    resolve(false);
                });
            });
        } else {
            throw new Error(result.message || "Media tidak ditemukan");
        }
    } catch (error) {
        console.error('❌ [FATAL ERROR]:', error.message);
        await reply("Duh, gagal download. Cek linknya lagi ya");
    }
}

module.exports = { handleDownload };