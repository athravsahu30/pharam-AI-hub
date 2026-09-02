document.addEventListener("DOMContentLoaded", function() {
    const imageInput = document.getElementById("imageInput");
    const preview = document.getElementById("preview");
    const scanBtn = document.getElementById("scanBtn");
    const resultBox = document.getElementById("resultBox");
    const loader = document.getElementById("loader");

    // 👇 APNI NAYI API KEY YAHAN PASTE KARIYE (Quotes "" ke andar) 👇
    const API_KEY = "AQ.Ab8RN6IUgRUMs3-VLgE6g_uAEI_pDi49PTpEO-3dIPOif591gw"; 

    let base64Image = "";
    let mimeType = "";

    imageInput.addEventListener("change", function(e) {
        const file = e.target.files[0];
        if (file) {
            mimeType = file.type;
            const reader = new FileReader();
            reader.onload = function(event) {
                preview.src = event.target.result;
                preview.style.display = "block";
                scanBtn.style.display = "block";
                resultBox.style.display = "none";
                
                // Extract base64 part
                base64Image = event.target.result.split(',')[1]; 
            };
            reader.readAsDataURL(file);
        }
    });

    scanBtn.addEventListener("click", async function() {
        if (!base64Image) return;

        scanBtn.style.display = "none"; 
        loader.style.display = "block"; 
        resultBox.style.display = "none";

        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: "You are an expert pharmacist. Read this medical prescription image carefully. Extract the medicines, dosages, and instructions. Format the output cleanly using basic HTML tags like <br> for new lines and <b> for bold text. Do NOT use markdown symbols like **. Keep it clear and professional." },
                            { inlineData: { mimeType: mimeType, data: base64Image } }
                        ]
                    }]
                })
            });

            const data = await response.json();
            loader.style.display = "none"; 
            
            if (data.candidates && data.candidates[0].content.parts[0].text) {
                let aiResponse = data.candidates[0].content.parts[0].text;
                
                // Clean up any stray markdown just in case
                aiResponse = aiResponse.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
                
                resultBox.innerHTML = aiResponse;
                resultBox.style.display = "block";
                scanBtn.style.display = "block"; 
            } else {
                throw new Error("Invalid AI response");
            }

        } catch (error) {
            loader.style.display = "none";
            resultBox.innerHTML = "<b>❌ Error:</b> Prescription scan failed. Please check if your API Key is correct and active, or try a clearer photo.";
            resultBox.style.display = "block";
            scanBtn.style.display = "block";
        }
    });
});
