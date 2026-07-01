const Genius = require("genius-lyrics");
const Client = new Genius.Client();

/**
 * Fungsi getLyrics dengan pembersihan metadata agresif
 * Membuang daftar bahasa (Turkish, German, dll) dan bait terjemahan.
 */
async function getLyrics(query) {
    try {
        console.log(`🔍 [GENIUS] Mencari lirik untuk: ${query}`);
        
        const searches = await Client.songs.search(query);
        
        if (searches.length === 0) {
            console.log(`❌ [GENIUS] Tidak ditemukan: ${query}`);
            return `\n\n_(Waduh, lirik buat "${query}" nggak ketemu di database nih bro)_`;
        }
        
        // Pilih hasil pertama yang judulnya tidak mengandung indikator terjemahan
        let song = searches.find(s => 
            !s.title.toLowerCase().includes('translation') && 
            !s.title.toLowerCase().includes('çeviri') && 
            !s.title.toLowerCase().includes('übersetzung') &&
            !s.title.toLowerCase().includes('german')
        ) || searches[0];
        
        let lyrics = await song.lyrics();
        
        // --- PROSES PEMBERSIHAN METADATA AGRESIF ---

        // 1. Buang tag HTML jika terbawa
        lyrics = lyrics.replace(/<[^>]*>/g, '');

        // 2. Buang blok Contributors & Translations yang sangat panjang di atas
        lyrics = lyrics.replace(/^\d+\s*ContributorsTranslations[\s\S]*?Lyrics/i, '');

        // 3. Potong semua teks sampah di bagian atas sampai bait pertama ditemukan
        const firstBracket = lyrics.indexOf('[');
        if (firstBracket !== -1 && firstBracket < 800) {
            lyrics = lyrics.substring(firstBracket);
        } else {
            lyrics = lyrics.replace(/^[\s\S]*?Lyrics\s*/i, '');
        }

        // 4. Hapus sampah di bagian bawah (Embed, You might juga like)
        lyrics = lyrics.replace(/You might also like[\s\S]*$/i, '');
        lyrics = lyrics.replace(/\d*Embed$/i, '');

        // 5. Normalisasi baris kosong (Maksimal 2 baris baru berurutan)
        lyrics = lyrics.replace(/\n{3,}/g, '\n\n');

        // 6. Hapus spasi/baris kosong di awal dan akhir
        lyrics = lyrics.trim();

        // 7. Filter Bait Terjemahan (De-duplikasi & Buang bahasa asing)
        const stanzas = lyrics.split('\n\n');
        const filteredStanzas = [];
        for (let stanza of stanzas) {
            let s = stanza.trim();
            if (!s) continue;
            
            // Buang bait yang mengandung kata kunci bahasa asing
            const foreignKeywords = [
                'çeviri', 'turkish', 'translation', 'terjemahan', 
                'übersetzung', 'deutsche', 'german', 'slovenščina', 'русский'
            ];
            const isForeign = foreignKeywords.some(key => s.toLowerCase().includes(key));
            
            if (!isForeign && !filteredStanzas.includes(s)) {
                filteredStanzas.push(s);
            }
        }
        lyrics = filteredStanzas.join('\n\n');
        
        console.log(`✅ [GENIUS] Berhasil mengambil lirik: ${song.title}`);

        // --- FORMAT OUTPUT ---
        return `🎶 *${song.title}* 🎶\n🎤 *${song.artist.name}* 🎤\n\n${lyrics}\n\n🎵✨`;
        
    } catch (err) {
        console.error(`\n❌ [GENIUS ERROR] ${err.message}`);
        return `\n\n_(Maaf bro, SkyMe gagal ngambil lirik karena masalah teknis server Genius)_`;
    }
}

module.exports = { getLyrics };