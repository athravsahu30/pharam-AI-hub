document.addEventListener("DOMContentLoaded", function() {
    let sendBtn = document.getElementById("sendBtn");
    let userInput = document.getElementById("userInput");
    let chatBox = document.getElementById("chatBox");

    // 👇 YAHAN APNI ASLI API KEY DAALIYE 👇
    const API_KEY = "AQ.Ab8RN6KBh_4UfahIjNjz2RLyMo2vsu3IvvIAYhQkfiKWWxVBzg"; 

    function addMessage(text, sender) {
        let msgDiv = document.createElement("div");
        msgDiv.classList.add("message");
        msgDiv.classList.add(sender === "user" ? "user-msg" : "bot-msg");
        msgDiv.innerHTML = text; 
        chatBox.appendChild(msgDiv);
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    sendBtn.addEventListener("click", async function() {
        let text = userInput.value.trim();
        if (text === "") return;

        // User message show karna
        addMessage(text, "user");
        userInput.value = "";

        // Loading message show karna
        addMessage("Analyzing your query... ⏳", "bot");

        // Asli AI API Call (Google Gemini)
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: "You are an expert B.Pharm professional and AI Pharma Assistant. Answer the following query strictly related to medicines, pharmacology, or healthcare. Keep it concise, accurate, and easy to understand. Format your response with basic HTML like <b> for bold if needed. Query: " + text
                        }]
                    }]
                })
            });

            const data = await response.json();
            
            if (data.candidates && data.candidates[0].content.parts[0].text) {
                chatBox.lastChild.remove(); // Loading message hatana
                let aiResponse = data.candidates[0].content.parts[0].text;
                
                // Markdown ko hatane ka chhota sa code taaki text clean dikhe
                aiResponse = aiResponse.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>'); 
                
                addMessage(aiResponse, "bot");
            } else {
                throw new Error("Invalid response");
            }

        } catch (error) {
            chatBox.lastChild.remove();
            addMessage("❌ Sorry, AI server se connect nahi ho pa raha. API Key check karein ya refresh karein.", "bot");
        }
    });
});
