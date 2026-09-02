document.addEventListener("DOMContentLoaded", function() {
    const imageInput = document.getElementById("imageInput");
    const preview = document.getElementById("preview");
    const scanBtn = document.getElementById("scanBtn");
    const resultBox = document.getElementById("resultBox");
    const loader = document.getElementById("loader");

    // 👇 YAHAN APNI ASLI API KEY DAALIYE 👇
    const API_KEY = "AQ.Ab8RN6IUgRUMs3-VLgE6g_uAEI_pDi49PTpEO-3dIPOif591gw"; 

    let base64Image = "";
    let mimeType = "";

    // 1. Jab user photo select/click karega, tab kya hoga:
    imageInput.addEventListener("change", function(e) {
        const file = e.target.files[0];
        if (file) {
            mimeType = file.type;
            const reader = new FileReader();
            reader.onload = function(event) {
                // Photo screen par dikhana
                preview.src = event.target.result;
                preview.style.display = "block";
                scanBtn.style.display = "block";
                resultBox.style.display = "none";
                
                // Photo ko AI ke padhne layak (Base64) format mein todna
                base64Image = event.target.result.split(',')[1]; 
            };
            reader.readAsDataURL(file);
        }
    });

    // 2. "Read Prescription" button dabane par kya hoga:
    scanBtn.addEventListener("click", async function() {
        if (!base64Image) return;

        scanBtn.style.display = "none"; // Button chhupao
        loader.style.display = "block"; // Loader dikhao
        resultBox.style.display = "none";

        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            // AI ko Pharmacist wala prompt diya hai
                            { text: "You are an expert pharmacist. Read this medical prescription image carefully. Extract the Doctor's name, Patient's name/age (if any), and list the medicines with their dosages and instructions. Format the output cleanly using basic HTML tags like <b> for bold or <br> for new lines. Do NOT use markdown like **. If the handwriting is totally unreadable, politely state that." },
                            { inlineData: { mimeType: mimeType, data: base64Image } }
                        ]
                    }]
                })
            });

            const data = await response.json();
            loader.style.display = "none"; // Loader band karo
            
            if (data.candidates && data.candidates[0].content.parts[0].text) {
                let aiResponse = data.candidates[0].content.parts[0].text;
                // AI ka text screen par dikhana
                resultBox.innerHTML = aiResponse;
                resultBox.style.display = "block";
                scanBtn.style.display = "block"; // Wapas scan ka option dena
            } else {
                throw new Error("Invalid AI response");
            }

        } catch (error) {
            loader.style.display = "none";
            resultBox.innerHTML = "<b>❌ Error:</b> Could not read the image. Please check your API Key or try a clearer photo.";
            resultBox.style.display = "block";
            scanBtn.style.display = "block";
        }
    });
});
