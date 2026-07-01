async function handleDrawFunction(m, sock, promptDraw, userId, generateAIResponseGemini, parts) {
	const psforDraw = "; adalah prompt untuk image generator, ubahlah prompt ini menjadi detail, terinci, lebih deskriptif dan lebih artistik, perkirakankan user ingin gambar yang realistis atau gambar yang ilustratif. DAN KAMU WAJIB MEMBERIKAN JAWABAN DENGAN FORMAT: [PROMPTDETAIL] | [PILIHAN MODEL]. PILIHAN MODEL HANYA BOLEH ANATARA 'zimage' dan 'flux' contoh: 'Batman in his iconic Batsuit, with his cape subtly fluttering, crouching on the edge of a towering gothic-deco skyscraper, overlooking the pitch-black Gotham City cityscape at night Streets are wet from recently subsided rain, neon lights flicker in the distance, and a thin fog envelops other tall buildings Photo taken from behind, with a dramatic and cinematic extreme long shot perspective, focusing on Batman's silhouette and the vastness of the city below him, highly detailed, moody lighting, dark aesthetic, realistic, cinematic noir atmosphere|zimage'";
	parts.push(promptDraw + psforDraw);
	
	const responMentah = await generateAIResponseGemini(parts);
	const hasilGemini = responMentah.split('|').map(item => item.trim());
	const DrawDesc = hasilGemini[0];
	const DrawModel = hasilGemini[1];
	const DrawRatio = "16:9";
	const DrawAPI = "sk_dEuqNcinlMpsYn1ZJujeYtrgGAh2og19";
	const DrawSeed = Math.floor(Math.random() * 1000000);
	const width = 1280;
	const height = 720;

	const pollinationsLink = `https://gen.pollinations.ai/image/${encodeURIComponent(DrawDesc)}?seed=${DrawSeed}&width=${width}&height=${height}&model=${DrawModel}&nologo=true&key=${DrawAPI}`;

	await sock.sendMessage(userId, { 
		image: { url: pollinationsLink }, 
		caption: `*Prompt:* ${DrawDesc}\n*Model:* ${DrawModel}\n*Seed:* ${DrawSeed}` 
	}, { quoted: m });
}
module.exports = { handleDrawFunction };