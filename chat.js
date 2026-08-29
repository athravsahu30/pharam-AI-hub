document.addEventListener("DOMContentLoaded", function() {
    let sendBtn = document.getElementById("sendBtn");
    let userInput = document.getElementById("userInput");
    let chatBox = document.getElementById("chatBox");

    // Yahan apni secret API key paste kariye
    const API_KEY = "AQ.Ab8RN6KBh_4UfahIjNjz2RLyMo2vsu3IvvIAYhQkfiKWWxVBzg"; 

    function addMessage(text, sender) {
        let msgDiv = document.createElement("div");
        msgDiv.classList.add("message");
        msgDiv.classList.add(sender === "user" ? "user-msg" : "bot-msg");
        msgDiv.innerHTML = text; 
        chatBox.appendChild(msgDiv);
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    const thinkingMessages = [
        "Let me check my database for that...",
        "Analyzing your query...",
        "Pulling up the latest pharmacological data...",
        "Just a second, retrieving information..."
    ];

    sendBtn.addEventListener("click", async function() {
        let text = userInput.value.trim();
        if (text === "") return;

        addMessage(text, "user");
        userInput.value = "";

        let randomThinking = thinkingMessages[Math.floor(Math.random() * thinkingMessages.length)];
        addMessage(randomThinking, "bot");

        // Asli AI API Call (Google Gemini)
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            // Yahan humne AI ko ek expert persona diya hai
                            text: "You are an expert B.Pharm professional and AI Pharma Assistant. Answer the following query strictly related to medicines, pharmacology, or healthcare. Keep it concise, accurate, and easy to understand. Format your response with basic HTML like <strong> for bold if needed, but do not use markdown like **. Query: " + text
                        }]
                    }]
                })
            });

            const data = await response.json();
            
            if (data.candidates && data.candidates[0].content.parts[0].text) {
                chatBox.lastChild.remove(); // Loading message hatana
                let aiResponse = data.candidates[0].content.parts[0].text;
                addMessage(aiResponse, "bot");
            } else {
                throw new Error("Invalid response");
            }

        } catch (error) {
            chatBox.lastChild.remove();
            addMessage("❌ Sorry, server connect nahi ho pa raha. Please apni API Key check karein ya thodi der mein try karein.", "bot");
        }
    });
});
